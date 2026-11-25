using Row = System.Collections.Generic.Dictionary<string, object?>;

namespace Journeys.Server;

static class DemoSeed
{
    public static void Run(Db db) => db.Write(() =>
    {
        // The product catalog is already present in a fresh database.
        foreach (var table in new[] { "players", "ratings", "bag", "vault", "trades", "battles", "events", "audit", "sessions", "requests", "ledger" })
            if (db.Scalar($"SELECT count(*) FROM {table}") != 0)
                throw new InvalidOperationException("--seed-demo requires a fresh data folder.");

        var now = DateTimeOffset.UtcNow;
        var names = new[] { "Test Ember", "Test Brook", "Test Fern", "Test Gale", "Test Frost", "Test Dawn" };
        var statuses = new[] { "ok", "ok", "flagged", "muted", "banned", "ok" };
        var species = new[] { "Pikachu", "Eevee", "Bulbasaur", "Squirtle", "Charmander", "Dragonite" };
        for (var i = 0; i < names.Length; i++)
        {
            var id = (long)i + 1;
            db.Put("players", new() { ["id"] = id }, new()
            {
                ["id"] = id, ["discordId"] = i == 5 ? null : $"10000000000000000{i}", ["name"] = names[i],
                ["created"] = now.AddDays(-30 - i).ToString("O"), ["lastSeen"] = now.AddHours(-i * 12).ToString("O"),
                ["money"] = 1000L + i * 250, ["battlePoints"] = 10L + i * 5, ["experience"] = 500L + i * 600,
                ["status"] = statuses[i], ["statusReason"] = statuses[i] == "ok" ? "" : "Demo status for console testing.",
                ["notes"] = "Demo player."
            });
            db.Ledger(id, "admin", null, 0, 1000L + i * 250);
            foreach (var (playlist, index) in AdminApi.Playlists.Select((p, index) => (p, index)))
            {
                if (i == 5 && index == 3) continue;
                db.Put("ratings", new() { ["playerId"] = id, ["playlist"] = playlist }, new()
                {
                    ["playerId"] = id, ["playlist"] = playlist, ["rating"] = 5L + i * 5 + index,
                    ["highestRating"] = 8L + i * 5 + index
                });
            }
            foreach (var item in new[] { "Potion", "Poke Ball" })
            {
                db.Put("bag", new() { ["playerId"] = id, ["item"] = item }, new()
                {
                    ["playerId"] = id, ["item"] = item, ["count"] = 3L + i
                });
                db.Ledger(id, "admin", item, 3L + i, 0);
            }
            db.Put("vault", new() { ["id"] = id }, new()
            {
                ["id"] = id, ["playerId"] = id, ["species"] = species[i], ["nickname"] = i == 0 ? "Sparky" : "",
                ["level"] = 10L + i * 5, ["shiny"] = i == 5, ["otName"] = names[i], ["originGame"] = "Demo",
                ["fingerprint"] = $"demo-vault-{id}", ["legal"] = i != 2,
                ["state"] = i == 4 ? "withdrawn" : "stored", ["legalityIssue"] = i == 2 ? "Demo legality issue." : null,
                ["hubOrigin"] = i == 1 ? "Demo hub encounter: welcome meadow" : null,
                ["data"] = null, ["removed"] = i == 4, ["added"] = now.AddDays(-i - 1).ToString("O")
            });
        }
        for (var i = 0; i < 3; i++)
            db.Put("trades", new() { ["id"] = (long)i + 1 }, new()
            {
                ["id"] = (long)i + 1, ["at"] = now.AddHours(-i - 1).ToString("O"),
                ["fromPlayer"] = (long)i + 1, ["toPlayer"] = (long)i + 2, ["summary"] = "Demo exchange of Vault Pokemon."
            });
        for (var i = 0; i < 4; i++)
            db.Put("battles", new() { ["id"] = (long)i + 1 }, new()
            {
                ["id"] = (long)i + 1, ["at"] = now.AddHours(-i - 2).ToString("O"), ["playlist"] = AdminApi.Playlists[i],
                ["playerA"] = (long)i + 1, ["playerB"] = (long)i + 2, ["winner"] = i == 3 ? null : (long)i + 1,
                ["rated"] = i != 3, ["summary"] = i == 3 ? "Demo friendly draw." : "Demo rated battle."
            });
        db.Put("events", new() { ["id"] = 1L }, new()
        {
            ["id"] = 1L, ["kind"] = "raid", ["name"] = "Test thunder raid", ["species"] = "Pikachu",
            ["starts"] = now.AddHours(-1).ToString("O"), ["ends"] = now.AddDays(3).ToString("O"), ["enabled"] = true,
            ["details"] = "{\"rewards\":[\"Potion\"],\"cooldownHours\":24,\"notes\":\"Demo active raid.\"}"
        });
        db.Put("events", new() { ["id"] = 2L }, new()
        {
            ["id"] = 2L, ["kind"] = "event", ["name"] = "Test welcome weekend", ["species"] = null,
            ["starts"] = now.AddDays(7).ToString("O"), ["ends"] = now.AddDays(9).ToString("O"), ["enabled"] = true,
            ["details"] = "{\"rewards\":[],\"cooldownHours\":12,\"notes\":\"Demo scheduled event.\"}"
        });
        var items = new[] { "Potion", "Super Potion", "Revive", "Poke Ball", "Great Ball", "Rare Candy" };
        for (var i = 0; i < items.Length; i++)
            db.Put("shop", new() { ["item"] = items[i] }, new Row
            {
                ["item"] = items[i], ["price"] = 100L + i * 200, ["stock"] = i == 0 ? null : (long)(i - 1) * 10,
                ["enabled"] = i != 5
            });
        return true;
    });
}
