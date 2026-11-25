using PKHeX.Core;

namespace Journeys.Core;

/// <summary>
/// PKHeX's legality check: whether a Pokémon could have come from the real games. A Pokémon that fails may stay in
/// its own journey, but can't enter shared spaces (the vault, moves between journeys, trades and ranked battles), so
/// a cheated or edited save can't be used to bring exploits to other players.
/// </summary>
public static class Legality
{
    public sealed record Result(bool Legal, string? Issue);

    public static Result Check(PKM pk)
    {
        if (pk.Species == 0)
            return new Result(true, null);
        try
        {
            var la = new LegalityAnalysis(pk);
            if (la.Valid)
                return new Result(true, null);
            // The report's first line that names a problem, without PKHeX's "Invalid:" prefix.
            var issue = la.Report()
                .Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                .FirstOrDefault(l => l.StartsWith("Invalid", StringComparison.OrdinalIgnoreCase))
                ?? la.Report().Trim();
            var colon = issue.IndexOf(':');
            if (colon >= 0 && colon < 12)
                issue = issue[(colon + 1)..].Trim();
            return new Result(false, issue);
        }
        catch (Exception ex)
        {
            return new Result(false, $"The legality check couldn't read this Pokémon ({ex.GetType().Name}).");
        }
    }

    /// <summary>Throws with the reason when <paramref name="pk"/> fails the check.</summary>
    public static void Require(PKM pk, string what)
    {
        var result = Check(pk);
        if (!result.Legal)
            throw new JourneysException($"{SaveBridge.Describe(pk)} didn't pass the legality check, so it can't {what}: {result.Issue}");
    }
}
