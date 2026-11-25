using System.Globalization;
using System.Security.Cryptography;
using System.Text.Json;
using PKHeX.Core;
using Row = System.Collections.Generic.Dictionary<string, object?>;

namespace Journeys.Server;

internal static class Vault
{
    internal const string Columns = "id, player_id, species, nickname, level, shiny, ot_name, origin_game, fingerprint, legal, hub_origin, removed, added, state, legality_issue";

    internal static Row Deposit(Db db, long playerId, string data, string journey)
    {
        PKM pk;
        try
        {
            var bytes = Convert.FromBase64String(data);
            pk = EntityFormat.GetFromBytes(bytes) ?? throw new ApiError("The Pokemon data could not be read.");
        }
        catch (Exception error) when (error is FormatException or ArgumentException or IndexOutOfRangeException)
        { throw new ApiError("The Pokemon data could not be read."); }
        if (pk.Species == 0) throw new ApiError("The Pokemon record is empty.");
        var legality = Journeys.Core.Legality.Check(pk);
        if (!legality.Legal) throw new ApiError(legality.Issue ?? "This Pokemon did not pass the legality check.");
        var fingerprint = Fingerprint(pk);
        if (db.Number("SELECT COUNT(*) FROM vault WHERE fingerprint = $fingerprint AND state IN ('stored','withdrawing')", ("fingerprint", fingerprint)) != 0)
            throw new ApiError(409, "This Pokémon is already in the Vault");
        db.Execute("""
            INSERT INTO vault (player_id, species, nickname, level, shiny, ot_name, origin_game, fingerprint, legal, hub_origin, data, removed, added, state, legality_issue)
            VALUES ($player, $species, $nickname, $level, $shiny, $ot, $game, $fingerprint, 1, NULL, $data, 0, $at, 'stored', NULL)
            """, ("player", playerId), ("species", SpeciesName.GetSpeciesNameGeneration(pk.Species, (int)LanguageID.English, pk.Format)),
            ("nickname", pk.Nickname), ("level", pk.CurrentLevel), ("shiny", pk.IsShiny), ("ot", pk.OriginalTrainerName),
            ("game", pk.Version.ToString()), ("fingerprint", fingerprint), ("data", data), ("at", Db.Now()));
        return db.Row("SELECT * FROM vault WHERE id = last_insert_rowid()")!;
    }

    internal static string Fingerprint(PKM pk)
    {
        // Length-delimited JSON values avoid ambiguous concatenation of trainer fields.
        var identity = JsonSerializer.SerializeToUtf8Bytes(new object?[]
        {
            pk is GBPKM gb ? (uint)gb.DV16 : pk.PID, pk.TID16, pk.SID16,
            pk.OriginalTrainerName, pk.OriginalTrainerGender, pk.MetDate?.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)
        });
        return Convert.ToHexString(SHA256.HashData(identity));
    }

    internal static Row Move(Db db, long playerId, long id, string from, string to, bool includeData)
    {
        var row = db.Row("SELECT * FROM vault WHERE id = $id AND player_id = $player AND removed = 0", ("id", id), ("player", playerId))
            ?? throw new ApiError(404, "Vault Pokemon not found.");
        var state = (string)row["state"]!;
        if (state != from && !(from == "withdrawing" && state == to))
            throw new ApiError(409, $"This Pokemon is {state}.");
        if (includeData && row["data"] is null) throw new ApiError("This Vault Pokemon has no entity data.");
        db.Execute("UPDATE vault SET state = $state WHERE id = $id", ("state", to), ("id", id));
        row["state"] = to;
        if (!includeData) row.Remove("data");
        return row;
    }
}
