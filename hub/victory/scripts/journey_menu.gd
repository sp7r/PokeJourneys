extends Control
## Journey selection using external field windows.
const Gba = preload("res://scripts/gba_frame.gd")
const BOTTOM_ZOOM := 1.125
var _gba: Gba
signal finished(journey: Dictionary)
var journeys: Array = []
var _page := 0
var _row := 0
var _group := 0
var _groups: Array = []
var _games: Array = []
var _chosen := {}
var _art := {}
var _glyphs := {}
var _ink: Texture2D
var _margins := {}
var _top: Control
var _list: Control
var _bottom: SubViewport
var _plugin: Object
var _sending := false
var _closing := false
var _scroll := 0.0

static func available(root: String) -> bool:
	if Gba.available(root): return true
	for file in ["active.png", "dim.png", "background.png", "cursor.png", "slices.json"]:
		if not FileAccess.file_exists(root.path_join("ui/captain/" + file)): return false
	return FileAccess.file_exists(root.path_join("ui/font/font.fnt"))

static func pick(host: Node, captain: Dictionary, path: String) -> void:
	var parsed = JSON.parse_string(FileAccess.get_file_as_string(path)) if FileAccess.file_exists(path) else null
	var items: Array = parsed.filter(func(j): return j is Dictionary and j.has("rom")) if parsed is Array else []
	if items.is_empty():
		await host._show_pages(captain.get("none", []))
		return
	host.player.locked = true
	var chosen := {}
	if available(OverworldSprite.data_root):
		var menu := load("res://scripts/journey_menu.gd").new() as Control
		menu.journeys = items
		host.get_node("UI").add_child(menu)
		chosen = await menu.finished
	else:
		var names: Array = items.map(func(j): return String(j.get("name", String(j.rom).get_file().get_basename())))
		names.append(String(captain.get("cancel", "Not now")))
		host.message.ask(String(captain.get("ask", "Where to?")), names)
		var index: int = await host.message.answered
		if index >= 0 and index < items.size(): chosen = items[index]
	host.player.locked = false
	if chosen.is_empty(): return
	await host._show_pages([String(captain.get("sail", "All aboard! Setting sail for %s!")).replace("%s", String(chosen.get("name", "Journey")))])
	if Engine.has_singleton("PokeJourneys"):
		Engine.get_singleton("PokeJourneys").call("launch", String(chosen.rom))
	else: print("launch journey: ", chosen.rom)

func _ready() -> void:
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
	var root := OverworldSprite.data_root
	var dir := root.path_join("ui/captain")
	if Gba.available(root): _gba = Gba.new(root)
	if not _gba: _load_legacy(root, dir)
	_setup_screens()

func _load_legacy(root: String, dir: String) -> void:
	for file in ["active", "dim", "background", "cursor"]:
		_art[file] = ImageTexture.create_from_image(Image.load_from_file(dir.path_join(file + ".png")))
	_margins = JSON.parse_string(FileAccess.get_file_as_string(dir.path_join("slices.json")))
	var atlas := Image.load_from_file(root.path_join("ui/font/font.png"))
	for y in atlas.get_height():
		for x in atlas.get_width():
			var c := atlas.get_pixel(x, y)
			if c.a > 0: atlas.set_pixel(x, y, Color("f6f6f6") if c.r < 0.4 else Color("4a5252"))
	_ink = ImageTexture.create_from_image(atlas)
	var pattern := RegEx.new()
	pattern.compile("(\\w+)=(-?\\d+)")
	for line in FileAccess.get_file_as_string(root.path_join("ui/font/font.fnt")).split("\n"):
		if not line.begins_with("char id="): continue
		var g := {}
		for hit in pattern.search_all(line): g[hit.get_string(1)] = int(hit.get_string(2))
		_glyphs[g.id] = g

func _setup_screens() -> void:
	for generation in [1, 2, 3, 4, 5, 6, 7, 0]:
		if journeys.any(func(j): return _picker_generation(j) == generation): _groups.append(generation)
	if Engine.has_singleton("PokeJourneys"):
		_plugin = Engine.get_singleton("PokeJourneys")
		if _plugin.has_second_screen():
			_bottom = SubViewport.new()
			var physical: PackedInt32Array = _plugin.second_screen_size()
			var factor := float(DisplayServer.window_get_size().y) / get_viewport_rect().size.y
			# Rendered at the screen's own resolution, laid out at the top screen's scale (whole pixels for Gba.screen).
			_bottom.size = Vector2i(physical[0], physical[1])
			_bottom.size_2d_override = Vector2i(roundi(physical[0] / factor), roundi(physical[1] / factor))
			_bottom.size_2d_override_stretch = true
			_bottom.render_target_update_mode = SubViewport.UPDATE_ALWAYS
			_bottom.canvas_item_default_texture_filter = Viewport.DEFAULT_CANVAS_ITEM_TEXTURE_FILTER_NEAREST
			add_child(_bottom)
			_plugin.connect("bottom_touch", _bottom_touch)
	var view := get_viewport_rect().size
	_top = _screen(self, Rect2(Vector2.ZERO, view if _bottom else Vector2(view.x / 2, view.y)), false)
	var list_rect := Rect2(Vector2.ZERO, Vector2(_bottom.size_2d_override)) if _bottom else Rect2(view.x / 2, 0, view.x / 2, view.y)
	_list = _screen(_bottom if _bottom else self, list_rect, true)
	if _bottom:
		var fit := minf(list_rect.size.x / _list.size.x, list_rect.size.y / _list.size.y)
		_list.scale = Vector2.ONE * minf(_list.scale.x * BOTTOM_ZOOM, fit)
		var display_scale := Vector2(_bottom.size) / list_rect.size
		_list.position = ((list_rect.size - _list.size * _list.scale) * display_scale / 2).round() / display_scale
	_refresh()

func _screen(parent: Node, rect: Rect2, list: bool) -> Control:
	var fill := ColorRect.new()
	fill.color = _gba.color("menuPalette",0) if _gba else Color.BLACK
	fill.position = rect.position
	fill.size = rect.size
	fill.mouse_filter = Control.MOUSE_FILTER_IGNORE
	parent.add_child(fill)
	if _gba:
		var native := Gba.screen(parent, rect, Vector2(256,192))
		native.draw.connect(func(): _draw_screen(native,list))
		return native
	var screen := Control.new()
	var factor := maxi(1, floori(minf(rect.size.x / 256, rect.size.y / 192)))
	screen.scale = Vector2.ONE * factor
	screen.position = (rect.position + (rect.size - Vector2(256, 192) * factor) / 2).floor()
	screen.size = Vector2(256, 192)
	screen.mouse_filter = Control.MOUSE_FILTER_IGNORE
	parent.add_child(screen)
	screen.draw.connect(func(): _draw_screen(screen, list))
	return screen

func _text(screen: Control, value: String, at: Vector2, width := 220, wrap := false) -> void:
	if wrap:
		var line := ""
		var lines: Array[String] = []
		for word in value.split(" "):
			if _text_width(line + " " + word) > width and line != "":
				lines.append(line)
				line = word
			else: line += (" " if line != "" else "") + word
		lines.append(line)
		for i in mini(lines.size(), 4): _text(screen, lines[i], at + Vector2(0, i * 17), width)
		return
	if _gba:
		_gba.text(screen, value, at, width)
		return
	var x := 0
	var y := 0
	for letter in value:
		var g: Dictionary = _glyphs.get(letter.unicode_at(0), _glyphs.get(63, {}))
		if g.is_empty(): continue
		if x + int(g.xadvance) > width:
			if not wrap: break
			x = 0
			y += 17
		if y > 68: break
		screen.draw_texture_rect_region(_ink, Rect2(at + Vector2(x, y), Vector2(16, 16)), Rect2(g.x, g.y, 16, 16))
		x += int(g.xadvance)

func _text_width(value: String) -> int:
	if _gba: return int(_gba.font.get_string_size(value, HORIZONTAL_ALIGNMENT_LEFT, -1, 16).x)
	var width := 0
	for letter in value:
		width += int(_glyphs.get(letter.unicode_at(0), _glyphs.get(63, {})).get("xadvance", 8))
	return width

func _process(delta: float) -> void:
	_scroll += delta
	if _page == 1 and _text_width(String(_games[_row].get("name", ""))) > 200:
		_list.queue_redraw()
		_send_bottom()

func _bar(screen: Control, rect: Rect2, active := false) -> void:
	if _gba:
		_gba.menu(screen, rect)
		return
	var style := StyleBoxTexture.new()
	style.texture = _art.active if active else _art.dim
	for side in [SIDE_LEFT, SIDE_TOP, SIDE_RIGHT, SIDE_BOTTOM]:
		style.set_texture_margin(side, _margins[["left", "top", "right", "bottom"][side]])
	screen.draw_style_box(style, rect)

func _title() -> String:
	return "Other" if _group == 0 else "Gen %d - games" % _group

func _labels() -> Array:
	if _page == 0: return _groups.map(func(g): return "Other" if g == 0 else "Gen %d" % g)
	if _page == 1: return _games.map(func(j): return String(j.get("name", "Journey")))
	return ["SAIL", "BACK"]

func _draw_screen(screen: Control, list: bool) -> void:
	if _gba: screen.draw_rect(Rect2(0,0,256,192), _gba.color("menuPalette", 0))
	else: screen.draw_texture(_art.background, Vector2.ZERO)
	_bar(screen, Rect2(4, 4, 248, 26))
	_text(screen, ("CHOOSE A JOURNEY" if _page == 0 else _title()) if list else "JOURNEY DETAILS", Vector2(18, 8))
	if list:
		var labels := _labels()
		if _gba: _gba.menu(screen, Rect2(8,32,240,134))
		var first := maxi(0, _row - 5)
		for i in range(first, mini(first + 6, labels.size())):
			var y := 34 + (i - first) * 22
			if not _gba: _bar(screen, Rect2(12, y, 232, 22), i == _row)
			if i == _row:
				if _gba: _gba.arrow(screen, Vector2(17,y + 3))
				else: screen.draw_texture(_art.cursor, Vector2(17, y - 1))
			var label := String(labels[i])
			if i == _row and _text_width(label) > 200:
				label = (label + "   ").substr(int(maxf(0, _scroll - 1.5) * 3) % (label.length() + 3)) + "   " + label
			_text(screen, label, Vector2(34, y + 3), 194)
		_bar(screen, Rect2(8, 168, 76, 24))
		_text(screen, "BACK", Vector2(24, 172))
		_bar(screen, Rect2(92, 168, 156, 24), true)
		_text(screen, "A / SELECT", Vector2(112, 172))
	else:
		_bar(screen, Rect2(8, 36, 240, 124))
		var game: Dictionary = _chosen if _page == 2 else (_games[_row] if _page == 1 else {})
		var other: bool = (_page == 0 and not _groups.is_empty() and _groups[_row] == 0) or (not game.is_empty() and _picker_generation(game) == 0)
		if game.is_empty() and not other:
			_text(screen, "Choose a generation, then a game to set sail.", Vector2(22, 44), 208, true)
		elif other:
			# OTHER: hacks and games the companion doesn't fully support keep what they earn to themselves.
			_text(screen, String(game.get("name", "Other games")), Vector2(22, 44), 208)
			_text(screen, OTHER_NOTE, Vector2(22, 66), 208, true)
		else:
			_text(screen, String(game.get("name", "Journey")), Vector2(22, 44), 208, true)
			_text(screen, "Generation %d" % int(game.get("generation", 0)), Vector2(22, 104))
			_text(screen, _region(game), Vector2(22, 126))
		_text(screen, "A selects / B goes back", Vector2(18, 172))

const OTHER_NOTE := "Full companion support may not be available. Pokémon, items and progress stay in this game only."

func _region(game: Dictionary) -> String:
	var name := String(game.get("name", "")).to_lower()
	if "heartgold" in name or "soulsilver" in name: return "Johto / Kanto"
	if "firered" in name or "leafgreen" in name: return "Kanto"
	return {1:"Kanto", 2:"Johto / Kanto", 3:"Hoenn", 4:"Sinnoh", 5:"Unova"}.get(int(game.get("generation", 0)), "Region unknown")

func _picker_generation(game: Dictionary) -> int:
	# A supported game (journeys.json's "shared": HubActivity.writeJourneys) under its generation; the rest are Other.
	var generation := int(game.get("generation", 0))
	return generation if game.get("shared", false) and generation in range(1, 8) else 0

func _refresh() -> void:
	_scroll = 0.0
	_top.queue_redraw()
	_list.queue_redraw()
	_send_bottom()

func _send_bottom() -> void:
	if not _bottom or _sending: return
	_sending = true
	await RenderingServer.frame_post_draw
	_sending = false
	if is_instance_valid(_bottom) and not _closing: _plugin.show_bottom(_bottom.get_texture().get_image().save_png_to_buffer())

func _select() -> void:
	if _page == 0:
		_group = _groups[_row]
		_games = journeys.filter(func(j): return _picker_generation(j) == _group)
		_page = 1
	elif _page == 1:
		_chosen = _games[_row]
		_page = 2
	else:
		if _row == 0: _finish(_chosen)
		else: _back()
		return
	_row = 0
	_refresh()

func _back() -> void:
	if _page == 0: _finish({})
	else:
		_page -= 1
		_row = _groups.find(_group) if _page == 0 else _games.find(_chosen)
		_row = maxi(0, _row)
		_refresh()

func _finish(game: Dictionary) -> void:
	if _closing: return
	_closing = true
	if _bottom:
		_plugin.disconnect("bottom_touch", _bottom_touch)
		_plugin.hide_bottom()
	finished.emit(game)
	queue_free()

func _bottom_touch(x: int, y: int) -> void:
	# Screen pixels to the 2D layout's, then into the list's own.
	var point := Vector2(x, y) * Vector2(_bottom.size_2d_override) / Vector2(_bottom.size)
	_touch(_list.get_global_transform().affine_inverse() * point)

func _touch(point: Vector2) -> void:
	if Rect2(8,168,76,24).has_point(point): _back()
	elif Rect2(92,168,156,24).has_point(point): _select()
	elif point.x >= 12 and point.x < 244 and point.y >= 34 and point.y < 166:
		var index := maxi(0, _row - 5) + int((point.y - 34) / 22)
		if index < _labels().size():
			_row = index
			_select()

func _input(event: InputEvent) -> void:
	if _closing: return
	if event.is_action_pressed("run"): _back()
	elif event.is_action_pressed("interact"): _select()
	elif event.is_action_pressed("move_up", true) or event.is_action_pressed("move_left", true):
		_row = posmod(_row - 1, _labels().size())
		_refresh()
	elif event.is_action_pressed("move_down", true) or event.is_action_pressed("move_right", true):
		_row = posmod(_row + 1, _labels().size())
		_refresh()
	elif not _bottom and event is InputEventMouseButton and event.pressed and event.button_index == MOUSE_BUTTON_LEFT:
		_touch(_list.get_global_transform_with_canvas().affine_inverse() * event.position)
	elif not _bottom and event is InputEventScreenTouch and event.pressed:
		_touch(_list.get_global_transform_with_canvas().affine_inverse() * event.position)
	else: return
	get_viewport().set_input_as_handled()
