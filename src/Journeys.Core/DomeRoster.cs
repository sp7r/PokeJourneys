using PKHeX.Core;

namespace Journeys.Core;

public sealed record DomeMon(string Id, string Name, ushort Species, string SpeciesName, bool Shiny, bool Female, string Sprite,
    byte Level, string Set, string Problem);
public sealed record DomeRoster(List<DomeMon> Pokemon);

/// <summary>Read-only battle projections. Neither the Vault Pokémon nor journey saves are edited.</summary>
public static class DomeTeams
{
    public static DomeRoster Read(JourneysPaths paths)
    {
        var vault = Vault.Open(paths);
        var mons = new List<DomeMon>();
        foreach (var entry in vault.Entries)
        {
            try
            {
                var original = vault.LoadMon(entry);
                if (original.IsEgg) throw new JourneysException("Eggs cannot battle.");
                if (original.Species is 0 or > (ushort)Species.Zeraora || original.Format > 7)
                    throw new JourneysException("Choose a Pokémon from a Gen 1–7 journey.");
                Legality.Require(original, "battle at the Battle Dome");
                var projected = Project(original);
                var species = (Species)projected.Species;
                var sprite = species switch
                {
                    Species.NidoranF => "NIDORANfE",
                    Species.NidoranM => "NIDORANmA",
                    Species.Flabébé => "FLABEBE",
                    _ => species.ToString().ToUpperInvariant(),
                };
                mons.Add(new DomeMon(entry.Id, projected.Nickname, projected.Species,
                    SpeciesName.GetSpeciesName(projected.Species, (int)LanguageID.English), projected.IsShiny,
                    projected.Gender == 1, sprite, original.CurrentLevel, new ShowdownSet(projected).Text, ""));
            }
            catch (Exception error) when (error is JourneysException or ArgumentException or IOException or InvalidOperationException)
            {
                mons.Add(new DomeMon(entry.Id, entry.Summary, entry.Species,
                    SpeciesName.GetSpeciesName(entry.Species, (int)LanguageID.English), false, false, "", 0, "", error.Message));
            }
        }
        return new DomeRoster(mons);
    }

    public static PKM Project(PKM original)
    {
        var copy = original.Clone();
        if (copy is PK7) return copy;
        var converted = EntityConverter.ConvertToType(copy, typeof(PK7), out _);
        return converted ?? throw new JourneysException("This Pokémon cannot be prepared for Gen 7 battles.");
    }
}
