using System.Diagnostics;

namespace Journeys.Core;

/// <summary>
/// Marks a game as running. A game writes its save whenever the player saves in it, so Journeys must never edit a
/// save while its game is open: either side would overwrite the other's changes, and a Pokémon could be lost or
/// copied. Every save edit checks <see cref="EnsureClosed"/> first.
/// </summary>
public static class GameLock
{
    public static void Acquire(JourneysPaths paths, string journeyId, int processId)
    {
        Directory.CreateDirectory(paths.LocksDir);
        File.WriteAllText(paths.LockFileFor(journeyId), processId.ToString());
    }

    public static void Release(JourneysPaths paths, string journeyId)
    {
        var file = paths.LockFileFor(journeyId);
        if (File.Exists(file))
            File.Delete(file);
    }

    /// <summary>True while the process that opened the game is still running. A lock left by a crash is cleared.</summary>
    public static bool IsRunning(JourneysPaths paths, string journeyId)
    {
        var file = paths.LockFileFor(journeyId);
        if (!File.Exists(file))
            return false;
        if (int.TryParse(File.ReadAllText(file).Trim(), out var pid) && IsAlive(pid))
            return true;
        File.Delete(file);
        return false;
    }

    public static void EnsureClosed(JourneysPaths paths, string journeyId)
    {
        if (IsRunning(paths, journeyId))
            throw new JourneysException($"'{journeyId}' is running. Save in the game and close the emulator first.");
    }

    private static bool IsAlive(int pid)
    {
        try
        {
            using var process = Process.GetProcessById(pid);
            return !process.HasExited;
        }
        catch (ArgumentException)
        {
            return false; // no process with that id
        }
    }
}
