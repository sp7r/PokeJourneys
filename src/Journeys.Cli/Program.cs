using Journeys.Core;
using PKHeX.Core;

namespace Journeys.Cli;

public static class Program
{
    private static readonly JourneysJson CompactJson = new(new(JsonFile.Options) { WriteIndented = false });
    private const string Help = """
        PokeJourneys Online: one trainer across every Pokémon game.

        Trainer
          journeys profile create <name> [--female] [--tid N] [--sid N]
          journeys profile show
          journeys trainer apply <journey>       make a journey's trainer your profile

        Journeys and emulators (you supply your own ROMs)
          journeys emulator add <name> --exe <path> [--arg <a>]...   args default to "{rom}"
          journeys journey add <id> --save <path> [--rom <path>] [--emulator <name>] [--title <text>]
                                [--kind official|romhack|fangame]
          journeys journey list
          journeys play <journey>                back up, launch, wait for the game to close

        Pokémon
          journeys show <journey>                trainer, party and PC boxes
          journeys deposit <journey> party <n>   move a party Pokémon into the vault
          journeys deposit <journey> box <b> <s> move a PC Pokémon into the vault
          journeys vault list [--json]
          journeys vault data <vault-id>
          journeys vault import <file> [--from <game>]
          journeys vault drop <vault-id>
          journeys withdraw <vault-id> <journey> move a vault Pokémon into a journey's PC
          journeys move <journey> party <n> <to-journey>     move a Pokémon straight into another journey
          journeys move <journey> box <b> <s> <to-journey>
          journeys snapshot <journey>            record every Pokémon in a journey's save
          journeys collection [--json]           the vault, every journey's Pokémon and your dex
          journeys backup <journey>

        Shops
          journeys shop list <mart|tm|costumes>
          journeys shop buy <mart|tm|costumes> <item> <quantity>
          journeys shop sell mart <item> <quantity>
          journeys economy <enter|leave> <journey> [--write]
          journeys economy export
          journeys economy import <file>

        Data folder: %LOCALAPPDATA%\PokeJourneys (set JOURNEYS_DATA to change it)
        """;

    public static int Main(string[] args)
    {
        try
        {
            var paths = JourneysPaths.Default();
            return Run(paths, new Args(args), Console.Out);
        }
        catch (JourneysException ex)
        {
            Console.Error.WriteLine(ex.Message);
            return 1;
        }
    }

    public static int Run(JourneysPaths paths, Args a, TextWriter o)
    {
        switch (a.Next())
        {
            case "profile": return Profile(paths, a, o);
            case "trainer": return Trainer(paths, a, o);
            case "emulator": return Emulator(paths, a, o);
            case "journey": return JourneyCmd(paths, a, o);
            case "play": return Play(paths, a, o);
            case "show": return Show(paths, a, o);
            case "deposit": return Deposit(paths, a, o);
            case "withdraw": return Withdraw(paths, a, o);
            case "vault": return VaultCmd(paths, a, o);
            case "backup": return Backup(paths, a, o);
            case "move": return MoveCmd(paths, a, o);
            case "snapshot": return SnapshotCmd(paths, a, o);
            case "collection": return CollectionCmd(paths, a, o);
            case "battle-roster":
                o.WriteLine(System.Text.Json.JsonSerializer.Serialize(DomeTeams.Read(paths), JourneysJson.Default.DomeRoster));
                return 0;
            case "shop": return ShopCmd(Economy(paths), a, o);
            case "economy": return EconomyCmd(Economy(paths), a, o);
            case "species-name":
                var number = a.RequiredInt("species");
                if (number is < 1 or > (int)Species.Zeraora)
                    throw new JourneysException("Choose a species from the 3DS Pokédex.");
                o.WriteLine(SpeciesName.GetSpeciesName((ushort)number, (int)LanguageID.English));
                return 0;
            case "follower-art":
                var vault = Vault.Open(paths);
                var entry = vault.Find(a.Required("vault id"));
                var follower = vault.LoadMon(entry);
                o.WriteLine($"{FollowerSprite((Species)follower.Species)}\t{(follower.IsShiny ? 1 : 0)}\t{(follower.Gender == 1 ? 1 : 0)}");
                return 0;
            case "follower-sprite":
                // Another player's follower by National Pokédex number: its sheet's name in the follower pack.
                var dex = a.RequiredInt("species");
                if (dex is < 1 or > (int)Species.Zeraora)
                    throw new JourneysException("Choose a species from the 3DS Pokédex.");
                o.WriteLine(FollowerSprite((Species)dex));
                return 0;
            case "debug-pokemon":
                var save = SaveBridge.Load(a.Required("save path"));
                var record = DebugPokemon.Create(save, a.Required("game code"), a.RequiredInt("species"), a.RequiredInt("level"));
                o.WriteLine(Convert.ToBase64String(record));
                return 0;
            case null or "help" or "--help" or "-h":
                o.WriteLine(Help);
                return 0;
            case var other:
                throw new JourneysException($"Unknown command '{other}'. Run 'journeys help'.");
        }
    }

    /// A species' sheet name in the follower pack (Graphics/Characters/Followers).
    private static string FollowerSprite(Species species) => species switch
    {
        Species.NidoranF => "NIDORANfE",
        Species.NidoranM => "NIDORANmA",
        Species.Flabébé => "FLABEBE",
        _ => species.ToString().ToUpperInvariant(),
    };

    private static int Profile(JourneysPaths paths, Args a, TextWriter o)
    {
        switch (a.Next())
        {
            case "create":
                var name = a.Required("name");
                if (TrainerProfile.Load(paths) is { } existing && !a.Flag("--replace"))
                    throw new JourneysException($"You already have a trainer, {existing.Name}. Add --replace to start over.");
                var profile = TrainerProfile.Create(
                    name,
                    a.Flag("--female") ? TrainerGender.Female : TrainerGender.Male,
                    a.UShort("--tid"),
                    a.UShort("--sid"));
                profile.Save(paths);
                o.WriteLine($"Created trainer {profile.Name} (ID {profile.TrainerId:D5}).");
                return 0;
            case "show" or null:
                var p = TrainerProfile.LoadRequired(paths);
                o.WriteLine($"{p.Name}  {p.Gender}  ID {p.TrainerId:D5}  SID {p.SecretId:D5}");
                return 0;
            case var other:
                throw new JourneysException($"Unknown profile command '{other}'.");
        }
    }

    private static int Trainer(JourneysPaths paths, Args a, TextWriter o)
    {
        if (a.Next() != "apply")
            throw new JourneysException("Usage: journeys trainer apply <journey>");
        var journeyId = a.Required("journey");
        var profile = TrainerProfile.LoadRequired(paths);
        var saves = new DiskSaveStore(paths, JourneyLibrary.Load(paths));
        GameLock.EnsureClosed(paths, journeyId);

        var sav = saves.Load(journeyId);
        if (SaveBridge.HasTrainer(sav, profile))
        {
            o.WriteLine($"{journeyId} already uses {profile.Name}.");
            return 0;
        }
        var oldName = sav.OT;
        var result = SaveBridge.ApplyTrainer(sav, profile);
        saves.Write(journeyId, sav, "before-trainer");
        o.WriteLine($"{journeyId}: trainer {oldName} is now {profile.Name}. {result.Restamped} Pokémon updated to match.");
        if (result.ShinyChanged > 0)
            o.WriteLine($"Note: {result.ShinyChanged} Pokémon changed shininess, because Gen 3+ shininess depends on trainer IDs.");
        return 0;
    }

    private static int Emulator(JourneysPaths paths, Args a, TextWriter o)
    {
        var lib = JourneyLibrary.Load(paths);
        switch (a.Next())
        {
            case "add":
                var name = a.Required("name");
                var exe = Path.GetFullPath(a.Option("--exe") ?? throw new JourneysException("Add --exe <path to the emulator>."));
                var emuArgs = a.Options("--arg");
                lib.Emulators[name] = new EmulatorEntry(exe, emuArgs.Count > 0 ? emuArgs : ["{rom}"]);
                lib.Save(paths);
                o.WriteLine($"Added emulator {name}.");
                return 0;
            case "list" or null:
                foreach (var (n, e) in lib.Emulators)
                    o.WriteLine($"{n}: {e.Exe} {string.Join(' ', e.Args)}");
                return 0;
            case var other:
                throw new JourneysException($"Unknown emulator command '{other}'.");
        }
    }

    private static int JourneyCmd(JourneysPaths paths, Args a, TextWriter o)
    {
        var lib = JourneyLibrary.Load(paths);
        switch (a.Next())
        {
            case "add":
                var id = a.Required("id");
                if (JourneyLibrary.IdProblem(id) is { } problem)
                    throw new JourneysException(problem);
                var save = a.Option("--save") ?? throw new JourneysException("Add --save <path to the game's .sav file>.");
                var rom = a.Option("--rom");
                var emulator = a.Option("--emulator");
                if (emulator is not null && !lib.Emulators.ContainsKey(emulator))
                    throw new JourneysException($"No emulator called '{emulator}'. Add it first with: journeys emulator add {emulator} --exe <path>");
                lib.Journeys[id] = new JourneyEntry(
                    Path.GetFullPath(save),
                    rom is null ? null : Path.GetFullPath(rom),
                    emulator,
                    a.Option("--title"),
                    ParseKind(a.Option("--kind")));
                lib.Save(paths);
                o.WriteLine($"Added {id}.");
                return 0;
            case "list" or null:
                foreach (var (gid, g) in lib.Journeys)
                {
                    var state = File.Exists(g.SavePath) ? Summarize(SaveBridge.Load(g.SavePath)) : "no save yet";
                    o.WriteLine($"{gid,-12} {state}");
                }
                return 0;
            case var other:
                throw new JourneysException($"Unknown journey command '{other}'.");
        }
    }

    private static int Play(JourneysPaths paths, Args a, TextWriter o)
    {
        var journeyId = a.Required("journey");
        var result = EmulatorLauncher.Play(paths, JourneyLibrary.Load(paths), journeyId, o.WriteLine);
        return result.ExitCode;
    }

    private static int Show(JourneysPaths paths, Args a, TextWriter o)
    {
        var journeyId = a.Required("journey");
        var sav = SaveBridge.Load(JourneyLibrary.Load(paths).Journey(journeyId).SavePath);
        o.WriteLine(Summarize(sav));
        var current = string.Empty;
        foreach (var (slot, pk) in SaveBridge.AllMons(sav))
        {
            var group = slot is SlotRef.Party ? "Party" : $"Box {((SlotRef.Box)slot).BoxIndex + 1}";
            if (group != current)
            {
                o.WriteLine($"  {group}");
                current = group;
            }
            var where = slot is SlotRef.Box b ? $"slot {b.Slot + 1}" : $"{((SlotRef.Party)slot).Index + 1}";
            o.WriteLine($"    {where,-8} {SaveBridge.Describe(pk)}");
        }
        return 0;
    }

    private static int Deposit(JourneysPaths paths, Args a, TextWriter o)
    {
        var journeyId = a.Required("journey");
        var library = JourneyLibrary.Load(paths);
        library.Shared(journeyId);
        var slot = ReadSlot(a);
        var entry = Vault.Open(paths).Deposit(new DiskSaveStore(paths, library), journeyId, slot);
        o.WriteLine($"{entry.Summary} is in the vault (id {entry.Id}).");
        return 0;
    }

    private static SlotRef ReadSlot(Args a) => a.Required("party or box") switch
    {
        "party" => new SlotRef.Party(a.RequiredInt("party slot") - 1),
        "box" => new SlotRef.Box(a.RequiredInt("box") - 1, a.RequiredInt("slot") - 1),
        var x => throw new JourneysException($"Expected 'party' or 'box', got '{x}'."),
    };

    private static int MoveCmd(JourneysPaths paths, Args a, TextWriter o)
    {
        var from = a.Required("journey");
        var slot = ReadSlot(a);
        var to = a.Required("journey to move it to");
        var library = JourneyLibrary.Load(paths);
        library.Shared(from);
        library.Shared(to);
        var saves = new DiskSaveStore(paths, library);
        var target = Vault.Open(paths).Move(saves, from, slot, to);
        o.WriteLine($"Moved from {from}, {slot} to {to}, {target}.");
        return 0;
    }

    private static int SnapshotCmd(JourneysPaths paths, Args a, TextWriter o)
    {
        var journeyId = a.Required("journey");
        var library = JourneyLibrary.Load(paths);
        var snapshot = Collection.Take(paths, new DiskSaveStore(paths, library), journeyId);
        o.WriteLine($"{journeyId}: {snapshot.Mons.Count} Pokémon recorded.");
        return 0;
    }

    private static TrainerEconomy Economy(JourneysPaths paths) =>
        new(paths, Environment.GetEnvironmentVariable("JOURNEYS_ACCOUNT") ?? "local");

    private static int EconomyCmd(TrainerEconomy economy, Args a, TextWriter o)
    {
        switch (a.Required("economy action"))
        {
            case "export":
                o.WriteLine(System.Text.Json.JsonSerializer.Serialize(economy.Export(), CompactJson.EconomyWallet));
                break;
            case "import":
                EconomyWallet wallet;
                try
                {
                    wallet = JsonFile.Read<EconomyWallet>(a.Required("wallet file"))
                        ?? throw new JourneysException("The wallet file could not be read.");
                }
                catch (System.Text.Json.JsonException) { throw new JourneysException("The wallet file could not be read."); }
                economy.Import(wallet);
                o.WriteLine("ok");
                break;
            case var mode when mode is "enter" or "leave":
                o.WriteLine(economy.Sync(a.Required("journey"), mode == "enter", a.Flag("--write")));
                break;
            default: throw new JourneysException("Choose enter, leave, export or import.");
        }
        return 0;
    }

    private static int ShopCmd(TrainerEconomy economy, Args a, TextWriter o)
    {
        var action = a.Required("shop action");
        var shop = a.Required("shop");
        var view = action == "list" ? economy.Shop(shop)
            : economy.Shop(shop, action, a.Required("item"), a.RequiredInt("quantity"));
        o.WriteLine(System.Text.Json.JsonSerializer.Serialize(view, JourneysJson.Default.ShopView));
        return 0;
    }

    private static int CollectionCmd(JourneysPaths paths, Args a, TextWriter o)
    {
        var view = Collection.View(paths);
        if (a.Flag("--json"))
        {
            o.WriteLine(System.Text.Json.JsonSerializer.Serialize(view, JourneysJson.Default.CollectionView));
            return 0;
        }
        o.WriteLine($"Vault: {view.Vault.Count} Pokémon");
        foreach (var e in view.Vault)
            o.WriteLine($"  {e.Id}  {e.Summary}");
        foreach (var s in view.Journeys)
        {
            o.WriteLine($"{s.JourneyId} ({s.Game}, {s.Trainer}): {s.Mons.Count} Pokémon");
            foreach (var m in s.Mons)
                o.WriteLine($"  {(m.InParty ? $"party {m.Slot + 1}" : $"box {m.Box + 1} slot {m.Slot + 1}"),-16} {m.Summary}");
        }
        o.WriteLine($"Dex: {view.Dex.Count} species caught across all journeys");
        return 0;
    }

    private static int Withdraw(JourneysPaths paths, Args a, TextWriter o)
    {
        var vault = Vault.Open(paths);
        var entry = vault.Find(a.Required("vault id"));
        var journeyId = a.Required("journey");
        var library = JourneyLibrary.Load(paths);
        library.Shared(journeyId);
        var slot = vault.Withdraw(new DiskSaveStore(paths, library), journeyId, entry);
        o.WriteLine($"{entry.Summary} is in {journeyId}, {slot}.");
        return 0;
    }

    private static int VaultCmd(JourneysPaths paths, Args a, TextWriter o)
    {
        var vault = Vault.Open(paths);
        switch (a.Next())
        {
            case null or "list":
                if (a.Flag("--json"))
                {
                    var entries = vault.Entries.Select(e => new VaultSummary(e.Id, e.Species, e.Summary, e.FromGame, e.DepositedUtc)).ToList();
                    o.WriteLine(System.Text.Json.JsonSerializer.Serialize(entries, CompactJson.ListVaultSummary));
                }
                else
                {
                    if (vault.Entries.Count == 0) o.WriteLine("The vault is empty.");
                    foreach (var e in vault.Entries)
                        o.WriteLine($"{e.Id}  {e.Summary,-32} {e.Format}  from {e.FromGame}");
                }
                break;
            case "data":
                o.WriteLine(Convert.ToBase64String(vault.Data(vault.Find(a.Required("vault id")))));
                break;
            case "import":
                var entry = vault.Import(File.ReadAllText(a.Required("Pokemon file")), a.Option("--from"));
                o.WriteLine(System.Text.Json.JsonSerializer.Serialize(entry, CompactJson.VaultEntry));
                break;
            case "drop":
                vault.Drop(vault.Find(a.Required("vault id")));
                o.WriteLine("ok");
                break;
            case var other: throw new JourneysException($"Unknown vault command '{other}'.");
        }
        return 0;
    }

    private static int Backup(JourneysPaths paths, Args a, TextWriter o)
    {
        var journeyId = a.Required("journey");
        var journey = JourneyLibrary.Load(paths).Journey(journeyId);
        var path = SaveBridge.Backup(paths, journeyId, journey.SavePath, "manual")
            ?? throw new JourneysException($"No save file at {journey.SavePath}.");
        o.WriteLine($"Backed up to {path}");
        return 0;
    }

    private static JourneyKind ParseKind(string? kind) => kind?.ToLowerInvariant() switch
    {
        null or "official" => JourneyKind.Official,
        "romhack" or "hack" => JourneyKind.RomHack,
        "fangame" => JourneyKind.FanGame,
        _ => throw new JourneysException("--kind must be official, romhack or fangame."),
    };

    private static string Summarize(SaveFile sav) =>
        $"{sav.Version} (Gen {sav.Generation})  {sav.OT}  ID {sav.DisplayTID}  party {sav.PartyCount}  played {sav.PlayTimeString}";
}

/// <summary>A small reader over the command line: positional words in order, plus --options anywhere.</summary>
public sealed class Args(IEnumerable<string> args)
{
    private readonly List<string> _items = args.ToList();

    public string? Next()
    {
        for (int i = 0; i < _items.Count; i++)
        {
            if (_items[i].StartsWith("--"))
            {
                i += IsValueOption(_items[i]) ? 1 : 0;
                continue;
            }
            var value = _items[i];
            _items.RemoveAt(i);
            return value;
        }
        return null;
    }

    public string Required(string what) => Next() ?? throw new JourneysException($"Missing {what}. Run 'journeys help'.");

    public int RequiredInt(string what) =>
        int.TryParse(Required(what), out var n) ? n : throw new JourneysException($"The {what} must be a number.");

    public bool Flag(string name) => _items.Remove(name);

    public string? Option(string name)
    {
        var i = _items.IndexOf(name);
        if (i < 0)
            return null;
        if (i + 1 >= _items.Count)
            throw new JourneysException($"{name} needs a value.");
        var value = _items[i + 1];
        _items.RemoveRange(i, 2);
        return value;
    }

    public List<string> Options(string name)
    {
        var values = new List<string>();
        while (Option(name) is { } v)
            values.Add(v);
        return values;
    }

    public ushort? UShort(string name) => Option(name) is { } v
        ? ushort.TryParse(v, out var n) ? n : throw new JourneysException($"{name} must be a number from 0 to 65535.")
        : null;

    private static bool IsValueOption(string name) =>
        name is "--exe" or "--arg" or "--save" or "--rom" or "--emulator" or "--title" or "--tid" or "--sid" or "--kind" or "--from";
}
