using System.Net;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using static Journeys.Server.AdminApi;
using Row = System.Collections.Generic.Dictionary<string, object?>;

namespace Journeys.Server;

internal static class GameApi
{
    private static string Hash(string token) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(token)));

    internal static long Authenticate(Db db, HttpContext context) => db.Write(() =>
    {
        var authorization = context.Request.Headers.Authorization.ToString();
        if (!AuthenticationHeaderValue.TryParse(authorization, out var header) ||
            !header.Scheme.Equals("Bearer", StringComparison.OrdinalIgnoreCase) || string.IsNullOrEmpty(header.Parameter))
            throw new ApiError(401, "A valid session is required.");
        var hash = Hash(header.Parameter);
        var now = Db.Now();
        var session = db.Row("""
            SELECT s.player_id, p.status FROM sessions s JOIN players p ON p.id = s.player_id
            WHERE s.token_hash = $hash AND s.expires > $now
            """, ("hash", hash), ("now", now)) ?? throw new ApiError(401, "A valid session is required.");
        if ((string)session["status"]! == "banned") throw new ApiError(403, "This player is banned.");
        var playerId = (long)session["playerId"]!;
        db.Execute("UPDATE sessions SET last_used = $now WHERE token_hash = $hash", ("now", now), ("hash", hash));
        db.Execute("UPDATE players SET last_seen = $now WHERE id = $id", ("now", now), ("id", playerId));
        context.Items["playerId"] = playerId;
        context.Items["tokenHash"] = hash;
        return playerId;
    });

    public static void MapGame(this WebApplication app, bool devSignin, bool botSignin = false)
    {
        var api = app.MapGroup("/api");
        api.MapWallet();
        api.MapPost("/auth/discord", async (HttpRequest request, Db db, IHttpClientFactory clients) =>
        {
            var body = await Body(request, "accessToken");
            var token = Text(body, "accessToken");
            if (token.Any(char.IsWhiteSpace) || token.Any(char.IsControl)) throw new ApiError(401, "Discord rejected this access token.");
            using var message = new HttpRequestMessage(HttpMethod.Get, "users/@me");
            message.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
            try
            {
                using var response = await clients.CreateClient("discord").SendAsync(message, request.HttpContext.RequestAborted);
                if (response.StatusCode is HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden)
                    throw new ApiError(401, "Discord rejected this access token.");
                if (!response.IsSuccessStatusCode) throw new ApiError(502, "Discord sign-in is unavailable.");
                using var document = await JsonDocument.ParseAsync(await response.Content.ReadAsStreamAsync(), cancellationToken: request.HttpContext.RequestAborted);
                var user = document.RootElement;
                var discordId = Text(user, "id");
                var name = user.TryGetProperty("global_name", out var global) && global.ValueKind == JsonValueKind.String && !string.IsNullOrWhiteSpace(global.GetString())
                    ? global.GetString()! : Text(user, "username");
                return SignIn(db, discordId, name);
            }
            catch (HttpRequestException) { throw new ApiError(502, "Discord sign-in is unavailable."); }
            catch (TaskCanceledException) when (!request.HttpContext.RequestAborted.IsCancellationRequested)
            { throw new ApiError(502, "Discord sign-in timed out."); }
        });

        api.MapPost("/auth/dev", async (HttpRequest request, Db db) =>
        {
            if (!devSignin && !botSignin) throw new ApiError(404, "Endpoint not found.");
            // Only callers on this machine: a request through the HTTPS proxy carries forwarding headers.
            var address = request.HttpContext.Connection.RemoteIpAddress;
            var proxied = request.Headers.ContainsKey("X-Forwarded-For") || request.Headers.ContainsKey("X-Real-IP") || request.Headers.ContainsKey("Forwarded");
            if (proxied || address is null || !IPAddress.IsLoopback(address.IsIPv4MappedToIPv6 ? address.MapToIPv4() : address))
                throw new ApiError(403, "Development sign-in requires a loopback address.");
            var body = await Body(request, "name", "display");
            var name = Text(body, "name");
            var bot = System.Text.RegularExpressions.Regex.Match(name, "^Bot ([0-9]{2,3})$");
            if (!devSignin && !bot.Success) throw new ApiError(403, "Only bot players sign in here.");
            if (!bot.Success) return SignIn(db, null, name);
            // A bot is its slot whatever the admin console names it (display); the first time, it takes over the player
            // it was before, found by its old name.
            var key = $"bot:{int.Parse(bot.Groups[1].Value)}";
            db.Execute("""
                UPDATE players SET discord_id = $key WHERE id = (SELECT MIN(id) FROM players WHERE discord_id IS NULL AND name = $name)
                AND NOT EXISTS (SELECT 1 FROM players WHERE discord_id = $key)
                """, ("key", key), ("name", name));
            return SignIn(db, key, body.TryGetProperty("display", out _) ? Text(body, "display") : name);
        });

        api.MapPost("/auth/signout", (HttpContext context, Db db) =>
        {
            Authenticate(db, context);
            db.Execute("DELETE FROM sessions WHERE token_hash = $hash", ("hash", context.Items["tokenHash"]));
            return Results.Ok(new { signedOut = true });
        });

        api.MapGet("/me", (HttpContext context, Db db) =>
        {
            var id = PlayerId(context);
            var player = Player(db, id);
            player["ratings"] = db.Rows("SELECT * FROM ratings WHERE player_id = $id ORDER BY playlist", ("id", id));
            player["bag"] = db.Rows("SELECT * FROM bag WHERE player_id = $id ORDER BY item", ("id", id));
            player["vault"] = db.Rows($"SELECT {Vault.Columns} FROM vault WHERE player_id = $id AND removed = 0 AND state IN ('stored','withdrawing') ORDER BY id", ("id", id));
            return Results.Ok(player);
        });

        // The character from the hub's creator, kept with the account: a new install skips the creator.
        api.MapGet("/character", (HttpContext context, Db db) =>
        {
            var look = db.Row("SELECT look FROM characters WHERE player_id = $id", ("id", PlayerId(context)))?["look"] as string;
            return Results.Text("{\"look\":" + (look ?? "null") + "}", "application/json");
        });
        api.MapPost("/character", async (HttpContext context, Db db) =>
        {
            var body = await Body(context.Request, "look");
            if (!body.TryGetProperty("look", out var look) || look.ValueKind != JsonValueKind.Object) throw new ApiError("look must be a JSON object.");
            var text = look.GetRawText();
            if (text.Length > 16384) throw new ApiError("look is over 16 KB.");
            var id = PlayerId(context);
            db.Write(() => db.Execute("""
                INSERT INTO characters (player_id, look, updated) VALUES ($id, $look, $now)
                ON CONFLICT(player_id) DO UPDATE SET look = excluded.look, updated = excluded.updated
                """, ("id", id), ("look", text), ("now", Db.Now())));
            return Results.Ok(new { saved = true });
        });

        api.MapGet("/shop", (Db db) => Results.Ok(db.Rows("SELECT * FROM shop WHERE enabled = 1 ORDER BY item")));
        api.MapPost("/shop/buy", async (HttpContext context, Db db) =>
        {
            var body = await Body(context.Request, "item", "count", "requestId");
            return Change(db, context, body, requestId =>
            {
                var id = PlayerId(context);
                var item = Text(body, "item");
                var count = Integer(body, "count", 1, 999);
                var shop = db.Row("SELECT * FROM shop WHERE item = $item AND enabled = 1", ("item", item)) ?? throw new ApiError(404, "Shop item not found.");
                var bag = db.Number("SELECT COALESCE(MAX(count), 0) FROM bag WHERE player_id = $id AND item = $item", ("id", id), ("item", item));
                if (shop["maxOwned"] is long limit && (bag > limit || count > limit - bag))
                    throw new ApiError("You already have as many of that item as you can carry.");
                if (shop["stock"] is long stock && stock < count) throw new ApiError("Not enough stock.");
                var money = (long)db.Player(id)["money"]!;
                var price = (long)shop["price"]!;
                if (price > money / count) throw new ApiError("Not enough money.");
                var cost = price * count;
                if (bag > long.MaxValue - count) throw new ApiError("The bag cannot hold that many items.");
                db.Execute("UPDATE players SET money = money - $cost WHERE id = $id", ("cost", cost), ("id", id));
                db.Execute("UPDATE shop SET stock = stock - $count WHERE item = $item", ("count", count), ("item", item));
                SetBag(db, id, item, bag + count);
                db.Ledger(id, "buy", item, count, -cost, requestId);
                return new { money = money - cost, count = bag + count, wallet = Wallet.Read(db, id) };
            });
        });

        api.MapPost("/bag/take", async (HttpContext context, Db db) =>
        {
            var body = await Body(context.Request, "item", "count", "journey", "requestId");
            return Change(db, context, body, requestId =>
            {
                var id = PlayerId(context);
                var item = Text(body, "item");
                var count = Integer(body, "count", 1);
                var journey = Text(body, "journey");
                var bag = db.Number("SELECT COALESCE(MAX(count), 0) FROM bag WHERE player_id = $id AND item = $item", ("id", id), ("item", item));
                if (bag < count) throw new ApiError("Not enough items in the bag.");
                SetBag(db, id, item, bag - count);
                db.Ledger(id, "take", item, -count, 0, requestId);
                return new { item, count = bag - count, journey };
            });
        });

        api.MapGet("/events", (Db db) => Results.Ok(db.Rows("""
            SELECT * FROM events WHERE enabled = 1 AND ends > $now AND starts <= $until ORDER BY starts, id
            """, ("now", Db.Now()), ("until", Db.Utc(DateTimeOffset.UtcNow.AddDays(14))))));

        api.MapPost("/vault/deposit", async (HttpContext context, Db db) =>
        {
            var body = await Body(context.Request, "data", "journey", "requestId");
            return Change(db, context, body, _ => Vault.Deposit(db, PlayerId(context), Text(body, "data"), Text(body, "journey")));
        });

        api.MapGet("/vault/{id}", (string id, HttpContext context, Db db) => Results.Ok(
            db.Row("SELECT * FROM vault WHERE id = $id AND player_id = $player AND state = 'stored' AND removed = 0",
                ("id", Id(id)), ("player", PlayerId(context))) ?? throw new ApiError(404, "Vault Pokemon not found.")));

        api.MapPost("/vault/{id}/withdraw", async (string id, HttpContext context, Db db) =>
        {
            var body = await Body(context.Request, "journey", "requestId");
            return Change(db, context, body, _ =>
            {
                Text(body, "journey");
                return Vault.Move(db, PlayerId(context), Id(id), "stored", "withdrawing", true);
            });
        });

        foreach (var operation in new[] { "confirm", "cancel" })
        {
            api.MapPost($"/vault/{{id}}/withdraw/{operation}", async (string id, HttpContext context, Db db) =>
            {
                // Confirm and cancel also accept an empty body, as documented.
                var body = context.Request.ContentLength == 0 || (context.Request.ContentLength is null && !context.Request.HasJsonContentType())
                    ? JsonSerializer.SerializeToElement(new { }) : await Body(context.Request, "requestId");
                return Change(db, context, body, _ => Vault.Move(db, PlayerId(context), Id(id), "withdrawing", operation == "confirm" ? "withdrawn" : "stored", false), optionalRequestId: true);
            });
        }
    }

    private static IResult SignIn(Db db, string? discordId, string name) => db.Write(() =>
    {
        var player = discordId is null
            ? db.Row("SELECT * FROM players WHERE discord_id IS NULL AND name = $name ORDER BY id LIMIT 1", ("name", name))
            : db.Row("SELECT * FROM players WHERE discord_id = $discord", ("discord", discordId));
        if (player?["status"] as string == "banned") throw new ApiError(403, "This player is banned.");
        var now = Db.Now();
        long id;
        if (player is null)
        {
            db.Execute("INSERT INTO players (discord_id, name, created, last_seen) VALUES ($discord, $name, $now, $now)", ("discord", discordId), ("name", name), ("now", now));
            id = db.Number("SELECT last_insert_rowid()");
            foreach (var playlist in Playlists)
                db.Execute("INSERT INTO ratings (player_id, playlist, rating, highest_rating) VALUES ($id, $playlist, 1, 1)", ("id", id), ("playlist", playlist));
        }
        else
        {
            id = (long)player["id"]!;
            db.Execute("UPDATE players SET name = $name, last_seen = $now WHERE id = $id", ("name", name), ("now", now), ("id", id));
        }
        var token = Convert.ToHexString(RandomNumberGenerator.GetBytes(32));
        var expires = Db.Utc(DateTimeOffset.UtcNow.AddDays(30));
        db.Execute("INSERT INTO sessions (token_hash, player_id, created, expires, last_used) VALUES ($hash, $id, $now, $expires, $now)", ("hash", Hash(token)), ("id", id), ("now", now), ("expires", expires));
        return Results.Ok(new { sessionToken = token, expires, player = Player(db, id) });
    });

    internal static long PlayerId(HttpContext context) => (long)context.Items["playerId"]!;
    private static Row Player(Db db, long id) => db.Row("SELECT id, name, status, money, battle_points, experience, wallet_imported AS imported FROM players WHERE id = $id", ("id", id))!;

    internal static void SetBag(Db db, long id, string item, long count)
    {
        if (count == 0) db.Execute("DELETE FROM bag WHERE player_id = $id AND item = $item", ("id", id), ("item", item));
        else db.Put("bag", new() { ["playerId"] = id, ["item"] = item }, new() { ["playerId"] = id, ["item"] = item, ["count"] = count });
    }

    internal static IResult Change(Db db, HttpContext context, JsonElement body, Func<string?, object> work, bool optionalRequestId = false)
    {
        var requestId = optionalRequestId && !body.TryGetProperty("requestId", out _) ? null : Text(body, "requestId");
        if (requestId?.Length > 64) throw new ApiError("requestId must be at most 64 characters.");
        return db.Write(() =>
        {
            var id = PlayerId(context);
            if ((string)db.Player(id)["status"]! == "banned") throw new ApiError(403, "This player is banned.");
            var previous = requestId is null ? null : db.Row("SELECT response FROM requests WHERE player_id = $id AND request_id = $request", ("id", id), ("request", requestId));
            if (previous is not null) return Results.Content((string)previous["response"]!, "application/json");
            var response = JsonSerializer.Serialize(work(requestId));
            if (requestId is not null)
                db.Execute("INSERT INTO requests (player_id, request_id, response, at) VALUES ($id, $request, $response, $at)", ("id", id), ("request", requestId), ("response", response), ("at", Db.Now()));
            return Results.Content(response, "application/json");
        });
    }
}
