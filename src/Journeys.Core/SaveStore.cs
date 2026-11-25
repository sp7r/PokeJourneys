using PKHeX.Core;

namespace Journeys.Core;

/// <summary>Where game saves are read from and written to.</summary>
public interface ISaveStore
{
    SaveFile Load(string journeyId);

    /// <summary>Writes the save. The real store backs up the old file first.</summary>
    void Write(string journeyId, SaveFile sav, string reason);
}

/// <summary>The player's real save files, as listed in the journey library. Every write backs up the old save first.</summary>
public sealed class DiskSaveStore(JourneysPaths paths, JourneyLibrary library) : ISaveStore
{
    public SaveFile Load(string journeyId)
    {
        var journey = library.Journey(journeyId);
        if (journey.Kind == JourneyKind.FanGame)
            throw new JourneysException($"'{journeyId}' is a fan game. Its save format isn't supported yet, so Pokémon can't move in or out of it.");
        return SaveBridge.Load(journey.SavePath);
    }

    public void Write(string journeyId, SaveFile sav, string reason)
    {
        var path = library.Journey(journeyId).SavePath;
        SaveBridge.Backup(paths, journeyId, path, reason);
        SaveBridge.Write(sav, path);
    }
}
