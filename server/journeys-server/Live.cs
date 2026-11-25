using System.Collections.Concurrent;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace Journeys.Server;

/// <summary>
/// The live connection: one WebSocket per signed-in player at /api/live (same Bearer session as the game API).
/// Carries hub presence, player requests and stored global and direct chat. Presence lives in memory only;
/// players in the same room hear where each other stands. See README "Live connection" for the messages.
/// </summary>
sealed partial class Live(string connectionString, ILogger<Live> logger)
{
    private const int MaxMessage = 4096;
    private const int MaxCoordinate = 4095;
    private static readonly string[] Facings = ["up", "down", "left", "right"];
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private readonly ConcurrentDictionary<long, Client> clients = new();
    private readonly string connectionString = connectionString;

    [GeneratedRegex("^[a-z0-9_-]{1,32}$")]
    private static partial Regex RoomName();

    [GeneratedRegex("^[a-z0-9 _:.'-]{0,48}$", RegexOptions.IgnoreCase)]
    private static partial Regex StatusText();

    private sealed class Client(long id, string name, object stats, bool muted, HashSet<long> friends, WebSocket socket)
    {
        public long Id { get; } = id;
        public string Name { get; } = name;
        public bool Muted { get; } = muted;
        public HashSet<long> Friends { get; } = friends;
        // Players with a block between them and this one, either way (Safety.cs).
        public readonly HashSet<long> Apart = [];
        public WebSocket Socket { get; } = socket;
        public string? Room;
        public int X, Y;
        public string Facing = "down";
        public string Status = "";
        // What the player's phone says about itself (look, follower, card); stats come from the server's records.
        public JsonElement? Look, Follower, Card;
        public object Stats { get; } = stats;
        public string Since = Db.Now();
        public readonly SemaphoreSlim Sending = new(1, 1);
        public double Tokens = Burst;
        public long LastRefill = Environment.TickCount64;
        public object Short() => new { id = Id, x = X, y = Y, facing = Facing };
        public object Full() => new { id = Id, name = Name, x = X, y = Y, facing = Facing, status = Status, look = Look, follower = Follower, card = Card, stats = Stats };
    }

    // Up to 20 messages a second per player, with a short burst; extra messages are dropped.
    private const double Rate = 20, Burst = 40;

    public int Online => clients.Count;

    public object State() => new
    {
        online = clients.Count,
        rooms = clients.Values.Where(c => c.Room is not null).GroupBy(c => c.Room!).OrderBy(g => g.Key)
            .Select(g => new { room = g.Key, players = g.Count() }).ToArray(),
        players = clients.Values.OrderBy(c => c.Name).Select(c => new { id = c.Id, name = c.Name, room = c.Room, x = c.X, y = c.Y, facing = c.Facing, status = c.Status, follower = c.Follower, since = c.Since }).ToArray()
    };

    public static void MapLive(WebApplication app)
    {
        Chat.MapAdmin(app);
        MapBattles(app);
        app.UseWebSockets(new WebSocketOptions { KeepAliveInterval = TimeSpan.FromSeconds(20), KeepAliveTimeout = TimeSpan.FromSeconds(20) });
        app.Map("/api/live", async (HttpContext context, Live live) =>
        {
            if (!context.WebSockets.IsWebSocketRequest) throw new ApiError(400, "This endpoint needs a WebSocket connection.");
            var id = GameApi.PlayerId(context);
            string name;
            object stats;
            bool muted;
            HashSet<long> friends;
            using (var db = new Db(live.connectionString))
            {
                var player = db.Player(id);
                name = (string)player["name"]!;
                muted = (string)player["status"]! == "muted";
                var best = db.Row("SELECT rating, playlist FROM ratings WHERE player_id = $id ORDER BY rating DESC, highest_rating DESC LIMIT 1", ("id", id));
                stats = new { experience = player["experience"], battlePoints = player["battlePoints"], money = player["money"], bestRating = best?["rating"], bestPlaylist = best?["playlist"] };
                friends = FriendIds(db, id);
            }
            using var socket = await context.WebSockets.AcceptWebSocketAsync();
            await live.Run(new Client(id, name, stats, muted, friends, socket),(string)context.Items["tokenHash"]!, context.RequestAborted);
            return Results.Empty;
        });
        app.MapGet("/api/admin/live", (Live live) => Results.Ok(live.State()));

        // Public, before signing in: the title screen's "Server Online · N players online" and the announcements
        // players see after spawning on the island.
        app.MapGet("/api/status", (Live live) =>
        {
            using var db = new Db(live.connectionString);
            return Results.Ok(new { online = true, players = live.Online, announcements = Announcements(db) });
        });
        app.MapGet("/api/admin/announcements", (Live live) =>
        {
            using var db = new Db(live.connectionString);
            return Results.Ok(new { lines = Announcements(db) });
        });
        // { lines: ["..."], reason }: up to 5 lines of up to 200 characters; an empty list clears them. Audited.
        app.MapPut("/api/admin/announcements", async (HttpRequest request, Live live) =>
        {
            var body = await AdminApi.Body(request, "lines");
            if (!body.TryGetProperty("lines", out var raw) || raw.ValueKind != JsonValueKind.Array) throw new ApiError("lines must be a list.");
            var lines = raw.EnumerateArray().Select(l => l.ValueKind == JsonValueKind.String ? l.GetString()!.Trim() : throw new ApiError("Each line must be text."))
                .Where(l => l.Length > 0).ToArray();
            if (lines.Length > 5 || lines.Any(l => l.Length > 200 || l.Any(char.IsControl))) throw new ApiError("Up to 5 lines of up to 200 characters.");
            var reason = body.TryGetProperty("reason", out var r) && r.ValueKind == JsonValueKind.String ? r.GetString()!.Trim() : "";
            if (reason.Length == 0) throw new ApiError("A reason is required.");
            using var db = new Db(live.connectionString);
            db.Write(() =>
            {
                var before = JsonSerializer.Serialize(new { lines = Announcements(db) });
                var after = JsonSerializer.Serialize(new { lines });
                db.Execute("INSERT INTO settings (key, value) VALUES ('announcements', $value) ON CONFLICT(key) DO UPDATE SET value = $value",
                    ("value", JsonSerializer.Serialize(lines)));
                db.Execute("INSERT INTO audit (at, admin, action, target, \"before\", \"after\", reason) VALUES ($at, 'admin-key', 'announcements.put', 'server:announcements', $before, $after, $reason)",
                    ("at", Db.Now()), ("before", before), ("after", after), ("reason", reason));
                return 0;
            });
            return Results.Ok(new { lines });
        });
        // The signed-in player's friends, and whether each is online now.
        app.MapGet("/api/friends", (HttpContext context, Live live) =>
        {
            using var db = new Db(live.connectionString);
            var id = GameApi.PlayerId(context);
            return Results.Ok(db.Rows("""
                SELECT p.id, p.name, f.since FROM friends f JOIN players p ON p.id = CASE WHEN f.player_a = $id THEN f.player_b ELSE f.player_a END
                WHERE f.player_a = $id OR f.player_b = $id ORDER BY p.name
                """, ("id", id)).Select(row => new { id = row["id"], name = row["name"], since = row["since"], online = live.clients.ContainsKey((long)row["id"]!) }));
        });
    }

    private static string[] Announcements(Db db)
    {
        var row = db.Row("SELECT value FROM settings WHERE key = 'announcements'");
        return row is null ? [] : JsonSerializer.Deserialize<string[]>((string)row["value"]!) ?? [];
    }

    private static HashSet<long> FriendIds(Db db, long id) => db.Rows(
        "SELECT CASE WHEN player_a = $id THEN player_b ELSE player_a END AS other FROM friends WHERE player_a = $id OR player_b = $id",
        ("id", id)).Select(row => (long)row["other"]!).ToHashSet();

    // Requests between players in the same room: friend, trade and battle requests wait for an answer (a minute at
    // most); a message is delivered as it is.
    private sealed record Pending(long From, long To, string Kind, DateTime Expires);
    private readonly ConcurrentDictionary<string, Pending> pending = new();
    private static readonly string[] Kinds = ["friend", "trade", "battle", "message"];

    private async Task Run(Client client, string tokenHash, CancellationToken aborted)
    {
        using var stop = CancellationTokenSource.CreateLinkedTokenSource(aborted);
        // A second connection for the same player replaces the first (a reconnect after a network change).
        if (clients.TryRemove(client.Id, out var old))
        {
            Leave(old);
            await Close(old, WebSocketCloseStatus.PolicyViolation, "Connected again elsewhere.", true);
        }
        await Send(client, new { type = "friends", ids = client.Friends.ToArray() });
        using (var db = new Db(connectionString))
        {
            client.Apart.UnionWith(Safety.Apart(db, client.Id));
            await Send(client, new { type = "blocks", ids = Safety.Blocked(db, client.Id) });
            await Send(client, new { type = "chat_history", messages = Chat.History(db, client.Id).Where(m => !client.Apart.Contains(m.From.Id)).ToArray() });
        }
        clients[client.Id] = client;
        logger.LogInformation("{Name} connected (player {Id}); {Online} online", client.Name, client.Id, clients.Count);
        var watch = Watch(client, tokenHash, stop.Token);
        var reason = "Disconnected.";
        try
        {
            var buffer = new byte[MaxMessage];
            while (client.Socket.State == WebSocketState.Open)
            {
                var length = 0;
                ValueWebSocketReceiveResult result;
                do
                {
                    if (length == buffer.Length)
                    {
                        await Close(client, WebSocketCloseStatus.MessageTooBig, "Messages must be at most 4 KB.", false);
                        return;
                    }
                    result = await client.Socket.ReceiveAsync(buffer.AsMemory(length), stop.Token);
                    length += result.Count;
                } while (!result.EndOfMessage);
                if (result.MessageType == WebSocketMessageType.Close) break;
                if (result.MessageType != WebSocketMessageType.Text) continue;
                await Handle(client, buffer.AsSpan(0, length).ToArray(), Allow(client));
            }
        }
        catch (Exception error) when (error is OperationCanceledException or WebSocketException) { reason = error.Message; }
        finally
        {
            stop.Cancel();
            await watch;
            if (clients.TryRemove(new KeyValuePair<long, Client>(client.Id, client))) Leave(client);
            logger.LogInformation("{Name} disconnected ({Reason}); {Online} online", client.Name, reason, clients.Count);
        }
    }

    // Every 15 seconds: a banned, signed-out or expired player is disconnected.
    private async Task Watch(Client client, string tokenHash, CancellationToken stop)
    {
        try
        {
            while (true)
            {
                await Task.Delay(TimeSpan.FromSeconds(15), stop);
                using var db = new Db(connectionString);
                var valid = db.Row("""
                    SELECT 1 AS ok FROM sessions s JOIN players p ON p.id = s.player_id
                    WHERE s.token_hash = $hash AND s.expires > $now AND p.status <> 'banned'
                    """, ("hash", tokenHash), ("now", Db.Now())) is not null;
                if (!valid)
                {
                    await Close(client, WebSocketCloseStatus.PolicyViolation, "Your session ended.", false);
                    return;
                }
            }
        }
        catch (OperationCanceledException) { }
        catch (Exception error) { logger.LogWarning(error, "Session check failed for player {Id}", client.Id); }
    }

    private bool Allow(Client client)
    {
        var now = Environment.TickCount64;
        client.Tokens = Math.Min(Burst, client.Tokens + (now - client.LastRefill) / 1000.0 * Rate);
        client.LastRefill = now;
        if (client.Tokens < 1) return false;
        client.Tokens--;
        return true;
    }

    private async Task Handle(Client client, byte[] text, bool allowed)
    {
        JsonElement message;
        try { message = JsonDocument.Parse(text).RootElement; }
        catch (JsonException) { await Send(client, new { type = "error", error = "A JSON object is required." }); return; }
        var type = message.ValueKind == JsonValueKind.Object && message.TryGetProperty("type", out var t) && t.ValueKind == JsonValueKind.String ? t.GetString() : null;
        if (!allowed && type != "chat") return;
        switch (type)
        {
            case "move":
                if (!TryMove(message, out var room, out var x, out var y, out var facing))
                {
                    await Send(client, new { type = "error", error = "move needs room (a-z, 0-9, _ or -, up to 32), x and y (0-4095) and facing (up, down, left or right)." });
                    return;
                }
                if (room != client.Room)
                {
                    Leave(client);
                    (client.Room, client.X, client.Y, client.Facing) = (room, x, y, facing);
                    var here = clients.Values.Where(c => c != client && c.Room == room).Select(c => c.Full()).ToArray();
                    await Send(client, new { type = "room", room, you = client.Id, players = here });
                    Broadcast(room, client, new { type = "joined", player = client.Full() });
                    break;
                }
                (client.X, client.Y, client.Facing) = (x, y, facing);
                Broadcast(room, client, new { type = "moved", player = client.Short() }, canDrop: true);
                break;
            case "profile":
                // Look, follower and trainer card as the phone shows them, each a JSON object (or null), 2 KB in all.
                if (text.Length > 2048 || !Optional(message, "look", out var look) || !Optional(message, "follower", out var follower) || !Optional(message, "card", out var card))
                {
                    await Send(client, new { type = "error", error = "profile takes look, follower and card as JSON objects or null, 2 KB in all." });
                    return;
                }
                (client.Look, client.Follower, client.Card) = (look, follower, card);
                if (client.Room is not null) Broadcast(client.Room, client, new { type = "profile", player = client.Full() });
                break;
            case "status":
                // A short word others can see: "", "afk", "shopping", "talking:Journey captain", "away:FireRed"...
                var status = message.TryGetProperty("status", out var s) && s.ValueKind == JsonValueKind.String ? s.GetString()! : null;
                if (status is null || !StatusText().IsMatch(status))
                {
                    await Send(client, new { type = "error", error = "status must be up to 48 letters, digits, spaces or _ : . ' -" });
                    return;
                }
                client.Status = status;
                if (client.Room is not null) Broadcast(client.Room, client, new { type = "status", id = client.Id, status });
                break;
            case "ping":
                await Send(client, new { type = "pong" });
                break;
            case "request":
                await Request(client, message);
                break;
            case "answer":
                await Answer(client, message);
                break;
            case "chat":
                await SendChat(client, message);
                break;
            case "block" or "unblock" or "report":
                await HandleSafety(client, type!, message);
                break;
            case "trade_offer" or "trade_confirm" or "trade_cancel":
                await HandleTrade(client, type!, message);
                break;
            default:
                await Send(client, new { type = "error", error = "Unknown message type." });
                break;
        }
    }

    // { type: "request", to, kind, text? }: to a player in the same room. The sender hears "sent" (or an error).
    private async Task Request(Client client, JsonElement message)
    {
        var kind = message.TryGetProperty("kind", out var k) && k.ValueKind == JsonValueKind.String ? k.GetString()! : "";
        var toId = message.TryGetProperty("to", out var t) && t.TryGetInt64(out var value) ? value : 0;
        string? Refuse()
        {
            if (!Kinds.Contains(kind)) return "kind must be friend, trade, battle or message.";
            if (!clients.TryGetValue(toId, out var target) || target == client || target.Room != client.Room || client.Room is null)
                return "That player isn't nearby anymore.";
            if (Apart(client.Id, toId)) return $"You can't send requests to {target.Name}.";
            if (kind == "friend" && client.Friends.Contains(toId)) return $"You and {target.Name} are already friends.";
            if (kind == "message" && client.Muted) return "You can't send messages right now.";
            var now = DateTime.UtcNow;
            foreach (var (id, old) in pending) if (old.Expires < now) pending.TryRemove(id, out _);
            if (pending.Values.Any(p => p.From == client.Id && p.To == toId && p.Kind == kind)) return $"You already asked {target.Name}. Wait for an answer.";
            if (pending.Values.Count(p => p.From == client.Id) >= 5) return "Wait for answers to your other requests first.";
            return null;
        }
        var refusal = Refuse();
        if (refusal is not null)
        {
            await Send(client, new { type = "error", error = refusal });
            return;
        }
        var to = clients[toId];
        string? text = null;
        if (kind == "message")
        {
            text = message.TryGetProperty("text", out var m) && m.ValueKind == JsonValueKind.String ? m.GetString()!.Trim() : "";
            if (text.Length is 0 or > 100 || text.Any(char.IsControl))
            {
                await Send(client, new { type = "error", error = "A message is 1 to 100 characters." });
                return;
            }
        }
        var requestId = Guid.NewGuid().ToString("N")[..12];
        if (kind != "message") pending[requestId] = new Pending(client.Id, to.Id, kind, DateTime.UtcNow.AddMinutes(1));
        await Send(to, new { type = "request", id = requestId, kind, text, from = new { id = client.Id, name = client.Name } });
        await Send(client, new { type = "sent", id = requestId, kind, to = new { id = to.Id, name = to.Name } });
    }

    // { type: "answer", id, accept }: the asked player's answer goes back to whoever asked. Friends are saved.
    private async Task Answer(Client client, JsonElement message)
    {
        var id = message.TryGetProperty("id", out var i) && i.ValueKind == JsonValueKind.String ? i.GetString()! : "";
        var accept = message.TryGetProperty("accept", out var a) && a.ValueKind == JsonValueKind.True;
        if (!pending.TryGetValue(id, out var request) || request.To != client.Id || !pending.TryRemove(id, out _) || request.Expires < DateTime.UtcNow)
        {
            await Send(client, new { type = "error", error = "That request has expired." });
            return;
        }
        clients.TryGetValue(request.From, out var from);
        if (accept && request.Kind == "friend")
        {
            using (var db = new Db(connectionString))
                db.Execute("INSERT OR IGNORE INTO friends (player_a, player_b, since) VALUES ($a, $b, $now)",
                    ("a", Math.Min(request.From, request.To)), ("b", Math.Max(request.From, request.To)), ("now", Db.Now()));
            lock (client.Friends) client.Friends.Add(request.From);
            await Send(client, new { type = "friends", ids = client.Friends.ToArray() });
            if (from is not null)
            {
                lock (from.Friends) from.Friends.Add(client.Id);
                await Send(from, new { type = "friends", ids = from.Friends.ToArray() });
            }
            logger.LogInformation("{A} and {B} are now friends", client.Name, from?.Name ?? $"player {request.From}");
        }
        if (from is not null) await Send(from, new { type = "answer", id, kind = request.Kind, accept, from = new { id = client.Id, name = client.Name } });
        if (accept && request.Kind == "trade" && from is not null) await OpenTrade(from, client);
        if (accept && request.Kind == "battle" && from is not null) await StartBattle(from, client);
    }

    private static bool Optional(JsonElement message, string field, out JsonElement? value)
    {
        value = null;
        if (!message.TryGetProperty(field, out var raw) || raw.ValueKind == JsonValueKind.Null) return true;
        if (raw.ValueKind != JsonValueKind.Object) return false;
        value = raw.Clone();
        return true;
    }

    private static bool TryMove(JsonElement message, out string room, out int x, out int y, out string facing)
    {
        room = facing = "";
        x = y = 0;
        if (!message.TryGetProperty("room", out var r) || r.ValueKind != JsonValueKind.String || !RoomName().IsMatch(r.GetString()!)) return false;
        if (!message.TryGetProperty("x", out var px) || !px.TryGetInt32(out x) || x is < 0 or > MaxCoordinate) return false;
        if (!message.TryGetProperty("y", out var py) || !py.TryGetInt32(out y) || y is < 0 or > MaxCoordinate) return false;
        if (!message.TryGetProperty("facing", out var f) || f.ValueKind != JsonValueKind.String || !Facings.Contains(f.GetString())) return false;
        room = r.GetString()!;
        facing = f.GetString()!;
        return true;
    }

    private void Leave(Client client)
    {
        LeaveTrade(client);
        if (client.Room is null) return;
        Broadcast(client.Room, client, new { type = "left", id = client.Id });
        client.Room = null;
    }

    private void Broadcast(string room, Client from, object message, bool canDrop = false)
    {
        var bytes = JsonSerializer.SerializeToUtf8Bytes(message, Json);
        foreach (var other in clients.Values)
            if (other != from && other.Room == room) _ = Send(other, bytes, canDrop);
    }

    private static Task Send(Client client, object message) => Send(client, JsonSerializer.SerializeToUtf8Bytes(message, Json), false);

    private static async Task Send(Client client, byte[] bytes, bool canDrop)
    {
        // A player whose connection can't keep up misses movement updates instead of slowing the room; other
        // messages (room lists, leaving) wait their turn.
        if (!await client.Sending.WaitAsync(canDrop ? TimeSpan.Zero : TimeSpan.FromSeconds(10))) return;
        try
        {
            if (client.Socket.State == WebSocketState.Open)
                await client.Socket.SendAsync(bytes, WebSocketMessageType.Text, true, CancellationToken.None);
        }
        catch (Exception error) when (error is WebSocketException or ObjectDisposedException) { }
        finally { client.Sending.Release(); }
    }

    private static async Task Close(Client client, WebSocketCloseStatus status, string reason, bool wait)
    {
        try
        {
            var closing = client.Socket.CloseOutputAsync(status, reason, CancellationToken.None);
            if (wait) await closing.WaitAsync(TimeSpan.FromSeconds(2));
            else await closing;
        }
        catch (Exception error) when (error is WebSocketException or ObjectDisposedException or TimeoutException or InvalidOperationException) { }
    }
}
