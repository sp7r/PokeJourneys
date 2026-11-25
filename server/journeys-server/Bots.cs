using System.Collections.Concurrent;
using System.Diagnostics;
using System.Net.Http.Json;
using System.Text.Json.Nodes;

namespace Journeys.Server;

/// <summary>
/// Bot players for a test server (only with --dev-signin): fake trainers named "Bot 01", "Bot 02"... sign in through
/// the development sign-in and use the game API and the live connection like the app and hub would, so the server
/// can be watched under load from the admin console without real players. Each bot has a personality: shoppers walk
/// from shop to shop and buy at the counter, travellers talk to a captain at the pier and go on journeys or raids,
/// idlers stand AFK for minutes (around the spawn, on the docks or anywhere), show-offs line up on the boardwalk
/// with their follower behind them, wanderers walk around. Each has its own look seed, follower and trainer card.
/// The admin console turns them on and off, sets how many, and edits each one (BotSetup.cs).
/// </summary>
sealed partial class BotPlayers(string baseUrl, bool available, BotWorld world, string connectionString, ILogger<BotPlayers> logger)
{
    internal BotWorld World => world;
    public const int MaxBots = 100;
    private readonly HttpClient http = new() { BaseAddress = new Uri(baseUrl.TrimEnd('/') + "/"), Timeout = TimeSpan.FromSeconds(30),
        // Bots are never an old app (Releases.RequireCurrent).
        DefaultRequestHeaders = { { "X-App-Version", int.MaxValue.ToString() } } };
    private readonly List<Bot> bots = [];
    private readonly object gate = new();
    private readonly ConcurrentQueue<string> log = new();
    internal readonly ConcurrentDictionary<string, Calls> Stats = new();
    internal readonly ConcurrentDictionary<string, bool> Missing = new();
    // Tiles a bot is standing on for a while (AFK or in the boardwalk line), so two never pick the same one.
    internal readonly ConcurrentDictionary<(int X, int Y), string> Spots = new();
    private int wanted;
    private bool enabled;

    public bool Available => available;

    /// GET and PUT /api/admin/bots: the bot controls in the admin console. PUT takes { enabled, count }.
    public static void MapBots(WebApplication app)
    {
        var api = app.MapGroup("/api/admin");
        api.MapGet("/bots", (BotPlayers bots) => Results.Ok(bots.State()));
        api.MapPut("/bots", async (HttpRequest request, BotPlayers bots) =>
        {
            var body = await AdminApi.Body(request, "enabled", "count");
            if (!body.TryGetProperty("enabled", out var on) || on.ValueKind is not (System.Text.Json.JsonValueKind.True or System.Text.Json.JsonValueKind.False))
                throw new ApiError("enabled must be true or false.");
            bots.Set(on.GetBoolean(), (int)AdminApi.Integer(body, "count", 0, MaxBots));
            return Results.Ok(bots.State());
        });
        MapSetups(api);
    }

    public object State()
    {
        lock (gate) return new
        {
            available, enabled, count = wanted, running = bots.Count(bot => bot.PlayerId > 0), max = MaxBots,
            stats = Stats.OrderBy(pair => pair.Key).Select(pair => pair.Value.Summary(pair.Key)).ToArray(),
            missing = Missing.Keys.Order().ToArray(),
            log = log.Reverse().ToArray(),
            bots = Setups(), personalities = KindNames.Values.ToArray(),
            journeys = Journeys.Select(j => new { id = j.Id, name = j.Name, badges = j.Badges }).ToArray(),
            chat = new { replies = Replies, global = GlobalLines }
        };
    }

    public void Set(bool on, int count)
    {
        if (!available) throw new ApiError("Bot players need a server started with --dev-signin or --bot-signin.");
        if (count is < 0 or > MaxBots) throw new ApiError($"Bots must be between 0 and {MaxBots}.");
        lock (gate)
        {
            if (on != enabled || count != wanted) Log("server", $"bots {(on ? "on" : "off")}, {count} wanted");
            enabled = on;
            wanted = count;
            Save("bots", new BotSwitch(on, count));
            var target = on ? count : 0;
            while (bots.Count > target)
            {
                var bot = bots[^1];
                bots.RemoveAt(bots.Count - 1);
                bot.Stop();
            }
            while (bots.Count < target)
            {
                var bot = new Bot(bots.Count + 1, Setup(bots.Count + 1), http, this);
                bots.Add(bot);
                bot.Start(TimeSpan.Zero);
            }
            foreach (var bot in bots) bot.Others = bots;
        }
    }

    internal void Log(string who, string text)
    {
        log.Enqueue($"{DateTime.Now:HH:mm:ss} {who}  {text}");
        while (log.Count > 200) log.TryDequeue(out _);
        if (who == "server" || text.StartsWith("signed")) logger.LogInformation("{Bot}: {Text}", who, text);
    }

    internal sealed class Calls
    {
        private readonly ConcurrentQueue<double> times = new();
        private long total, ok;
        public void Add(bool success, double ms)
        {
            Interlocked.Increment(ref total);
            if (success) Interlocked.Increment(ref ok);
            times.Enqueue(ms);
            while (times.Count > 500) times.TryDequeue(out _);
        }
        public object Summary(string endpoint)
        {
            var sorted = times.Order().ToArray();
            return new
            {
                endpoint, calls = total, ok, refused = total - ok,
                avgMs = sorted.Length == 0 ? 0 : Math.Round(sorted.Average(), 1),
                p95Ms = sorted.Length == 0 ? 0 : Math.Round(sorted[(int)(sorted.Length * 0.95)], 1)
            };
        }
    }

    private enum Kind { Shopper, Traveller, Idler, Wanderer, SpawnIdler, DockIdler, ShowOff }
        // Bot 01, 02... take these in turn: plenty stand around the spawn, as players do.
        private static readonly Kind[] Turns = [Kind.SpawnIdler, Kind.Shopper, Kind.ShowOff, Kind.SpawnIdler, Kind.Traveller, Kind.DockIdler,
            Kind.SpawnIdler, Kind.Shopper, Kind.ShowOff, Kind.Wanderer];

    private static readonly (string Id, string Name, int Badges)[] Journeys =
        [("firered", "FireRed", 8), ("emerald", "Emerald", 8), ("platinum", "Platinum", 8), ("heartgold", "HeartGold", 16), ("black2", "Black 2", 8)];

    private sealed class Bot(int slot, BotSetup setup, HttpClient http, BotPlayers owner)
    {
        private readonly string name = setup.Name;
        public long PlayerId { get; private set; }
        public IReadOnlyList<Bot> Others { get; set; } = [];
        private readonly CancellationTokenSource stop = new();
        private readonly Random random = new();
        private readonly Dictionary<string, long> bag = [];
        private JsonArray shop = [];
        private string token = "";
        private long money;
        private BotWorld World => owner.World;
        private Kind kind;
        private string room = "island";
        private (int X, int Y) at;
        private string facing = "down";
        private string status = "";
        private object? profile;
        private System.Net.WebSockets.ClientWebSocket? live;
        private readonly ConcurrentDictionary<long, (string Name, int X, int Y)> nearby = new(); // everyone in this room
        private void See(JsonNode player) => nearby[(long)player["id"]!] = ((string)player["name"]!, (int)player["x"]!, (int)player["y"]!);

        public void Start(TimeSpan delay) => _ = Task.Run(async () =>
        {
            try { await Task.Delay(delay, stop.Token); } catch (OperationCanceledException) { return; }
            await Run();
        });
        public void Stop() => stop.Cancel();

        private async Task Run()
        {
            Task chatting = Task.CompletedTask;
            try
            {
                await SignIn();
                chatting = setup.Chat ? Chatter() : Task.CompletedTask;
                // Everyone walks around a little first, so a crowd forms before people head off.
                await Wander();
                while (!stop.IsCancellationRequested)
                {
                    try { await Live(); }
                    catch (Exception error) when (error is not OperationCanceledException) { owner.Log(name, $"error: {error.Message}"); }
                    await Task.Delay(random.Next(500, 2000), stop.Token);
                }
            }
            catch (OperationCanceledException) { }
            catch (Exception error) { owner.Log(name, $"stopped: {error.Message}"); }
            stop.Cancel();
            await chatting;
            if (live is not null)
            {
                try { await live.CloseOutputAsync(System.Net.WebSockets.WebSocketCloseStatus.NormalClosure, "Bot stopped.", CancellationToken.None); } catch { }
                live.Dispose();
            }
            if (token.Length > 0)
            {
                try { await Call("POST", "api/auth/signout", new { }, "auth/signout", CancellationToken.None); } catch { }
                owner.Log(name, "signed out");
            }
            PlayerId = 0;
        }

        private async Task SignIn()
        {
            var answer = await Call("POST", "api/auth/dev", new { name = $"Bot {slot:00}", display = name }, "auth/dev") ?? throw new Exception("sign-in was refused");
            token = (string)answer["sessionToken"]!;
            PlayerId = (long)answer["player"]!["id"]!;
            shop = (await Call("GET", "api/shop", null, "shop") as JsonArray) ?? [];
            var wallet = await Call("GET", "api/wallet", null, "wallet");
            if (wallet?["imported"]?.GetValue<bool>() == false)
                wallet = await Call("POST", "api/wallet/report", new { source = "import", money = 3000 + random.Next(5000), items = new { }, requestId = Id() }, "wallet/report import") ?? wallet;
            Read(wallet);
            MakeProfile();
            owner.Log(name, $"signed in as player {PlayerId}, a {kind.ToString().ToLowerInvariant()}");
            at = World.Spawn;
            await Send(new { type = "move", room, x = at.X, y = at.Y, facing });
        }

        // Each bot is the same trainer every time: its setup comes from the admin console or from its slot number.
        private void MakeProfile()
        {
            kind = KindOf(setup.Personality);
            var played = setup.Journeys.Select(j => new
            {
                id = j.Id, name = Journeys.First(known => known.Id == j.Id).Name, badges = j.Badges, pokedex = j.Pokedex,
                hours = j.Hours, champion = j.Champion
            }).ToArray();
            profile = new
            {
                type = "profile",
                // No parts chosen: the hub draws a random look from the seed.
                look = new { gender = setup.Gender, seed = Seed(slot) },
                follower = new { species = setup.Species, shiny = setup.Shiny },
                card = new
                {
                    journeys = played, current = played[0].id,
                    story = played[0].champion ? $"Became {played[0].name} Champion" : $"{played[0].badges} badges in {played[0].name}"
                }
            };
        }

        private async Task Live()
        {
            if (random.Next(100) < 15) await Social();
            switch (kind)
            {
                case Kind.Shopper:
                    if (random.Next(100) < 75) await Shop(); else await Wander();
                    break;
                case Kind.Traveller:
                    if (random.Next(100) < 40) await Sail(); else if (random.Next(2) == 0) await Shop(); else await Wander();
                    break;
                case Kind.Idler:
                    if (random.Next(100) < 60) await Afk(); else await Wander();
                    break;
                case Kind.SpawnIdler:
                    if (random.Next(100) < 80) await Hangout(World.SpawnArea); else if (random.Next(2) == 0) await Shop(); else await Wander();
                    break;
                case Kind.DockIdler:
                    if (random.Next(100) < 75) await Hangout(World.Docks); else await Sail();
                    break;
                case Kind.ShowOff:
                    if (random.Next(100) < 75) await LineUp(); else await Shop();
                    break;
                default:
                    await Wander();
                    break;
            }
        }

        // Walks somewhere on the island and looks around for a bit.
        private async Task Wander()
        {
            var goal = World.People.Count > 0 && random.Next(3) == 0 ? World.People[random.Next(World.People.Count)].Stand : World.RandomTile(random);
            await Walk(goal);
            await Pause(2, 8);
        }

        // Walks to a shop, goes in, shops at the counter, comes out.
        private async Task Shop()
        {
            var places = World.Places.Where(p => p.Room is not null).ToList();
            if (places.Count == 0) { await Buy(); return; }
            var place = places.Where(p => p.Role is "shop" or "vault").ToList() is { Count: > 0 } shops && random.Next(100) < 70
                ? shops[random.Next(shops.Count)] : places[random.Next(places.Count)];
            if (!await Walk(place.Door)) return;
            var door = place.Door;
            await Move(place.Room!, place.Stand, place.StandFacing);
            await Status(place.Role == "shop" ? "shopping" : $"visiting:{place.Building}");
            if (place.Role == "shop")
                for (var i = random.Next(1, 4); i > 0; i--)
                {
                    await Pause(3, 7);
                    if (random.Next(3) == 0) await Sell(); else await Buy();
                }
            else
            {
                if (place.Role == "vault") await Call("GET", "api/me", null, "me");
                await Pause(6, 20);
            }
            await Status("");
            await Move("island", door, "down");
            await Walk((door.X, door.Y + 1));
        }

        // Talks to a captain at the pier, sails off on a journey (or a raid), and comes back later.
        private async Task Sail()
        {
            var captains = World.People.Where(p => p.Role is "journeys" or "raids").ToList();
            var captain = captains.Count == 0 ? null : captains.FirstOrDefault(c => c.Role == "journeys" && random.Next(4) != 0) ?? captains[random.Next(captains.Count)];
            if (captain is not null)
            {
                if (!await Walk(captain.Stand)) return;
                await Move(room, at, captain.Facing);
                await Status($"talking:{captain.Name}");
                await Pause(4, 9);
            }
            var journey = Journeys[random.Next(Journeys.Length)];
            var raid = captain?.Role == "raids";
            await Status(raid ? "away:Raid" : $"away:{journey.Name}");
            var pier = at;
            await Move(raid ? "raid" : $"journey-{journey.Id}", (0, 0), "down");
            owner.Log(name, raid ? "sailed out to a raid" : $"set off on a journey to {journey.Name}");
            var owned = bag.Where(pair => pair.Value > 0).ToList();
            if (owned.Count > 0 && random.Next(2) == 0) await Take(owned[random.Next(owned.Count)].Key, journey.Id);
            for (var i = random.Next(2, 5); i > 0; i--)
            {
                await Pause(15, 40);
                await Report(journey.Id);
            }
            await Move("island", pier, "down");
            await Status("");
            owner.Log(name, $"came back from {(raid ? "a raid" : journey.Name)}, money {money}");
        }

        // Stands still for one to five minutes.
        private async Task Afk()
        {
            await Walk(World.RandomTile(random));
            await Status("afk");
            var until = DateTime.UtcNow.AddSeconds(random.Next(60, 300));
            while (DateTime.UtcNow < until)
            {
                await Pause(20, 60);
                if (random.Next(4) == 0) await Move(room, at, new[] { "up", "down", "left", "right" }[random.Next(4)]);
            }
            await Status("");
        }

        // Stands AFK on a free tile of an area (the spawn, the docks) for two to eight minutes.
        private async Task Hangout(IReadOnlyList<(int X, int Y)> area)
        {
            // Apart enough that name tags don't overlap: three tiles across or two rows between bots.
            var free = area.Where(tile => !owner.Spots.Keys.Any(spot => Math.Abs(spot.X - tile.X) < 3 && Math.Abs(spot.Y - tile.Y) < 2)).ToList();
            if (free.Count == 0) { await Afk(); return; }
            var spot = free[random.Next(free.Count)];
            if (!owner.Spots.TryAdd(spot, name)) return;
            try
            {
                if (!await Walk(spot)) return;
                await Move(room, at, new[] { "down", "down", "left", "right", "up" }[random.Next(5)]);
                await Status("afk");
                var until = DateTime.UtcNow.AddSeconds(random.Next(120, 480));
                while (DateTime.UtcNow < until)
                {
                    await Pause(25, 70);
                    if (random.Next(5) == 0) await Move(room, at, new[] { "up", "down", "left", "right" }[random.Next(4)]);
                }
                await Status("");
            }
            finally { owner.Spots.TryRemove(spot, out _); }
        }

        // Joins the line on the boardwalk: walks onto the tile behind a free place, steps forward and faces out, so
        // its follower stands right behind it. Stays three to ten minutes without turning, to show off together.
        private async Task LineUp()
        {
            var free = World.Lineup.Where(place => !owner.Spots.ContainsKey(place.Front)).ToList();
            if (free.Count == 0) { await Hangout(World.SpawnArea); return; }
            var place = free[random.Next(free.Count)];
            if (!owner.Spots.TryAdd(place.Front, name)) return;
            try
            {
                if (!await Walk(place.Behind) || !await Walk(place.Front)) return;
                await Move(room, at, place.Facing);
                await Status("afk");
                await Pause(180, 600);
                await Status("");
            }
            finally { owner.Spots.TryRemove(place.Front, out _); }
        }

        private async Task Social()
        {
            switch (random.Next(4))
            {
                case 0: await Reach(new[] { "friend", "message" }[random.Next(2)]); break;
                case 1: await Reach("message"); break;
                case 2: await Call("GET", "api/me", null, "me"); break;
                default: await Call("GET", "api/events", null, "events"); break;
            }
        }

        /// Walks a real path to a tile, one step at a time (sometimes running). False when it can't get there.
        private async Task<bool> Walk((int X, int Y) goal)
        {
            if (room != "island") return false;
            var path = World.Path(at, goal);
            if (path.Count == 0) return at == goal;
            var stepMs = random.Next(4) == 0 ? 140 : 270;
            foreach (var (tile, way) in path)
            {
                await Move(room, tile, way);
                await Task.Delay(stepMs, stop.Token);
            }
            return true;
        }

        private Task Pause(int minSeconds, int maxSeconds) => Task.Delay(TimeSpan.FromSeconds(random.Next(minSeconds, maxSeconds + 1)), stop.Token);

        private Task Move(string where, (int X, int Y) tile, string way)
        {
            (room, at, facing) = (where, tile, way);
            return Send(new { type = "move", room, x = at.X, y = at.Y, facing });
        }

        private Task Status(string text)
        {
            status = text;
            return Send(new { type = "status", status });
        }

        // The live connection, as the hub will use it: the same session token, then JSON messages.
        private async Task Send(object message)
        {
            // Answers go out while the bot walks: one send at a time on the socket.
            await sending.WaitAsync(stop.Token);
            try
            {
                if (live?.State != System.Net.WebSockets.WebSocketState.Open && !await Connect()) return;
                var clock = Stopwatch.StartNew();
                await live!.SendAsync(System.Text.Json.JsonSerializer.SerializeToUtf8Bytes(message), System.Net.WebSockets.WebSocketMessageType.Text, true, stop.Token);
                owner.Stats.GetOrAdd("live send", _ => new Calls()).Add(true, clock.Elapsed.TotalMilliseconds);
            }
            finally { sending.Release(); }
        }
        private readonly SemaphoreSlim sending = new(1, 1);

        private async Task<bool> Connect()
        {
            live?.Dispose();
            live = new System.Net.WebSockets.ClientWebSocket();
            live.Options.SetRequestHeader("Authorization", $"Bearer {token}");
            var url = new Uri(http.BaseAddress!, "api/live").ToString().Replace("http://", "ws://").Replace("https://", "wss://");
            var clock = Stopwatch.StartNew();
            try
            {
                await live.ConnectAsync(new Uri(url), stop.Token);
                owner.Stats.GetOrAdd("live connect", _ => new Calls()).Add(true, clock.Elapsed.TotalMilliseconds);
                _ = Task.Run(() => Listen(live));
                // A new connection starts empty: say who we are, where, and what we're doing.
                var bytes = new[] { profile!, new { type = "move", room, x = at.X, y = at.Y, facing }, new { type = "status", status } }
                    .Select(m => System.Text.Json.JsonSerializer.SerializeToUtf8Bytes(m));
                foreach (var message in bytes) await live.SendAsync(message, System.Net.WebSockets.WebSocketMessageType.Text, true, stop.Token);
                return true;
            }
            catch (Exception error) when (error is not OperationCanceledException)
            {
                owner.Stats.GetOrAdd("live connect", _ => new Calls()).Add(false, clock.Elapsed.TotalMilliseconds);
                owner.Log(name, $"live connection failed: {error.Message}");
                return false;
            }
        }

        private async Task Listen(System.Net.WebSockets.ClientWebSocket socket)
        {
            var buffer = new byte[64 * 1024];
            try
            {
                while (socket.State == System.Net.WebSockets.WebSocketState.Open)
                {
                    var length = 0;
                    System.Net.WebSockets.ValueWebSocketReceiveResult result;
                    do
                    {
                        result = await socket.ReceiveAsync(buffer.AsMemory(length), stop.Token);
                        length += result.Count;
                    } while (!result.EndOfMessage && length < buffer.Length);
                    if (result.MessageType == System.Net.WebSockets.WebSocketMessageType.Close)
                    {
                        owner.Log(name, $"live connection closed: {socket.CloseStatusDescription}");
                        break;
                    }
                    var message = JsonNode.Parse(buffer.AsSpan(0, length));
                    var type = (string?)message?["type"];
                    owner.Stats.GetOrAdd($"live received: {type}", _ => new Calls()).Add(type != "error", 0);
                    switch (type)
                    {
                        case "room":
                            nearby.Clear();
                            foreach (var player in message!["players"]!.AsArray()) See(player!);
                            break;
                        case "joined": See(message!["player"]!); break;
                        case "moved":
                            var mover = message!["player"]!;
                            if (nearby.TryGetValue((long)mover["id"]!, out var known)) nearby[(long)mover["id"]!] = (known.Name, (int)mover["x"]!, (int)mover["y"]!);
                            break;
                        case "left": nearby.TryRemove((long)message!["id"]!, out _); break;
                        case "request": _ = Task.Run(() => Answer(message!)); break;
                        case "chat":
                            if ((string?)message!["channel"] == "direct" && (long?)message["to"]?["id"] == PlayerId &&
                                (long?)message["from"]?["id"] != PlayerId && Random.Shared.Next(2) == 0)
                                _ = Task.Run(() => ReplyChat(message));
                            break;
                        case "answer":
                            owner.Log(name, $"{message!["from"]!["name"]} {((bool)message["accept"]! ? "accepted" : "declined")} the {message["kind"]} request");
                            break;
                        case "error": owner.Log(name, $"live: {message!["error"]}"); break;
                    }
                }
            }
            catch (Exception error) when (error is OperationCanceledException or System.Net.WebSockets.WebSocketException or ObjectDisposedException) { }
        }

        private async Task Buy()
        {
            var choices = shop.Where(row => ((string)row!["item"]!).StartsWith("mart:") && (long)row["price"]! is > 0 and var price && price <= money).ToList();
            if (choices.Count == 0) return;
            var item = (string)choices[random.Next(choices.Count)]!["item"]!;
            var price = (long)choices.First(row => (string)row!["item"]! == item)!["price"]!;
            var count = (int)Math.Min(random.Next(1, 4), money / price);
            var answer = await Call("POST", "api/shop/buy", new { item, count, requestId = Id() }, "shop/buy");
            if (answer is null) return;
            Read(answer["wallet"]);
            owner.Log(name, $"bought {item}, money {money}");
        }

        private async Task Sell()
        {
            var owned = bag.Where(pair => pair.Key.StartsWith("mart:") && pair.Value > 0).ToList();
            if (owned.Count == 0) return;
            var (item, have) = owned[random.Next(owned.Count)];
            var answer = await Call("POST", "api/shop/sell", new { item, count = random.Next(1, (int)Math.Min(have, 3) + 1), requestId = Id() }, "shop/sell");
            if (answer is not null) Read(answer["wallet"]);
        }

        // A journey reporting money earned (prize money) or spent (marts) in a game.
        private async Task Report(string source) =>
            Read(await Call("POST", "api/wallet/report", new { source, money = random.Next(-300, 1200), items = new { }, requestId = Id() }, "wallet/report journey"));

        // Packs an item from the shared bag for a journey.
        private async Task Take(string item, string journey)
        {
            if (await Call("POST", "api/bag/take", new { item, count = 1, journey, requestId = Id() }, "bag/take") is not null) bag[item]--;
        }

        private async Task Chatter()
        {
            try
            {
                await Task.Delay(TimeSpan.FromSeconds(Random.Shared.Next(30, 181)), stop.Token);
                while (!stop.IsCancellationRequested)
                {
                    try
                    {
                        await Send(new { type = "chat", channel = "global", text = owner.GlobalLines[Random.Shared.Next(owner.GlobalLines.Length)] });
                        owner.Log(name, "said hello in global chat");
                    }
                    catch (Exception error) when (error is not OperationCanceledException) { owner.Log(name, $"chat: {error.Message}"); }
                    await Task.Delay(TimeSpan.FromSeconds(Random.Shared.Next(180, 361)), stop.Token);
                }
            }
            catch (OperationCanceledException) { }
        }

        private async Task ReplyChat(JsonNode message)
        {
            try
            {
                await Task.Delay(TimeSpan.FromSeconds(Random.Shared.Next(2, 7)), stop.Token);
                await Send(new { type = "chat", to = (long)message["from"]!["id"]!, text = owner.Replies[Random.Shared.Next(owner.Replies.Length)] });
            }
            catch (Exception error) when (error is OperationCanceledException or System.Net.WebSockets.WebSocketException or ObjectDisposedException) { }
        }

        // Someone else asked: friends are mostly accepted, trades and battles sometimes; a message sometimes gets a reply.
        private async Task Answer(JsonNode request)
        {
            try
            {
                var kind = (string)request["kind"]!;
                var from = request["from"]!;
                await Task.Delay(TimeSpan.FromSeconds(random.Next(2, 7)), stop.Token);
                if (kind == "message")
                {
                    owner.Log(name, $"{from["name"]} said \"{request["text"]}\"");
                    if (random.Next(2) == 0)
                        await Send(new { type = "request", to = (long)from["id"]!, kind = "message", text = owner.Replies[random.Next(owner.Replies.Length)] });
                    return;
                }
                // Bots have nothing in a Vault to trade and can't play a battle yet, so they say no to both.
                var accept = kind is not ("trade" or "battle") && random.Next(100) < (kind == "friend" ? 70 : 40);
                await Send(new { type = "answer", id = (string)request["id"]!, accept });
                owner.Log(name, $"{(accept ? "accepted" : "declined")} {from["name"]}'s {kind} request");
            }
            catch (Exception error) when (error is OperationCanceledException or System.Net.WebSockets.WebSocketException or ObjectDisposedException) { }
        }

        // Asks someone nearby to be friends, trade or battle, or says hello. Mostly other bots; now and then a real
        // player, so the hub's incoming requests can be tried out.
        private async Task Reach(string kind)
        {
            // Only someone close enough to see: within 12 tiles across and 8 up or down, as on a screen.
            var close = nearby.Where(pair => Math.Abs(pair.Value.X - at.X) <= 12 && Math.Abs(pair.Value.Y - at.Y) <= 8)
                .Select(pair => (pair.Key, pair.Value.Name)).ToArray();
            if (close.Length == 0) return;
            var people = close.Where(pair => !Others.Any(bot => bot.PlayerId == pair.Key)).ToArray();
            var (to, toName) = people.Length > 0 && random.Next(3) == 0 ? people[random.Next(people.Length)] : close[random.Next(close.Length)];
            await Send(new { type = "request", to, kind, text = kind == "message" ? owner.Replies[random.Next(owner.Replies.Length)] : null });
            owner.Log(name, kind == "message" ? $"said hi to {toName}" : $"sent {toName} a {kind} request");
        }

        private void Read(JsonNode? wallet)
        {
            if (wallet is null) return;
            money = (long)wallet["money"]!;
            bag.Clear();
            if (wallet["items"] is JsonObject items)
                foreach (var (key, value) in items) bag[key] = (long)value!;
        }

        private static string Id() => Guid.NewGuid().ToString("N");

        /// One call; the answer, or null after a refusal (counted and logged). Missing endpoints are tried once.
        private async Task<JsonNode?> Call(string method, string path, object? body, string label, CancellationToken? cancel = null)
        {
            if (owner.Missing.ContainsKey(label)) return null;
            using var request = new HttpRequestMessage(new HttpMethod(method), path);
            if (body is not null) request.Content = JsonContent.Create(body);
            if (token.Length > 0) request.Headers.Authorization = new("Bearer", token);
            var clock = Stopwatch.StartNew();
            using var response = await http.SendAsync(request, cancel ?? stop.Token);
            var text = await response.Content.ReadAsStringAsync();
            clock.Stop();
            var node = text.Length > 0 ? JsonNode.Parse(text) : null;
            if ((int)response.StatusCode == 404 && node?["error"]?.ToString() == "Endpoint not found.")
            {
                if (owner.Missing.TryAdd(label, true)) owner.Log(name, $"{label}: not on this server yet");
                return null;
            }
            owner.Stats.GetOrAdd(label, _ => new Calls()).Add(response.IsSuccessStatusCode, clock.Elapsed.TotalMilliseconds);
            if (response.IsSuccessStatusCode) return node;
            owner.Log(name, $"{label}: {(int)response.StatusCode} {node?["error"] ?? text}");
            // Banned or signed out by the server: this bot stops (turn bots off and on to start it again).
            if ((int)response.StatusCode is 401 or 403 && token.Length > 0 && !stop.IsCancellationRequested)
            {
                token = "";
                owner.Log(name, "stopped: the server ended this bot's session");
                stop.Cancel();
            }
            return null;
        }
    }
}
