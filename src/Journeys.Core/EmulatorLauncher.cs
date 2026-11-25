using System.Diagnostics;

namespace Journeys.Core;

/// <summary>
/// Starts a game in the player's emulator and keeps its save safe around the session: a backup before the game
/// opens, a lock so nothing edits the save while it runs, and a check of the save once the game closes.
/// </summary>
public static class EmulatorLauncher
{
    public sealed record SessionResult(int ExitCode, string? BackupPath, bool SaveExists, bool TrainerMatches);

    public static ProcessStartInfo BuildStartInfo(EmulatorEntry emulator, JourneyEntry game)
    {
        if (!File.Exists(emulator.Exe))
            throw new JourneysException($"Can't find the emulator at {emulator.Exe}.");
        if (game.RomPath is null || !File.Exists(game.RomPath))
            throw new JourneysException($"Can't find the ROM at {game.RomPath ?? "(none set)"}. Add the path to your own copy with --rom.");

        var info = new ProcessStartInfo(emulator.Exe)
        {
            UseShellExecute = false,
            WorkingDirectory = Path.GetDirectoryName(emulator.Exe)!,
        };
        foreach (var arg in emulator.Args)
            info.ArgumentList.Add(arg.Replace("{rom}", game.RomPath).Replace("{save}", game.SavePath));
        return info;
    }

    /// <summary>Runs the game and waits for the player to close it.</summary>
    public static SessionResult Play(JourneysPaths paths, JourneyLibrary library, string journeyId, Action<string> log)
    {
        var game = library.Journey(journeyId);
        var emulator = library.EmulatorFor(journeyId);
        GameLock.EnsureClosed(paths, journeyId);
        var info = BuildStartInfo(emulator, game);

        var backup = SaveBridge.Backup(paths, journeyId, game.SavePath, "before-play");
        log(backup is null ? "No save yet: this will be a new game." : $"Backed up the save to {backup}");

        using var process = Process.Start(info) ?? throw new JourneysException("The emulator didn't start.");
        GameLock.Acquire(paths, journeyId, process.Id);
        log($"Playing {game.Title ?? journeyId}. Journeys won't touch this save until the emulator closes.");
        try
        {
            process.WaitForExit();
        }
        finally
        {
            GameLock.Release(paths, journeyId);
        }

        var saveExists = File.Exists(game.SavePath);
        var matches = false;
        if (saveExists)
        {
            var sav = SaveBridge.Load(game.SavePath);
            var profile = TrainerProfile.Load(paths);
            matches = profile is not null && SaveBridge.HasTrainer(sav, profile);
            log($"Save: {sav.OT}, {sav.PartyCount} in party, played {sav.PlayTimeString}.");
            if (Collection.TryTake(paths, new DiskSaveStore(paths, library), journeyId) is { } snapshot)
                log($"Recorded {snapshot.Mons.Count} Pokémon from this journey.");
            if (profile is not null && !matches)
                log($"This save's trainer isn't {profile.Name} yet. Run: journeys trainer apply {journeyId}");
        }
        else
        {
            log($"The game didn't write a save at {game.SavePath}. Check the path if you saved in the game.");
        }
        return new SessionResult(process.ExitCode, backup, saveExists, matches);
    }
}
