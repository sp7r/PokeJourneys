using System.Globalization;
using System.Text.Json;
using static Journeys.Server.AdminApi;
using static Journeys.Server.GameApi;
using Row = System.Collections.Generic.Dictionary<string, object?>;

namespace Journeys.Server;

internal static class Wallet
{
    private const long MaxMoney = 9_999_999;
    // TMs the bridge can put in a save; any other tm: key would never reach a game.
    private static readonly HashSet<string> Machines = Journeys.Core.TrainerEconomy.Catalog()
        .Select(p => p.Key).Where(k => k.StartsWith("tm:", StringComparison.Ordinal)).ToHashSet();

    internal static Row Read(Db db, long id)
    {
        var player = db.Player(id);
        return new()
        {
            ["money"] = player["money"], ["imported"] = player["walletImported"],
            ["items"] = db.Rows("SELECT item, count FROM bag WHERE player_id = $id AND count > 0 ORDER BY item", ("id", id))
                .ToDictionary(row => (string)row["item"]!, row => (long)row["count"]!)
        };
    }

    internal static void MapWallet(this RouteGroupBuilder api)
    {
        api.MapGet("/wallet", (HttpContext context, Db db) => Results.Ok(Read(db, PlayerId(context))));
        api.MapPost("/wallet/report", async (HttpContext context, Db db) =>
        {
            var body = await Body(context.Request, "source", "money", "items", "requestId");
            return Change(db, context, body, requestId => Report(db, PlayerId(context), body, requestId));
        });
        api.MapPost("/shop/sell", async (HttpContext context, Db db) =>
        {
            var body = await Body(context.Request, "item", "count", "requestId");
            return Change(db, context, body, requestId =>
            {
                var id = PlayerId(context);
                var item = Text(body, "item");
                if (!item.StartsWith("mart:", StringComparison.Ordinal)) throw new ApiError("This shop cannot make that trade.");
                var count = Integer(body, "count", 1, 999);
                var shop = db.Row("SELECT price FROM shop WHERE item = $item", ("item", item))
                    ?? throw new ApiError(404, "Shop item not found.");
                var bag = db.Number("SELECT COALESCE(MAX(count), 0) FROM bag WHERE player_id = $id AND item = $item", ("id", id), ("item", item));
                if (bag < count) throw new ApiError("You don't have that many to sell.");
                var money = (long)db.Player(id)["money"]!;
                var price = (long)shop["price"]! / 2;
                if (money > MaxMoney || price > (MaxMoney - money) / count) throw new ApiError("Your wallet is full.");
                var proceeds = price * count;
                db.Execute("UPDATE players SET money = money + $proceeds WHERE id = $id", ("id", id), ("proceeds", proceeds));
                SetBag(db, id, item, bag - count);
                db.Ledger(id, "sell", item, -count, proceeds, requestId);
                return new { money = money + proceeds, count = bag - count, wallet = Read(db, id) };
            });
        });
    }

    private static Row Report(Db db, long id, JsonElement body, string? requestId)
    {
        var source = Text(body, "source");
        if (source.Length > 64) throw new ApiError("source must be at most 64 characters.");
        var money = Integer(body, "money", long.MinValue);
        if (!body.TryGetProperty("items", out var rawItems) || rawItems.ValueKind != JsonValueKind.Object)
            throw new ApiError("items must be an object.");
        var items = new Dictionary<string, (long Change, int Limit)>();
        foreach (var item in rawItems.EnumerateObject())
        {
            var limit = KeyLimit(item.Name);
            if (item.Value.ValueKind != JsonValueKind.Number || !item.Value.TryGetInt64(out var change))
                throw new ApiError($"The change for '{item.Name}' must be a signed whole number.");
            if (!items.TryAdd(item.Name, (change, limit))) throw new ApiError($"Duplicate wallet key: {item.Name}.");
            if (items.Count > 500) throw new ApiError("A wallet report can contain at most 500 keys.");
        }
        var player = db.Player(id);
        var importing = source == "import";
        var imported = (bool)player["walletImported"]!;
        if (importing && imported) throw new ApiError(409, "This wallet was already brought to this server.");
        if (!importing && !imported) throw new ApiError(409, "Bring your wallet to this server first.");
        var oldMoney = (long)player["money"]!;
        var newMoney = Clamp(oldMoney, money, MaxMoney);
        db.Execute("UPDATE players SET money = $money, wallet_imported = 1 WHERE id = $id", ("money", newMoney), ("id", id));
        var kind = importing ? "import" : "journey";
        db.Ledger(id, kind, null, 0, newMoney - oldMoney, requestId, source);
        foreach (var (key, delta) in items)
        {
            var oldCount = db.Number("SELECT COALESCE(MAX(count), 0) FROM bag WHERE player_id = $id AND item = $item", ("id", id), ("item", key));
            var count = Clamp(oldCount, delta.Change, delta.Limit);
            if (count == oldCount) continue;
            SetBag(db, id, key, count);
            db.Ledger(id, kind, key, count - oldCount, 0, requestId, source);
        }
        if ((string)player["status"]! == "ok" && (money > 200_000 || items.Values.Any(p => p.Change > 99)
                || importing && money > 999_999))
        {
            var reason = $"Large wallet report from {source}";
            Row before = new() { ["status"] = player["status"], ["statusReason"] = player["statusReason"] };
            Row after = new() { ["status"] = "flagged", ["statusReason"] = reason };
            db.Update("players", new() { ["id"] = id }, after);
            db.Audit("player.status", $"player:{id}", before, after, reason, "server");
        }
        return Read(db, id);
    }

    private static long Clamp(long current, long change, long limit) => (long)Math.Clamp((decimal)current + change, 0, limit);

    private static int KeyLimit(string key)
    {
        var colon = key.IndexOf(':');
        if (colon > 0)
        {
            var value = key[(colon + 1)..];
            if (key.StartsWith("mart:", StringComparison.Ordinal) && value.Length > 0 && value == value.Trim()
                && value == value.ToLowerInvariant() && !value.Any(c => char.IsControl(c) || c == ':')) return 999;
            if (key.StartsWith("tm:", StringComparison.Ordinal) && int.TryParse(value, NumberStyles.None, CultureInfo.InvariantCulture, out var move)
                && value == move.ToString(CultureInfo.InvariantCulture) && Machines.Contains(key)) return 999;
            if (key.StartsWith("costume:", StringComparison.Ordinal) && value.Length > 0
                && value.All(c => char.IsAsciiLetterLower(c) || char.IsAsciiDigit(c) || c == '-')) return 1;
        }
        throw new ApiError($"Invalid wallet key '{key}'.");
    }
}
