extends Node3D
## Grid connections and surface heights sampled from the DS Map Studio export.
const ObjLoader = preload("res://scripts/obj_loader.gd")
const ORIGIN := Vector2(15.5, 15.5)
const DIRECTIONS := [Vector2i.UP, Vector2i.DOWN, Vector2i.LEFT, Vector2i.RIGHT]
const TYPES := {".": "walk", "=": "bridge", "S": "stairs", "~": "water"}
var player_tile := Vector2i(-1, -1)
var bounds := Rect2i()
var _types: Array
var _heights: Array
var _connections: Array
var _step_heights: Dictionary
var layout: Dictionary
var signs := {}

func load_walk(root: String) -> bool:
	var data = JSON.parse_string(FileAccess.get_file_as_string(root.path_join("walk.json")))
	if not data is Dictionary or not data.has_all(["cols", "rows", "types", "heights", "connections", "stepHeights"]):
		push_error("Invalid walk.json in " + root)
		return false
	bounds = Rect2i(0, 0, int(data.cols), int(data.rows))
	_types = data.types
	_heights = data.heights
	_connections = data.connections
	_step_heights = data.stepHeights
	return true

func load_room(root: String, room: Dictionary, load_meshes: bool = true) -> bool:
	if not load_walk(root): return false
	layout = {"spawn": room.entry, "doorways": [], "exits": room.exits}
	if load_meshes:
		for file in room.meshes:
			var path: String = root.path_join(file)
			if not FileAccess.file_exists(path): return false
			var node := MeshInstance3D.new()
			node.mesh = ObjLoader.load_obj(path)
			add_child(node)
	return true

func load_island(root: String, load_meshes: bool = true) -> bool:
	if not load_walk(root): return false
	layout = JSON.parse_string(FileAccess.get_file_as_string("res://data/layout.json"))
	var entries = JSON.parse_string(FileAccess.get_file_as_string(root.path_join("signs.json")))
	if not entries is Array:
		push_error("Invalid signs.json in " + root)
		return false
	for entry in entries:
		# A sign board is "width" tiles wide; it can be read from below any of them.
		for k in int(entry.get("width", 1)):
			signs[pair(entry.tile) + Vector2i(k, 0)] = entry
	if load_meshes:
		for group in ["terrain", "buildings", "decorations"]:
			var file: String = root.path_join(group).path_join(group + ".obj")
			if not FileAccess.file_exists(file):
				push_error("Missing mesh: " + file)
				return false
			get_node(group.capitalize()).mesh = ObjLoader.load_obj(file)
		# Copies of tiles that overlap their neighbours, drawn a hair higher so they never flicker.
		for group in ["deck", "deck2"]:
			var file: String = root.path_join(group).path_join(group + ".obj")
			if not FileAccess.file_exists(file): continue
			var node := MeshInstance3D.new()
			node.name = group.capitalize()
			node.mesh = ObjLoader.load_obj(file)
			add_child(node)
		# layout.json "fillers": plain dark blocks inside buildings whose models are open on some
		# side, so see-through windows show an interior instead of the ground.
		for filler in layout.get("fillers", []):
			var box := BoxMesh.new()
			var lo := Vector3(filler.x0, filler.bottom, filler.y0)
			var hi := Vector3(filler.x1, filler.top, filler.y1)
			box.size = hi - lo
			var material := StandardMaterial3D.new()
			material.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
			material.albedo_color = Color(filler.get("color", "#1c2238"))
			box.material = material
			var node := MeshInstance3D.new()
			node.mesh = box
			# Map tile coordinates are world coordinates offset by 15.5, as in the exported meshes.
			node.position = (lo + hi) / 2.0 - Vector3(15.5, 0, 15.5)
			add_child(node)
		_animate(root)
	return true

# --- Ambient motion (layout.json "animate" and "spin") ---------------------------------------
const SwayShader = preload("res://shaders/sway.gdshader")
var _scrolling: Array = []  # [material, Vector2 speed]
var _flipping: Array = []   # [material, texel width, seconds per flip]
var _spinners: Array = []   # {wheel, cars: [[node, offset]], center, seconds}
var _flipbooks: Array = []  # [material, textures, seconds per frame, first frame]
var _pulsing: Array = []    # [material, lowest opacity, highest opacity, seconds per cycle]
var _sloshing: Array = []   # [material, distance along v, seconds per cycle]
var _time := 0.0

## Gives matching materials their motion: "scroll" slides water textures, "flip" shifts flower
## textures one pixel back and forth like the DS's frame swaps, "sway" bends tree tops and bunting.
func _animate(root: String) -> void:
	var rules: Array = layout.get("animate", [])
	# frames.json (from tools/hub/victory/frames.js): the original games' frames for a material.
	# They replace a "scroll" or "flip" rule for that material; "sway" still applies on top.
	var frames := {}
	var frames_file := root.path_join("frames.json")
	if FileAccess.file_exists(frames_file):
		var parsed = JSON.parse_string(FileAccess.get_file_as_string(frames_file))
		if parsed is Dictionary: frames = parsed
	# "noFrames": matches that aren't animations (such as day and night versions of windows).
	for name in layout.get("noFrames", []): frames.erase(name)
	for node in get_children():
		if not node is MeshInstance3D or not node.mesh is ArrayMesh: continue
		var mesh: ArrayMesh = node.mesh
		for i in mesh.get_surface_count():
			var name := mesh.surface_get_name(i)
			for rule in rules:
				if not (rule.match as Array).any(func(part): return name.to_lower().contains(String(part).to_lower())): continue
				var material := mesh.surface_get_material(i) as StandardMaterial3D
				if material == null: break
				if frames.has(name) and (rule.has("scroll") or rule.has("flip")): break
				if rule.has("scroll"):
					_scrolling.append([material, Vector2(rule.scroll[0], rule.scroll[1])])
				elif rule.has("slosh"):
					# [distance in texture widths along v, seconds per cycle]: slides back and forth, so
					# foam laps against a hull without the rest of the texture sliding into view.
					_sloshing.append([material, float(rule.slosh[0]), float(rule.slosh[1])])
				elif rule.has("pulse"):
					# [lowest opacity, highest opacity, seconds per cycle]: foam that washes in and out.
					material.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
					_pulsing.append([material, float(rule.pulse[0]), float(rule.pulse[1]), float(rule.pulse[2])])
				elif rule.has("flip"):
					var width := 16.0
					if material.albedo_texture: width = material.albedo_texture.get_width()
					_flipping.append([material, 1.0 / width, float(rule.flip)])
				elif rule.has("sway"):
					var sway := ShaderMaterial.new()
					sway.shader = SwayShader
					sway.set_shader_parameter("albedo_texture", material.albedo_texture)
					sway.set_shader_parameter("amount", float(rule.sway[0]))
					sway.set_shader_parameter("speed", float(rule.sway[1]))
					sway.set_shader_parameter("scissor", material.alpha_scissor_threshold)
					sway.render_priority = material.render_priority
					mesh.surface_set_material(i, sway)
				break
			if frames.has(name):
				var textures: Array = []
				for path in frames[name].frames:
					var image := Image.load_from_file(root.path_join(path))
					if image != null: textures.append(ImageTexture.create_from_image(image))
				if textures.size() > 1:
					_flipbooks.append([mesh.surface_get_material(i), textures, _frame_seconds(name), int(frames[name].get("start", 0))])
	for spin in layout.get("spin", []):
		_make_spinner(spin)
	for rotor in layout.get("rotors", []):
		_make_rotors(rotor)

## "rotors": in a surface holding several windmills, the pieces above "above" (height over the
## surface's lowest point) are the blades. Blades close together form one rotor, which turns about
## its middle around its thinnest side; the rest of the surface stays where it is.
func _make_rotors(rotor: Dictionary) -> void:
	var source: MeshInstance3D = get_node_or_null(String(rotor.get("group", "buildings")).capitalize())
	if source == null or not source.mesh is ArrayMesh: return
	var mesh: ArrayMesh = source.mesh
	for i in range(mesh.get_surface_count() - 1, -1, -1):
		if not mesh.surface_get_name(i).contains(rotor.surface): continue
		var arrays := mesh.surface_get_arrays(i)
		var material := mesh.surface_get_material(i)
		var lowest := INF
		for v in arrays[Mesh.ARRAY_VERTEX]: lowest = minf(lowest, v.y)
		var groups: Array = []  # [box, [piece arrays]]
		var still: Array = []
		for piece in _pieces(arrays):
			var box := AABB(piece[0][Mesh.ARRAY_VERTEX][0], Vector3.ZERO)
			for v in piece[0][Mesh.ARRAY_VERTEX]: box = box.expand(v)
			if box.position.y - lowest < float(rotor.get("above", 3.0)):
				still.append([piece[0], material])
				continue
			var home = null
			for g in groups:
				if g[0].grow(0.5).intersects(box): home = g; break
			if home == null: groups.append([box, [[piece[0], material]]])
			else:
				home[0] = home[0].merge(box)
				home[1].append([piece[0], material])
		if groups.is_empty(): continue
		var name := mesh.surface_get_name(i)
		mesh.surface_remove(i)
		# Put every piece that doesn't turn (bases and poles) back as one surface.
		if not still.is_empty():
			var merged := []
			merged.resize(Mesh.ARRAY_MAX)
			for slot in [Mesh.ARRAY_VERTEX, Mesh.ARRAY_TEX_UV, Mesh.ARRAY_NORMAL, Mesh.ARRAY_COLOR]:
				if still[0][0][slot] == null: continue
				var out = still[0][0][slot].duplicate()
				for k in range(1, still.size()): out.append_array(still[k][0][slot])
				merged[slot] = out
			mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, merged)
			mesh.surface_set_material(mesh.get_surface_count() - 1, material)
			mesh.surface_set_name(mesh.get_surface_count() - 1, name)
		for g in groups:
			var box: AABB = g[0]
			# Each blade's middle point; their average is the hub (the blades are evenly spaced), and
			# the line square to the plane through them is the axle, so the rotor spins in place.
			var middles: Array = []
			for part in g[1]:
				var sum := Vector3.ZERO
				for v in part[0][Mesh.ARRAY_VERTEX]: sum += v
				middles.append(sum / maxi(part[0][Mesh.ARRAY_VERTEX].size(), 1))
			var center := Vector3.ZERO
			for m in middles: center += m
			center /= maxi(middles.size(), 1)
			var axis := Vector3.RIGHT
			if box.size.y < box.size.x and box.size.y < box.size.z: axis = Vector3.UP
			elif box.size.z < box.size.x and box.size.z < box.size.y: axis = Vector3.FORWARD
			var far: Vector3 = Vector3.ZERO
			for m in middles:
				if (m - center).length() > far.length(): far = m - center
			var best := Vector3.ZERO
			for m in middles:
				var n: Vector3 = far.cross(m - center)
				if n.length() > best.length(): best = n
			if best.length() > 0.01: axis = best.normalized()
			var node := MeshInstance3D.new()
			node.mesh = _shifted(g[1], -center)
			node.position = center
			add_child(node)
			# A wheel with no cars: _process turns it like the ferris wheel.
			_spinners.append({"wheel": node, "cars": [], "center": center, "axis": axis, "seconds": float(rotor.get("seconds", 4.0))})

## Moves the wheel's surfaces into their own node turning about the axle; each car (a connected
## piece of the car surfaces) hangs from the rim and stays upright as it goes round.
func _make_spinner(spin: Dictionary) -> void:
	var source: MeshInstance3D = get_node_or_null(String(spin.get("group", "buildings")).capitalize())
	if source == null or not source.mesh is ArrayMesh: return
	var mesh: ArrayMesh = source.mesh
	var wheel_parts: Array = []
	var car_parts: Array = []
	for i in range(mesh.get_surface_count() - 1, -1, -1):
		var name := mesh.surface_get_name(i)
		var is_wheel: bool = (spin.wheel as Array).any(func(p): return name.contains(p))
		var is_car: bool = (spin.cars as Array).any(func(p): return name.contains(p))
		if not is_wheel and not is_car: continue
		var part := [mesh.surface_get_arrays(i), mesh.surface_get_material(i)]
		(wheel_parts if is_wheel else car_parts).append(part)
		mesh.surface_remove(i)
	if wheel_parts.is_empty(): return
	var box := AABB()
	var first := true
	for part in wheel_parts:
		for v in part[0][Mesh.ARRAY_VERTEX]:
			if first: box = AABB(v, Vector3.ZERO); first = false
			else: box = box.expand(v)
	var center := box.get_center()
	# The axle runs along the wheel's thinnest side.
	var axis := Vector3.FORWARD if box.size.z < box.size.x and box.size.z < box.size.y else Vector3.RIGHT
	var wheel := MeshInstance3D.new()
	wheel.mesh = _shifted(wheel_parts, -center)
	wheel.position = center
	add_child(wheel)
	# Pieces of every car material that sit close together form one car with one hanging point.
	var groups: Array = []  # [box, [[arrays, material], ...]]
	for part in car_parts:
		for piece in _pieces(part[0]):
			var piece_box := AABB(piece[0][Mesh.ARRAY_VERTEX][0], Vector3.ZERO)
			for v in piece[0][Mesh.ARRAY_VERTEX]: piece_box = piece_box.expand(v)
			var home = null
			for g in groups:
				if g[0].grow(0.3).intersects(piece_box): home = g; break
			if home == null: groups.append([piece_box, [[piece[0], part[1]]]])
			else:
				home[0] = home[0].merge(piece_box)
				home[1].append([piece[0], part[1]])
	var cars: Array = []
	for g in groups:
		var top := Vector3(g[0].get_center().x, g[0].end.y, g[0].get_center().z)
		var car := MeshInstance3D.new()
		car.mesh = _shifted(g[1], -top)
		car.position = top
		add_child(car)
		cars.append([car, top - center])
	_spinners.append({"wheel": wheel, "cars": cars, "center": center, "axis": axis, "seconds": float(spin.get("seconds", 60.0))})

static func _shifted(parts: Array, offset: Vector3) -> ArrayMesh:
	var mesh := ArrayMesh.new()
	for part in parts:
		var arrays: Array = part[0].duplicate()
		var verts: PackedVector3Array = arrays[Mesh.ARRAY_VERTEX].duplicate()
		for k in verts.size(): verts[k] += offset
		arrays[Mesh.ARRAY_VERTEX] = verts
		mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
		mesh.surface_set_material(mesh.get_surface_count() - 1, part[1])
	return mesh

## Splits a triangle list into connected pieces (triangles sharing a vertex position).
## Returns [arrays, hanging point (top middle of the piece)] for each piece.
static func _pieces(arrays: Array) -> Array:
	var verts: PackedVector3Array = arrays[Mesh.ARRAY_VERTEX]
	var count := verts.size() / 3
	var parent := range(count)
	var find := func(self_ref, x):
		while parent[x] != x:
			parent[x] = parent[parent[x]]
			x = parent[x]
		return x
	var owner := {}
	for t in count:
		for k in 3:
			var key := (verts[t * 3 + k] * 64.0).round()
			if owner.has(key):
				var a = find.call(find, t)
				var b = find.call(find, owner[key])
				if a != b: parent[a] = b
			else:
				owner[key] = t
	var groups := {}
	for t in count:
		var root = find.call(find, t)
		if not groups.has(root): groups[root] = []
		groups[root].append(t)
	var result := []
	for root in groups:
		var piece := []
		piece.resize(Mesh.ARRAY_MAX)
		for slot in [Mesh.ARRAY_VERTEX, Mesh.ARRAY_TEX_UV, Mesh.ARRAY_NORMAL, Mesh.ARRAY_COLOR]:
			if arrays[slot] == null: continue
			var out = arrays[slot].duplicate()
			out.resize(0)
			for t in groups[root]:
				for k in 3: out.append(arrays[slot][t * 3 + k])
			piece[slot] = out
		var box := AABB(piece[Mesh.ARRAY_VERTEX][0], Vector3.ZERO)
		for v in piece[Mesh.ARRAY_VERTEX]: box = box.expand(v)
		result.append([piece, Vector3(box.get_center().x, box.end.y, box.get_center().z)])
	return result

## Seconds per frame from layout.json "frameSeconds": the first key found in the material name wins,
## otherwise "default".
func _frame_seconds(name: String) -> float:
	var table: Dictionary = layout.get("frameSeconds", {})
	for key in table:
		if key != "default" and name.to_lower().contains(String(key).to_lower()): return float(table[key])
	return float(table.get("default", 0.25))

func _process(delta: float) -> void:
	_time += delta
	for book in _flipbooks:
		var texture: Texture2D = book[1][(int(_time / book[2]) + book[3]) % book[1].size()]
		if book[0] is ShaderMaterial: book[0].set_shader_parameter("albedo_texture", texture)
		elif book[0] is StandardMaterial3D: book[0].albedo_texture = texture
	for entry in _scrolling:
		entry[0].uv1_offset = Vector3(fposmod(entry[1].x * _time, 1.0), fposmod(entry[1].y * _time, 1.0), 0)
	for entry in _sloshing:
		entry[0].uv1_offset = Vector3(0, entry[1] * sin(TAU * _time / entry[2]), 0)
	for entry in _pulsing:
		entry[0].albedo_color.a = lerpf(entry[1], entry[2], 0.5 + 0.5 * sin(TAU * _time / entry[3]))
	for entry in _flipping:
		entry[0].uv1_offset = Vector3(entry[1] if int(_time / entry[2]) % 2 == 1 else 0.0, 0, 0)
	for spin in _spinners:
		var angle: float = TAU * _time / spin.seconds
		spin.wheel.basis = Basis(spin.axis, angle)
		for car in spin.cars:
			car[0].position = spin.center + car[1].rotated(spin.axis, angle)

static func pair(value: Array) -> Vector2i:
	return Vector2i(int(value[0]), int(value[1]))

func tile_to_world(tile: Vector2i) -> Vector3:
	return Vector3(tile.x - ORIGIN.x, float(_heights[tile.y][tile.x]), tile.y - ORIGIN.y)

func spawn_tile() -> Vector2i:
	return pair(layout.spawn)

func behaviour(tile: Vector2i) -> String:
	return TYPES.get(_types[tile.y][tile.x], "block") if bounds.has_point(tile) else "block"

const Npc = preload("res://scripts/npc.gd")
var npcs := {}  # tile -> npc node

## Places layout.json's NPCs. Called once the sprite data folder is known.
func spawn_npcs() -> void:
	for data in layout.get("npcs", []):
		var npc := Npc.new()
		add_child(npc)
		npc.setup(self, data)
		npcs[npc.tile] = npc
		# "blocks": more tiles a standing NPC covers (someone drawn forward onto a bench seat). They
		# can't be walked through, and facing one talks to that NPC.
		for extra in data.get("blocks", []):
			npcs[Vector2i(int(extra[0]), int(extra[1]))] = npc

func npc_at(tile: Vector2i):
	return npcs.get(tile)

## Moves an NPC's claim to the tile it is stepping onto (called before its step starts).
func move_npc(npc: Node3D, to: Vector2i) -> void:
	npcs.erase(npc.tile)
	npcs[to] = npc

func can_step(from: Vector2i, to: Vector2i) -> bool:
	if npcs.has(to): return false
	var direction := DIRECTIONS.find(to - from)
	return direction >= 0 and bounds.has_point(from) and bounds.has_point(to) and (int(_connections[from.y][from.x]) & (1 << direction)) != 0

func step_path(from: Vector2i, to: Vector2i) -> PackedVector3Array:
	var start := tile_to_world(from)
	var end := tile_to_world(to)
	var direction := DIRECTIONS.find(to - from)
	var profile: Array = _step_heights.get("%d,%d,%d" % [from.x, from.y, direction], [])
	var points := PackedVector3Array()
	for i in profile.size():
		var point := start.lerp(end, float(i + 1) / float(profile.size() + 1))
		point.y = float(profile[i])
		points.append(point)
	points.append(end)
	return points

func sign_at(tile: Vector2i, facing: Vector2i) -> Array:
	if not signs.has(tile): return []
	var entry: Dictionary = signs[tile]
	var outward: Vector2i = {"up": Vector2i.UP, "down": Vector2i.DOWN, "left": Vector2i.LEFT, "right": Vector2i.RIGHT}.get(entry.get("facing"), Vector2i.ZERO)
	if outward != Vector2i.ZERO and facing != -outward: return []
	var key := "%d,%d" % [int(entry.tile[0]), int(entry.tile[1])]
	var label: String = layout.get("signs", {}).get(key, entry.get("label", ""))
	return [label if not label.is_empty() else "This sign is blank."]

func check_reachable() -> Dictionary:
	var start := spawn_tile()
	var seen := {}
	var queue: Array[Vector2i] = []
	if behaviour(start) in ["walk", "bridge", "stairs"]:
		seen[start] = true
		queue.append(start)
	var index := 0
	while index < queue.size():
		var tile := queue[index]
		index += 1
		for direction in DIRECTIONS:
			var target: Vector2i = tile + direction
			if not seen.has(target) and can_step(tile, target):
				seen[target] = true
				queue.append(target)
	var result := {"spawn": [start.x, start.y], "reachable": seen.size(), "doors": [], "signs": []}
	result.exits = []
	for exit in layout.get("exits", []):
		result.exits.append({"tile": exit, "reachable": seen.has(pair(exit))})
	for entry in layout.doorways:
		var target := pair(entry.tile)
		var front := target + Vector2i.DOWN
		result.doors.append({"name": entry.name, "tile": entry.tile, "reachable": seen.has(target) or seen.has(front), "front": [front.x, front.y]})
	for target in signs:
		var entry: Dictionary = signs[target]
		if pair(entry.tile) != target: continue
		var outward: Vector2i = {"up": Vector2i.UP, "down": Vector2i.DOWN, "left": Vector2i.LEFT, "right": Vector2i.RIGHT}.get(entry.get("facing"), Vector2i.ZERO)
		var reachable := false
		var front: Vector2i = target
		for direction in DIRECTIONS:
			if outward != Vector2i.ZERO and direction != outward: continue
			if seen.has(target + direction):
				reachable = true
				front = target + direction
				break
		result.signs.append({"tile": [target.x, target.y], "facing": entry.get("facing"), "reachable": reachable, "front": [front.x, front.y]})
	# An NPC can be talked to from any reachable tile next to it. "check": false skips one that is
	# fenced off on purpose (the Daycare's Pokemon).
	result.npcs = []
	for data in layout.get("npcs", []):
		if not data.get("check", true): continue
		var at := Vector2i(int(data.tile[0]), int(data.tile[1]))
		var covered: Array = [at]
		for extra in data.get("blocks", []): covered.append(Vector2i(int(extra[0]), int(extra[1])))
		var reachable := covered.any(func(c): return DIRECTIONS.any(func(d): return not covered.has(c + d) and seen.has(c + d)))
		result.npcs.append({"name": data.get("name", ""), "tile": [at.x, at.y], "reachable": reachable})
	return result
