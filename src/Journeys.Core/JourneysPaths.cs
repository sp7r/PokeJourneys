namespace Journeys.Core;

/// <summary>
/// Where Journeys keeps the player's data. Everything lives under one root folder:
/// <code>
/// profile.json        the player's trainer
/// library.json        journeys and emulators
/// vault/index.json    Pokémon stored outside every journey
/// vault/mons/         one file per stored Pokémon
/// snapshots/&lt;journey&gt;.json  every Pokémon in that journey's save when it was last read
/// dex.json            every species the player has ever had, across all journeys
/// backups/&lt;journey&gt;/   a copy of a save from before each launch and each edit
/// locks/&lt;journey&gt;.lock present while its game is running
/// </code>
/// </summary>
public sealed class JourneysPaths
{
    public JourneysPaths(string root)
    {
        Root = Path.GetFullPath(root);
        Directory.CreateDirectory(Root);
    }

    /// <summary>The root from <c>JOURNEYS_DATA</c>, or the user's local app data folder.</summary>
    public static JourneysPaths Default()
    {
        var env = Environment.GetEnvironmentVariable("JOURNEYS_DATA");
        if (!string.IsNullOrWhiteSpace(env))
            return new JourneysPaths(env);
        var local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        return new JourneysPaths(Path.Combine(local, "PokeJourneys"));
    }

    public string Root { get; }
    public string ProfileFile => Path.Combine(Root, "profile.json");
    public string LibraryFile => Path.Combine(Root, "library.json");
    public string VaultDir => Path.Combine(Root, "vault");
    public string VaultIndexFile => Path.Combine(VaultDir, "index.json");
    public string VaultMonsDir => Path.Combine(VaultDir, "mons");
    public string BackupsDir => Path.Combine(Root, "backups");
    public string LocksDir => Path.Combine(Root, "locks");
    public string SnapshotsDir => Path.Combine(Root, "snapshots");
    public string DexFile => Path.Combine(Root, "dex.json");

    public string SnapshotFileFor(string journeyId) => Path.Combine(SnapshotsDir, journeyId + ".json");

    public string BackupDirFor(string journeyId) => Path.Combine(BackupsDir, journeyId);
    public string LockFileFor(string journeyId) => Path.Combine(LocksDir, journeyId + ".lock");
}
