using PKHeX.Core;

namespace Journeys.Core;

public static class DebugPokemon
{
    /// <summary>Creates a checked Gen 3 PC record without writing to the save.</summary>
    public static byte[] Create(SaveFile save, string gameCode, int species, int level)
    {
        if (species is < 1 or > 386 || level is < 1 or > 100)
            throw new JourneysException("Choose a Gen 3 Pokémon and a level from 1 to 100.");

        var version = save switch
        {
            SAV3FRLG when gameCode.StartsWith("BPR", StringComparison.Ordinal) => GameVersion.FR,
            SAV3FRLG when gameCode.StartsWith("BPG", StringComparison.Ordinal) => GameVersion.LG,
            SAV3E when gameCode.StartsWith("BPE", StringComparison.Ordinal) => GameVersion.E,
            SAV3RS when gameCode.StartsWith("AXV", StringComparison.Ordinal) => GameVersion.R,
            SAV3RS when gameCode.StartsWith("AXP", StringComparison.Ordinal) => GameVersion.S,
            _ => throw new JourneysException("The save and game must be from the same supported Gen 3 game family."),
        };

        GameVersion[] gba = [GameVersion.FR, GameVersion.LG, GameVersion.E, GameVersion.R, GameVersion.S];
        var origins = gba.Prepend(version).Distinct().ToArray();
        var template = new PK3 { Species = (ushort)species };
        var encounters = EncounterMovesetGenerator.GenerateEncounters(template, save, ReadOnlyMemory<ushort>.Empty, origins)
            .Where(encounter => !encounter.IsEgg && encounter.LevelMin <= level)
            .Distinct().OrderByDescending(encounter => encounter.Species == species);
        foreach (var encounter in encounters)
        {
            if (encounter.ConvertToPKM(save, EncounterCriteria.Unrestricted) is not PK3 pokemon || pokemon.IsEgg)
                continue;
            pokemon.Species = (ushort)species;
            pokemon.ClearNickname();
            pokemon.CurrentLevel = (byte)level;
            pokemon.RefreshAbility(pokemon.AbilityNumber >> 1);
            if (!new LegalityAnalysis(pokemon).Valid)
                continue;
            var record = new byte[pokemon.SIZE_STORED];
            pokemon.WriteEncryptedDataStored(record);
            return record;
        }
        throw new JourneysException("No valid Gen 3 encounter could produce that Pokémon at this level. Try another level or species.");
    }
}
