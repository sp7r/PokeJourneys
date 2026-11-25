namespace Journeys.Core;

/// <summary>
/// An emulator the player installed. <see cref="Args"/> are passed one by one; <c>{rom}</c> and <c>{save}</c>
/// are replaced with the journey's paths.
/// </summary>
public sealed record EmulatorEntry(string Exe, List<string> Args);

/// <summary>What a journey is played on.</summary>
public enum JourneyKind
{
    /// <summary>An official release, such as Emerald or HeartGold.</summary>
    Official,

    /// <summary>A ROM hack built on an official game. Its save is supported when it keeps the base game's layout.</summary>
    RomHack,

    /// <summary>A fan game with its own engine and save format. Needs its own save adapter before Pokémon can move.</summary>
    FanGame,
}

/// <summary>
/// A journey: one game or region the player plays through with their trainer, using their own ROM, its save file,
/// and an emulator to run it.
/// </summary>
public sealed record JourneyEntry(
    string SavePath,
    string? RomPath = null,
    string? Emulator = null,
    string? Title = null,
    JourneyKind Kind = JourneyKind.Official);

/// <summary>The player's journeys and emulators, kept in <c>library.json</c>.</summary>
public sealed class JourneyLibrary
{
    public Dictionary<string, EmulatorEntry> Emulators { get; init; } = new(StringComparer.OrdinalIgnoreCase);
    public Dictionary<string, JourneyEntry> Journeys { get; init; } = new(StringComparer.OrdinalIgnoreCase);

    public static JourneyLibrary Load(JourneysPaths paths)
    {
        var lib = JsonFile.Read<JourneyLibrary>(paths.LibraryFile) ?? new JourneyLibrary();
        // Keep lookups case-insensitive after loading from JSON.
        return new JourneyLibrary
        {
            Emulators = new(lib.Emulators, StringComparer.OrdinalIgnoreCase),
            Journeys = new(lib.Journeys, StringComparer.OrdinalIgnoreCase),
        };
    }

    public void Save(JourneysPaths paths) => JsonFile.Write(paths.LibraryFile, this);

    public JourneyEntry Journey(string id) =>
        Journeys.TryGetValue(id, out var journey)
            ? journey
            : throw new JourneysException($"No journey called '{id}'. Add it with: journeys journey add {id} --save <path>");

    public EmulatorEntry EmulatorFor(string journeyId)
    {
        var journey = Journey(journeyId);
        if (journey.Emulator is null)
            throw new JourneysException($"'{journeyId}' has no emulator. Set one with: journeys journey add {journeyId} --save <path> --emulator <name>");
        return Emulators.TryGetValue(journey.Emulator, out var emu)
            ? emu
            : throw new JourneysException($"No emulator called '{journey.Emulator}'. Add it with: journeys emulator add {journey.Emulator} --exe <path>");
    }

    /// <summary>Journey ids become file and folder names, so keep them simple.</summary>
    public static string? IdProblem(string id) =>
        id.Length is > 0 and <= 32 && id.All(c => char.IsAsciiLetterOrDigit(c) || c is '-' or '_')
            ? null
            : "A journey id can use only letters, digits, '-' and '_' (up to 32 characters), like 'emerald' or 'hgss'.";
}
