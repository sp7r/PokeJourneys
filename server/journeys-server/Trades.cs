using Row = System.Collections.Generic.Dictionary<string, object?>;
using System.Collections.Concurrent;
using System.Text.Json;

namespace Journeys.Server;

/// <summary>
/// Trades between two players on the live connection, after one accepts the other's trade request. Each player offers
/// one Pokémon from their own Vault (stored, not being withdrawn); a new offer clears both confirmations; when both
/// confirm, the server swaps the two Vault entries' owners in one transaction and records it in the audit log. Either
/// player can cancel, and leaving cancels. A trade left open for ten minutes closes.
///
/// Messages: the server sends trade_open { trade, with { id, name }, vault [...] }, trade_update { trade, mine, theirs,
/// confirmed { mine, theirs } }, trade_done { trade, gave, got } and trade_closed { trade, reason }. Players send
/// trade_offer { trade, vault: id or null }, trade_confirm { trade } and trade_cancel { trade }.
/// </summary>
sealed partial class Live
{
    private sealed class Trade(string id, long a, long b)
    {
        public string Id { get; } = id;
        public long A { get; } = a;
        public long B { get; } = b;
        public readonly Dictionary<long, long?> Offers = new() { [a] = null, [b] = null };
        public readonly HashSet<long> Confirmed = [];
        public readonly DateTime Expires = DateTime.UtcNow.AddMinutes(10);
        public bool Done;
        public long Other(long player) => player == A ? B : A;
    }

    private readonly ConcurrentDictionary<string, Trade> trades = new();
    private const string VaultSummary = "id, species, nickname, level, shiny, ot_name, origin_game";

    private Trade? TradeOf(long player) =>
        trades.Values.FirstOrDefault(t => !t.Done && (t.A == player || t.B == player) && t.Expires > DateTime.UtcNow);

    // An accepted trade request opens a trade for both players, each with their own Vault to pick from.
    private async Task OpenTrade(Client from, Client to)
    {
        foreach (var player in new[] { from, to })
            if (TradeOf(player.Id) is { } busy) await CloseTrade(busy, $"{player.Name} started another trade.");
        var trade = new Trade(Guid.NewGuid().ToString("N")[..12], from.Id, to.Id);
        trades[trade.Id] = trade;
        using var db = new Db(connectionString);
        foreach (var (player, other) in new[] { (from, to), (to, from) })
            await Send(player, new
            {
                type = "trade_open", trade = trade.Id, with = new { id = other.Id, name = other.Name },
                vault = db.Rows($"SELECT {VaultSummary} FROM vault WHERE player_id = $p AND state = 'stored' AND removed = 0 ORDER BY id", ("p", player.Id))
            });
        logger.LogInformation("Trade {Trade} opened between {A} and {B}", trade.Id, from.Name, to.Name);
    }

    private async Task HandleTrade(Client client, string type, JsonElement message)
    {
        var id = message.TryGetProperty("trade", out var t) && t.ValueKind == JsonValueKind.String ? t.GetString()! : "";
        if (!trades.TryGetValue(id, out var trade) || trade.Done || (trade.A != client.Id && trade.B != client.Id))
        {
            await Send(client, new { type = "trade_closed", trade = id, reason = "That trade has ended." });
            return;
        }
        if (trade.Expires < DateTime.UtcNow) { await CloseTrade(trade, "The trade took too long and was closed."); return; }
        switch (type)
        {
            case "trade_offer":
                long? vault = message.TryGetProperty("vault", out var v) && v.ValueKind == JsonValueKind.Number ? v.GetInt64() : null;
                if (vault is not null)
                {
                    using var db = new Db(connectionString);
                    if (db.Number("SELECT COUNT(*) FROM vault WHERE id = $id AND player_id = $p AND state = 'stored' AND removed = 0",
                            ("id", vault), ("p", client.Id)) == 0)
                    {
                        await Send(client, new { type = "error", error = "That Pokémon isn't in your Vault." });
                        return;
                    }
                }
                lock (trade) { trade.Offers[client.Id] = vault; trade.Confirmed.Clear(); }
                await UpdateTrade(trade);
                break;
            case "trade_confirm":
                bool ready;
                lock (trade)
                {
                    if (trade.Offers[client.Id] is null) ready = false;
                    else { trade.Confirmed.Add(client.Id); ready = trade.Confirmed.Count == 2 && trade.Offers.Values.All(o => o is not null); }
                }
                if (ready) await FinishTrade(trade);
                else await UpdateTrade(trade);
                break;
            default:
                await CloseTrade(trade, $"{client.Name} cancelled the trade.");
                break;
        }
    }

    private async Task UpdateTrade(Trade trade)
    {
        using var db = new Db(connectionString);
        object? Summary(long? vault) => vault is null ? null : db.Row($"SELECT {VaultSummary} FROM vault WHERE id = $id", ("id", vault));
        foreach (var player in new[] { trade.A, trade.B })
        {
            if (!clients.TryGetValue(player, out var client)) continue;
            var other = trade.Other(player);
            await Send(client, new
            {
                type = "trade_update", trade = trade.Id, mine = Summary(trade.Offers[player]), theirs = Summary(trade.Offers[other]),
                confirmed = new { mine = trade.Confirmed.Contains(player), theirs = trade.Confirmed.Contains(other) }
            });
        }
    }

    // Both confirmed: swap the two entries' owners, checking again that each is still stored and still theirs.
    private async Task FinishTrade(Trade trade)
    {
        lock (trade) { if (trade.Done) return; trade.Done = true; }
        trades.TryRemove(trade.Id, out _);
        var fromA = trade.Offers[trade.A]!.Value;
        var fromB = trade.Offers[trade.B]!.Value;
        Row? gotA = null, gotB = null;
        string? failure = null;
        using (var db = new Db(connectionString))
        {
            try
            {
                db.Write(() =>
                {
                    var a = db.Row("SELECT * FROM vault WHERE id = $id AND player_id = $p AND state = 'stored' AND removed = 0", ("id", fromA), ("p", trade.A));
                    var b = db.Row("SELECT * FROM vault WHERE id = $id AND player_id = $p AND state = 'stored' AND removed = 0", ("id", fromB), ("p", trade.B));
                    if (a is null || b is null) throw new ApiError("One of the Pokémon left its Vault before the trade finished.");
                    db.Execute("UPDATE vault SET player_id = $p WHERE id = $id", ("p", trade.B), ("id", fromA));
                    db.Execute("UPDATE vault SET player_id = $p WHERE id = $id", ("p", trade.A), ("id", fromB));
                    gotA = db.Row($"SELECT {VaultSummary} FROM vault WHERE id = $id", ("id", fromB));
                    gotB = db.Row($"SELECT {VaultSummary} FROM vault WHERE id = $id", ("id", fromA));
                    // The players' trade history (the admin console's player page lists it).
                    db.Execute("INSERT INTO trades (at, from_player, to_player, summary) VALUES ($at, $a, $b, $summary)",
                        ("at", Db.Now()), ("a", trade.A), ("b", trade.B),
                        ("summary", $"{a["species"]} (vault {fromA}) for {b["species"]} (vault {fromB})"));
                    var before = new Row { ["trade"] = trade.Id, ["player_a"] = trade.A, ["vault_a"] = fromA, ["player_b"] = trade.B, ["vault_b"] = fromB };
                    var after = new Row { ["trade"] = trade.Id, ["vault_a_owner"] = trade.B, ["vault_b_owner"] = trade.A };
                    db.Audit("vault.trade", $"trade:{trade.Id}", before, after, "Players traded", $"player:{trade.A}+{trade.B}");
                    return true;
                });
            }
            catch (ApiError error) { failure = error.Message; }
        }
        if (failure is not null) { await CloseTrade(trade, failure); return; }
        foreach (var (player, gave, got) in new[] { (trade.A, gotB, gotA), (trade.B, gotA, gotB) })
            if (clients.TryGetValue(player, out var client)) await Send(client, new { type = "trade_done", trade = trade.Id, gave, got });
        logger.LogInformation("Trade {Trade} done: vault {A} and {B} swapped", trade.Id, fromA, fromB);
    }

    private async Task CloseTrade(Trade trade, string reason)
    {
        lock (trade) { if (trade.Done) return; trade.Done = true; }
        trades.TryRemove(trade.Id, out _);
        foreach (var player in new[] { trade.A, trade.B })
            if (clients.TryGetValue(player, out var client)) await Send(client, new { type = "trade_closed", trade = trade.Id, reason });
    }

    // Leaving the island cancels the player's trade.
    private void LeaveTrade(Client client)
    {
        if (TradeOf(client.Id) is { } trade) _ = CloseTrade(trade, $"{client.Name} left.");
    }
}
