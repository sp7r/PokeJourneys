using System.Text.Json;

namespace Journeys.Server;

/// <summary>
/// What bot players know about Victory Island: the hub's layout.json (doorways, interiors and their clerks, the
/// captains) and, when --hub-walk points at the hub build's walk.json, which tiles can be walked, so bots follow
/// real paths. Without walk.json the bots wander without a map.
/// </summary>
sealed class BotWorld
{
    public sealed record Place(string Name, string Building, (int X, int Y) Door, string? Room, (int X, int Y) Stand, string StandFacing, string? Role);
    public sealed record Npc(string Name, (int X, int Y) Stand, string Facing, string? Role);
    public sealed record LinePlace((int X, int Y) Front, (int X, int Y) Behind, string Facing);

    private static readonly (int X, int Y)[] Steps = [(0, -1), (0, 1), (-1, 0), (1, 0)]; // up, down, left, right: walk.json's bit order
    private static readonly string[] StepFacing = ["up", "down", "left", "right"];
    private int cols, rows;
    private int[][]? connections;
    private readonly HashSet<(int, int)> blocked = [];
    private readonly List<(int X, int Y)> walkable = [];

    public (int X, int Y) Spawn { get; } = (47, 63);
    public IReadOnlyList<Place> Places { get; } = [];
    public IReadOnlyList<Npc> People { get; } = [];
    public bool HasMap => connections is not null;
    // layout.json's "botHangouts": where AFK bots gather (around the spawn, on the docks) and the boardwalk line.
    public IReadOnlyList<(int X, int Y)> SpawnArea { get; private set; } = [];
    public IReadOnlyList<(int X, int Y)> Docks { get; private set; } = [];
    public IReadOnlyList<LinePlace> Lineup { get; private set; } = [];
    private JsonElement hangouts;

    public BotWorld(string? layoutPath, string? walkPath)
    {
        if (layoutPath is not null && File.Exists(layoutPath))
        {
            using var layout = JsonDocument.Parse(File.ReadAllText(layoutPath));
            var root = layout.RootElement;
            if (root.TryGetProperty("spawn", out var spawn)) Spawn = Tile(spawn);
            var interiors = root.TryGetProperty("interiors", out var list) ? list.EnumerateArray().ToList() : [];
            var places = new List<Place>();
            foreach (var door in root.TryGetProperty("doorways", out var doors) ? doors.EnumerateArray().ToList() : [])
            {
                var name = door.GetProperty("name").GetString()!;
                var inside = interiors.FirstOrDefault(i => i.GetProperty("door").GetString() == name);
                string? room = inside.ValueKind == JsonValueKind.Object && inside.TryGetProperty("room", out var r) ? Clean(r.GetString()!) : null;
                var clerk = inside.ValueKind == JsonValueKind.Object && inside.TryGetProperty("npcs", out var npcs) ? npcs.EnumerateArray().FirstOrDefault() : default;
                var (stand, facing) = clerk.ValueKind == JsonValueKind.Object ? Front(clerk) : ((3, 6), "up");
                var role = clerk.ValueKind == JsonValueKind.Object && clerk.TryGetProperty("role", out var ro) ? ro.GetString() : null;
                places.Add(new Place(name, door.GetProperty("building").GetString()!, Tile(door.GetProperty("tile")), room, stand, facing, role));
            }
            Places = places;
            var people = new List<Npc>();
            foreach (var npc in root.TryGetProperty("npcs", out var island) ? island.EnumerateArray().ToList() : [])
            {
                var tile = Tile(npc.GetProperty("tile"));
                blocked.Add(tile);
                if (npc.TryGetProperty("blocks", out var more)) foreach (var b in more.EnumerateArray()) blocked.Add(Tile(b));
                var (stand, facing) = Front(npc);
                people.Add(new Npc(npc.GetProperty("name").GetString()!, stand, facing, npc.TryGetProperty("role", out var ro) ? ro.GetString() : null));
            }
            People = people;
            if (root.TryGetProperty("botHangouts", out var spots)) hangouts = spots.Clone();
        }
        try { ReadWalk(walkPath); }
        finally { ReadHangouts(); }
    }

    private void ReadWalk(string? walkPath)
    {
        if (walkPath is null || !File.Exists(walkPath)) return;
        using var walk = JsonDocument.Parse(File.ReadAllText(walkPath));
        cols = walk.RootElement.GetProperty("cols").GetInt32();
        rows = walk.RootElement.GetProperty("rows").GetInt32();
        connections = walk.RootElement.GetProperty("connections").EnumerateArray().Select(row => row.EnumerateArray().Select(c => c.GetInt32()).ToArray()).ToArray();
        // Only tiles reachable from the spawn, so a bot never starts on a ledge it can't leave.
        foreach (var tile in Reach(Spawn)) walkable.Add(tile);
    }

    private void ReadHangouts()
    {
        if (hangouts.ValueKind != JsonValueKind.Object) return;
        var reachable = walkable.ToHashSet();
        var fronts = People.Select(p => p.Stand).ToHashSet();
        bool Free((int X, int Y) tile) => !blocked.Contains(tile) && !fronts.Contains(tile) && (reachable.Count == 0 || reachable.Contains(tile));
        List<(int X, int Y)> Area(string key)
        {
            if (!hangouts.TryGetProperty(key, out var box) || box.GetArrayLength() != 4) return [];
            var (x0, y0, x1, y1) = (box[0].GetInt32(), box[1].GetInt32(), box[2].GetInt32(), box[3].GetInt32());
            var tiles = new List<(int X, int Y)>();
            for (var y = y0; y <= y1; y++) for (var x = x0; x <= x1; x++) if (Free((x, y))) tiles.Add((x, y));
            return tiles;
        }
        SpawnArea = Area("spawn");
        Docks = Area("docks");
        if (!hangouts.TryGetProperty("lineup", out var line)) return;
        (int X, int Y) from = Tile(line.GetProperty("from"));
        (int X, int Y) to = Tile(line.GetProperty("to"));
        var spacing = line.TryGetProperty("spacing", out var gap) ? Math.Max(1, gap.GetInt32()) : 2;
        var facing = line.TryGetProperty("facing", out var f) ? f.GetString()! : "down";
        var (dx, dy) = Steps[Math.Max(0, Array.IndexOf(StepFacing, facing))];
        var places = new List<LinePlace>();
        var along = (Math.Sign(to.X - from.X), Math.Sign(to.Y - from.Y));
        for (var tile = from; ; tile = (tile.X + along.Item1 * spacing, tile.Y + along.Item2 * spacing))
        {
            var behind = (tile.X - dx, tile.Y - dy);
            if (Free(tile) && Free(behind)) places.Add(new LinePlace(tile, behind, facing));
            if (Math.Abs(to.X - tile.X) + Math.Abs(to.Y - tile.Y) < spacing || along == (0, 0)) break;
        }
        Lineup = places;
    }

    private static string Clean(string room) => new(room.ToLowerInvariant().Select(c => char.IsAsciiLetterOrDigit(c) || c is '_' or '-' ? c : '-').Take(32).ToArray());
    private static (int, int) Tile(JsonElement pair) => (pair[0].GetInt32(), pair[1].GetInt32());

    // The tile in front of someone and the way a visitor faces them there.
    private static ((int, int), string) Front(JsonElement npc)
    {
        var (x, y) = Tile(npc.GetProperty("tile"));
        var facing = npc.TryGetProperty("facing", out var f) ? f.GetString() : "down";
        var index = Math.Max(0, Array.IndexOf(StepFacing, facing));
        var (dx, dy) = Steps[index];
        return ((x + dx, y + dy), StepFacing[index ^ 1]);
    }

    public (int X, int Y) RandomTile(Random random) =>
        walkable.Count > 0 ? walkable[random.Next(walkable.Count)] : (random.Next(20, 100), random.Next(20, 80));

    private bool CanStep((int X, int Y) from, int direction, out (int X, int Y) to)
    {
        to = (from.X + Steps[direction].X, from.Y + Steps[direction].Y);
        return connections is not null && from.X >= 0 && from.Y >= 0 && from.X < cols && from.Y < rows &&
            to.X >= 0 && to.Y >= 0 && to.X < cols && to.Y < rows && (connections[from.Y][from.X] & (1 << direction)) != 0 && !blocked.Contains(to);
    }

    private IEnumerable<(int X, int Y)> Reach((int X, int Y) start)
    {
        var seen = new HashSet<(int, int)> { start };
        var queue = new Queue<(int X, int Y)>([start]);
        while (queue.TryDequeue(out var tile))
        {
            yield return tile;
            for (var d = 0; d < 4; d++)
                if (CanStep(tile, d, out var next) && seen.Add(next)) queue.Enqueue(next);
        }
    }

    /// The steps from one tile to another as (tile, facing), shortest first; empty when there's no way there.
    /// Without a map it walks straight, one axis at a time.
    public List<((int X, int Y) Tile, string Facing)> Path((int X, int Y) from, (int X, int Y) to)
    {
        var path = new List<((int, int), string)>();
        if (connections is null)
        {
            var (x, y) = from;
            while ((x, y) != to)
            {
                var d = x != to.X ? (to.X > x ? 3 : 2) : (to.Y > y ? 1 : 0);
                (x, y) = (x + Steps[d].X, y + Steps[d].Y);
                path.Add(((x, y), StepFacing[d]));
            }
            return path;
        }
        var previous = new Dictionary<(int, int), ((int, int) From, int Direction)>();
        var queue = new Queue<(int X, int Y)>([from]);
        var seen = new HashSet<(int, int)> { from };
        while (queue.TryDequeue(out var tile))
        {
            if (tile == to) break;
            for (var d = 0; d < 4; d++)
                if (CanStep(tile, d, out var next) && seen.Add(next))
                {
                    previous[next] = (tile, d);
                    queue.Enqueue(next);
                }
        }
        if (!previous.ContainsKey(to)) return path;
        for (var at = to; at != from; at = previous[at].From) path.Add((at, StepFacing[previous[at].Direction]));
        path.Reverse();
        return path;
    }
}
