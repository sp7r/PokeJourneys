extends Node
## Data-driven door warps. Rooms share the island's grid, mesh loader and player.
const Island = preload("res://scripts/island.gd")
var host: Node3D
var island: Node3D
var root: String
var args: Dictionary
var rooms := {}
var active := ""
var return_tile := Vector2i.ZERO
var busy := false
var fade := ColorRect.new()
var environment: Environment
var sky: Color
var reported := {}

func setup(main: Node3D, data: String, flags: Dictionary) -> void:
	host = main
	island = main.world
	return_tile = island.spawn_tile()
	root = data
	args = flags
	host.player.step_attempted.connect(_enter)
	host.player.stepped.connect(_stepped)
	environment = host.get_node("WorldEnvironment").environment
	sky = environment.background_color
	var layer := CanvasLayer.new()
	layer.layer = 100
	add_child(layer)
	fade.color = Color(0, 0, 0, 0)
	fade.mouse_filter = Control.MOUSE_FILTER_IGNORE
	fade.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	layer.add_child(fade)
	if flags.has("check"): return
	if flags.has("room"):
		var name: String = flags.room
		if not _load(name):
			printerr("Room unavailable: ", name)
			host.get_tree().quit(1)
			return
		for entry in island.layout.get("interiors", []):
			if entry.room == name: return_tile = _door(entry.door) + Vector2i.DOWN
		_show(name)
		host.player.face(-Island.pair(rooms[name].info.get("exitFacing", [0, 1])))
		_prepare_island.call_deferred()

func _prepare_island() -> void:
	# With --room, the normal startup populates the active room instead of the island.
	island.spawn_npcs()
	var sprite: Node3D = host.player.get_child(0)
	for npc in island.npcs.values():
		npc.sprite.position = sprite.position
		npc.sprite.scale = sprite.scale

func _door(name: String) -> Vector2i:
	for door in island.layout.doorways:
		if door.name == name: return Island.pair(door.tile)
	return Vector2i(-1, -1)

func _line(key: String, text: String) -> void:
	if reported.has(key): return
	reported[key] = true
	print(text)

func _load(name: String, meshes: bool = true) -> bool:
	if rooms.has(name): return true
	if name.is_empty() or name.get_file() != name or name in [".", ".."]: return false
	var folder := root.path_join("interiors").path_join(name)
	if not FileAccess.file_exists(folder.path_join("room.json")): return false
	var info = JSON.parse_string(FileAccess.get_file_as_string(folder.path_join("room.json")))
	if not info is Dictionary or not info.has_all(["entry", "exits", "size", "meshes"]): return false
	var world := Island.new()
	add_child(world)
	if not world.load_room(folder, info, meshes):
		world.queue_free()
		return false
	world.visible = false
	rooms[name] = {"world": world, "info": info}
	return true

func check(result: Dictionary) -> bool:
	result.interiors = []
	var valid := true
	var entries: Array = island.layout.get("interiors", []).duplicate()
	for name in DirAccess.get_directories_at(root.path_join("interiors")):
		if not entries.any(func(e): return e.room == name): entries.append({"door": "", "room": name})
	for entry in entries:
		var available := _load(entry.room, false)
		var exits: Array = []
		if available:
			var world = rooms[entry.room].world
			var original: Array = world.layout.exits
			world.layout.exits = original.duplicate()
			for link in rooms[entry.room].info.get("links", []):
				world.layout.exits.append(link.tile)
			exits = world.check_reachable().exits
			world.layout.exits = original
		var reachable := available and not exits.is_empty() and exits.all(func(e): return e.reachable)
		if available:
			for link in rooms[entry.room].info.get("links", []):
				if not _load(link.room, false):
					reachable = false
				elif rooms[link.room].world.behaviour(Island.pair(link.arrival)) not in ["walk", "bridge", "stairs"]:
					reachable = false
		result.interiors.append({"door": entry.door, "room": entry.room, "available": available, "reachable": reachable, "exits": exits})
		if not reachable: valid = false
	return valid

func _show(name: String) -> void:
	active = name
	island.visible = name.is_empty()
	island.process_mode = Node.PROCESS_MODE_INHERIT if name.is_empty() else Node.PROCESS_MODE_DISABLED
	for key in rooms: rooms[key].world.visible = key == name
	if not name.is_empty(): _spawn_npcs.call_deferred(name)
	host.world = island if name.is_empty() else rooms[name].world
	host.player.world = host.world
	environment.background_color = sky if name.is_empty() else Color.BLACK
	if host.music: host.music.room(name)

## A room's NPCs: "npcs" in its layout.json "interiors" entry, written like the island's, in the
## room's own tiles. Placed the first time the room shows, once the sprite data folder is known.
func _spawn_npcs(name: String) -> void:
	var room: Dictionary = rooms[name]
	if room.has("npcs"): return
	room.npcs = true
	for entry in island.layout.get("interiors", []):
		if entry.room == name: room.world.layout.npcs = entry.get("npcs", [])
	room.world.spawn_npcs()
	var sprite: Node3D = host.player.get_child(0)
	for npc in room.world.npcs.values():
		npc.sprite.position = sprite.position
		npc.sprite.scale = sprite.scale

## A room's `mirror` tiles (room.json): facing one and pressing A opens the character creator.
## Interiors is main's last child, so it sees the press before main's own interact handling.
func _unhandled_input(event: InputEvent) -> void:
	if active.is_empty() or busy or not event.is_action_pressed("interact"): return
	if host.player.locked or host.player.moving or host.message.is_open(): return
	var target: Vector2i = host.player.tile + host.player.facing
	for tile in rooms[active].info.get("mirror", []):
		if target == Island.pair(tile):
			get_viewport().set_input_as_handled()
			host._open_creator()
			return

func _stepped(tile: Vector2i, _behaviour: String) -> void:
	if busy or active.is_empty() or _link(tile): return
	if host.player.facing == Island.pair(rooms[active].info.get("exitFacing", [0, 1])):
		for exit in rooms[active].info.exits:
			if tile == Island.pair(exit): _warp("")

func _link(tile: Vector2i) -> bool:
	for link in rooms[active].info.get("links", []):
		if tile != Island.pair(link.tile): continue
		if link.has("direction") and host.player.facing != Island.pair(link.direction): continue
		if not _load(link.room):
			_line(link.room, "Interior missing for stair: " + link.room)
			return true
		_warp(link.room, link.arrival, link.facing)
		return true
	return false

## A north press can enter a doorway from its marker or the tile immediately south.
func _enter(target: Vector2i) -> void:
	if busy or not active.is_empty() or host.player.facing != Vector2i.UP: return
	for door in island.layout.doorways:
		var tile := Island.pair(door.tile)
		if target != tile and host.player.tile != tile: continue
		for entry in island.layout.get("interiors", []):
			if entry.door != door.name: continue
			if not _load(entry.room):
				_line(door.name, "Interior missing for " + door.name + ": " + entry.room)
				return
			return_tile = tile + Vector2i.DOWN
			_warp(entry.room)
			return
		_line(door.name, "No interior for " + door.name)

func _warp(name: String, arrival: Array = [], facing: Array = []) -> void:
	if busy: return
	busy = true
	host.player.locked = true
	await create_tween().tween_property(fade, "color:a", 1.0, 0.25).finished
	_show(name)
	host.player.place(Island.pair(arrival) if not arrival.is_empty() else (return_tile if name.is_empty() else host.world.spawn_tile()))
	host.player.face(Island.pair(facing) if not facing.is_empty() else (Vector2i.DOWN if name.is_empty() else -Island.pair(rooms[name].info.get("exitFacing", [0, 1]))))
	host._follow(1.0)
	print("interior: ", "island" if name.is_empty() else name, " player tile ", host.player.tile, " facing ", host.player.facing)
	await create_tween().tween_property(fade, "color:a", 0.0, 0.25).finished
	host.player.locked = false
	busy = false
