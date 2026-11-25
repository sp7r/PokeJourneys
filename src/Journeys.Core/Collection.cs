using PKHeX.Core;

namespace Journeys.Core;

/// <summary>One Pokémon seen in a journey's save. <see cref="Box"/> is -1 for the party; boxes and slots start at 0.</summary>
public sealed record CollectedMon(
    int Box,
    int Slot,
    ushort Species,
    byte Form,
    string Summary,
    byte Level,
    bool Shiny,
    bool Egg,
    string Format,
    bool Legal = true,
    string? LegalityIssue = null)
{
    public bool InParty => Box < 0;

    public SlotRef ToSlot() => InParty ? new SlotRef.Party(Slot) : new SlotRef.Box(Box, Slot);
}

/// <summary>Every Pokémon in a journey's save at the time it was read.</summary>
public sealed record JourneySnapshot(
    string JourneyId,
    DateTime TakenUtc,
    string Game,
    byte Generation,
    string Trainer,
    ushort TrainerId,
    List<CollectedMon> Mons);

/// <summary>Everything the player owns: the vault, the last snapshot of each journey, and every species they've had.</summary>
public sealed record CollectionView(List<VaultEntry> Vault, List<JourneySnapshot> Journeys, List<ushort> Dex);

/// <summary>
/// Keeps track of the player's Pokémon across all journeys. A journey's save is read when its game closes (and after
/// every move), and the list of what's in it is kept as a snapshot. Every species seen is added to the player's dex,
/// which only grows, so a Pokémon traded away or evolved still counts as caught.
/// </summary>
public static class Collection
{
    /// <summary>Reads the journey's save and records everything in it.</summary>
    public static JourneySnapshot Take(JourneysPaths paths, ISaveStore saves, string journeyId)
    {
        var sav = saves.Load(journeyId);
        var mons = SaveBridge.AllMons(sav).Select(x => Describe(x.Slot, x.Mon)).ToList();
        var snapshot = new JourneySnapshot(
            journeyId, DateTime.UtcNow, sav.Version.ToString(), sav.Generation, sav.OT, sav.TID16, mons);
        JsonFile.Write(paths.SnapshotFileFor(journeyId), snapshot);
        AddToDex(paths, mons.Where(m => !m.Egg).Select(m => m.Species));
        return snapshot;
    }

    /// <summary><see cref="Take"/>, skipping a journey whose save can't be read (no save yet, or not supported).</summary>
    public static JourneySnapshot? TryTake(JourneysPaths paths, ISaveStore saves, string journeyId)
    {
        try { return Take(paths, saves, journeyId); }
        catch (JourneysException) { return null; }
    }

    public static JourneySnapshot? Load(JourneysPaths paths, string journeyId) =>
        JsonFile.Read<JourneySnapshot>(paths.SnapshotFileFor(journeyId));

    public static List<JourneySnapshot> All(JourneysPaths paths)
    {
        if (!Directory.Exists(paths.SnapshotsDir))
            return [];
        return Directory.GetFiles(paths.SnapshotsDir, "*.json")
            .Select(f => JsonFile.Read<JourneySnapshot>(f))
            .OfType<JourneySnapshot>()
            .OrderBy(s => s.JourneyId, StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    public static List<ushort> Dex(JourneysPaths paths) => JsonFile.Read<List<ushort>>(paths.DexFile) ?? [];

    public static void AddToDex(JourneysPaths paths, IEnumerable<ushort> species)
    {
        var dex = new SortedSet<ushort>(Dex(paths));
        var before = dex.Count;
        dex.UnionWith(species.Where(s => s != 0));
        if (dex.Count != before)
            JsonFile.Write(paths.DexFile, dex.ToList());
    }

    /// The Vault and the official journeys' Pokémon: a ROM hack's or unsupported game's stay in that game.
    public static CollectionView View(JourneysPaths paths)
    {
        var library = JourneyLibrary.Load(paths);
        var shared = All(paths).Where(s => library.Journeys.TryGetValue(s.JourneyId, out var j) && j.Kind == JourneyKind.Official).ToList();
        return new(Vault.Open(paths).Entries.ToList(), shared, Dex(paths));
    }

    private static CollectedMon Describe(SlotRef slot, PKM pk)
    {
        var (box, index) = slot switch
        {
            SlotRef.Party p => (-1, p.Index),
            SlotRef.Box b => (b.BoxIndex, b.Slot),
            _ => throw new ArgumentOutOfRangeException(nameof(slot)),
        };
        var legality = Legality.Check(pk);
        return new CollectedMon(
            box, index, pk.Species, pk.Form, SaveBridge.Describe(pk), pk.CurrentLevel, pk.IsShiny, pk.IsEgg,
            pk.GetType().Name, legality.Legal, legality.Issue);
    }
}
