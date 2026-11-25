using System.Text.Json;
using System.Text.Json.Serialization;

namespace Journeys.Core;

/// <summary>
/// Every type Journeys stores as JSON. The serializer code is generated at build time, so it also works in the
/// ahead-of-time compiled Android build, where reflection-based JSON is unavailable.
/// </summary>
[JsonSourceGenerationOptions(
    WriteIndented = true,
    PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase,
    UseStringEnumConverter = true)]
[JsonSerializable(typeof(TrainerProfile))]
[JsonSerializable(typeof(JourneyLibrary))]
[JsonSerializable(typeof(List<VaultEntry>))]
[JsonSerializable(typeof(JourneySnapshot))]
[JsonSerializable(typeof(List<ushort>))]
[JsonSerializable(typeof(CollectionView))]
[JsonSerializable(typeof(EconomyData))]
[JsonSerializable(typeof(EconomyWallet))]
[JsonSerializable(typeof(List<VaultSummary>))]
[JsonSerializable(typeof(ShopView))]
[JsonSerializable(typeof(DomeRoster))]
public partial class JourneysJson : JsonSerializerContext;

/// <summary>Reads and writes Journeys' JSON files. Writes go to a temporary file first, so a crash never leaves half a file.</summary>
public static class JsonFile
{
    public static JsonSerializerOptions Options => JourneysJson.Default.Options;

    public static T? Read<T>(string path) where T : class
    {
        if (!File.Exists(path))
            return null;
        using var stream = File.OpenRead(path);
        return (T?)JsonSerializer.Deserialize(stream, typeof(T), JourneysJson.Default);
    }

    public static void Write<T>(string path, T value)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        var json = JsonSerializer.Serialize(value, typeof(T), JourneysJson.Default);
        FileOps.WriteAllTextAtomic(path, json);
    }
}

public static class FileOps
{
    public static void WriteAllBytesAtomic(string path, ReadOnlySpan<byte> data)
    {
        var tmp = path + ".journeys-tmp";
        File.WriteAllBytes(tmp, data.ToArray());
        File.Move(tmp, path, overwrite: true);
    }

    public static void WriteAllTextAtomic(string path, string text)
    {
        var tmp = path + ".journeys-tmp";
        File.WriteAllText(tmp, text);
        File.Move(tmp, path, overwrite: true);
    }
}

/// <summary>A problem the player can fix, with a message meant for them.</summary>
public sealed class JourneysException(string message) : Exception(message);
