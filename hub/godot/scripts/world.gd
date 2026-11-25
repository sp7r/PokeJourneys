extends Node3D
const NPC = preload("res://scripts/npc.gd")
const Sprites = preload("res://scripts/overworld_sprite.gd")
const ObjLoader = preload("res://scripts/obj_loader.gd")
const CHUNK := 32
const BODY_LOW := 0.2  # tiles above a model's base: parts between these heights block walking
const BODY_HIGH := 1.6
const SAMPLE_STEP := 0.25
var bounds := Rect2i(0, 0, 96, 96)  # replaced by the collision grid size on load
var layout := {}
var grid := {}
var cells := {}
var overrides := {}
var npcs := {}
var signs := {}
var doors := {}
var player_tile := Vector2i(-1, -1)

func read_json(path: String) -> Dictionary:
	if not FileAccess.file_exists(path): return {}
	var value = JSON.parse_string(FileAccess.get_file_as_string(path))
	return value if value is Dictionary else {}

func load_island(root: String) -> void:
	Sprites.data_root = root
	layout = read_json("res://data/victory_island.json")
	if layout.is_empty():
		push_warning("Missing res://data/victory_island.json; using an empty layout.")
	grid = read_json(root.path_join("victory_island/collision.json"))
	cells = read_json(root.path_join("victory_island/cells.json"))
	bounds = Rect2i(0, 0, int(grid.get("cols", 96)), int(grid.get("rows", 96)))
	var terrain := MeshInstance3D.new()
	terrain.mesh = ObjLoader.load_obj(root.path_join("victory_island/terrain/island.obj"))
	add_child(terrain)
	for entry in layout.get("buildings", []) + layout.get("props", []):
		_add_model(root, entry)
	for entry in layout.get("buildings", []):
		if entry.has("door"):
			var t := pair(entry.door)
			overrides[t] = "door"
			doors[t] = entry
	for entry in layout.get("signs", []):
		signs[Vector2i(int(entry.x), int(entry.y))] = entry
	for entry in layout.get("npcs", []):
		var npc := NPC.new()
		add_child(npc)
		npc.setup(self, entry)
		npcs[npc.tile] = npc

func pair(value: Array) -> Vector2i:
	return Vector2i(int(value[0]), int(value[1]))

func spawn_tile() -> Vector2i:
	var s: Dictionary = layout.get("spawn", {"x": 48, "y": 48})
	return Vector2i(int(s.x), int(s.y))

func behaviour(t: Vector2i) -> String:
	if not bounds.has_point(t): return "block"
	if overrides.has(t): return overrides[t]
	var rows: Array = grid.get("behaviour", [])
	if t.y >= rows.size() or t.x >= rows[t.y].size(): return "block"
	return str(rows[t.y][t.x])

func height(t: Vector2i) -> float:
	var rows: Array = cells.get("heights", [])
	if t.x < 0 or t.y < 0 or t.y >= rows.size() or t.x >= rows[t.y].size(): return 0.0
	return float(rows[t.y][t.x]) if rows[t.y][t.x] != null else 0.0

func tile_to_world(t: Vector2i) -> Vector3:
	return Vector3(t.x - 15.5, height(t) + (0.5 if behaviour(t) == "stairs" else 0.0), t.y - 15.5)

func is_occupied(t: Vector2i) -> bool:
	return npcs.has(t) or signs.has(t) or t == player_tile

func can_step(from: Vector2i, to: Vector2i, checking := false) -> bool:
	if absi(to.x - from.x) + absi(to.y - from.y) != 1: return false
	if npcs.has(to) or signs.has(to) or (not checking and to == player_tile): return false
	if behaviour(to) not in ["walk", "bridge", "stairs"]: return false
	return absf(height(to) - height(from)) <= 1.01 or behaviour(to) == "stairs" or behaviour(from) == "stairs"

func npc_at(t: Vector2i) -> Variant:
	return npcs.get(t)

func sign_at(t: Vector2i) -> Array:
	return signs[t].get("text", []) if signs.has(t) else []

func move_npc(npc: Node3D, to: Vector2i) -> void:
	npcs.erase(npc.tile)
	npc.tile = to
	npcs[to] = npc

func _add_model(root: String, entry: Dictionary) -> void:
	var model: String = entry.model
	var path := root.path_join("victory_island/models/%s/%s.glb" % [model, model])
	var node: Node3D
	if FileAccess.file_exists(path):
		var doc := GLTFDocument.new()
		var state := GLTFState.new()
		if doc.append_from_file(path, state, 0, path.get_base_dir()) == OK:
			node = doc.generate_scene(state)
	else:
		push_warning("Missing model: " + path)
	if node != null:
		add_child(node)
		node.scale = Vector3.ONE / 16.0
		node.position = Vector3(float(entry.x) - 16, float(entry.get("level", 0)), float(entry.y) - 16)
		node.rotation_degrees.y = float(entry.get("rot", 0))
		_treat_materials(node)
	if entry.get("block", true) is bool and entry.get("block", true) == false: return
	var rect = entry.get("block")
	if rect is Array and rect.size() == 4:
		for y in range(int(rect[1]), int(rect[3]) + 1):
			for x in range(int(rect[0]), int(rect[2]) + 1):
				overrides[Vector2i(x, y)] = "block"
	elif node != null:
		var base := float(entry.get("level", 0))
		for t in _body_tiles(node, base + BODY_LOW, base + BODY_HIGH):
			overrides[t] = "block"

## Tiles where the model has a surface at body height (between low and high, in tiles): walls, posts,
## counters. Floors, shadows and overhead parts (roofs, arches) are walked on or under.
func _body_tiles(node: Node, low: float, high: float, out: Dictionary = {}) -> Dictionary:
	if node is MeshInstance3D and node.mesh != null:
		var xf: Transform3D = node.global_transform
		for s in node.mesh.get_surface_count():
			var arrays: Array = node.mesh.surface_get_arrays(s)
			var verts: PackedVector3Array = arrays[Mesh.ARRAY_VERTEX]
			var index = arrays[Mesh.ARRAY_INDEX]
			var count: int = index.size() if index != null else verts.size()
			for i in range(0, count - 2, 3):
				var a: Vector3 = xf * verts[index[i] if index != null else i]
				var b: Vector3 = xf * verts[index[i + 1] if index != null else i + 1]
				var c: Vector3 = xf * verts[index[i + 2] if index != null else i + 2]
				if maxf(a.y, maxf(b.y, c.y)) < low or minf(a.y, minf(b.y, c.y)) > high:
					continue
				var n := maxi(1, ceili(maxf(a.distance_to(b), a.distance_to(c)) / SAMPLE_STEP))
				for u in n + 1:
					for v in n + 1 - u:
						var p: Vector3 = a + (b - a) * (float(u) / n) + (c - a) * (float(v) / n)
						if p.y >= low and p.y <= high:
							out[Vector2i(floori(p.x + 16.0), floori(p.z + 16.0))] = true
	for child in node.get_children():
		_body_tiles(child, low, high, out)
	return out

func _treat_materials(node: Node) -> void:
	if node is MeshInstance3D and node.mesh != null:
		for i in node.mesh.get_surface_count():
			var mat = node.get_active_material(i)
			if mat is BaseMaterial3D:
				mat = mat.duplicate()
				mat.texture_filter = BaseMaterial3D.TEXTURE_FILTER_NEAREST
				mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
				node.set_surface_override_material(i, mat)
	for child in node.get_children(): _treat_materials(child)

func check_reachable(start: Vector2i) -> Dictionary:
	var seen := {}
	var queue: Array[Vector2i] = []
	if behaviour(start) in ["walk", "bridge", "stairs"] and not npcs.has(start) and not signs.has(start):
		seen[start] = true
		queue.append(start)
	var index := 0
	while index < queue.size():
		var t := queue[index]
		index += 1
		for d in [Vector2i.UP, Vector2i.DOWN, Vector2i.LEFT, Vector2i.RIGHT]:
			var next: Vector2i = t + d
			if not seen.has(next) and can_step(t, next, true):
				seen[next] = true
				queue.append(next)
	var result := {"reachable": seen.size(), "doors": [], "npcs": [], "signs": []}
	for category in ["doors", "npcs", "signs"]:
		var entries: Array = layout.get("buildings" if category == "doors" else category, [])
		for entry in entries:
			if category == "doors" and not entry.has("door"): continue
			var target := pair(entry.door) if category == "doors" else Vector2i(int(entry.x), int(entry.y))
			var front := target + Vector2i.DOWN
			var reachable := false
			for d in [Vector2i.DOWN, Vector2i.UP, Vector2i.LEFT, Vector2i.RIGHT]:
				if category == "doors" and d != Vector2i.DOWN: continue
				if seen.has(target + d):
					front = target + d
					reachable = true
					break
			result[category].append({"id": entry.get("id", entry.get("name", "%s,%s" % [target.x, target.y])), "door": [target.x, target.y], "reachable": reachable, "front": [front.x, front.y]})
	return result
