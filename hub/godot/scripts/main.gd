extends Node3D
const CAMERA_DISTANCE := 0x29AEC1 / 4096.0 / 16.0
const CAMERA_PITCH := (65536 - 0xDD62) * 360.0 / 65536.0
const CAMERA_OFFSET := Vector3(0, sin(deg_to_rad(CAMERA_PITCH)), cos(deg_to_rad(CAMERA_PITCH))) * CAMERA_DISTANCE
const CAMERA_FOV := 0x05C1 * 360.0 / 65536.0 * 2.0
const VIEW_MARGIN := Vector4(10.5, 5.0, 10.5, 6.0)
@onready var world: Node3D = $World
@onready var player: Node3D = $Player
@onready var camera: Camera3D = $Camera
@onready var message: PanelContainer = $UI/Message
var _args := {}
var _loaded := false
var _zone := ""
var _banner: PanelContainer
var _banner_label: Label
var _banner_tween: Tween

func _ready() -> void:
	for a in OS.get_cmdline_user_args():
		var kv := a.trim_prefix("--").split("=", true, 1)
		_args[kv[0]] = kv[1] if kv.size() > 1 else ""
	var root: String = _args.get("data", OS.get_environment("JOURNEYS_HUB_DATA"))
	if root.is_empty(): root = ProjectSettings.globalize_path("user://hub-data")
	root = ProjectSettings.globalize_path(root)
	if not root.is_absolute_path(): root = DirAccess.open(".").get_current_dir().path_join(root).simplify_path()
	if not FileAccess.file_exists(root.path_join("victory_island/collision.json")):
		var label := Label.new()
		label.text = "Victory Island data not found in %s. Build it with node hub/godot/pipeline/build-data.js" % root
		label.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
		label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		label.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
		label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		$UI.add_child(label)
		print(label.text)
		if _args.has("check"): get_tree().quit(1)
		return
	world.load_island(root)
	player.world = world
	var start: Vector2i = world.spawn_tile()
	if _args.has("at"):
		var p: PackedStringArray = _args.at.split(",")
		if p.size() == 2: start = Vector2i(int(p[0]), int(p[1]))
	if _args.has("grid"):
		var c := {}
		for y in world.bounds.size.y:
			var row := ""
			for x in world.bounds.size.x:
				var b: String = world.behaviour(Vector2i(x, y))
				c[b] = c.get(b, 0) + 1
				row += {"walk": ".", "block": "#", "water": "~", "bridge": "=", "stairs": "S", "door": "D"}.get(b, "?")
			print("ROW ", row)
		print("CELLS ", c)
	if _args.has("check"):
		var result: Dictionary = world.check_reachable(start)
		print(JSON.stringify(result))
		var valid := true
		for category in ["doors", "npcs", "signs"]:
			for entry in result[category]:
				if not entry.reachable: valid = false
		get_tree().quit(0 if valid else 1)
		return
	player.place(start)
	player.face({"up": Vector2i.UP, "down": Vector2i.DOWN, "left": Vector2i.LEFT, "right": Vector2i.RIGHT}.get(world.layout.get("spawn", {}).get("facing", "down"), Vector2i.DOWN))
	player.stepped.connect(_on_stepped)
	player.bumped.connect(_on_bumped)
	camera.fov = CAMERA_FOV
	camera.near = 150.0 / 16.0
	camera.far = 1200.0 / 16.0 + CAMERA_DISTANCE
	_loaded = true
	_follow(1.0)
	_make_banner()
	_on_stepped(start, world.behaviour(start))
	for ch in _args.get("walk", ""):
		var d = {"u": Vector2i.UP, "d": Vector2i.DOWN, "l": Vector2i.LEFT, "r": Vector2i.RIGHT}.get(ch)
		if d != null: player.scripted.append(d)
	if _args.has("speed"): Engine.time_scale = maxf(0.01, float(_args.speed))
	if _args.has("overview"):
		player.locked = true
		_overview(_args.overview)
	elif _args.has("shot") or _args.has("talk"):
		_when_idle()

func _process(delta: float) -> void:
	if _loaded and not _args.has("overview"): _follow(1.0 - exp(-12.0 * delta))

func _follow(weight: float) -> void:
	var focus: Vector3 = player.position
	focus.x = clampf(focus.x, -16 + VIEW_MARGIN.x, world.bounds.size.x - 16 - VIEW_MARGIN.z)
	focus.z = clampf(focus.z, -16 + VIEW_MARGIN.y, world.bounds.size.y - 16 - VIEW_MARGIN.w)
	camera.position = camera.position.lerp(focus + CAMERA_OFFSET, weight)
	camera.look_at(camera.position - CAMERA_OFFSET, Vector3.UP)

func _on_bumped(tile: Vector2i, _behaviour: String) -> void:
	var entry: Dictionary = world.doors.get(tile, {})
	var title: String = entry.get("name", "")
	if title.is_empty(): title = entry.get("model", "Door")
	_toast("%s: closed for now." % title)

func _toast(text: String) -> void:
	if message.is_open(): return
	message.show_pages([text])
	await get_tree().create_timer(1.5).timeout
	if message.is_open() and not player.locked: message.advance()

func _show_pages(pages: Array) -> void:
	if pages.is_empty() or message.is_open(): return
	player.locked = true
	message.show_pages(pages)
	await message.closed
	player.locked = false

func _on_shipmaster(npc: Node3D) -> void:
	await _show_pages(npc.text)

func _unhandled_input(event: InputEvent) -> void:
	if event.is_action_pressed("quit") and OS.get_name() != "Android":
		get_tree().quit()
		return
	if not _loaded or not event.is_action_pressed("interact"): return
	if message.is_open():
		message.advance()
		return
	if player.moving: return
	var front: Vector2i = player.tile + player.facing
	var npc = world.npc_at(front)
	if npc != null:
		npc.talking = true
		npc.face_toward(player.tile)
		if npc.info.get("role", "") in ["journeys", "event"]:
			await _on_shipmaster(npc)
		else:
			await _show_pages(npc.text if not npc.text.is_empty() else ["…"])
		npc.talking = false
		return
	_show_pages(world.sign_at(front))

func _make_banner() -> void:
	_banner = PanelContainer.new()
	var style := StyleBoxFlat.new()
	style.bg_color = Color(0.97, 0.97, 0.94)
	style.border_color = Color(0.36, 0.42, 0.55)
	style.set_border_width_all(4)
	style.set_corner_radius_all(8)
	style.content_margin_left = 24
	style.content_margin_right = 24
	style.content_margin_top = 12
	style.content_margin_bottom = 12
	_banner.add_theme_stylebox_override("panel", style)
	_banner_label = Label.new()
	_banner_label.add_theme_font_size_override("font_size", 28)
	_banner_label.add_theme_color_override("font_color", Color(0.25, 0.25, 0.28))
	_banner.add_child(_banner_label)
	$UI.add_child(_banner)
	_banner.position = Vector2(-500, 24)

func _on_stepped(tile: Vector2i, _behaviour: String) -> void:
	var nearest := INF
	var name := ""
	var centre := Vector2(tile) + Vector2(0.5, 0.5)
	for zone in world.layout.get("zones", []):
		var distance := centre.distance_to(Vector2(float(zone.x), float(zone.y)))
		if distance <= float(zone.radius) and distance < nearest:
			nearest = distance
			name = zone.name
	if name.is_empty() or name == _zone: return
	_zone = name
	if _banner_tween != null: _banner_tween.kill()
	_banner_label.text = name
	_banner.position.x = -500
	_banner_tween = create_tween()
	_banner_tween.tween_property(_banner, "position:x", 24.0, 0.25)
	_banner_tween.tween_interval(2.0)
	_banner_tween.tween_property(_banner, "position:x", -500.0, 0.25)

func _when_idle() -> void:
	while not player.scripted.is_empty() or player.moving:
		await get_tree().process_frame
	for i in 30: await get_tree().process_frame
	if _args.has("talk"):
		var press := InputEventAction.new()
		press.action = "interact"
		press.pressed = true
		_unhandled_input(press)
		for i in 20: await get_tree().process_frame
	if _args.has("shot"):
		await RenderingServer.frame_post_draw
		var error := get_viewport().get_texture().get_image().save_png(_args.shot)
		print("screenshot: ", _args.shot, " player tile ", player.tile, " error ", error)
		get_tree().quit(0 if error == OK else 1)

func _overview(path: String) -> void:
	var viewport := SubViewport.new()
	viewport.size = Vector2i(1920, 1920)
	viewport.world_3d = get_viewport().world_3d
	viewport.render_target_update_mode = SubViewport.UPDATE_ALWAYS
	add_child(viewport)
	var overview := Camera3D.new()
	overview.projection = Camera3D.PROJECTION_ORTHOGONAL
	overview.size = float(world.bounds.size.y)
	overview.far = 1000
	viewport.add_child(overview)
	overview.position = Vector3(world.bounds.size.x / 2.0 - 16, 300, world.bounds.size.y / 2.0 - 16)
	overview.rotation_degrees.x = -90
	overview.current = true
	if _args.has("overlay"):
		var marker := CylinderMesh.new()
		marker.top_radius = 0.13
		marker.bottom_radius = 0.13
		marker.height = 0.03
		var material := StandardMaterial3D.new()
		material.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
		material.albedo_color = Color.RED
		material.no_depth_test = true
		marker.material = material
		for y in world.bounds.size.y:
			for x in world.bounds.size.x:
				var t := Vector2i(x, y)
				if world.behaviour(t) in ["block", "water", "door"] or world.npcs.has(t) or world.signs.has(t):
					var node := MeshInstance3D.new()
					node.mesh = marker
					world.add_child(node)
					node.position = world.tile_to_world(t) + Vector3(0, 0.1, 0)
	for i in 5: await get_tree().process_frame
	await RenderingServer.frame_post_draw
	var error := viewport.get_texture().get_image().save_png(path)
	print("overview: ", path, " error ", error)
	get_tree().quit(0 if error == OK else 1)
