using System.Text;
using System.Text.Json;
using Microsoft.Data.Sqlite;
using Row = System.Collections.Generic.Dictionary<string, object?>;

namespace Journeys.Server;

sealed class Db : IDisposable
{
    private readonly SqliteConnection connection;
    private SqliteTransaction? transaction;
    private static readonly HashSet<string> BooleanColumns = ["shiny", "legal", "removed", "rated", "enabled", "rolled_back", "wallet_imported", "imported", "notice", "deleted"];

    public Db(string connectionString)
    {
        connection = new SqliteConnection(connectionString);
        connection.Open();
    }

    public static string Now() => Utc(DateTimeOffset.UtcNow);
    public static string Utc(DateTimeOffset value) => value.ToUniversalTime().ToString("O");
    public void Begin() => transaction = connection.BeginTransaction();
    public void Commit() => transaction!.Commit();

    public void Initialize()
    {
        Execute("""
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS players (
            id INTEGER PRIMARY KEY AUTOINCREMENT, discord_id TEXT UNIQUE, name TEXT NOT NULL,
            created TEXT NOT NULL, last_seen TEXT NOT NULL,
            money INTEGER NOT NULL DEFAULT 0 CHECK(money >= 0),
            battle_points INTEGER NOT NULL DEFAULT 0 CHECK(battle_points >= 0),
            experience INTEGER NOT NULL DEFAULT 0 CHECK(experience >= 0),
            status TEXT NOT NULL DEFAULT 'ok' CHECK(status IN ('ok','flagged','muted','banned')),
            status_reason TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT ''
        );
        CREATE TABLE IF NOT EXISTS ratings (
            player_id INTEGER NOT NULL REFERENCES players(id),
            playlist TEXT NOT NULL CHECK(playlist IN ('random_singles','random_doubles','open_singles','open_doubles')),
            rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 50),
            highest_rating INTEGER NOT NULL CHECK(highest_rating BETWEEN rating AND 50),
            PRIMARY KEY(player_id, playlist)
        );
        CREATE TABLE IF NOT EXISTS bag (
            player_id INTEGER NOT NULL REFERENCES players(id), item TEXT NOT NULL,
            count INTEGER NOT NULL CHECK(count > 0), PRIMARY KEY(player_id, item)
        );
        CREATE TABLE IF NOT EXISTS vault (
            id INTEGER PRIMARY KEY AUTOINCREMENT, player_id INTEGER NOT NULL REFERENCES players(id),
            species TEXT NOT NULL, nickname TEXT NOT NULL, level INTEGER NOT NULL CHECK(level BETWEEN 1 AND 100),
            shiny INTEGER NOT NULL CHECK(shiny IN (0,1)), ot_name TEXT NOT NULL, origin_game TEXT NOT NULL,
            fingerprint TEXT NOT NULL, legal INTEGER NOT NULL CHECK(legal IN (0,1)), hub_origin TEXT, data TEXT,
            removed INTEGER NOT NULL DEFAULT 0 CHECK(removed IN (0,1)), added TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS trades (
            id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL,
            from_player INTEGER NOT NULL REFERENCES players(id), to_player INTEGER NOT NULL REFERENCES players(id),
            summary TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS battles (
            id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL,
            playlist TEXT NOT NULL CHECK(playlist IN ('random_singles','random_doubles','open_singles','open_doubles')),
            player_a INTEGER NOT NULL REFERENCES players(id), player_b INTEGER NOT NULL REFERENCES players(id),
            winner INTEGER REFERENCES players(id), rated INTEGER NOT NULL CHECK(rated IN (0,1)), summary TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS events (
            id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL CHECK(kind IN ('raid','event')),
            name TEXT NOT NULL, species TEXT, starts TEXT NOT NULL, ends TEXT NOT NULL,
            enabled INTEGER NOT NULL CHECK(enabled IN (0,1)), details TEXT NOT NULL CHECK(json_valid(details))
        );
        CREATE TABLE IF NOT EXISTS shop (
            item TEXT PRIMARY KEY NOT NULL, price INTEGER NOT NULL CHECK(price >= 0),
            stock INTEGER CHECK(stock >= 0), enabled INTEGER NOT NULL CHECK(enabled IN (0,1))
        );
        CREATE TABLE IF NOT EXISTS audit (
            id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, admin TEXT NOT NULL,
            action TEXT NOT NULL, target TEXT NOT NULL,
            "before" TEXT NOT NULL CHECK(json_valid("before")), "after" TEXT NOT NULL CHECK(json_valid("after")),
            reason TEXT NOT NULL CHECK(length(trim(reason)) > 0),
            rolled_back INTEGER NOT NULL DEFAULT 0 CHECK(rolled_back IN (0,1))
        );
        CREATE INDEX IF NOT EXISTS vault_player ON vault(player_id);
        CREATE INDEX IF NOT EXISTS trades_from ON trades(from_player, id DESC);
        CREATE INDEX IF NOT EXISTS trades_to ON trades(to_player, id DESC);
        CREATE INDEX IF NOT EXISTS battles_a ON battles(player_a, id DESC);
        CREATE INDEX IF NOT EXISTS battles_b ON battles(player_b, id DESC);
        CREATE INDEX IF NOT EXISTS audit_target ON audit(target, id DESC);
        CREATE TABLE IF NOT EXISTS sessions (
            token_hash TEXT PRIMARY KEY NOT NULL, player_id INTEGER NOT NULL REFERENCES players(id),
            created TEXT NOT NULL, expires TEXT NOT NULL, last_used TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS sessions_player ON sessions(player_id, last_used DESC);
        CREATE TABLE IF NOT EXISTS requests (
            player_id INTEGER NOT NULL REFERENCES players(id), request_id TEXT NOT NULL CHECK(length(request_id) BETWEEN 1 AND 64),
            response TEXT NOT NULL CHECK(json_valid(response)), at TEXT NOT NULL,
            PRIMARY KEY(player_id, request_id)
        );
        CREATE TABLE IF NOT EXISTS ledger (
            id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, player_id INTEGER NOT NULL REFERENCES players(id),
            kind TEXT NOT NULL CHECK(kind IN ('buy','take','admin')), item TEXT, count INTEGER NOT NULL,
            money_change INTEGER NOT NULL, money_after INTEGER NOT NULL, request_id TEXT
        );
        CREATE INDEX IF NOT EXISTS ledger_player ON ledger(player_id, id DESC);
        CREATE TABLE IF NOT EXISTS friends (
            player_a INTEGER NOT NULL REFERENCES players(id), player_b INTEGER NOT NULL REFERENCES players(id),
            since TEXT NOT NULL, PRIMARY KEY(player_a, player_b), CHECK(player_a < player_b)
        );
        CREATE INDEX IF NOT EXISTS friends_b ON friends(player_b);
        CREATE TABLE IF NOT EXISTS chat (
            id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL,
            from_player INTEGER REFERENCES players(id), to_player INTEGER REFERENCES players(id), text TEXT NOT NULL,
            notice INTEGER NOT NULL DEFAULT 0 CHECK(notice IN (0,1)),
            deleted INTEGER NOT NULL DEFAULT 0 CHECK(deleted IN (0,1))
        );
        CREATE INDEX IF NOT EXISTS chat_global ON chat(id) WHERE to_player IS NULL;
        CREATE INDEX IF NOT EXISTS chat_direct ON chat(from_player, to_player, id) WHERE to_player IS NOT NULL;
        CREATE INDEX IF NOT EXISTS chat_from ON chat(from_player, id);
        CREATE INDEX IF NOT EXISTS chat_to ON chat(to_player, id) WHERE to_player IS NOT NULL;
        CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL CHECK(json_valid(value)));
        CREATE TABLE IF NOT EXISTS characters (
            player_id INTEGER PRIMARY KEY REFERENCES players(id), look TEXT NOT NULL CHECK(json_valid(look)), updated TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS releases (
            id INTEGER PRIMARY KEY AUTOINCREMENT, version TEXT NOT NULL UNIQUE,
            version_code INTEGER NOT NULL CHECK(version_code > 0), notes TEXT NOT NULL,
            size INTEGER NOT NULL CHECK(size > 0), sha256 TEXT NOT NULL,
            published INTEGER NOT NULL DEFAULT 0 CHECK(published IN (0,1)), created TEXT NOT NULL
        );
        """);
        Write(() =>
        {
            var columns = Query("PRAGMA table_info(vault)").Select(row => (string)row["name"]!).ToHashSet();
            if (!columns.Contains("state"))
            {
                Execute("ALTER TABLE vault ADD COLUMN state TEXT NOT NULL DEFAULT 'stored' CHECK(state IN ('stored','withdrawing','withdrawn'))");
                Execute("UPDATE vault SET state = 'withdrawn' WHERE removed = 1");
            }
            if (!columns.Contains("legality_issue")) Execute("ALTER TABLE vault ADD COLUMN legality_issue TEXT");
            Execute("CREATE INDEX IF NOT EXISTS vault_fingerprint ON vault(fingerprint, state)");
            // At most one live copy of a Pokémon, even if two deposits race.
            Execute("CREATE UNIQUE INDEX IF NOT EXISTS vault_fingerprint_live ON vault(fingerprint) WHERE state IN ('stored','withdrawing') AND fingerprint IS NOT NULL AND fingerprint <> ''");
            if (!Query("PRAGMA table_info(players)").Any(row => (string)row["name"]! == "wallet_imported"))
                Execute("ALTER TABLE players ADD COLUMN wallet_imported INTEGER NOT NULL DEFAULT 0 CHECK(wallet_imported IN (0,1))");
            var shopColumns = Query("PRAGMA table_info(shop)").Select(row => (string)row["name"]!).ToHashSet();
            if (!shopColumns.Contains("label")) Execute("ALTER TABLE shop ADD COLUMN label TEXT");
            if (!shopColumns.Contains("max_owned")) Execute("ALTER TABLE shop ADD COLUMN max_owned INTEGER CHECK(max_owned >= 0)");
            if (!Query("PRAGMA table_info(ledger)").Any(row => (string)row["name"]! == "source"))
            {
                // Rebuild the original table to extend its kind constraint without losing history.
                Execute("""
                    CREATE TABLE ledger_sync (
                        id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, player_id INTEGER NOT NULL REFERENCES players(id),
                        kind TEXT NOT NULL CHECK(kind IN ('buy','sell','take','admin','import','journey')), item TEXT, count INTEGER NOT NULL,
                        money_change INTEGER NOT NULL, money_after INTEGER NOT NULL, request_id TEXT, source TEXT
                    );
                    INSERT INTO ledger_sync (id, at, player_id, kind, item, count, money_change, money_after, request_id)
                        SELECT id, at, player_id, kind, item, count, money_change, money_after, request_id FROM ledger;
                    DROP TABLE ledger;
                    ALTER TABLE ledger_sync RENAME TO ledger;
                    CREATE INDEX ledger_player ON ledger(player_id, id DESC);
                    """);
            }
            foreach (var product in Journeys.Core.TrainerEconomy.Catalog())
                Execute("""
                    INSERT INTO shop (item, label, price, stock, enabled, max_owned)
                    VALUES ($item, $label, $price, NULL, 1, $limit) ON CONFLICT(item) DO NOTHING
                    """, ("item", product.Key), ("label", product.Label), ("price", product.Price), ("limit", product.Limit));
            return true;
        });
        PruneChat();
    }

    public void PruneChat() => Execute("DELETE FROM chat WHERE at < $before", ("before", Utc(DateTimeOffset.UtcNow.AddDays(-7))));

    public void Backup(string destination)
    {
        using var target = new SqliteConnection(new SqliteConnectionStringBuilder { DataSource = destination, Pooling = false }.ToString());
        target.Open();
        connection.BackupDatabase(target);
    }

    public void Ledger(long playerId, string kind, string? item, long count, long moneyChange, string? requestId = null, string? source = null) => Execute("""
        INSERT INTO ledger (at, player_id, kind, item, count, money_change, money_after, request_id, source)
        VALUES ($at, $player, $kind, $item, $count, $change, (SELECT money FROM players WHERE id = $player), $request, $source)
        """, ("at", Now()), ("player", playerId), ("kind", kind), ("item", item), ("count", count), ("change", moneyChange), ("request", requestId), ("source", source));

    public void RecordAdminChange(Change change, Row? before, Row? after)
    {
        if (change.Table == "players")
        {
            var playerId = Convert.ToInt64(change.Keys["id"]);
            if (after?.GetValueOrDefault("status") as string == "banned")
                Execute("DELETE FROM sessions WHERE player_id = $id", ("id", playerId));
            if (before?.GetValueOrDefault("money") is long oldMoney && after?.GetValueOrDefault("money") is long newMoney && newMoney != oldMoney)
                Ledger(playerId, "admin", null, 0, newMoney - oldMoney);
        }
        if (change.Table == "bag")
        {
            var oldCount = Convert.ToInt64(before?.GetValueOrDefault("count"));
            var newCount = Convert.ToInt64(after?.GetValueOrDefault("count"));
            if (oldCount != newCount)
                Ledger(Convert.ToInt64(change.Keys["playerId"]), "admin", (string)change.Keys["item"]!, newCount - oldCount, 0);
        }
    }

    public T Write<T>(Func<T> work)
    {
        using var current = connection.BeginTransaction();
        transaction = current;
        try
        {
            var result = work();
            current.Commit();
            return result;
        }
        finally { transaction = null; }
    }

    private SqliteCommand Command(string sql, (string Name, object? Value)[] parameters)
    {
        var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = sql;
        foreach (var (name, value) in parameters)
            command.Parameters.AddWithValue(name.StartsWith('$') ? name : "$" + name, value ?? DBNull.Value);
        return command;
    }

    public int Execute(string sql, params (string Name, object? Value)[] parameters)
    {
        using var command = Command(sql, parameters);
        return command.ExecuteNonQuery();
    }

    public long Scalar(string sql, params (string Name, object? Value)[] parameters)
    {
        using var command = Command(sql, parameters);
        return Convert.ToInt64(command.ExecuteScalar());
    }

    public List<Row> Query(string sql, params (string Name, object? Value)[] parameters)
    {
        using var command = Command(sql, parameters);
        using var reader = command.ExecuteReader();
        var rows = new List<Row>();
        while (reader.Read())
        {
            var row = new Row();
            for (var i = 0; i < reader.FieldCount; i++)
            {
                var name = reader.GetName(i);
                row[Camel(name)] = reader.IsDBNull(i) ? null : BooleanColumns.Contains(name) ? reader.GetInt64(i) != 0 : reader.GetValue(i);
            }
            rows.Add(row);
        }
        return rows;
    }

    public Row RequirePlayer(long id) => Query("SELECT * FROM players WHERE id = $id", ("id", id)).FirstOrDefault()
        ?? throw new ApiError(404, "Player not found.");

    public long Number(string sql, params (string, object?)[] parameters) => Scalar(sql, parameters);
    public List<Row> Rows(string sql, params (string, object?)[] parameters) => Query(sql, parameters);
    public Row? Row(string sql, params (string, object?)[] parameters) => Query(sql, parameters).FirstOrDefault();
    public Row Player(long id) => RequirePlayer(id);

    public static Change Describe(string action, string target, string[]? fields = null)
    {
        var kind = action;
        while (kind.StartsWith("rollback:", StringComparison.Ordinal)) kind = kind[9..];
        var parts = target.Split('/', 3);
        var id = target[(target.IndexOf(':') + 1)..].Split('/')[0];
        Row playerKey = new() { ["id"] = id };
        return kind switch
        {
            "player.update" => new(action, target, "players", playerKey, fields),
            "player.status" => new(action, target, "players", playerKey, ["status", "statusReason"]),
            "rating.put" => new(action, target, "ratings", new() { ["playerId"] = id, ["playlist"] = parts[2] }),
            "bag.put" => new(action, target, "bag", new() { ["playerId"] = id, ["item"] = parts[2] }),
            "vault.remove" or "vault.restore" => new(action, target, "vault", new() { ["id"] = parts[2], ["playerId"] = id }, ["removed"]),
            "event.create" or "event.update" or "event.delete" => new(action, target, "events", new() { ["id"] = id }),
            "shop.put" or "shop.delete" => new(action, target, "shop", new() { ["item"] = target[5..] }),
            _ => throw new ApiError("This change cannot be rolled back.")
        };
    }

    public Row? Snapshot(Change change)
    {
        var row = Find(change.Table, change.Keys);
        if (change.Fields is null) return row;
        if (row is null) throw new ApiError("Record not found.", 404);
        return change.Fields.ToDictionary(field => field, field => row[field]);
    }

    public void Restore(Change change, Row? state)
    {
        if (change.Fields is not null)
        {
            if (state is null) throw new InvalidOperationException("A field change must have a previous state.");
            Update(change.Table, change.Keys, state);
        }
        else if (state is null) Delete(change.Table, change.Keys);
        else Put(change.Table, change.Keys, state);
    }

    public long Audit(Change change, Row? before, Row? after, string reason) => Audit(change.Action, change.Target, before, after, reason);
    public static Row? Decode(object? json) => ParseSnapshot(json);

    public Row? Find(string table, Row keys) => Query($"SELECT * FROM {Quote(table)} WHERE {Where(keys)}", Parameters(keys)).FirstOrDefault();

    public void Delete(string table, Row keys) => Execute($"DELETE FROM {Quote(table)} WHERE {Where(keys)}", Parameters(keys));

    public void Update(string table, Row keys, Row fields)
    {
        var assignments = string.Join(", ", fields.Keys.Select(k => $"{Quote(Snake(k))} = $v_{k}"));
        Execute($"UPDATE {Quote(table)} SET {assignments} WHERE {Where(keys)}",
            [.. Parameters(keys), .. fields.Select(p => ("v_" + p.Key, p.Value))]);
    }

    public long Put(string table, Row keys, Row row)
    {
        var columns = string.Join(", ", row.Keys.Select(k => Quote(Snake(k))));
        var values = string.Join(", ", row.Keys.Select(k => "$" + k));
        var conflict = string.Join(", ", keys.Keys.Select(k => Quote(Snake(k))));
        var updates = string.Join(", ", row.Keys.Except(keys.Keys).Select(k => $"{Quote(Snake(k))} = excluded.{Quote(Snake(k))}"));
        Execute($"INSERT INTO {Quote(table)} ({columns}) VALUES ({values}) ON CONFLICT ({conflict}) DO UPDATE SET {updates}", Parameters(row));
        return Scalar("SELECT last_insert_rowid()");
    }

    public long Audit(string action, string target, Row? before, Row? after, string reason, string admin = "admin-key")
    {
        Execute("""
            INSERT INTO audit (at, admin, action, target, "before", "after", reason)
            VALUES ($at, $admin, $action, $target, $before, $after, $reason)
            """, ("at", Now()), ("admin", admin), ("action", action), ("target", target),
            ("before", JsonSerializer.Serialize(before)), ("after", JsonSerializer.Serialize(after)), ("reason", reason));
        return Scalar("SELECT last_insert_rowid()");
    }

    public static Row? ParseSnapshot(object? json)
    {
        using var document = JsonDocument.Parse((string)json!);
        if (document.RootElement.ValueKind == JsonValueKind.Null) return null;
        return document.RootElement.EnumerateObject().ToDictionary(p => p.Name, p => p.Value.ValueKind switch
        {
            JsonValueKind.Null => null,
            JsonValueKind.True => (object)true,
            JsonValueKind.False => false,
            JsonValueKind.Number => p.Value.GetInt64(),
            _ => (object?)p.Value.GetString()
        });
    }

    private static string Quote(string name) => "\"" + name.Replace("\"", "\"\"") + "\"";
    private static string Where(Row keys) => string.Join(" AND ", keys.Keys.Select(k => $"{Quote(Snake(k))} = ${k}"));
    private static (string, object?)[] Parameters(Row row) => row.Select(p => (p.Key, p.Value)).ToArray();
    private static string Camel(string name)
    {
        var parts = name.Split('_');
        return parts[0] + string.Concat(parts.Skip(1).Select(p => char.ToUpperInvariant(p[0]) + p[1..]));
    }
    private static string Snake(string name)
    {
        var result = new StringBuilder();
        foreach (var c in name)
        {
            if (char.IsUpper(c)) result.Append('_');
            result.Append(char.ToLowerInvariant(c));
        }
        return result.ToString();
    }

    public void Dispose()
    {
        transaction?.Dispose();
        connection.Dispose();
    }
}

sealed record Change(string Action, string Target, string Table, Row Keys, string[]? Fields = null);

sealed class ApiError(int status, string message) : Exception(message)
{
    public ApiError(string message, int status = 400) : this(status, message) { }
    public int Status { get; } = status;
}
