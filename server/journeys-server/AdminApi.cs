using System.Globalization;
using System.Text.Json;

namespace Journeys.Server;

internal static class AdminApi
{
    internal static readonly string[] Playlists = ["random_singles", "random_doubles", "open_singles", "open_doubles"];
    private static readonly string[] Statuses = ["ok", "flagged", "muted", "banned"];

    public static void MapAdmin(this WebApplication app, string path)
    {
        var api = app.MapGroup("/api/admin");
        api.MapGet("/overview", (Backups backups) =>
        {
            using var db = new Db(path);
            var now = DateTimeOffset.UtcNow;
            return Results.Ok(new
            {
                players = db.Number("SELECT COUNT(*) FROM players"),
                online24h = db.Number("SELECT COUNT(*) FROM players WHERE last_seen >= $since", ("$since", Db.Utc(now.AddHours(-24)))),
                flagged = db.Number("SELECT COUNT(*) FROM players WHERE status = 'flagged'"),
                banned = db.Number("SELECT COUNT(*) FROM players WHERE status = 'banned'"),
                vaultPokemon = db.Number("SELECT COUNT(*) FROM vault WHERE removed = 0 AND state IN ('stored','withdrawing')"),
                sessions = db.Number("SELECT COUNT(*) FROM sessions WHERE expires > $now", ("now", Db.Utc(now))),
                lastBackup = backups.LastBackup,
                activeEvents = db.Rows("SELECT * FROM events WHERE enabled = 1 AND starts <= $now AND ends > $now ORDER BY starts, id", ("$now", Db.Utc(now))),
                recentAudit = db.Rows("SELECT * FROM audit ORDER BY id DESC LIMIT 10")
            });
        });

        api.MapPost("/backup", (Backups backups) =>
        {
            backups.Create();
            return Results.Ok(new { lastBackup = backups.LastBackup });
        });

        api.MapGet("/players", (HttpRequest request) =>
        {
            using var db = new Db(path);
            var q = request.Query["q"].ToString();
            var status = request.Query["status"].ToString();
            if (status.Length > 0) Known(status, Statuses, "status");
            var limit = Page(request, "limit", 50, 1);
            var offset = Page(request, "offset", 0, 0);
            const string filter = """
                WHERE ($q = '' OR instr(lower(p.name), lower($q)) > 0 OR instr(COALESCE(p.discord_id, ''), $q) > 0)
                AND ($status = '' OR p.status = $status)
                """;
            return Results.Ok(new
            {
                total = db.Number($"SELECT COUNT(*) FROM players p {filter}", ("$q", q), ("$status", status)),
                players = db.Rows($"""
                    SELECT p.id, p.name, p.discord_id, p.status, p.money, p.experience,
                        (SELECT rating FROM ratings WHERE player_id = p.id ORDER BY rating DESC, playlist LIMIT 1) AS best_rating,
                        (SELECT playlist FROM ratings WHERE player_id = p.id ORDER BY rating DESC, playlist LIMIT 1) AS best_playlist,
                        p.last_seen
                    FROM players p {filter} ORDER BY p.id LIMIT $limit OFFSET $offset
                    """, ("$q", q), ("$status", status), ("$limit", limit), ("$offset", offset))
            });
        });

        api.MapGet("/players/{id}", (string id) =>
        {
            using var db = new Db(path);
            var playerId = Id(id);
            var player = db.Player(playerId);
            player["ratings"] = db.Rows("SELECT * FROM ratings WHERE player_id = $id ORDER BY playlist", ("$id", playerId));
            player["bag"] = db.Rows("SELECT * FROM bag WHERE player_id = $id ORDER BY item", ("$id", playerId));
            player["vault"] = db.Rows("SELECT * FROM vault WHERE player_id = $id ORDER BY id", ("$id", playerId));
            player["ledger"] = db.Rows("SELECT * FROM ledger WHERE player_id = $id ORDER BY id DESC LIMIT 100", ("id", playerId));
            player["sessions"] = db.Row("SELECT COUNT(*) AS count, MAX(last_used) AS last_used FROM sessions WHERE player_id = $id AND expires > $now", ("id", playerId), ("now", Db.Now()));
            player["trades"] = db.Rows("SELECT * FROM trades WHERE from_player = $id OR to_player = $id ORDER BY at DESC, id DESC LIMIT 50", ("$id", playerId));
            player["battles"] = db.Rows("SELECT * FROM battles WHERE player_a = $id OR player_b = $id ORDER BY at DESC, id DESC LIMIT 50", ("$id", playerId));
            var target = $"player:{playerId}";
            player["audit"] = db.Rows("SELECT * FROM audit WHERE target = $target OR substr(target, 1, length($target) + 1) = $target || '/' ORDER BY id DESC LIMIT 50", ("$target", target));
            return Results.Ok(player);
        });

        api.MapPatch("/players/{id}", async (string id, HttpRequest request) =>
        {
            var body = await Body(request, "name", "money", "battlePoints", "experience", "notes");
            var state = new Dictionary<string, object?>();
            foreach (var field in new[] { "name", "money", "battlePoints", "experience", "notes" })
            {
                if (!body.TryGetProperty(field, out _)) continue;
                state[field] = field is "name" or "notes" ? Text(body, field, field == "notes") : Integer(body, field);
            }
            if (state.Count == 0) throw new ApiError("Provide at least one player field to change.");
            var change = Db.Describe("player.update", $"player:{Id(id)}", state.Keys.ToArray());
            return Write(path, change, Reason(body), _ => state);
        });

        api.MapPost("/players/{id}/status", async (string id, HttpRequest request) =>
        {
            var body = await Body(request, "status");
            var status = Text(body, "status");
            Known(status, Statuses, "status");
            var reason = Reason(body);
            return Write(path, Db.Describe("player.status", $"player:{Id(id)}"), reason,
                _ => new() { ["status"] = status, ["statusReason"] = reason });
        });

        api.MapPut("/players/{id}/ratings/{playlist}", async (string id, string playlist, HttpRequest request) =>
        {
            Known(playlist, Playlists, "playlist");
            var body = await Body(request, "rating", "highestRating");
            var rating = Integer(body, "rating", 1, 50);
            var highest = body.TryGetProperty("highestRating", out _) ? Integer(body, "highestRating", rating, 50) : (long?)null;
            var playerId = Id(id);
            return Write(path, Db.Describe("rating.put", $"player:{playerId}/ratings/{playlist}"), Reason(body), db =>
            {
                db.Player(playerId);
                var oldHighest = db.Number("SELECT COALESCE(MAX(highest_rating), 1) FROM ratings WHERE player_id = $id AND playlist = $playlist", ("$id", playerId), ("$playlist", playlist));
                return new() { ["playerId"] = playerId, ["playlist"] = playlist, ["rating"] = rating, ["highestRating"] = highest ?? Math.Max(oldHighest, rating) };
            });
        });

        api.MapPut("/players/{id}/bag/{item}", async (string id, string item, HttpRequest request) =>
        {
            Name(item, "item");
            var body = await Body(request, "count");
            var count = Integer(body, "count");
            var playerId = Id(id);
            return Write(path, Db.Describe("bag.put", $"player:{playerId}/bag/{item}"), Reason(body), db =>
            {
                db.Player(playerId);
                return count == 0 ? null : new() { ["playerId"] = playerId, ["item"] = item, ["count"] = count };
            });
        });

        foreach (var operation in new[] { "remove", "restore" })
        {
            api.MapPost($"/players/{{id}}/vault/{{vaultId}}/{operation}", async (string id, string vaultId, HttpRequest request) =>
            {
                var body = await Body(request);
                var change = Db.Describe($"vault.{operation}", $"player:{Id(id)}/vault/{Id(vaultId)}");
                return Write(path, change, Reason(body), _ => new() { ["removed"] = operation == "remove" });
            });
        }

        api.MapGet("/events", () =>
        {
            using var db = new Db(path);
            return Results.Ok(db.Rows("SELECT * FROM events ORDER BY starts DESC, id DESC"));
        });

        api.MapPost("/events", async (HttpRequest request) =>
        {
            var body = await Body(request, "kind", "name", "species", "starts", "ends", "enabled", "details");
            var state = Event(body);
            var reason = Reason(body);
            using var db = new Db(path);
            db.Begin();
            db.Execute("INSERT INTO events (kind, name, species, starts, ends, enabled, details) VALUES ($kind, $name, $species, $starts, $ends, $enabled, $details)",
                state.Select(pair => ("$" + pair.Key, pair.Value)).ToArray());
            var id = db.Number("SELECT last_insert_rowid()");
            var change = Db.Describe("event.create", $"event:{id}");
            var after = db.Snapshot(change);
            var auditId = db.Audit(change, null, after, reason);
            db.Commit();
            return Results.Ok(new { auditId, before = (object?)null, after });
        });

        api.MapPut("/events/{id}", async (string id, HttpRequest request) =>
        {
            var body = await Body(request, "kind", "name", "species", "starts", "ends", "enabled", "details");
            var eventId = Id(id);
            var state = Event(body);
            state["id"] = eventId;
            return Write(path, Db.Describe("event.update", $"event:{eventId}"), Reason(body), _ => state, requireExisting: true);
        });

        api.MapDelete("/events/{id}", (string id, HttpRequest request) =>
            Write(path, Db.Describe("event.delete", $"event:{Id(id)}"), QueryReason(request), _ => null, requireExisting: true));

        api.MapGet("/shop", () =>
        {
            using var db = new Db(path);
            return Results.Ok(db.Rows("SELECT * FROM shop ORDER BY item"));
        });

        api.MapPut("/shop/{item}", async (string item, HttpRequest request) =>
        {
            Name(item, "item");
            var body = await Body(request, "price", "stock", "enabled", "label", "maxOwned");
            var price = Integer(body, "price");
            var stock = body.TryGetProperty("stock", out var rawStock) && rawStock.ValueKind != JsonValueKind.Null ? Integer(body, "stock") : (long?)null;
            var enabled = Boolean(body, "enabled");
            Dictionary<string, object?> row = new() { ["item"] = item, ["price"] = price, ["stock"] = stock, ["enabled"] = enabled };
            if (body.TryGetProperty("label", out var label)) row["label"] = label.ValueKind == JsonValueKind.Null ? null : Text(body, "label");
            if (body.TryGetProperty("maxOwned", out var maxOwned)) row["maxOwned"] = maxOwned.ValueKind == JsonValueKind.Null ? null : Integer(body, "maxOwned");
            return Write(path, Db.Describe("shop.put", $"shop:{item}"), Reason(body), _ => row);
        });

        api.MapDelete("/shop/{item}", (string item, HttpRequest request) =>
            Write(path, Db.Describe("shop.delete", $"shop:{item}"), QueryReason(request), _ => null, requireExisting: true));

        api.MapGet("/audit", (HttpRequest request) =>
        {
            using var db = new Db(path);
            var target = request.Query["target"].ToString();
            var limit = Page(request, "limit", 100, 1);
            var offset = Page(request, "offset", 0, 0);
            return Results.Ok(new
            {
                total = db.Number("SELECT COUNT(*) FROM audit WHERE $target = '' OR target = $target", ("$target", target)),
                entries = db.Rows("SELECT * FROM audit WHERE $target = '' OR target = $target ORDER BY id DESC LIMIT $limit OFFSET $offset", ("$target", target), ("$limit", limit), ("$offset", offset))
            });
        });

        api.MapPost("/audit/{id}/rollback", async (string id, HttpRequest request) =>
        {
            var body = await Body(request);
            var reason = Reason(body);
            using var db = new Db(path);
            db.Begin();
            var auditId = Id(id);
            var entry = db.Row("SELECT * FROM audit WHERE id = $id", ("$id", auditId)) ?? throw new ApiError("Audit entry not found.", 404);
            if ((bool)entry["rolledBack"]!) throw new ApiError("This change has already been rolled back.");
            var state = Db.Decode(entry["before"]);
            var action = (string)entry["action"]!;
            while (action.StartsWith("rollback:", StringComparison.Ordinal)) action = action[9..];
            var change = Db.Describe("rollback:" + action, (string)entry["target"]!, state?.Keys.ToArray());
            var before = db.Snapshot(change);
            db.Restore(change, state);
            var after = db.Snapshot(change);
            var rollbackId = db.Audit(change, before, after, reason);
            db.RecordAdminChange(change, before, after);
            db.Execute("UPDATE audit SET rolled_back = 1 WHERE id = $id", ("$id", auditId));
            db.Commit();
            return Results.Ok(new { auditId = rollbackId, before, after });
        });
    }

    private static IResult Write(string path, Change change, string reason, Func<Db, Dictionary<string, object?>?> next, bool requireExisting = false)
    {
        using var db = new Db(path);
        db.Begin();
        var before = db.Snapshot(change);
        if (requireExisting && before is null) throw new ApiError("Record not found.", 404);
        var state = next(db);
        db.Restore(change, state);
        var after = db.Snapshot(change);
        var auditId = db.Audit(change, before, after, reason);
        db.RecordAdminChange(change, before, after);
        db.Commit();
        return Results.Ok(new { auditId, before, after });
    }

    internal static async Task<JsonElement> Body(HttpRequest request, params string[] fields)
    {
        if (!request.HasJsonContentType()) throw new ApiError("Content-Type must be application/json.");
        using var document = await JsonDocument.ParseAsync(request.Body, cancellationToken: request.HttpContext.RequestAborted);
        if (document.RootElement.ValueKind != JsonValueKind.Object) throw new ApiError("A JSON object is required.");
        var seen = new HashSet<string>();
        foreach (var property in document.RootElement.EnumerateObject())
        {
            if (!seen.Add(property.Name)) throw new ApiError($"Duplicate field: {property.Name}.");
            if (property.Name != "reason" && !fields.Contains(property.Name)) throw new ApiError($"Unknown field: {property.Name}.");
        }
        return document.RootElement.Clone();
    }

    internal static string Text(JsonElement body, string field, bool allowEmpty = false)
    {
        if (!body.TryGetProperty(field, out var value) || value.ValueKind != JsonValueKind.String) throw new ApiError($"{field} must be a string.");
        var text = value.GetString()!;
        if (!allowEmpty) Name(text, field);
        return text;
    }

    private static void Name(string value, string field)
    {
        if (string.IsNullOrWhiteSpace(value)) throw new ApiError($"{field} is required.");
    }

    internal static long Integer(JsonElement body, string field, long min = 0, long max = long.MaxValue)
    {
        if (!body.TryGetProperty(field, out var value) || value.ValueKind != JsonValueKind.Number || !value.TryGetInt64(out var number) || number < min || number > max)
            throw new ApiError($"{field} must be a whole number from {min} to {max}.");
        return number;
    }

    private static bool Boolean(JsonElement body, string field)
    {
        if (!body.TryGetProperty(field, out var value) || value.ValueKind is not (JsonValueKind.True or JsonValueKind.False)) throw new ApiError($"{field} must be a boolean.");
        return value.GetBoolean();
    }

    private static void Known(string value, string[] choices, string field)
    {
        if (!choices.Contains(value)) throw new ApiError($"Unknown {field}: {value}.");
    }

    private static string Reason(JsonElement body) => Text(body, "reason");
    private static string QueryReason(HttpRequest request)
    {
        var reason = request.Query["reason"].ToString();
        Name(reason, "reason");
        return reason;
    }

    internal static long Id(string value)
    {
        if (!long.TryParse(value, NumberStyles.None, CultureInfo.InvariantCulture, out var id) || id < 1) throw new ApiError("id must be a positive integer.");
        return id;
    }

    private static int Page(HttpRequest request, string field, int fallback, int min)
    {
        if (!request.Query.TryGetValue(field, out var value)) return fallback;
        if (!int.TryParse(value.ToString(), NumberStyles.None, CultureInfo.InvariantCulture, out var number) || number < min)
            throw new ApiError($"{field} must be a whole number of at least {min}.");
        return number;
    }

    private static Dictionary<string, object?> Event(JsonElement body)
    {
        var kind = Text(body, "kind");
        Known(kind, ["raid", "event"], "event kind");
        var name = Text(body, "name");
        var starts = Time(body, "starts");
        var ends = Time(body, "ends");
        if (ends <= starts) throw new ApiError("ends must be later than starts.");
        var species = body.TryGetProperty("species", out var rawSpecies) && rawSpecies.ValueKind != JsonValueKind.Null ? Text(body, "species", true) : null;
        var details = Text(body, "details");
        try { using var document = JsonDocument.Parse(details); }
        catch (JsonException) { throw new ApiError("details must contain valid JSON text."); }
        return new()
        {
            ["kind"] = kind, ["name"] = name, ["species"] = species,
            ["starts"] = Db.Utc(starts), ["ends"] = Db.Utc(ends), ["enabled"] = Boolean(body, "enabled"), ["details"] = details
        };
    }

    private static DateTimeOffset Time(JsonElement body, string field)
    {
        var value = Text(body, field);
        if (!DateTimeOffset.TryParseExact(value, ["yyyy-MM-dd'T'HH:mm:ssK", "yyyy-MM-dd'T'HH:mm:ss.FFFFFFFK"], CultureInfo.InvariantCulture, DateTimeStyles.None, out var date)
            || !(value.EndsWith('Z') || (value.Length >= 6 && value[^3] == ':' && value[^6] is '+' or '-')))
            throw new ApiError($"{field} must be an ISO 8601 timestamp with a UTC offset.");
        return date;
    }
}
