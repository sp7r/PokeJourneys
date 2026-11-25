using System.Text.RegularExpressions;

namespace Journeys.Core;

public enum TrainerGender { Male = 0, Female = 1 }

/// <summary>
/// The one trainer the player uses in every game. Its name and IDs are written into each game's save, so every
/// Pokémon the player catches anywhere has the same Original Trainer. Later games then treat those Pokémon as the
/// player's own instead of traded ones (traded Pokémon can disobey without enough badges).
/// </summary>
public sealed record TrainerProfile(string Name, TrainerGender Gender, ushort TrainerId, ushort SecretId)
{
    /// <summary>
    /// Gen 1–5 allow at most 7 characters, and Gen 1–2 have a small character set. A name that fits the oldest
    /// game fits every game.
    /// </summary>
    public const int MaxNameLength = 7;

    private static readonly Regex NamePattern = new("^[A-Za-z0-9]+$", RegexOptions.Compiled);

    /// <summary>Why <paramref name="name"/> can't be a trainer name, or null if it can.</summary>
    public static string? NameProblem(string name)
    {
        if (string.IsNullOrEmpty(name))
            return "The trainer name can't be empty.";
        if (name.Length > MaxNameLength)
            return $"The trainer name can be at most {MaxNameLength} characters, so it fits the Gen 1 games.";
        if (!NamePattern.IsMatch(name))
            return "The trainer name can use only letters A-Z and digits 0-9, so every game can show it.";
        return null;
    }

    public static TrainerProfile Create(string name, TrainerGender gender, ushort? trainerId = null, ushort? secretId = null)
    {
        if (NameProblem(name) is { } problem)
            throw new JourneysException(problem);
        return new TrainerProfile(
            name,
            gender,
            trainerId ?? (ushort)Random.Shared.Next(0, 65536),
            secretId ?? (ushort)Random.Shared.Next(0, 65536));
    }

    public static TrainerProfile? Load(JourneysPaths paths) => JsonFile.Read<TrainerProfile>(paths.ProfileFile);

    public static TrainerProfile LoadRequired(JourneysPaths paths) =>
        Load(paths) ?? throw new JourneysException("No trainer yet. Create one with: journeys profile create <name>");

    public void Save(JourneysPaths paths) => JsonFile.Write(paths.ProfileFile, this);
}
