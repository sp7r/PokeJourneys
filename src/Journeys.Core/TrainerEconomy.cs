using System.Diagnostics;
using System.Security.Cryptography;
using PKHeX.Core;

namespace Journeys.Core;

public sealed record ShopItem(string Id, string Label, int Price, int Owned, int Limit);
public sealed record ShopView(int Money, bool Ready, List<ShopItem> Stock, Dictionary<string, int> Bag);
public sealed record EconomyWallet(bool Ready, int Money, Dictionary<string, int> Items);
public sealed record EconomyWrite(string Journey, string Digest, JourneyFunds Funds,
    Dictionary<int, int>? PendingMachines = null, Dictionary<int, int>? Machines = null);

public sealed class EconomyData
{
    public JourneyFunds? Funds { get; set; }
    public Dictionary<string, JourneyFunds> LastRead { get; set; } = [];
    public Dictionary<int, int> Machines { get; set; } = [];
    public HashSet<string> Costumes { get; set; } = [];
    public Dictionary<string, Dictionary<int, int>> LastMachines { get; set; } = [];
    public bool ImportedMachines { get; set; }
    // Undelivered purchases from the version that sold journey-specific TMs.
    public Dictionary<string, Dictionary<int, int>> PendingMachines { get; set; } = [];
    public EconomyWrite? Writing { get; set; }
}

/// <summary>One wallet, bag, and wardrobe per trainer, with TMs shared by the move they teach.</summary>
public sealed class TrainerEconomy(JourneysPaths paths, string account)
{
    private const int MaxBalance = 9_999_999;
    private const int MachinePrice = 3_000;
    private static readonly (string Name, int Price)[] Mart =
    [
        ("Poké Ball", 200), ("Great Ball", 600), ("Ultra Ball", 1_200), ("Potion", 300),
        ("Super Potion", 700), ("Hyper Potion", 1_200), ("Max Potion", 2_500), ("Full Restore", 3_000),
        ("Antidote", 100), ("Paralyze Heal", 200), ("Awakening", 250), ("Burn Heal", 250),
        ("Ice Heal", 250), ("Full Heal", 600), ("Revive", 1_500),
        ("Repel", 350), ("Super Repel", 500), ("Max Repel", 700), ("Escape Rope", 550),
    ];
    private static readonly (string Id, string Label, int Price)[] Costumes =
    [
        ("adventurer", "Adventurer Set", 1_500),
        ("martial-arts", "Martial Arts Set", 1_500),
        ("champions-cape", "Champion's Cape", 2_500),
        ("golden-spikes", "Golden Spikes", 1_000),
    ];

    private readonly string file = Path.Combine(paths.Root, "accounts",
        account == "local" || account.Length is > 0 and <= 32 && account.All(char.IsAsciiDigit)
            ? account : throw new JourneysException("Invalid trainer account."), "economy.json");

    public static IEnumerable<(string Key, string Label, int Price, int Limit)> Catalog() =>
        Mart.Select(p => ($"mart:{JourneyBag.Key(p.Name)}", p.Name, p.Price, 999))
            .Concat(JourneyBag.Catalog().Select(move => ($"tm:{move}", JourneyBag.MoveName(move), MachinePrice, 999)))
            .Concat(Costumes.Select(p => ($"costume:{p.Id}", p.Label, p.Price, 1)));

    public EconomyWallet Export()
    {
        using var lease = Lock();
        var library = JourneyLibrary.Load(paths);
        var state = Load(library);
        Seed(state, library);
        if (state.Funds is not null) ImportMachines(state, library);
        var items = new Dictionary<string, int>();
        if (state.Funds is { } funds)
            foreach (var (key, count) in funds.Items.Where(p => p.Value > 0)) items[$"mart:{key}"] = count;
        foreach (var (move, count) in state.Machines.Where(p => p.Value > 0)) items[$"tm:{move}"] = count;
        foreach (var id in state.Costumes) items[$"costume:{id}"] = 1;
        return new EconomyWallet(state.Funds is not null, state.Funds?.Money ?? 0, items);
    }

    public void Import(EconomyWallet wallet)
    {
        using var lease = Lock();
        if (wallet.Money is < 0 or > MaxBalance || wallet.Items is null)
            throw new JourneysException("The wallet money or items are invalid.");
        var items = new Dictionary<string, int>();
        var machines = new Dictionary<int, int>();
        var costumes = new HashSet<string>();
        foreach (var (key, count) in wallet.Items)
        {
            if (count < 0 || key.StartsWith("costume:", StringComparison.Ordinal) && count > 1)
                throw new JourneysException($"Invalid wallet count for '{key}'.");
            if (key.StartsWith("mart:", StringComparison.Ordinal) && JourneyBag.IsItemKey(key[5..]))
            {
                if (count > 0) items[key[5..]] = count;
            }
            else if (key.StartsWith("tm:", StringComparison.Ordinal) && int.TryParse(key.AsSpan(3), out var move)
                     && key == $"tm:{move}" && JourneyBag.Catalog().Contains(move))
            {
                if (count > 0) machines[move] = count;
            }
            else if (key.StartsWith("costume:", StringComparison.Ordinal) && Costumes.Any(p => p.Id == key[8..]))
            {
                if (count > 0) costumes.Add(key[8..]);
            }
            // A key from a newer server stays on the server; refusing the whole wallet would stop every sync.
            else Console.Error.WriteLine($"Skipped unknown wallet key '{key}'.");
        }
        // Save baselines still describe the last read of each journey.
        var state = JsonFile.Read<EconomyData>(file) ?? new EconomyData();
        state.Funds = new JourneyFunds(wallet.Money, items);
        state.Machines = machines;
        state.Costumes = costumes;
        state.ImportedMachines = true;
        state.PendingMachines = [];
        JsonFile.Write(file, state);
    }

    public ShopView Shop(string shop, string? action = null, string? item = null, int quantity = 0)
    {
        using var lease = Lock();
        var library = JourneyLibrary.Load(paths);
        var state = Load(library);
        Seed(state, library);
        if (state.Funds is not null) ImportMachines(state, library);
        var funds = state.Funds ?? new JourneyFunds(0, []);
        var stock = shop switch
        {
            "mart" => Mart.Select(p => new ShopItem(JourneyBag.Key(p.Name), p.Name, p.Price,
                funds.Items.GetValueOrDefault(JourneyBag.Key(p.Name)), 999)).ToList(),
            "tm" => JourneyBag.Catalog().Select(move => new ShopItem(move.ToString(), JourneyBag.MoveName(move),
                MachinePrice, state.Machines.GetValueOrDefault(move), 999)).ToList(),
            "costumes" => Costumes.Select(p => new ShopItem(p.Id, p.Label, p.Price,
                state.Costumes.Contains(p.Id) ? 1 : 0, 1)).ToList(),
            _ => throw new JourneysException("This shop is unavailable."),
        };

        if (action is null)
            return View();
        if (state.Funds is null)
            throw new JourneysException("Save in an official journey to bring your money and bag to the island.");
        if (quantity is < 1 or > 99)
            throw new JourneysException("Choose between 1 and 99 items.");
        var product = stock.Find(p => p.Id == item) ?? throw new JourneysException("That item is not in stock.");
        var balance = funds.Money;
        if (action == "buy")
        {
            if (shop == "costumes" && product.Owned > 0)
                throw new JourneysException("That costume is already in your wardrobe.");
            if (product.Owned + quantity > product.Limit)
                throw new JourneysException("You already have as many of that item as you can carry.");
            var cost = product.Price * quantity;
            if (cost > balance) throw new JourneysException("You don't have enough Pokéyen.");
            balance -= cost;
            if (shop == "mart") funds.Items[product.Id] = product.Owned + quantity;
            else if (shop == "tm") state.Machines[int.Parse(product.Id)] = product.Owned + quantity;
            else state.Costumes.Add(product.Id);
            stock[stock.IndexOf(product)] = product with { Owned = product.Owned + quantity };
        }
        else if (shop == "mart" && action == "sell")
        {
            if (product.Owned < quantity) throw new JourneysException("You don't have that many to sell.");
            var proceeds = product.Price / 2 * quantity;
            if (balance + proceeds > MaxBalance) throw new JourneysException("Your wallet is full.");
            balance += proceeds;
            var remaining = product.Owned - quantity;
            if (remaining == 0) funds.Items.Remove(product.Id);
            else funds.Items[product.Id] = remaining;
            stock[stock.IndexOf(product)] = product with { Owned = remaining };
        }
        else
        {
            throw new JourneysException("This shop cannot make that trade.");
        }
        funds = state.Funds = funds with { Money = balance };
        JsonFile.Write(file, state);
        return View();

        ShopView View()
        {
            var bag = new Dictionary<string, int>(funds.Items);
            foreach (var (move, count) in state.Machines)
                bag[$"TM {JourneyBag.MoveName(move)}"] = count;
            return new ShopView(funds.Money, state.Funds != null, stock, bag);
        }
    }

    public string Sync(string journeyId, bool entering, bool canWrite = false)
    {
        using var lease = Lock();
        var library = JourneyLibrary.Load(paths);
        var entry = library.Journey(journeyId);
        if (entry.Kind != JourneyKind.Official) return "ignored";
        GameLock.EnsureClosed(paths, journeyId);
        var save = LoadPlayable(entry);
        if (save is null) return "unsaved";
        var state = Load(library);
        var bag = new JourneyBag(save);
        var current = bag.Read();
        if (state.Funds is null)
            state.Funds = new JourneyFunds(current.Money, new(current.Items));
        ImportMachines(state, library);
        var machines = bag.ReadMachines();
        if (state.LastMachines.TryGetValue(journeyId, out var priorMachines))
            AddChanges(state.Machines, priorMachines, machines);
        else
            KeepLargerStacks(state.Machines, machines);
        state.LastMachines[journeyId] = machines;

        if (state.LastRead.TryGetValue(journeyId, out var former))
        {
            AddChanges(state.Funds.Items, former.Items, current.Items);
            var balance = Math.Clamp(state.Funds.Money + current.Money - former.Money, 0, MaxBalance);
            state.Funds = state.Funds with { Money = balance };
        }
        else
        {
            // On the first visit, keep any items already in this journey's bag without adding its starting money.
            KeepLargerStacks(state.Funds.Items, current.Items);
        }
        state.LastRead[journeyId] = current;

        if (!entering || !bag.Apply(state.Funds, state.Machines))
        {
            JsonFile.Write(file, state);
            return "unchanged";
        }
        if (!canWrite)
        {
            JsonFile.Write(file, state);
            return "pending";
        }

        // Journal the intended bytes before updating the save. On retry we can distinguish a completed write
        // from an interrupted one without charging for or delivering a TM twice.
        var bytes = save.Write();
        var written = new JourneyBag(save);
        state.Writing = new EconomyWrite(journeyId, Convert.ToHexString(SHA256.HashData(bytes.Span)),
            written.Read(), Machines: written.ReadMachines());
        JsonFile.Write(file, state);
        SaveBridge.Backup(paths, journeyId, entry.SavePath, "economy");
        FileOps.WriteAllBytesAtomic(entry.SavePath, bytes.Span);
        FinishWrite(state);
        JsonFile.Write(file, state);
        return "changed";
    }

    private static void AddChanges<TKey>(Dictionary<TKey, int> global, Dictionary<TKey, int> former,
        Dictionary<TKey, int> current) where TKey : notnull
    {
        foreach (var key in former.Keys.Union(current.Keys))
        {
            var delta = current.GetValueOrDefault(key) - former.GetValueOrDefault(key);
            if (delta == 0) continue;
            var count = (int)Math.Clamp((long)global.GetValueOrDefault(key) + delta, 0, int.MaxValue);
            if (count == 0) global.Remove(key);
            else global[key] = count;
        }
    }

    private static void KeepLargerStacks<TKey>(Dictionary<TKey, int> shared, Dictionary<TKey, int> existing)
        where TKey : notnull
    {
        foreach (var (key, count) in existing)
            shared[key] = Math.Max(shared.GetValueOrDefault(key), count);
    }

    private void ImportMachines(EconomyData state, JourneyLibrary library)
    {
        var updated = false;
        if (!state.ImportedMachines)
        {
            // Import native TMs once. Record each save's baseline so a stale copy doesn't restore a spent TM.
            foreach (var (id, entry) in library.Journeys)
            {
                if (GameLock.IsRunning(paths, id) || LoadPlayable(entry) is not { } save) continue;
                var machines = new JourneyBag(save).ReadMachines();
                KeepLargerStacks(state.Machines, machines);
                state.LastMachines[id] = machines;
            }
            state.ImportedMachines = true;
            updated = true;
        }
        foreach (var (id, pending) in state.PendingMachines.ToArray())
        {
            if (!library.Journeys.TryGetValue(id, out var entry) || GameLock.IsRunning(paths, id) ||
                LoadPlayable(entry) is not { } save) continue;
            var game = new JourneyBag(save);
            if (!state.LastMachines.ContainsKey(id))
            {
                var existing = game.ReadMachines();
                KeepLargerStacks(state.Machines, existing);
                state.LastMachines[id] = existing;
            }
            var moves = game.Machines().ToDictionary(tm => tm.Item, tm => tm.Move);
            foreach (var (item, count) in pending.ToArray())
            {
                if (!moves.TryGetValue(item, out var move)) continue;
                state.Machines[move] = (int)Math.Min((long)state.Machines.GetValueOrDefault(move) + count, int.MaxValue);
                pending.Remove(item);
                updated = true;
            }
            if (pending.Count == 0) state.PendingMachines.Remove(id);
        }
        if (updated) JsonFile.Write(file, state);
    }

    private void Seed(EconomyData state, JourneyLibrary library)
    {
        if (state.Funds is not null) return;
        foreach (var (id, entry) in library.Journeys.Where(p => p.Value.Kind == JourneyKind.Official)
                     .OrderByDescending(p => File.GetLastWriteTimeUtc(p.Value.SavePath)))
        {
            if (GameLock.IsRunning(paths, id) || LoadPlayable(entry) is not { } save) continue;
            var funds = new JourneyBag(save).Read();
            state.Funds = new JourneyFunds(funds.Money, new(funds.Items));
            state.LastRead[id] = funds;
            JsonFile.Write(file, state);
            return;
        }
    }

    private static SaveFile? LoadPlayable(JourneyEntry entry) =>
        entry.Kind == JourneyKind.Official && File.Exists(entry.SavePath) &&
        SaveUtil.TryGetSaveFile(entry.SavePath, out var save) && save.Generation is >= 1 and <= 7 &&
        save.ChecksumsValid && !string.IsNullOrWhiteSpace(save.OT) ? save : null;

    private EconomyData Load(JourneyLibrary library)
    {
        var state = JsonFile.Read<EconomyData>(file) ?? new EconomyData();
        state.LastRead ??= [];
        state.Machines ??= [];
        state.Costumes ??= [];
        state.LastMachines ??= [];
        state.PendingMachines ??= [];
        if (state.Writing is not { } writing) return state;
        if (library.Journeys.TryGetValue(writing.Journey, out var entry) && File.Exists(entry.SavePath) &&
            Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(entry.SavePath))) == writing.Digest)
            FinishWrite(state);
        else
            state.Writing = null;
        JsonFile.Write(file, state);
        return state;
    }

    private static void FinishWrite(EconomyData state)
    {
        var writing = state.Writing!;
        state.LastRead[writing.Journey] = writing.Funds;
        if (writing.Machines is not null) state.LastMachines[writing.Journey] = writing.Machines;
        if (writing.PendingMachines is { } pending)
        {
            if (pending.Count == 0) state.PendingMachines.Remove(writing.Journey);
            else state.PendingMachines[writing.Journey] = pending;
        }
        state.Writing = null;
    }

    private FileStream Lock()
    {
        Directory.CreateDirectory(Path.GetDirectoryName(file)!);
        var elapsed = Stopwatch.StartNew();
        while (true)
        {
            try { return File.Open(file + ".lock", FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None); }
            catch (IOException) when (elapsed.ElapsedMilliseconds < 2_000) { Thread.Sleep(25); }
        }
    }
}
