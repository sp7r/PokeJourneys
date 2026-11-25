using System.Text.Json;
using Row = System.Collections.Generic.Dictionary<string, object?>;

namespace Journeys.Server;

static class Chat
{
    private static long nextPrune = Environment.TickCount64 + 3_600_000;
    internal const string Select = """
        SELECT c.*, f.name AS from_name, t.name AS to_name
        FROM chat c LEFT JOIN players f ON f.id = c.from_player LEFT JOIN players t ON t.id = c.to_player
        """;

    internal sealed record Player(long Id, string Name);
    internal sealed record Message(long Id, string Channel, Player From, Player? To, string Text, string At, bool Notice)
    {
        public string Type => "chat";
    }

    internal static string Text(JsonElement body)
    {
        var text = AdminApi.Text(body, "text", allowEmpty: true).Trim();
        if (text.Length is 0 or > 200 || text.Any(char.IsControl))
            throw new ApiError("Chat text must be 1 to 200 characters without control characters.");
        return text;
    }

    internal static long Store(Db db, long? from, long? to, string text, bool notice = false)
    {
        var now = Environment.TickCount64;
        var next = Interlocked.Read(ref nextPrune);
        if (now >= next && Interlocked.CompareExchange(ref nextPrune, now + 3_600_000, next) == next) db.PruneChat();
        db.Execute("""
            INSERT INTO chat (at, from_player, to_player, text, notice) VALUES ($at, $from, $to, $text, $notice)
            """, ("at", Db.Now()), ("from", from), ("to", to), ("text", text), ("notice", notice));
        return db.Number("SELECT last_insert_rowid()");
    }

    internal static Message Shape(Row row) => new(
        (long)row["id"]!, row["toPlayer"] is null ? "global" : "direct",
        row["fromPlayer"] is long from ? new Player(from, (string)row["fromName"]!) : new Player(0, "Server"),
        row["toPlayer"] is long to ? new Player(to, (string)row["toName"]!) : null,
        (string)row["text"]!, (string)row["at"]!, (bool)row["notice"]!);

    internal static Message Read(Db db, long id) => Shape(db.Row(Select + " WHERE c.id = $id", ("id", id))!);

    internal static Message[] History(Db db, long player) => db.Rows(Select + """
         WHERE c.id IN (
            SELECT id FROM chat WHERE to_player IS NULL AND deleted = 0 ORDER BY id DESC LIMIT 50
        ) OR c.id IN (
            SELECT id FROM chat WHERE to_player IS NOT NULL AND (from_player = $player OR to_player = $player)
                AND deleted = 0 ORDER BY id DESC LIMIT 50
        ) ORDER BY c.id
        """, ("player", player)).Select(Shape).ToArray();

    internal static void MapAdmin(WebApplication app)
    {
        var api = app.MapGroup("/api/admin/chat");
        api.MapGet("/", (HttpRequest request, Db db) =>
        {
            var filter = request.Query["player"].ToString();
            var player = filter.Length == 0 ? (long?)null : AdminApi.Id(filter);
            var limit = 100;
            if (request.Query.TryGetValue("limit", out var raw) && (!int.TryParse(raw, out limit) || limit is < 1 or > 1000))
                throw new ApiError("limit must be a whole number from 1 to 1000.");
            return Results.Ok(db.Rows(Select + """
                 WHERE $player IS NULL OR c.from_player = $player OR c.to_player = $player
                ORDER BY c.id DESC LIMIT $limit
                """, ("player", player), ("limit", limit)).Select(row =>
                {
                    var message = Shape(row);
                    return new { message.Type, message.Id, message.Channel, message.From, message.To, message.Text, message.At, message.Notice, deleted = (bool)row["deleted"]! };
                }));
        });
        api.MapDelete("/{id}", async (string id, HttpRequest request, Db db, Live live) =>
        {
            var chatId = AdminApi.Id(id);
            var reason = request.Query["reason"].ToString().Trim();
            if (reason.Length == 0) throw new ApiError("A reason is required.");
            var result = db.Write(() =>
            {
                var before = db.Find("chat", new() { ["id"] = chatId }) ?? throw new ApiError(404, "Chat message not found.");
                db.Execute("UPDATE chat SET deleted = 1 WHERE id = $id", ("id", chatId));
                var after = db.Find("chat", new() { ["id"] = chatId });
                var auditId = db.Audit("chat.delete", $"chat:{chatId}", before, after, reason);
                return new { auditId, before, after };
            });
            await live.DeleteChat(chatId);
            return Results.Ok(result);
        });
        api.MapPost("/notice", async (HttpRequest request, Db db, Live live) =>
        {
            var body = await AdminApi.Body(request, "text");
            var text = Text(body);
            var reason = AdminApi.Text(body, "reason");
            var result = db.Write(() =>
            {
                var id = Store(db, null, null, text, notice: true);
                var after = db.Find("chat", new() { ["id"] = id });
                var auditId = db.Audit("chat.notice", $"chat:{id}", null, after, reason);
                return new { auditId, before = (object?)null, after, message = Read(db, id) };
            });
            await live.PublishChat(result.message);
            return Results.Ok(result);
        });
    }
}

sealed partial class Live
{
    private async Task SendChat(Client client, JsonElement message)
    {
        try
        {
            using var db = new Db(connectionString);
            var chat = db.Write(() =>
            {
                if ((string)db.Player(client.Id)["status"]! is "muted" or "banned")
                    throw new ApiError("You can't chat right now.");
                var text = Chat.Text(message);
                long? to = null;
                if (message.TryGetProperty("to", out var target))
                {
                    if (message.TryGetProperty("channel", out _) || target.ValueKind != JsonValueKind.Number || !target.TryGetInt64(out var id) || id < 1)
                        throw new ApiError("Chat needs channel global or a player's id in to.");
                    db.Player(id);
                    if (Apart(client.Id, id)) throw new ApiError("You can't message that player.");
                    to = id;
                }
                else if (!message.TryGetProperty("channel", out var channel) || channel.ValueKind != JsonValueKind.String || channel.GetString() != "global")
                    throw new ApiError("Chat needs channel global or a player's id in to.");
                // Stored timestamps keep the limit in effect across reconnects and concurrent connections.
                if (db.Row("SELECT id FROM chat WHERE from_player = $from AND at > $since LIMIT 1",
                    ("from", client.Id), ("since", Db.Utc(DateTimeOffset.UtcNow.AddSeconds(-1)))) is not null)
                    throw new ApiError("Wait a second before sending another chat message.");
                return Chat.Read(db, Chat.Store(db, client.Id, to, text));
            });
            await PublishChat(chat);
        }
        catch (ApiError error) { await Send(client, new { type = "error", error = error.Message }); }
    }

    internal Task PublishChat(Chat.Message message) => SendToAll(message,
        client => (message.To is null || client.Id == message.From.Id || client.Id == message.To.Id) && !IsApart(client, message.From.Id));

    private static bool IsApart(Client client, long from) { lock (client.Apart) return client.Apart.Contains(from); }

    internal Task DeleteChat(long id) => SendToAll(new { type = "chat_deleted", id }, _ => true);

    private Task SendToAll(object message, Func<Client, bool> include)
    {
        var bytes = JsonSerializer.SerializeToUtf8Bytes(message, Json);
        return Task.WhenAll(clients.Values.Where(include).Select(client => Send(client, bytes, false)));
    }
}
