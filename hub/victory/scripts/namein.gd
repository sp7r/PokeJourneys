extends Node
## The trainer's name screen, built from the player's own Pokémon Platinum naming screen: the top
## screen's name box and the bottom screen's keyboard frame, pages, tabs, BACK / OK and cursor
## corners, exported from the ROM into the hub data folder (`node tools/hub/victory/ds2d.js namein
## <platinum.nds> <hub data>` writes ui/namein). Nothing of it is in this project.
##
## Laid out in DS pixels (256 x 192 a screen) and scaled to fit: with a second screen the name box
## goes on the top one and the keyboard on the bottom one, else the two screens sit side by side.
## The arrows move the cursor, A types (or presses the tab, BACK or OK under it), B deletes, START
## is OK, SELECT turns to the next page, as in the game. A touch or click types the key under it.
## Emits `done` with the name.

const Gba = preload("res://scripts/gba_frame.gd")
var _gba: Gba
var _fr_font: FontFile
var _fr_single := false
var _fr_cursor: Texture2D

signal done(entered_name: String)

## The pages, one a tab (UPPER, lower, Others): their rows of keys and their background.
const PAGES := [
	[["ABCDEFGHIJKLM", "NOPQRSTUVWXYZ"], "page-blue.png"],
	[["abcdefghijklm", "nopqrstuvwxyz"], "page-orange.png"],
	[["0123456789"], "page-green.png"],
]
const MAX_ROWS := 5  # the page's rows of checker squares under the tabs
const MAX_COLS := 13
## The tabs as [selected cell, unselected cell]; then BACK and OK as [cell, highlighted cell].
const TABS := [[0, 2], [4, 6], [8, 10]]
const BACK := [20, 19]
const OK := [22, 21]
## The tab row: tabs 30 x 22 and BACK / OK 37 x 22, each drawn from 8 pixels above its sprite's
## position (the cells' own drawing), one pixel apart.
const ROW_Y := 74
const TAB_X := 18
const TAB_STEP := 31
const BACK_X := 152
const OK_X := 194
const KEY_X := 16  # the page's checker squares, 16 DS pixels each
const KEY_Y := 104
const KEY := 16
const LENGTH := 7

var dir := ""
var font: FontFile
var game_font := false  # font is Platinum's own (creator.gd game_font), shadow and all
var trainer: Texture2D  # the trainer standing, facing down (32 x 32), beside the name
var entered := ""

var _cells := {}
var _textures := {}  # cell file -> texture, for swapping highlights
var _top: Control
var _bottom: Control
var _tabs: Array = []  # TextureRects
var _page: TextureRect  # the current page's background
var _keys: Array = []  # Labels, MAX_ROWS rows of MAX_COLS
var _pages := {}  # page file -> texture
var _back: TextureRect
var _ok: TextureRect
var _cursor: Array = []  # the four corner cells
var _slots: Array = []  # [letter Label, underline ColorRect] per character
var _row := 0  # -1: the tab row; 0-4: the keys
var _col := 0
var _tab := 0
var _time := 0.0


static func available(data_dir: String) -> bool:
	return Gba.available(data_dir) or FileAccess.file_exists(data_dir.path_join("ui/namein/cells.json"))


## Builds the screens: the top one in [top_parent] filling [top_size], the bottom one in
## [bottom_parent] filling [bottom_size] (the same parent and halves of it on one screen).
func build(top_parent: Node, top_rect: Rect2, bottom_parent: Node, bottom_rect: Rect2) -> void:
	if Gba.available():
		_build_fr(top_parent, top_rect, bottom_parent, bottom_rect)
		return
	_cells = JSON.parse_string(FileAccess.get_file_as_string(dir.path_join("cells.json")))
	_top = _screen(top_parent, top_rect, "top.png")
	_bottom = _screen(bottom_parent, bottom_rect, "bottom.png")
	_page = _image(_bottom, PAGES[0][1], Vector2(0, 80))
	_cell(_bottom, 31, Vector2(16, 60))
	for i in TABS.size():
		_tabs.append(_cell(_bottom, TABS[i][1], Vector2(TAB_X + i * TAB_STEP, ROW_Y)))
	_back = _cell(_bottom, BACK[0], Vector2(BACK_X, ROW_Y))
	_ok = _cell(_bottom, OK[0], Vector2(OK_X, ROW_Y))
	# A label per checker square; the page's letters go in them (_show).
	for r in MAX_ROWS:
		var line := []
		for c in MAX_COLS:
			var key := _label("", 16)
			key.position = Vector2(KEY_X + c * KEY + 1, KEY_Y + r * KEY)  # +1: the glyph's shadow column
			key.size = Vector2(KEY, KEY)
			_bottom.add_child(key)
			line.append(key)
		_keys.append(line)
	for corner in [61, 62, 63, 64]:
		_cursor.append(_cell(_bottom, corner, Vector2.ZERO))
	# The name: the trainer on the box's oval, then a slot per letter.
	if trainer:
		var icon := TextureRect.new()
		icon.texture = trainer
		icon.position = Vector2(19, 9)
		icon.size = Vector2(32, 32)
		_top.add_child(icon)
	for i in LENGTH:
		var letter := _label("", 16)
		letter.position = Vector2(76 + i * 11, 20)
		letter.size = Vector2(11, 16)
		_top.add_child(letter)
		var line := ColorRect.new()
		line.color = Color(0.13, 0.13, 0.16)
		line.position = Vector2(77 + i * 11, 38)
		line.size = Vector2(9, 2)
		_top.add_child(line)
		_slots.append([letter, line])
	_show()


## One DS screen: a 256 x 192 Control with [background], scaled to fit [rect] and centred, on a
## fill of the background's corner colour.
func _screen(parent: Node, rect: Rect2, background: String) -> Control:
	var image := Image.load_from_file(dir.path_join(background))
	var fill := ColorRect.new()
	fill.color = image.get_pixel(image.get_width() - 1, image.get_height() - 1) if image else Color.BLACK
	fill.position = rect.position
	fill.size = rect.size
	parent.add_child(fill)
	var screen := Control.new()
	var scale := minf(rect.size.x / 256.0, rect.size.y / 192.0)
	screen.scale = Vector2(scale, scale)
	screen.size = Vector2(256, 192)
	screen.position = rect.position + (rect.size - screen.size * scale) / 2.0
	parent.add_child(screen)
	_image(screen, background, Vector2.ZERO)
	return screen


func _image(parent: Control, file: String, at: Vector2) -> TextureRect:
	var image := Image.load_from_file(dir.path_join(file))
	var rect := TextureRect.new()
	if image: rect.texture = ImageTexture.create_from_image(image)
	rect.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
	rect.position = at
	rect.mouse_filter = Control.MOUSE_FILTER_IGNORE
	parent.add_child(rect)
	return rect


## A cell drawn with its sprite position at [at] (its own offset applied).
func _cell(parent: Control, index: int, at: Vector2) -> TextureRect:
	var info: Dictionary = _cells.get(str(index), {})
	var rect := _image(parent, String(info.get("file", "")), at)
	rect.set_meta("offset", Vector2(info.get("x", 0), info.get("y", 0)))
	rect.position = at + rect.get_meta("offset")
	return rect


func _swap(rect: TextureRect, index: int) -> void:
	var info: Dictionary = _cells.get(str(index), {})
	var file := String(info.get("file", ""))
	if not _textures.has(file):
		var image := Image.load_from_file(dir.path_join(file))
		_textures[file] = ImageTexture.create_from_image(image) if image else null
	if _textures[file] and rect.texture != _textures[file]: rect.texture = _textures[file]


func _label(text: String, size: int) -> Label:
	var label := Label.new()
	label.text = text
	label.add_theme_font_override("font", font)
	label.add_theme_font_size_override("font_size", size)
	if game_font:
		# The game's font carries its own colours and shadow.
		label.add_theme_color_override("font_color", Color.WHITE)
	else:
		label.add_theme_color_override("font_color", Color(0.13, 0.13, 0.16))
		label.add_theme_color_override("font_shadow_color", Color(0.7, 0.7, 0.75))
		label.add_theme_constant_override("shadow_offset_x", 1)
		label.add_theme_constant_override("shadow_offset_y", 1)
	label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	label.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return label


## The top row's items, left to right: the tabs, BACK, OK, with their centres in DS pixels.
func _top_row() -> Array:
	var items := []
	for i in TABS.size(): items.append(["tab", i, TAB_X + i * TAB_STEP + 15.0])
	items.append(["back", 0, BACK_X + 18.5])
	items.append(["ok", 0, OK_X + 18.5])
	return items


func _show() -> void:
	if _gba:
		_top.queue_redraw()
		_bottom.queue_redraw()
		return
	var blink := fmod(_time, 0.8) < 0.4
	for i in LENGTH:
		_slots[i][0].text = entered[i] if i < entered.length() else ""
		# The next blank blinks.
		_slots[i][1].visible = not (i == entered.length() and not blink)
	for i in TABS.size(): _swap(_tabs[i], TABS[i][0] if i == _tab else TABS[i][1])
	# The current page: its background and its letters.
	var file: String = PAGES[_tab][1]
	if not _pages.has(file):
		var image := Image.load_from_file(dir.path_join(file))
		_pages[file] = ImageTexture.create_from_image(image) if image else null
	if _pages[file]: _page.texture = _pages[file]
	var rows := _rows()
	for r in MAX_ROWS:
		for c in MAX_COLS:
			_keys[r][c].text = rows[r][c] if r < rows.size() and c < rows[r].length() else ""
	var on_back := _row == -1 and _col == TABS.size()
	var on_ok := _row == -1 and _col == TABS.size() + 1
	_swap(_back, BACK[1] if on_back else BACK[0])
	_swap(_ok, OK[1] if on_ok else OK[0])
	# The cursor's corners round the key (or the tab) it's on.
	var box := Rect2()
	if _row >= 0:
		box = Rect2(KEY_X + _col * KEY, KEY_Y + _row * KEY, KEY, KEY)
	elif _col < TABS.size():
		box = Rect2(TAB_X + _col * TAB_STEP, ROW_Y - 8, 30, 22)
	else:
		box = Rect2(Vector2(-100, -100), Vector2.ZERO)  # BACK / OK light up instead
	var corners := [box.position, Vector2(box.end.x, box.position.y), Vector2(box.position.x, box.end.y), box.end]
	for i in 4: _cursor[i].position = corners[i] + _cursor[i].get_meta("offset")


func tick(delta: float) -> void:
	var before := fmod(_time, 0.8) < 0.4
	_time += delta
	if before != (fmod(_time, 0.8) < 0.4): _show()


## Returns true when it used [event].
func handle(event: InputEvent) -> bool:
	if _gba: return _fr_handle(event)
	if event.is_action_pressed("move_left", true) or event.is_action_pressed("ui_left", true):
		_col = posmod(_col - 1, _width())
	elif event.is_action_pressed("move_right", true) or event.is_action_pressed("ui_right", true):
		_col = posmod(_col + 1, _width())
	elif event.is_action_pressed("move_up", true) or event.is_action_pressed("ui_up", true):
		_move_row(-1)
	elif event.is_action_pressed("move_down", true) or event.is_action_pressed("ui_down", true):
		_move_row(1)
	elif event.is_action_pressed("interact"):
		_press()
	elif event.is_action_pressed("run"):
		_delete()
	elif event is InputEventJoypadButton and event.pressed and event.button_index == JOY_BUTTON_START:
		done.emit(entered)
		return true
	elif (event is InputEventJoypadButton and event.pressed and event.button_index == JOY_BUTTON_BACK) \
			or (event is InputEventKey and event.pressed and not event.echo and event.keycode == KEY_TAB):
		_turn_to((_tab + 1) % PAGES.size())
	elif event is InputEventKey and event.pressed and not event.echo and event.keycode == KEY_BACKSPACE:
		_delete()
	elif event is InputEventKey and event.pressed and not event.echo and event.keycode == KEY_ENTER:
		done.emit(entered)
		return true
	elif event is InputEventKey and event.pressed and not event.echo and _allowed(char(event.unicode)):
		_type(char(event.unicode))
	else:
		return false
	_show()
	return true


## A touch or click at [at] in the bottom screen's own pixels (DS pixels after the screen's scale).
func touch(at: Vector2) -> void:
	if _gba:
		_fr_touch(at)
		return
	var p := (at - _bottom.position) / _bottom.scale
	var c := int(floor((p.x - KEY_X) / KEY))
	var r := int(floor((p.y - KEY_Y) / KEY))
	var rows := _rows()
	if r >= 0 and r < rows.size() and c >= 0 and c < rows[r].length():
		_row = r
		_col = c
		_press()
	elif p.y >= ROW_Y - 8 and p.y < ROW_Y + 14:
		for item_index in _top_row().size():
			if absf(p.x - _top_row()[item_index][2]) <= 16:
				_row = -1
				_col = item_index
				_press()
	_show()


## The current page's rows of keys.
func _rows() -> Array:
	return PAGES[_tab][0]


## Turns to page [tab]; a cursor on the keys stays on a key of the new page.
func _turn_to(tab: int) -> void:
	_tab = tab
	if _row >= 0:
		_row = mini(_row, _rows().size() - 1)
		_col = mini(_col, _rows()[_row].length() - 1)


func _width() -> int:
	return _top_row().size() if _row == -1 else _rows()[_row].length()


func _move_row(step: int) -> void:
	var x := _x_of()
	# Rows -1 (tabs, BACK, OK) to the page's last key row, wrapping round.
	_row = posmod(_row + 1 + step, _rows().size() + 1) - 1
	# Keep to the same place across the screen.
	if _row == -1:
		var best := 0
		for i in _top_row().size():
			if absf(_top_row()[i][2] - x) < absf(_top_row()[best][2] - x): best = i
		_col = best
	else:
		_col = clampi(int((x - KEY_X) / KEY), 0, _rows()[_row].length() - 1)


func _x_of() -> float:
	return _top_row()[_col][2] if _row == -1 else KEY_X + _col * KEY + KEY / 2.0


func _press() -> void:
	if _row >= 0:
		_type(_rows()[_row][_col])
		return
	var item: Array = _top_row()[_col]
	match item[0]:
		"tab": _turn_to(item[1])
		"back": _delete()
		"ok": done.emit(entered)


func _type(letter: String) -> void:
	if entered.length() < LENGTH: entered += letter


func _delete() -> void:
	entered = entered.substr(0, maxi(0, entered.length() - 1))


static func _allowed(text: String) -> bool:
	if text.length() != 1: return false
	var code := text.unicode_at(0)
	return (code >= 48 and code <= 57) or (code >= 65 and code <= 90) or (code >= 97 and code <= 122)

func _build_fr(top_parent: Node, top_rect: Rect2, bottom_parent: Node, bottom_rect: Rect2) -> void:
	_gba = Gba.new()
	font = _gba.font
	_fr_font = Gba.load_font(Gba.data_root(), true)
	_fr_single = top_parent == bottom_parent
	for pair in [[top_parent, top_rect], [bottom_parent, bottom_rect]]:
		var fill := ColorRect.new()
		fill.color = _gba.texture("naming-background").get_image().get_pixel(0,0)
		fill.position = pair[1].position
		fill.size = pair[1].size
		pair[0].add_child(fill)
		if _fr_single: break
	_top = Gba.screen(top_parent, top_rect, Vector2(240,160) if _fr_single else Vector2(240,80))
	_bottom = _top if _fr_single else Gba.screen(bottom_parent, bottom_rect, Vector2(240,88))
	_top.clip_contents = true
	_bottom.clip_contents = true
	_top.draw.connect(func(): _draw_fr(_top, true, _fr_single))
	if not _fr_single: _bottom.draw.connect(func(): _draw_fr(_bottom, false, true))
	_show()

func _fr_rows() -> Array:
	if _tab == 0: return ["ABCDEF .", "GHIJKL ,", "MNOPQRS ", "TUVWXYZ "]
	if _tab == 1: return ["abcdef .", "ghijkl ,", "mnopqrs ", "tuvwxyz "]
	return ["01234 ", "56789 ", "!?♂♀/-", "…“”‘' "]

func _fr_x(col: int) -> int:
	return int(_gba.metadata["symbolX" if _tab == 2 else "keyX"][col])

func _draw_fr(canvas: Control, input: bool, keyboard: bool) -> void:
	if not _fr_single and keyboard: canvas.draw_set_transform(Vector2(0,-72))
	canvas.draw_texture(_gba.texture("naming-background"), Vector2.ZERO)
	if input:
		canvas.draw_rect(Rect2(64,32,136,32), _gba.color("keyboardPalette",1))
		_gba.text(canvas, "YOUR NAME?", Vector2(73,33))
		if trainer: canvas.draw_texture_rect(trainer, Rect2(32,28,32,32), false)
		for i in LENGTH:
			if i < entered.length(): _gba.text(canvas, entered[i], Vector2(100 + i * 8,49))
			if i != entered.length() or fmod(_time,0.8) < 0.4:
				canvas.draw_texture(_gba.texture("underscore"), Vector2(97 + i * 8,56))
		canvas.draw_texture(_gba.texture("inputArrow"), Vector2(93,52))
	if not keyboard: return
	canvas.draw_texture(_gba.texture("naming-" + ["upper","lower","others"][_tab]), Vector2.ZERO)
	canvas.draw_rect(Rect2(24,80,152,64), _gba.color("keyboardPalette",[13,14,15][_tab]))
	for r in 4:
		var row: String = _fr_rows()[r]
		for c in row.length(): _gba.text(canvas, row[c], Vector2(_fr_x(c),81 + r * 16), -1, _fr_font)
	for piece in ["pageButton", ["pageLowerText","pageOthersText","pageUpperText"][_tab], "pageFrame", "back", "ok"]:
		var pos: Array = _gba.metadata.positions[piece]
		var file: String = ["pageButton", "pageButtonOthers", "pageButtonUpper"][_tab] if piece == "pageButton" else piece
		canvas.draw_texture(_gba.texture(file), Vector2(pos[0],pos[1]))
	if _col >= _fr_rows()[_row].length():
		_gba.arrow(canvas, Vector2(174, [80,80,108,132][_row]))
	else:
		_draw_fr_cursor(canvas, Vector2(_fr_x(_col) - 5,80 + _row * 16))

func _draw_fr_cursor(canvas: Control, at: Vector2) -> void:
	# The GBA cursor blends 12/16 foreground and 8/16 background in five-bit colour.
	var source := _gba.texture("cursor").get_image()
	var image := Image.create_empty(16,16,false,Image.FORMAT_RGBA8)
	var bg := _gba.color("keyboardPalette",[13,14,15][_tab])
	var row: String = _fr_rows()[_row]
	var font_image := _gba.texture("naming-font").get_image()
	var glyph := Rect2i()
	for line in FileAccess.get_file_as_string(_gba.dir.path_join("naming-font.fnt")).split("\n"):
		if line.begins_with("char id=%d " % row.unicode_at(_col)):
			var parts := line.split(" ")
			glyph = Rect2i(int(parts[2].trim_prefix("x=")),int(parts[3].trim_prefix("y=")),16,16)
	for y in 16:
		for x in 16:
			var fg := source.get_pixel(x,y)
			if fg.a == 0: continue
			var back := bg
			var px := x - 5
			var py := y - 1
			if px >= 0 and py >= 0:
				var ink := font_image.get_pixel(glyph.position.x + px, glyph.position.y + py)
				if ink.a > 0: back = ink
			var rgb := Color.BLACK
			for channel in 3:
				rgb[channel] = minf(31, floor((round(fg[channel] * 31) * 12 + round(back[channel] * 31) * 8) / 16)) / 31.0
			image.set_pixel(x,y,rgb)
	_fr_cursor = ImageTexture.create_from_image(image)
	canvas.draw_texture(_fr_cursor,at)

func _fr_press() -> void:
	var row: String = _fr_rows()[_row]
	if _col < row.length():
		if _allowed(row[_col]): _type(row[_col])
	elif _row < 2: _tab = (_tab + 1) % 3
	elif _row == 2: _delete()
	else: done.emit(entered)
	_show()

func _fr_handle(event: InputEvent) -> bool:
	if event.is_action_pressed("move_left",true) or event.is_action_pressed("ui_left",true): _col = posmod(_col - 1, _fr_rows()[_row].length() + 1)
	elif event.is_action_pressed("move_right",true) or event.is_action_pressed("ui_right",true): _col = posmod(_col + 1, _fr_rows()[_row].length() + 1)
	elif event.is_action_pressed("move_up",true) or event.is_action_pressed("ui_up",true): _row = posmod(_row - 1,4)
	elif event.is_action_pressed("move_down",true) or event.is_action_pressed("ui_down",true): _row = posmod(_row + 1,4)
	elif (event is InputEventJoypadButton and event.pressed and event.button_index == JOY_BUTTON_START) or (event is InputEventKey and event.pressed and event.keycode == KEY_ENTER):
		done.emit(entered)
		return true
	elif (event is InputEventJoypadButton and event.pressed and event.button_index == JOY_BUTTON_BACK) or (event is InputEventKey and event.pressed and event.keycode == KEY_TAB): _tab = (_tab + 1) % 3
	elif event.is_action_pressed("run") or (event is InputEventKey and event.pressed and event.keycode == KEY_BACKSPACE): _delete()
	elif event.is_action_pressed("interact"): _fr_press()
	elif event is InputEventKey and event.pressed and not event.echo and _allowed(char(event.unicode)): _type(char(event.unicode))
	else: return false
	_col = mini(_col, _fr_rows()[_row].length())
	_show()
	return true

func _fr_touch(at: Vector2) -> void:
	var p := (at - _bottom.position) / _bottom.scale
	if not _fr_single: p.y += 72
	if p.x >= 184 and p.x < 224:
		if p.y >= 72 and p.y < 104: _tab = (_tab + 1) % 3
		elif p.y >= 104 and p.y < 128: _delete()
		elif p.y >= 128 and p.y < 152: done.emit(entered)
	elif p.y >= 80 and p.y < 144 and p.x >= 24 and p.x < 176:
		_row = int((p.y - 80) / 16)
		var best := 0
		for c in _fr_rows()[_row].length():
			if absf(p.x - _fr_x(c)) < absf(p.x - _fr_x(best)): best = c
		_col = best
		_fr_press()
	_col = mini(_col, _fr_rows()[_row].length())
	_show()
