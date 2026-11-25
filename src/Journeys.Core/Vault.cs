using PKHeX.Core;

namespace Journeys.Core;

public sealed record VaultSummary(string Id, ushort Species, string Summary, string FromGame, DateTime DepositedUtc);

/// <summary>A Pokémon kept in the vault, outside every game.</summary>
public sealed record VaultEntry(
    string Id,
    ushort Species,
    string Summary,
    string Format,
    EntityContext Context,
    string FromGame,
    DateTime DepositedUtc,
    string File);

/// <summary>
/// The vault holds Pokémon between games, like Pokémon HOME. A Pokémon is always in exactly one place: one game's
/// save, or the vault. Moving it writes the new place first and removes it from the old place second, so a crash
/// part-way leaves a copy rather than losing it.
///
/// Pokémon move the way the games allow: Gen 1 and 2 trade with each other and go up to Gen 7, and Gen 3 and
/// later go only forward (3 → 4 → 5 → 6 → 7). A Pokémon that moves to a newer game keeps that newer format.
///
/// Only Pokémon that pass PKHeX's legality check (<see cref="Legality"/>) can enter the vault or move between
/// journeys. One that fails can stay in its own journey.
/// </summary>
public sealed class Vault
{
    private readonly JourneysPaths _paths;
    private readonly List<VaultEntry> _entries;

    private Vault(JourneysPaths paths, List<VaultEntry> entries)
    {
        _paths = paths;
        _entries = entries;
    }

    public static Vault Open(JourneysPaths paths)
    {
        Directory.CreateDirectory(paths.VaultMonsDir);
        var entries = JsonFile.Read<List<VaultEntry>>(paths.VaultIndexFile) ?? [];
        return new Vault(paths, entries);
    }

    public IReadOnlyList<VaultEntry> Entries => _entries;

    public byte[] Data(VaultEntry entry) => System.IO.File.ReadAllBytes(Path.Combine(_paths.VaultMonsDir, entry.File));

    public VaultEntry Import(string base64, string? fromGame = null)
    {
        byte[] bytes;
        PKM pk;
        try
        {
            bytes = Convert.FromBase64String(base64);
            pk = EntityFormat.GetFromBytes(bytes) ?? throw new JourneysException("The Pokemon data could not be read.");
        }
        catch (Exception error) when (error is FormatException or ArgumentException or IndexOutOfRangeException)
        { throw new JourneysException("The Pokemon data could not be read."); }
        if (pk.Species == 0) throw new JourneysException("The Pokemon record is empty.");
        Legality.Require(pk, "go into the vault");
        var entry = Store(pk, fromGame ?? pk.Version.ToString(), bytes);
        Collection.AddToDex(_paths, [pk.Species]);
        return entry;
    }

    public void Drop(VaultEntry entry)
    {
        _entries.Remove(entry);
        SaveIndex();
        System.IO.File.Delete(Path.Combine(_paths.VaultMonsDir, entry.File));
    }

    private VaultEntry Store(PKM pk, string fromGame, ReadOnlySpan<byte> bytes)
    {
        var id = Guid.NewGuid().ToString("N")[..12];
        var file = $"{id}.{pk.Extension}";
        var entry = new VaultEntry(id, pk.Species, SaveBridge.Describe(pk), pk.GetType().Name, pk.Context,
            fromGame, DateTime.UtcNow, file);
        FileOps.WriteAllBytesAtomic(Path.Combine(_paths.VaultMonsDir, file), bytes);
        _entries.Add(entry);
        SaveIndex();
        return entry;
    }

    public VaultEntry Find(string idOrPrefix)
    {
        var matches = _entries.Where(e => e.Id.StartsWith(idOrPrefix, StringComparison.OrdinalIgnoreCase)).ToList();
        return matches.Count switch
        {
            1 => matches[0],
            0 => throw new JourneysException($"Nothing in the vault has the id '{idOrPrefix}'."),
            _ => throw new JourneysException($"More than one Pokémon's id starts with '{idOrPrefix}'. Type more of it."),
        };
    }

    public PKM LoadMon(VaultEntry entry)
    {
        var data = System.IO.File.ReadAllBytes(Path.Combine(_paths.VaultMonsDir, entry.File));
        var pk = EntityFormat.GetFromBytes(data, entry.Context)
            ?? throw new JourneysException($"The vault file for {entry.Summary} can't be read.");
        if (pk.GetType().Name != entry.Format)
            throw new JourneysException($"The vault file for {entry.Summary} is a {pk.GetType().Name}, expected {entry.Format}.");
        return pk;
    }

    /// <summary>Moves a Pokémon from a game's save into the vault, and writes the save.</summary>
    public VaultEntry Deposit(ISaveStore saves, string journeyId, SlotRef slot)
    {
        GameLock.EnsureClosed(_paths, journeyId);
        var sav = saves.Load(journeyId);
        var pk = SaveBridge.Get(sav, slot);
        if (pk.Species == 0)
            throw new JourneysException($"{slot} is empty.");
        if (pk.IsEgg)
            throw new JourneysException("Eggs stay in their game until they hatch.");
        Collection.AddToDex(_paths, [pk.Species]);
        if (SaveBridge.ClearProblem(sav, slot) is { } problem)
            throw new JourneysException(problem);
        Legality.Require(pk, "go into the vault");

        // 1) Into the vault.
        var stored = new byte[pk.SIZE_STORED];
        pk.WriteDecryptedDataStored(stored);
        var entry = Store(pk, journeyId, stored);

        // 2) Out of the game.
        try
        {
            SaveBridge.Clear(sav, slot);
            saves.Write(journeyId, sav, "before-deposit");
        }
        catch
        {
            Drop(entry);
            throw;
        }
        Refresh(saves, journeyId);
        return entry;
    }

    /// <summary>
    /// Why <paramref name="entry"/> can't go into <paramref name="sav"/>, or null if it can. On success
    /// <paramref name="converted"/> is the Pokémon in that game's format.
    /// </summary>
    public string? CheckWithdraw(VaultEntry entry, SaveFile sav, out PKM? converted) =>
        TransferProblem(LoadMon(entry), sav, out converted);

    /// <summary>
    /// Why <paramref name="pk"/> can't go into <paramref name="sav"/>, or null if it can. On success
    /// <paramref name="converted"/> is the Pokémon in that game's format.
    /// </summary>
    public static string? TransferProblem(PKM pk, SaveFile sav, out PKM? converted)
    {
        converted = null;
        var name = SaveBridge.Describe(pk);
        if (pk.IsEgg)
            return "Eggs stay in their game until they hatch.";
        var result = TryConvert(pk, sav, out var pkConverted);
        if (result is not null)
            return result;

        if (pkConverted!.Species > sav.MaxSpeciesID)
            return $"{name} doesn't exist in this game.";
        if (pkConverted.HeldItem > sav.MaxItemID)
            return $"{name} holds an item this game doesn't have.";
        if (pkConverted.Moves.Any(m => m > sav.MaxMoveID))
            return $"{name} knows a move this game doesn't have.";
        if (sav.IsStorageFull)
            return "Every PC box in this game is full.";

        converted = pkConverted;
        return null;
    }

    /// <summary>
    /// Moves a Pokémon straight from one journey's save into the first empty PC slot of another's. Both games must be
    /// closed. The Pokémon is written into the new save first and removed from the old one second.
    /// </summary>
    public SlotRef.Box Move(ISaveStore saves, string fromJourney, SlotRef slot, string toJourney)
    {
        if (string.Equals(fromJourney, toJourney, StringComparison.OrdinalIgnoreCase))
            throw new JourneysException("That Pokémon is already in that journey.");
        GameLock.EnsureClosed(_paths, fromJourney);
        GameLock.EnsureClosed(_paths, toJourney);

        var from = saves.Load(fromJourney);
        var to = saves.Load(toJourney);
        var pk = SaveBridge.Get(from, slot);
        if (pk.Species == 0)
            throw new JourneysException($"{slot} is empty.");
        if (SaveBridge.ClearProblem(from, slot) is { } clearProblem)
            throw new JourneysException(clearProblem);
        Legality.Require(pk, "move to another journey");
        if (TransferProblem(pk, to, out var converted) is { } problem)
            throw new JourneysException(problem);

        var index = to.NextOpenBoxSlot();
        var target = new SlotRef.Box(index / to.BoxSlotCount, index % to.BoxSlotCount);

        // 1) Into the new journey.
        to.SetBoxSlotAtIndex(converted!, target.BoxIndex, target.Slot, EntityImportSettings.All);
        saves.Write(toJourney, to, "before-move-in");

        // 2) Out of the old one.
        SaveBridge.Clear(from, slot);
        saves.Write(fromJourney, from, "before-move-out");

        Refresh(saves, fromJourney, toJourney);
        return target;
    }

    /// <summary>Updates the snapshots of journeys whose saves just changed.</summary>
    private void Refresh(ISaveStore saves, params string[] journeyIds)
    {
        foreach (var id in journeyIds)
            Collection.TryTake(_paths, saves, id);
    }

    private static string? TryConvert(PKM pk, SaveFile sav, out PKM? converted)
    {
        converted = null;
        if (!EntityConverter.IsConvertibleToFormat(pk, sav.Generation))
        {
            return pk.Format >= 3
                ? $"A Gen {pk.Format} Pokémon can't go back to a Gen {sav.Generation} game. Pokémon from Gen 3 on only move forward."
                : $"Gen 1 and 2 Pokémon can go to Gen 1, 2 or 7 games, not Gen {sav.Generation}.";
        }
        var result = EntityConverter.ConvertToType(pk, sav.PKMType, out var why);
        if (result is null)
        {
            return why switch
            {
                EntityConverterResult.IncompatibleSpecies => "That Pokémon doesn't exist in this game.",
                EntityConverterResult.IncompatibleForm => "That Pokémon's form doesn't exist in this game.",
                EntityConverterResult.IncompatibleLanguageGB => "Japanese and other-language Gen 1/2 games can't trade with each other.",
                _ => "The games have no way to move that Pokémon there.",
            };
        }
        converted = result;
        return null;
    }

    /// <summary>Moves a Pokémon from the vault into the first empty PC slot of a game, and writes the save.</summary>
    public SlotRef.Box Withdraw(ISaveStore saves, string journeyId, VaultEntry entry)
    {
        GameLock.EnsureClosed(_paths, journeyId);
        var sav = saves.Load(journeyId);
        if (CheckWithdraw(entry, sav, out var pk) is { } problem)
            throw new JourneysException(problem);

        var index = sav.NextOpenBoxSlot();
        var slot = new SlotRef.Box(index / sav.BoxSlotCount, index % sav.BoxSlotCount);

        // 1) Into the game.
        sav.SetBoxSlotAtIndex(pk!, slot.BoxIndex, slot.Slot, EntityImportSettings.All);
        saves.Write(journeyId, sav, "before-withdraw");

        // 2) Out of the vault.
        Drop(entry);
        Refresh(saves, journeyId);
        return slot;
    }

    private void SaveIndex() => JsonFile.Write(_paths.VaultIndexFile, _entries);
}
