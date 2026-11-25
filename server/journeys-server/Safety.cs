using System.Text.Json;
using Row = System.Collections.Generic.Dictionary<string, object?>;

namespace Journeys.Server;

/// Players keeping themselves safe, and the admin console's view of it.
///
/// Live messages: { type: "block", player } and { type: "unblock", player } answer with { type: "blocks", ids } (the
/// players this one has blocked). Two players with a block either way don't see each other's chat, can't send each
/// other private messages or requests, and don't get each other's history. { type: "report", player, reason } saves
/// a report with that player's last 20 messages for the admin console and answers { type: "reported", player }.
///
/// POST /api/crash { version, device, android, trace } (signed in): the app's crash log from its last run.
/// Admin: GET /api/admin/reports?state=open|closed|all, POST /api/admin/reports/{id}/close { resolution, reason },
/// GET /api/admin/crashes, DELETE /api/admin/crashes/{id}.
static class Safety
{
    internal static void Initialize(Db db) => db.Execute("""
        CREATE TABLE IF NOT EXISTS blocks (
            player_id INTEGER NOT NULL REFERENCES players(id), blocked_id INTEGER NOT NULL REFERENCES players(id),
            since TEXT NOT NULL, PRIMARY KEY(player_id, blocked_id), CHECK(player_id <> blocked_id)
        );
        CREATE INDEX IF NOT EXISTS blocks_blocked ON blocks(blocked_id);
        CREATE TABLE IF NOT EXISTS reports (
            id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL,
            reporter INTEGER NOT NULL REFERENCES players(id), reported INTEGER NOT NULL REFERENCES players(id),
            reason TEXT NOT NULL, chat TEXT NOT NULL CHECK(json_valid(chat)),
            state TEXT NOT NULL DEFAULT 'open' CHECK(state IN ('open','closed')), resolution TEXT NOT NULL DEFAULT ''
        );
        CREATE INDEX IF NOT EXISTS reports_state ON reports(state, id DESC);
        CREATE TABLE IF NOT EXISTS crashes (
            id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, player_id INTEGER REFERENCES players(id),
            version TEXT NOT NULL, device TEXT NOT NULL, android TEXT NOT NULL, trace TEXT NOT NULL
        );
        """);

    /// Everyone [player] has a block with, either way.
    internal static HashSet<long> Apart(Db db, long player) => db.Rows("""
        SELECT blocked_id AS other FROM blocks WHERE player_id = $id UNION SELECT player_id FROM blocks WHERE blocked_id = $id
        """, ("id", player)).Select(row => (long)row["other"]!).ToHashSet();

    internal static long[] Blocked(Db db, long player) =>
        db.Rows("SELECT blocked_id FROM blocks WHERE player_id = $id ORDER BY since", ("id", player)).Select(row => (long)row["blockedId"]!).ToArray();

    private static string Text(JsonElement body, string field, int max)
    {
        var text = body.TryGetProperty(field, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString()!.Trim() : "";
        return text.Length > max ? text[..max] : text;
    }

    internal static void Map(WebApplication app)
    {
        app.MapPost("/api/crash", async (HttpContext context, Db db) =>
        {
            var body = await AdminApi.Body(context.Request, "version", "device", "android", "trace");
            var trace = Text(body, "trace", 32_000);
            if (trace.Length == 0) throw new ApiError("trace is required.");
            var player = GameApi.PlayerId(context);
            if (db.Number("SELECT COUNT(*) FROM crashes WHERE player_id = $id AND at > $since",
                ("id", player), ("since", Db.Utc(DateTimeOffset.UtcNow.AddHours(-1)))) >= 10)
                return Results.Ok(new { saved = false });
            db.Execute("INSERT INTO crashes (at, player_id, version, device, android, trace) VALUES ($at, $id, $version, $device, $android, $trace)",
                ("at", Db.Now()), ("id", player), ("version", Text(body, "version", 64)), ("device", Text(body, "device", 128)),
                ("android", Text(body, "android", 32)), ("trace", trace));
            // The newest 1000 are plenty.
            db.Execute("DELETE FROM crashes WHERE id <= (SELECT id FROM crashes ORDER BY id DESC LIMIT 1 OFFSET 1000)");
            return Results.Ok(new { saved = true });
        });

        var admin = app.MapGroup("/api/admin");
        admin.MapGet("/reports", (HttpRequest request, Db db) =>
        {
            var state = request.Query["state"].ToString() is { Length: > 0 } s ? s : "open";
            if (state is not ("open" or "closed" or "all")) throw new ApiError("state must be open, closed or all.");
            return Results.Ok(db.Rows("""
                SELECT r.*, a.name AS reporter_name, b.name AS reported_name, b.status AS reported_status,
                    (SELECT COUNT(*) FROM reports o WHERE o.reported = r.reported AND o.state = 'open') AS open_reports
                FROM reports r JOIN players a ON a.id = r.reporter JOIN players b ON b.id = r.reported
                WHERE $state = 'all' OR r.state = $state ORDER BY r.id DESC LIMIT 200
                """, ("state", state)).Select(Shape));
        });
        admin.MapPost("/reports/{id}/close", async (string id, HttpRequest request, Db db) =>
        {
            var reportId = AdminApi.Id(id);
            var body = await AdminApi.Body(request, "resolution");
            var reason = AdminApi.Text(body, "reason");
            var resolution = Text(body, "resolution", 500);
            return Results.Ok(db.Write(() =>
            {
                var before = db.Find("reports", new() { ["id"] = reportId }) ?? throw new ApiError(404, "Report not found.");
                db.Execute("UPDATE reports SET state = 'closed', resolution = $resolution WHERE id = $id", ("resolution", resolution), ("id", reportId));
                var after = db.Find("reports", new() { ["id"] = reportId });
                var auditId = db.Audit("report.close", $"report:{reportId}", before, after, reason);
                return new { auditId, before, after };
            }));
        });
        admin.MapGet("/crashes", (Db db) => Results.Ok(db.Rows("""
            SELECT c.*, p.name AS player_name FROM crashes c LEFT JOIN players p ON p.id = c.player_id ORDER BY c.id DESC LIMIT 200
            """)));
        admin.MapDelete("/crashes/{id}", (string id, Db db) =>
        {
            db.Execute("DELETE FROM crashes WHERE id = $id", ("id", AdminApi.Id(id)));
            return Results.Ok(new { deleted = true });
        });
    }

    private static object Shape(Row row) => new
    {
        id = row["id"], at = row["at"], reason = row["reason"], state = row["state"], resolution = row["resolution"],
        reporter = new { id = row["reporter"], name = row["reporterName"] },
        reported = new { id = row["reported"], name = row["reportedName"], status = row["reportedStatus"], openReports = row["openReports"] },
        chat = JsonDocument.Parse((string)row["chat"]!).RootElement,
    };
}

sealed partial class Live
{
    private static long Target(JsonElement message) =>
        message.TryGetProperty("player", out var p) && p.TryGetInt64(out var id) && id > 0 ? id : 0;

    /// Whether two players have a block between them, either way.
    private bool Apart(long a, long b)
    {
        if (clients.TryGetValue(a, out var one)) lock (one.Apart) return one.Apart.Contains(b);
        if (clients.TryGetValue(b, out var two)) lock (two.Apart) return two.Apart.Contains(a);
        using var db = new Db(connectionString);
        return Safety.Apart(db, a).Contains(b);
    }

    private async Task HandleSafety(Client client, string type, JsonElement message)
    {
        var other = Target(message);
        try
        {
            using var db = new Db(connectionString);
            if (other == 0 || other == client.Id) throw new ApiError("That needs another player's id in player.");
            var target = db.Player(other);
            switch (type)
            {
                case "block":
                    db.Execute("INSERT OR IGNORE INTO blocks (player_id, blocked_id, since) VALUES ($a, $b, $now)", ("a", client.Id), ("b", other), ("now", Db.Now()));
                    break;
                case "unblock":
                    db.Execute("DELETE FROM blocks WHERE player_id = $a AND blocked_id = $b", ("a", client.Id), ("b", other));
                    break;
                case "report":
                    var reason = message.TryGetProperty("reason", out var r) && r.ValueKind == JsonValueKind.String ? r.GetString()!.Trim() : "";
                    if (reason.Length > 200 || reason.Any(char.IsControl)) throw new ApiError("A report reason is up to 200 characters.");
                    if (db.Number("SELECT COUNT(*) FROM reports WHERE reporter = $id AND at > $since",
                        ("id", client.Id), ("since", Db.Utc(DateTimeOffset.UtcNow.AddHours(-1)))) >= 10)
                        throw new ApiError("You've sent a lot of reports. Try again later.");
                    var chat = db.Rows(Chat.Select + " WHERE c.from_player = $id ORDER BY c.id DESC LIMIT 20", ("id", other))
                        .Select(Chat.Shape).Select(m => new { m.At, m.Channel, m.Text }).ToArray();
                    db.Execute("INSERT INTO reports (at, reporter, reported, reason, chat) VALUES ($at, $from, $to, $reason, $chat)",
                        ("at", Db.Now()), ("from", client.Id), ("to", other), ("reason", reason.Length == 0 ? "No reason given" : reason),
                        ("chat", JsonSerializer.Serialize(chat, Json)));
                    logger.LogWarning("{Name} reported {Other} (player {Id})", client.Name, (string)target["name"]!, other);
                    await Send(client, new { type = "reported", player = other });
                    return;
            }
            // Both sides' sets follow the database, which has the block either way.
            var apart = Safety.Apart(db, client.Id).Contains(other);
            foreach (var (who, them) in new[] { (client.Id, other), (other, client.Id) })
                if (clients.TryGetValue(who, out var c)) lock (c.Apart) { if (apart) c.Apart.Add(them); else c.Apart.Remove(them); }
            await Send(client, new { type = "blocks", ids = Safety.Blocked(db, client.Id) });
        }
        catch (ApiError error) { await Send(client, new { type = "error", error = error.Message }); }
    }
}
