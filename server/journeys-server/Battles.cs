using System.Collections.Concurrent;
using System.Security.Cryptography;
using System.Text.Json;

namespace Journeys.Server;

/// <summary>
/// Battles between two players, after one accepts the other's battle request. Both phones run the same battle engine
/// (the Battle Dome's, tools/battle) from the same seed, so the server never simulates: it only hands each player the
/// other's choices in order. The requester is side 0 (p1), the one who accepted side 1 (p2). For now every battle is a
/// casual Random Singles battle, whose teams both phones generate from the seed.
///
/// The live connection sends both players battle_start { battle, format, seed, side, players }. The phones then use HTTP,
/// which keeps working while the battle screen is open: POST /api/battles/{id}/choice { turn, choice, check } adds a
/// choice (turn counts this player's choices from 1; check is a hash of the battle log so far, so a phone that
/// drifted out of step is noticed), GET /api/battles/{id}/events?after=n waits up to 25 seconds for events after n
/// (choices from either side, the end), POST /api/battles/{id}/result { winner, check } reports the end
/// (winner 0, 1, or null for a draw) and POST /api/battles/{id}/forfeit gives up. When both report the same result
/// it is kept in the battles table. A side with no choice for three minutes loses.
/// </summary>
sealed partial class Live
{
    private sealed class Battle(string id, long[] players, string[] names, int[] seed)
    {
        public string Id { get; } = id;
        public long[] Players { get; } = players;
        public string[] Names { get; } = names;
        public int[] Seed { get; } = seed;
        public readonly List<object> Events = [];
        public readonly int[] Turns = [0, 0];
        public readonly string?[] Results = [null, null];
        public readonly string?[] Checks = [null, null];
        public DateTime LastChoice = DateTime.UtcNow;
        public bool Ended;
        public TaskCompletionSource Changed = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public int Side(long player) => Array.IndexOf(Players, player);

        public void Add(object e)
        {
            lock (this)
            {
                Events.Add(e);
                var changed = Changed;
                Changed = new(TaskCreationOptions.RunContinuationsAsynchronously);
                changed.TrySetResult();
            }
        }
    }

    private const string BattleFormat = "random_singles";
    private static readonly TimeSpan ChoiceTimeout = TimeSpan.FromMinutes(3);
    private readonly ConcurrentDictionary<string, Battle> battles = new();

    private async Task StartBattle(Client from, Client to)
    {
        foreach (var old in battles.Values.Where(b => !b.Ended && (b.Players.Contains(from.Id) || b.Players.Contains(to.Id))))
            EndBattle(old, null, "A new battle started.");
        var seed = Enumerable.Range(0, 4).Select(_ => RandomNumberGenerator.GetInt32(0x10000)).ToArray();
        var battle = new Battle(Guid.NewGuid().ToString("N")[..12], [from.Id, to.Id], [from.Name, to.Name], seed);
        battles[battle.Id] = battle;
        for (var side = 0; side < 2; side++)
            await Send(side == 0 ? from : to, new
            {
                type = "battle_start", battle = battle.Id, format = BattleFormat, seed, side,
                players = new[] { new { id = from.Id, name = from.Name }, new { id = to.Id, name = to.Name } }
            });
        logger.LogInformation("Battle {Battle} started: {A} vs {B}", battle.Id, from.Name, to.Name);
    }

    private void EndBattle(Battle battle, int? winner, string reason)
    {
        lock (battle) { if (battle.Ended) return; battle.Ended = true; }
        battle.Add(new { type = "end", winner, reason });
        using var db = new Db(connectionString);
        db.Execute("INSERT INTO battles (at, playlist, player_a, player_b, winner, rated, summary) VALUES ($at, $playlist, $a, $b, $winner, 0, $summary)",
            ("at", Db.Now()), ("playlist", BattleFormat), ("a", battle.Players[0]), ("b", battle.Players[1]),
            ("winner", winner is null ? null : battle.Players[winner.Value]), ("summary", $"Casual battle between players: {reason}"));
        logger.LogInformation("Battle {Battle} ended: {Reason}", battle.Id, reason);
        _ = Task.Delay(TimeSpan.FromMinutes(10)).ContinueWith(_ => battles.TryRemove(battle.Id, out var _));
    }

    // A side that hasn't chosen for three minutes, while the other has, loses.
    private void CheckTimeout(Battle battle)
    {
        if (battle.Ended || DateTime.UtcNow - battle.LastChoice < ChoiceTimeout) return;
        int[] turns;
        lock (battle) turns = [.. battle.Turns];
        if (turns[0] == turns[1]) return;
        var slow = turns[0] < turns[1] ? 0 : 1;
        EndBattle(battle, 1 - slow, $"{battle.Names[slow]} ran out of time.");
    }

    public static void MapBattles(WebApplication app)
    {
        var api = app.MapGroup("/api/battles");
        Battle Find(Live live, string id, HttpContext context, out int side)
        {
            if (!live.battles.TryGetValue(id, out var battle)) throw new ApiError(404, "That battle has ended.");
            side = battle.Side(GameApi.PlayerId(context));
            if (side < 0) throw new ApiError(403, "That isn't your battle.");
            return battle;
        }
        static string Text(JsonElement body, string name, int max)
        {
            var value = body.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString()! : "";
            if (value.Length > max) throw new ApiError($"{name} is too long.");
            return value;
        }

        api.MapPost("/{id}/choice", async (string id, HttpContext context, Live live) =>
        {
            var battle = Find(live, id, context, out var side);
            using var document = await JsonDocument.ParseAsync(context.Request.Body);
            var body = document.RootElement;
            var turn = body.TryGetProperty("turn", out var t) && t.ValueKind == JsonValueKind.Number ? t.GetInt32() : 0;
            var choice = Text(body, "choice", 200);
            var check = Text(body, "check", 64);
            if (battle.Ended) throw new ApiError(409, "The battle has ended.");
            lock (battle)
            {
                if (turn == battle.Turns[side]) return Results.Ok(new { ok = true }); // a retry of the last choice
                if (turn != battle.Turns[side] + 1) throw new ApiError(409, "That choice is out of order.");
                battle.Turns[side] = turn;
                battle.LastChoice = DateTime.UtcNow;
            }
            battle.Add(new { type = "choice", side, turn, choice, check });
            return Results.Ok(new { ok = true });
        });

        api.MapGet("/{id}/events", async (string id, int after, HttpContext context, Live live) =>
        {
            var battle = Find(live, id, context, out _);
            var deadline = DateTime.UtcNow.AddSeconds(25);
            while (true)
            {
                Task changed;
                lock (battle)
                {
                    if (battle.Events.Count > after) return Results.Ok(new { events = battle.Events.Skip(Math.Max(0, after)).ToArray(), next = battle.Events.Count });
                    changed = battle.Changed.Task;
                }
                live.CheckTimeout(battle);
                var left = deadline - DateTime.UtcNow;
                if (left <= TimeSpan.Zero) return Results.Ok(new { events = Array.Empty<object>(), next = after });
                await Task.WhenAny(changed, Task.Delay(left < TimeSpan.FromSeconds(5) ? left : TimeSpan.FromSeconds(5), context.RequestAborted));
                if (context.RequestAborted.IsCancellationRequested) return Results.Empty;
            }
        });

        api.MapPost("/{id}/result", async (string id, HttpContext context, Live live) =>
        {
            var battle = Find(live, id, context, out var side);
            using var document = await JsonDocument.ParseAsync(context.Request.Body);
            var body = document.RootElement;
            var winner = body.TryGetProperty("winner", out var w) && w.ValueKind == JsonValueKind.Number ? w.GetInt32() : (int?)null;
            if (winner is not (null or 0 or 1)) throw new ApiError("winner is 0, 1 or null.");
            var check = Text(body, "check", 64);
            bool agreed, disagreed;
            lock (battle)
            {
                battle.Results[side] = winner?.ToString() ?? "draw";
                battle.Checks[side] = check;
                agreed = battle.Results[0] is not null && battle.Results[0] == battle.Results[1] && battle.Checks[0] == battle.Checks[1];
                disagreed = battle.Results[0] is not null && battle.Results[1] is not null && !agreed;
            }
            if (agreed) live.EndBattle(battle, winner, winner is null ? "a draw" : $"{battle.Names[winner.Value]} won");
            else if (disagreed) live.EndBattle(battle, null, "the two phones disagreed, so no result was kept");
            return Results.Ok(new { ok = true });
        });

        api.MapPost("/{id}/forfeit", (string id, HttpContext context, Live live) =>
        {
            var battle = Find(live, id, context, out var side);
            live.EndBattle(battle, 1 - side, $"{battle.Names[side]} forfeited");
            return Results.Ok(new { ok = true });
        });
    }
}
