using PKHeX.Core;

namespace Journeys.Core;

public sealed record JourneyFunds(int Money, Dictionary<string, int> Items);

/// <summary>Translates the shared bag to the legal item IDs and limits of a particular save.</summary>
internal sealed class JourneyBag(SaveFile save)
{
    internal sealed record Machine(int Item, int Move, int Limit);

    private static readonly GameStrings Strings = GameInfo.GetStrings("en");
    private static readonly GameVersion[] MachineVersions =
    [
        GameVersion.RD, GameVersion.C, GameVersion.R, GameVersion.E, GameVersion.FR,
        GameVersion.D, GameVersion.Pt, GameVersion.HG, GameVersion.B, GameVersion.B2,
        GameVersion.X, GameVersion.OR, GameVersion.SN, GameVersion.US,
    ];
    private static readonly Lazy<int[]> MachineMoves = new(() => MachineVersions
        .SelectMany(version => new JourneyBag(BlankSaveFile.Get(version, "Trainer", LanguageID.English)).Machines())
        .Select(item => item.Move).Distinct().OrderBy(MoveName, StringComparer.OrdinalIgnoreCase).ToArray());
    private static readonly Lazy<HashSet<string>> ItemKeys = new(() => MachineVersions
        .Select(version => new JourneyBag(BlankSaveFile.Get(version, "Trainer", LanguageID.English)))
        .SelectMany(game => game.SharedPouches.SelectMany(pocket => pocket.GetAllItems().ToArray())
            .Select(id => game.Name(id)).Where(game.IsShared).Select(Key)).ToHashSet(StringComparer.Ordinal));

    internal static bool IsItemKey(string key) => ItemKeys.Value.Contains(key);
    private static readonly Lazy<HashSet<string>> Gen1Portable = new(() =>
    {
        // Red/Blue/Yellow put key items and machines in the general pocket. Use the ordinary
        // item and Ball pockets in Crystal to identify equivalent portable items.
        var crystal = new SAV2(LanguageID.English, GameVersion.C);
        var names = Strings.GetItemStrings(crystal.Context, crystal.Version);
        var portable = new HashSet<string>();
        foreach (var pocket in crystal.Inventory.Pouches.Where(p => p.Type is InventoryType.Items or InventoryType.Balls))
        foreach (var id in pocket.GetAllItems())
            portable.Add(Key(names[id]));
        return portable;
    });
    private readonly string[] names = Strings.GetItemStrings(save.Context, save.Version);
    private readonly PlayerBag bag = save.Inventory;

    private IEnumerable<InventoryPouch> SharedPouches => bag.Pouches.Where(p => p.Type is
        InventoryType.Items or InventoryType.Medicine or InventoryType.Berries or InventoryType.Balls or
        InventoryType.BattleItems or InventoryType.Treasure or InventoryType.MailItems);

    private IEnumerable<InventoryPouch> MachinePouches => bag.Pouches.Where(p =>
        p.Type == InventoryType.TMHMs || save.Generation == 1 && p.Type == InventoryType.Items);

    private string Name(int index) => index > 0 && index < names.Length ? names[index] : "";

    public static string Key(string name) => name.Replace('é', 'e').Replace('É', 'E').ToLowerInvariant() switch
    {
        "parlyz heal" or "prz heal" => "paralyze heal",
        var key => key,
    };

    private bool IsShared(string name) => name.Length > 0 && (save.Generation != 1 || Gen1Portable.Value.Contains(Key(name)));

    private static bool IsMachine(string name, out int number)
    {
        number = 0;
        return name.StartsWith("TM", StringComparison.Ordinal) && int.TryParse(name.AsSpan(2), out number);
    }

    public JourneyFunds Read()
    {
        var items = new Dictionary<string, int>();
        foreach (var pocket in SharedPouches)
        foreach (var item in pocket.Items)
        {
            var name = Name(item.Index);
            if (IsShared(name) && item.Count > 0 && pocket.CanContain((ushort)item.Index))
            {
                var key = Key(name);
                items[key] = items.GetValueOrDefault(key) + item.Count;
            }
        }
        return new JourneyFunds((int)Math.Min(save.Money, (uint)save.MaxMoney), items);
    }

    public bool Apply(JourneyFunds funds, Dictionary<int, int> sharedMachines)
    {
        var targetMoney = (uint)Math.Clamp(funds.Money, 0, save.MaxMoney);
        var changed = save.Money != targetMoney;
        save.Money = targetMoney;
        var changedBag = false;
        var used = new Dictionary<string, int>();
        foreach (var pocket in SharedPouches)
        {
            // Keep the player's slot order for existing items. Use empty slots for newly added items.
            var ids = pocket.GetAllItems().ToArray();
            foreach (var slot in pocket.Items)
            {
                var name = Name(slot.Index);
                if (!IsShared(name) || !pocket.CanContain((ushort)slot.Index)) continue;
                var key = Key(name);
                var count = Math.Clamp(funds.Items.GetValueOrDefault(key) - used.GetValueOrDefault(key),
                    0, bag.GetMaxCount(pocket.Type, slot.Index));
                used[key] = used.GetValueOrDefault(key) + count;
                if (count == slot.Count) continue;
                if (count == 0) slot.Clear();
                else slot.Count = count;
                changedBag = true;
            }
            foreach (var id in ids)
            {
                var name = Name(id);
                if (!IsShared(name)) continue;
                var key = Key(name);
                if (used.GetValueOrDefault(key) != 0) continue;
                var count = Math.Clamp(funds.Items.GetValueOrDefault(key), 0, bag.GetMaxCount(pocket.Type, id));
                if (count == 0 || !bag.IsLegal(pocket.Type, id, count)) continue;
                var empty = pocket.FindIndexFirstEmptySlot();
                if (empty < 0) break;
                pocket.Items[empty].SetNewDetails(count);
                pocket.Items[empty].Index = id;
                pocket.Items[empty].Count = count;
                used[key] = used.GetValueOrDefault(key) + count;
                changedBag = true;
            }
        }

        changedBag |= ApplyMachines(sharedMachines);
        if (changedBag) bag.CopyTo(save);
        return changed || changedBag;
    }

    private bool ApplyMachines(Dictionary<int, int> shared)
    {
        var changed = false;
        var machines = Machines().ToDictionary(m => m.Item);
        var projected = new HashSet<int>();
        foreach (var pocket in MachinePouches)
        {
            foreach (var slot in pocket.Items)
            {
                if (!machines.TryGetValue(slot.Index, out var tm)) continue;
                var count = projected.Add(tm.Move) ? Math.Min(shared.GetValueOrDefault(tm.Move), tm.Limit) : 0;
                if (count == slot.Count) continue;
                if (count == 0) slot.Clear();
                else slot.Count = count;
                changed = true;
            }
            foreach (var id in pocket.GetAllItems().ToArray())
            {
                if (!machines.TryGetValue(id, out var tm) || projected.Contains(tm.Move)) continue;
                var count = Math.Min(shared.GetValueOrDefault(tm.Move), tm.Limit);
                if (count <= 0) continue;
                var empty = pocket.FindIndexFirstEmptySlot();
                if (empty < 0) break;
                var slot = pocket.Items[empty];
                slot.SetNewDetails(count);
                slot.Index = id;
                slot.Count = count;
                projected.Add(tm.Move);
                changed = true;
            }
        }
        return changed;
    }

    public Dictionary<int, int> ReadMachines()
    {
        var machines = Machines().ToDictionary(m => m.Item);
        var shared = new Dictionary<int, int>();
        foreach (var item in MachinePouches.SelectMany(p => p.Items))
        {
            if (item.Count <= 0 || !machines.TryGetValue(item.Index, out var tm)) continue;
            shared[tm.Move] = Math.Min(shared.GetValueOrDefault(tm.Move) + item.Count, tm.Limit);
        }
        return shared;
    }

    public static IReadOnlyList<int> Catalog() => MachineMoves.Value;
    public static string MoveName(int move) => Strings.Move[move];

    public IEnumerable<Machine> Machines()
    {
        foreach (var pocket in MachinePouches)
        foreach (var id in pocket.GetAllItems().ToArray())
        {
            var name = Name(id);
            if (!IsMachine(name, out var number)) continue;
            var move = MachineMove(number);
            if (move > 0 && bag.IsLegal(pocket.Type, id, 1))
            {
                // Reusable TMs are one entry per move in the game. Extra copies remain in the shared bag.
                var limit = save.Generation >= 5 ? 1 : bag.GetMaxCount(pocket.Type, id);
                yield return new Machine(id, move, limit);
            }
        }
    }

    private int MachineMove(int number)
    {
        var index = number - 1;
        if (index < 0) return 0;
        if (save.Generation is 1 or 2)
        {
            var list = save.Generation == 1 ? PersonalInfo1.MachineMoves : PersonalInfo2.MachineMoves;
            return index < list.Length ? list[index] : 0;
        }
        ReadOnlySpan<ushort> moves = save.Generation switch
        {
            3 => PersonalInfo3.MachineMovesTechnical,
            4 => PersonalInfo4.MachineMovesTechnical,
            5 => PersonalInfo5BW.MachineMoves,
            6 => save is SAV6AO ? LearnSource6AO.MachineMoves : LearnSource6XY.MachineMoves,
            7 => PersonalInfo7.MachineMoves,
            _ => [],
        };
        return index < moves.Length ? moves[index] : 0;
    }
}
