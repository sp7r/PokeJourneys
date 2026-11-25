using System.Text.Json;
using System.Text.RegularExpressions;

namespace Journeys.Server;

/// One journey on a bot's trainer card.
sealed record BotJourney(string Id, int Badges, int Pokedex, int Hours, bool Champion);

/// What the admin console can change about one bot: its name, personality, look, follower, trainer card and whether
/// it talks in global chat. A bot without saved changes uses the defaults its slot number gives it.
sealed record BotSetup(string Name, string Personality, string Gender, int Species, bool Shiny, bool Chat, BotJourney[] Journeys);

/// The bot editor (admin console, Bots page). Saved in the settings table: "bots" { enabled, count } (so the on/off
/// switch survives a restart, ahead of --bots), "bot:N" (one bot's BotSetup) and "bot-chat" { replies, global }.
///
/// PUT /api/admin/bots/{slot} with a BotSetup saves one bot and restarts it if it's running;
/// DELETE /api/admin/bots/{slot} puts it back to its defaults; PUT /api/admin/bots/chat { replies, global } sets
/// what bots say (replies to players, and lines for global chat).
sealed partial class BotPlayers
{
    private static readonly Dictionary<Kind, string> KindNames = new()
    {
        [Kind.Shopper] = "shopper", [Kind.Traveller] = "traveller", [Kind.Idler] = "idler", [Kind.Wanderer] = "wanderer",
        [Kind.SpawnIdler] = "spawn-idler", [Kind.DockIdler] = "dock-idler", [Kind.ShowOff] = "show-off"
    };
    private static readonly string[] DefaultReplies = ["Hi!", "Nice follower!", "Want to trade?", "Good luck on your journey!", "Thanks!", "See you around!"];
    private static readonly string[] DefaultGlobal = ["Hi everyone!", "Hope your journey is going well!", "Good luck with your next badge!", "Nice day for exploring the island.", "See you around the shops!", "Anyone found a new favourite follower?"];
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    internal string[] Replies { get; private set; } = DefaultReplies;
    internal string[] GlobalLines { get; private set; } = DefaultGlobal;

    /// The look seed stays with the slot, so renaming a bot doesn't change how it looks.
    internal static int Seed(int slot) => $"Bot {slot:00}".Aggregate(17, (hash, c) => hash * 31 + c);

    private static BotSetup Default(int slot)
    {
        var fixedRandom = new Random(Seed(slot));
        var played = Journeys.OrderBy(_ => fixedRandom.Next()).Take(fixedRandom.Next(1, 4)).Select(j => new BotJourney(
            j.Id, fixedRandom.Next(0, j.Badges + 1), fixedRandom.Next(5, 250), fixedRandom.Next(1, 150), fixedRandom.Next(4) == 0)).ToArray();
        var gender = fixedRandom.Next(2) == 0 ? "m" : "f";
        var species = fixedRandom.Next(1, 808);
        var shiny = fixedRandom.Next(64) == 0;
        return new BotSetup($"Bot {slot:00}", KindNames[Turns[(slot - 1) % Turns.Length]], gender, species, shiny, true, played);
    }

    private BotSetup? Saved(int slot)
    {
        using var db = new Db(connectionString);
        var value = db.Row("SELECT value FROM settings WHERE key = $key", ("key", $"bot:{slot}"))?["value"] as string;
        return value is null ? null : JsonSerializer.Deserialize<BotSetup>(value, Json);
    }

    internal BotSetup Setup(int slot) => Saved(slot) ?? Default(slot);

    private static Kind KindOf(string personality) => KindNames.First(pair => pair.Value == personality).Key;

    private void Save(string key, object value)
    {
        using var db = new Db(connectionString);
        db.Execute("INSERT INTO settings (key, value) VALUES ($key, $value) ON CONFLICT(key) DO UPDATE SET value = $value",
            ("key", key), ("value", JsonSerializer.Serialize(value, Json)));
    }

    /// Server start: the console's last on/off choice, or --bots when there isn't one; and the saved chat lines.
    public void Resume(int startBots)
    {
        using (var db = new Db(connectionString))
        {
            if (db.Row("SELECT value FROM settings WHERE key = 'bot-chat'")?["value"] is string chat &&
                JsonSerializer.Deserialize<BotChat>(chat, Json) is { } lines)
                (Replies, GlobalLines) = (lines.Replies, lines.Global);
            if (db.Row("SELECT value FROM settings WHERE key = 'bots'")?["value"] is string saved &&
                JsonSerializer.Deserialize<BotSwitch>(saved, Json) is { } choice)
            {
                if (available) Set(choice.Enabled, choice.Count);
                return;
            }
        }
        if (startBots > 0) Set(true, startBots);
    }

    private sealed record BotSwitch(bool Enabled, int Count);
    private sealed record BotChat(string[] Replies, string[] Global);

    private object[] Setups()
    {
        int highest;
        using (var db = new Db(connectionString))
            highest = db.Rows("SELECT key FROM settings WHERE key LIKE 'bot:%'")
                .Select(row => int.TryParse(((string)row["key"]!)[4..], out var slot) ? slot : 0).DefaultIfEmpty(0).Max();
        var shown = Math.Clamp(Math.Max(Math.Max(wanted, highest), 1), 1, MaxBots);
        return Enumerable.Range(1, shown).Select(slot =>
        {
            var saved = Saved(slot);
            var running = slot <= bots.Count ? bots[slot - 1].PlayerId : 0;
            return (object)new { slot, custom = saved is not null, playerId = running, setup = saved ?? Default(slot) };
        }).ToArray();
    }

    private static readonly Regex Control = new(@"[\u0000-\u001f\u007f-\u009f]");

    private static string Line(JsonElement value, string field, int max)
    {
        var text = value.ValueKind == JsonValueKind.String ? value.GetString()!.Trim() : "";
        if (text.Length is 0 || text.Length > max || Control.IsMatch(text)) throw new ApiError($"{field}: use 1 to {max} characters without control characters.");
        return text;
    }

    private static bool Flag(JsonElement body, string field) =>
        body.TryGetProperty(field, out var value) && value.ValueKind is JsonValueKind.True or JsonValueKind.False
            ? value.GetBoolean() : throw new ApiError($"{field} must be true or false.");

    private static BotSetup Read(JsonElement body)
    {
        var name = Line(body.GetProperty("name"), "name", 20);
        var personality = body.TryGetProperty("personality", out var p) ? p.GetString() ?? "" : "";
        if (!KindNames.ContainsValue(personality)) throw new ApiError($"personality must be one of: {string.Join(", ", KindNames.Values)}.");
        var gender = body.TryGetProperty("gender", out var g) ? g.GetString() ?? "" : "";
        if (gender is not ("m" or "f")) throw new ApiError("gender must be m or f.");
        var species = (int)AdminApi.Integer(body, "species", 1, 898);
        if (!body.TryGetProperty("journeys", out var list) || list.ValueKind != JsonValueKind.Array || list.GetArrayLength() is 0 or > 5)
            throw new ApiError("journeys must list 1 to 5 journeys.");
        var journeys = list.EnumerateArray().Select(entry =>
        {
            var id = entry.TryGetProperty("id", out var i) ? i.GetString() ?? "" : "";
            var known = Journeys.FirstOrDefault(j => j.Id == id);
            if (known.Id is null) throw new ApiError($"Unknown journey: {id}.");
            return new BotJourney(id, (int)AdminApi.Integer(entry, "badges", 0, known.Badges), (int)AdminApi.Integer(entry, "pokedex", 0, 1025),
                (int)AdminApi.Integer(entry, "hours", 0, 9999), Flag(entry, "champion"));
        }).ToArray();
        if (journeys.Select(j => j.Id).Distinct().Count() != journeys.Length) throw new ApiError("Each journey can be on the card once.");
        return new BotSetup(name, personality, gender, species, Flag(body, "shiny"), Flag(body, "chat"), journeys);
    }

    private void Reset(int slot)
    {
        using var db = new Db(connectionString);
        db.Execute("DELETE FROM settings WHERE key = $key", ("key", $"bot:{slot}"));
    }

    /// Starts the bot in [slot] again with its new setup, if it's running.
    private void Restart(int slot)
    {
        lock (gate)
        {
            if (slot > bots.Count) return;
            bots[slot - 1].Stop();
            // A moment for the old one to sign out before the new one signs in as the same player.
            var bot = new Bot(slot, Setup(slot), http, this);
            bots[slot - 1] = bot;
            bot.Start(TimeSpan.FromSeconds(2));
            foreach (var other in bots) other.Others = bots;
        }
        Log("server", $"bot {slot} restarted with its new setup");
    }

    private static void MapSetups(RouteGroupBuilder api)
    {
        api.MapPut("/bots/{slot:int}", async (int slot, HttpRequest request, BotPlayers bots) =>
        {
            if (slot is < 1 or > MaxBots) throw new ApiError($"Bots are numbered 1 to {MaxBots}.");
            var setup = Read(await AdminApi.Body(request, "name", "personality", "gender", "species", "shiny", "chat", "journeys"));
            bots.Save($"bot:{slot}", setup);
            bots.Restart(slot);
            return Results.Ok(bots.State());
        });
        api.MapDelete("/bots/{slot:int}", (int slot, BotPlayers bots) =>
        {
            bots.Reset(slot);
            bots.Restart(slot);
            return Results.Ok(bots.State());
        });
        api.MapPut("/bots/chat", async (HttpRequest request, BotPlayers bots) =>
        {
            var body = await AdminApi.Body(request, "replies", "global");
            string[] Lines(string field) =>
                body.TryGetProperty(field, out var list) && list.ValueKind == JsonValueKind.Array && list.GetArrayLength() is >= 1 and <= 30
                    ? list.EnumerateArray().Select(line => Line(line, field, 200)).ToArray()
                    : throw new ApiError($"{field} must list 1 to 30 lines.");
            var chat = new BotChat(Lines("replies"), Lines("global"));
            bots.Save("bot-chat", chat);
            (bots.Replies, bots.GlobalLines) = (chat.Replies, chat.Global);
            return Results.Ok(bots.State());
        });
    }
}
