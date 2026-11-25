using PKHeX.Core;

namespace Journeys.Core;

/// <summary>A Pokémon's place in a save: a party slot, or a PC box and slot. Numbers start at 0.</summary>
public abstract record SlotRef
{
    public sealed record Party(int Index) : SlotRef
    {
        public override string ToString() => $"party {Index + 1}";
    }

    public sealed record Box(int BoxIndex, int Slot) : SlotRef
    {
        public override string ToString() => $"box {BoxIndex + 1} slot {Slot + 1}";
    }
}

/// <summary>Opens, backs up and writes game saves through PKHeX.Core.</summary>
public static class SaveBridge
{
    private const int BackupsKept = 30;

    public static SaveFile Load(string savePath)
    {
        if (!File.Exists(savePath))
            throw new JourneysException($"No save file at {savePath}. Start the game and save once first.");
        if (!SaveUtil.TryGetSaveFile(savePath, out var sav))
            throw new JourneysException($"{savePath} isn't a save file PokeJourneys recognizes.");
        return sav;
    }

    /// <summary>Copies the save into the game's backup folder and returns the copy's path (null when there's no save yet).</summary>
    public static string? Backup(JourneysPaths paths, string journeyId, string savePath, string reason)
    {
        if (!File.Exists(savePath))
            return null;
        var dir = paths.BackupDirFor(journeyId);
        Directory.CreateDirectory(dir);
        var stamp = DateTime.Now.ToString("yyyyMMdd-HHmmss-fff");
        var target = Path.Combine(dir, $"{stamp}-{reason}{Path.GetExtension(savePath)}");
        File.Copy(savePath, target, overwrite: false);
        Prune(dir);
        return target;
    }

    private static void Prune(string dir)
    {
        var old = new DirectoryInfo(dir).GetFiles()
            .OrderByDescending(f => f.Name, StringComparer.Ordinal)
            .Skip(BackupsKept);
        foreach (var file in old)
            file.Delete();
    }

    /// <summary>Writes the save back in the same layout it was read in (emulator footers included).</summary>
    public static void Write(SaveFile sav, string savePath) =>
        FileOps.WriteAllBytesAtomic(savePath, sav.Write().Span);

    public static PKM Get(SaveFile sav, SlotRef slot) => slot switch
    {
        SlotRef.Party p => p.Index < sav.PartyCount
            ? sav.GetPartySlotAtIndex(p.Index)
            : throw new JourneysException($"The party has only {sav.PartyCount} Pokémon."),
        SlotRef.Box b => sav.GetBoxSlotAtIndex(CheckBox(sav, b).BoxIndex, b.Slot),
        _ => throw new ArgumentOutOfRangeException(nameof(slot)),
    };

    /// <summary>Why <paramref name="slot"/> can't be emptied, or null if it can. The party keeps at least one Pokémon, as the games require.</summary>
    public static string? ClearProblem(SaveFile sav, SlotRef slot)
    {
        switch (slot)
        {
            case SlotRef.Party p:
                if (p.Index < 0 || p.Index >= sav.PartyCount)
                    return $"The party has only {sav.PartyCount} Pokémon.";
                if (sav.PartyCount <= 1)
                    return "That's the last Pokémon in the party. The games need at least one, so put another in the party first.";
                return null;
            case SlotRef.Box b:
                CheckBox(sav, b);
                return sav.IsBoxSlotOverwriteProtected(b.BoxIndex, b.Slot)
                    ? $"{b} is locked by the game (for example a Battle Box or team), so it can't be moved."
                    : null;
            default:
                throw new ArgumentOutOfRangeException(nameof(slot));
        }
    }

    /// <summary>Empties a slot (see <see cref="ClearProblem"/> for when it can't).</summary>
    public static void Clear(SaveFile sav, SlotRef slot)
    {
        if (ClearProblem(sav, slot) is { } problem)
            throw new JourneysException(problem);
        switch (slot)
        {
            case SlotRef.Party p:
                sav.DeletePartySlot(p.Index);
                break;
            case SlotRef.Box b:
                sav.SetBoxSlotAtIndex(sav.BlankPKM, b.BoxIndex, b.Slot, EntityImportSettings.None);
                break;
        }
    }

    private static SlotRef.Box CheckBox(SaveFile sav, SlotRef.Box b)
    {
        if (b.BoxIndex < 0 || b.BoxIndex >= sav.BoxCount)
            throw new JourneysException($"This game has boxes 1 to {sav.BoxCount}.");
        if (b.Slot < 0 || b.Slot >= sav.BoxSlotCount)
            throw new JourneysException($"A box in this game has slots 1 to {sav.BoxSlotCount}.");
        return b;
    }

    /// <summary>Every Pokémon in the save, with where it is.</summary>
    public static IEnumerable<(SlotRef Slot, PKM Mon)> AllMons(SaveFile sav)
    {
        for (int i = 0; i < sav.PartyCount; i++)
            yield return (new SlotRef.Party(i), sav.GetPartySlotAtIndex(i));
        for (int box = 0; box < sav.BoxCount; box++)
        {
            for (int slot = 0; slot < sav.BoxSlotCount; slot++)
            {
                var pk = sav.GetBoxSlotAtIndex(box, slot);
                if (pk.Species != 0)
                    yield return (new SlotRef.Box(box, slot), pk);
            }
        }
    }

    public static bool HasTrainer(SaveFile sav, TrainerProfile profile) =>
        sav.OT == profile.Name
        && sav.TID16 == profile.TrainerId
        && (sav.Generation <= 2 || sav.SID16 == profile.SecretId);

    public sealed record TrainerApplyResult(int Restamped, int ShinyChanged);

    /// <summary>
    /// Makes the save's trainer the player's profile. Pokémon the old trainer caught get the new trainer too, so
    /// they stay the player's own. Gen 3+ shininess depends on the trainer IDs, so a few of those Pokémon can
    /// change shininess: do this right after the game's first save, before catching anything.
    /// </summary>
    public static TrainerApplyResult ApplyTrainer(SaveFile sav, TrainerProfile profile)
    {
        var oldName = sav.OT;
        var oldTid = sav.TID16;
        var oldSid = sav.SID16;

        sav.OT = profile.Name;
        sav.TID16 = profile.TrainerId;
        if (sav.Generation >= 3)
            sav.SID16 = profile.SecretId;
        if (sav.Generation >= 3 || sav.Version == GameVersion.C)
            sav.Gender = (byte)profile.Gender;

        int restamped = 0, shinyChanged = 0;
        foreach (var (slot, pk) in AllMons(sav).ToList())
        {
            if (pk.IsEgg || pk.OriginalTrainerName != oldName || pk.TID16 != oldTid)
                continue;
            if (sav.Generation >= 3 && pk.SID16 != oldSid)
                continue;

            var wasShiny = pk.IsShiny;
            pk.OriginalTrainerName = profile.Name;
            pk.TID16 = profile.TrainerId;
            if (sav.Generation >= 3)
                pk.SID16 = profile.SecretId;
            if (sav.Generation >= 3 || sav.Version == GameVersion.C)
                pk.OriginalTrainerGender = (byte)profile.Gender;
            pk.RefreshChecksum();
            if (pk.IsShiny != wasShiny)
                shinyChanged++;

            switch (slot)
            {
                case SlotRef.Party p: sav.SetPartySlotAtIndex(pk, p.Index, EntityImportSettings.None); break;
                case SlotRef.Box b: sav.SetBoxSlotAtIndex(pk, b.BoxIndex, b.Slot, EntityImportSettings.None); break;
            }
            restamped++;
        }
        return new TrainerApplyResult(restamped, shinyChanged);
    }

    public static string Describe(PKM pk)
    {
        var species = SpeciesName.GetSpeciesName(pk.Species, (int)LanguageID.English);
        var name = pk.IsNicknamed ? $"{pk.Nickname} ({species})" : species;
        var shiny = pk.IsShiny ? " ★" : "";
        var egg = pk.IsEgg ? " [egg]" : "";
        return $"{name} Lv{pk.CurrentLevel}{shiny}{egg}";
    }
}
