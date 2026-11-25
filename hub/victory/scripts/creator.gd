extends CanvasLayer
## Character creator: external FireRed field windows when present; otherwise the trainer on a banded
## sky under a "Create your trainer" header (left; the top screen there), and a grid of pixel-window
## choices on blue stripes (right; the bottom screen): each row a part with its style and its colour.
## The look is the creator's own, in the spirit of handheld games of the GBA era (FRAMES, PIXEL).
## With a second screen, as on the DS, the trainer fills the top one and the buttons go below.
## The arrows move the highlight, A steps the highlighted button to its next choice and B back;
## a click does the same (right click goes back). A on DONE saves the look and emits `finished`.

signal finished(look: Dictionary)

const Gba = preload("res://scripts/gba_frame.gd")
var _gba: Gba
var _gba_options: Control
var _gba_preview: Control
var _backdrop_background: Texture2D
var _backdrop_base: Texture2D
var _backdrop_origin := Vector2.ZERO
var _backdrop_base_position := Vector2.ZERO

const Character = preload("res://scripts/character.gd")
const CostumeParts = preload("res://scripts/costume_parts.gd")
const Namein = preload("res://scripts/namein.gd")
## The creator's own handheld-era look (drawn here, nothing taken from any game): chunky pixel
## windows with a notched corner, a dark outline and a light inner rim, a small fixed palette, and
## every pixel PIXEL screen pixels wide with no smoothing.
const PIXEL := 4
const INK := Color("283048")
const SHADOW := Color("c8c8d0")
## Window kinds: [outline, inner rim, panel].
const FRAMES := {
	"window": [Color("283048"), Color("f8f8f8"), Color("f0ecd8")],
	"tag": [Color("283048"), Color("d8e8f8"), Color("a8c0e8")],
	"option": [Color("283048"), Color("ffffff"), Color("e8e8f0")],
	"lit": [Color("c83830"), Color("fff8d8"), Color("f8d870")],
	"lit_dim": [Color("f08070"), Color("fff8d8"), Color("f8d870")],
}
## Behind the buttons: two blues in diagonal pixel stripes.
const STRIPES := [Color("4868a8"), Color("5878b8")]
## Behind the trainer: a stepped sky, light to dark, a few flat bands.
const SKY := [Color("a8d0f0"), Color("90c0e8"), Color("78a8d8"), Color("6090c8"), Color("4878b0"), Color("385c98"), Color("2c4478")]
const BLINK := 0.4  # seconds per half of the letter cursor's blink
## The choices' and labels' text: three times the game font's 16 pixels (whole multiples keep it
## crisp), and the row labels' width to fit "BOTTOM" at that size.
const TEXT_SIZE := 48
const NARROW_TEXT_SIZE := 32  # when the buttons have under 560 pixels of width (_ready)
const TAG_WIDTH := 176

static var _frames := {}
## The window colours in use: FRAMES, or the player's own Platinum naming screen's (_ds_style).
static var _kinds := FRAMES.duplicate(true)
## The game's touch buttons by window kind, drawn twice their size (_ds_style); empty without them.
static var _button_art := {}
## Whether _font is the game's own (its shadow drawn in, so labels add none).
var _game_font := false
var _text_size := TEXT_SIZE
## The backgrounds from the naming screen, when it's in the hub data: its top screen's bands behind
## the trainer and its bottom screen's stripes behind the buttons.
var _sky_art: Texture2D
var _panel_art: Texture2D
## [label, left button, right button]; a button is [look key, part].
const ROWS := [["BODY", ["gender", ""], ["skin", ""]], ["HAIR", ["hair", "style"], ["hair", "color"]],
		["TOP", ["top", "style"], ["top", "color"]], ["BOTTOM", ["bottom", "style"], ["bottom", "color"]],
		["BACK", ["bag", "style"], ["bag", "color"]], ["HAT", ["hat", "style"], ["hat", "color"]]]

## The rows after ROWS' six: the trainer's name, then DONE.
const NAME_ROW := 6
const DONE_ROW := 7
## Trainer names: up to 7 letters and digits, so every game can show them (the save bridge's rule,
## TrainerProfile.cs). The games read it from character.json's "name".
const NAME_LENGTH := 7
const KEYS := ["ABCDEFGHIJ", "KLMNOPQRST", "UVWXYZ", "abcdefghij", "klmnopqrst", "uvwxyz", "0123456789"]

var look := {}
var _buttons: Array = []  # per row: [left, right] PanelContainers; the last row holds DONE alone
var _row := 0
var _col := 0
var _atlas := AtlasTexture.new()
var _front: Texture2D
var _time := 0.0
var _font: FontFile
## With a second screen (the app's PokeJourneys plugin): the trainer fills the top screen and the
## buttons are drawn here, off-screen, and shown on the bottom one; null on one screen.
var _bottom: SubViewport
var _plugin: Object
var _sending := false
## The letter grid while it's open: its panel, the name so far, and the keys ([label, button] per
## key, DEL and OK last) with the highlighted one.
var _naming: Control
var _name_shown: Label
var _keys: Array = []
var _key := 0
var _draft := ""
## The DS name screen while it's open (namein.gd), and the layers it draws in.
var _ds_naming: Node
var _ds_layers: Array = []


func _ready() -> void:
	layer = 9
	var base: Dictionary = Character.DEFAULT.duplicate(true)
	base.merge(look, true)
	look = base
	# No name yet: start from the Discord name, cut to what the games take.
	if String(look.get("name", "")) == "" and Engine.has_singleton("PokeJourneys"):
		look["name"] = _clean_name(Engine.get_singleton("PokeJourneys").account_name())
	_font = load("res://fonts/PixelOperator.ttf") as FontFile
	_font.antialiasing = TextServer.FONT_ANTIALIASING_NONE
	_font.hinting = TextServer.HINTING_NONE
	_font.subpixel_positioning = TextServer.SUBPIXEL_POSITIONING_DISABLED
	if Engine.has_singleton("PokeJourneys"):
		_plugin = Engine.get_singleton("PokeJourneys")
		var screen: PackedInt32Array = _plugin.second_screen_size() if _plugin.has_second_screen() else PackedInt32Array()
		if screen.size() == 2 and screen[0] > 0 and screen[1] > 0:
			_bottom = SubViewport.new()
			# Drawn at the top screen's scale (the project's 1280 x 720, stretched), so text and
			# rims are the same size on both screens; the app scales the picture up to fill.
			var scale := float(DisplayServer.window_get_size().y) / get_viewport().get_visible_rect().size.y
			# The bottom screen renders at its own resolution with the 2D laid out at the top screen's scale,
			# so pixel art can use whole physical pixels there (Gba.screen) while text keeps its size.
			_bottom.size = Vector2i(screen[0], screen[1])
			_bottom.size_2d_override = Vector2i(roundi(screen[0] / scale), roundi(screen[1] / scale))
			_bottom.size_2d_override_stretch = true
			_bottom.render_target_update_mode = SubViewport.UPDATE_ALWAYS
			# Square pixels, as on the top screen: a SubViewport smooths its 2D by default, which
			# blurs the art and bleeds the font's neighbouring letters into each other.
			_bottom.canvas_item_default_texture_filter = Viewport.DEFAULT_CANVAS_ITEM_TEXTURE_FILTER_NEAREST
			add_child(_bottom)
			_plugin.connect("bottom_touch", _on_bottom_touch)
	_ds_style()
	_font = Gba.load_font()
	_game_font = _font.fixed_size > 0
	if Gba.available():
		_gba = Gba.new()
		_font = _gba.font
		_game_font = true
	# The buttons get the second screen, or half of this one.
	var width: float = _bottom.size_2d_override.x if _bottom else get_viewport().get_visible_rect().size.x / 2.0
	_text_size = TEXT_SIZE if width >= 560 else NARROW_TEXT_SIZE
	_build_preview()
	_build_buttons()
	_refresh()


## With the player's own Platinum naming screen in the hub data (namein.gd), the creator takes its
## colours and backgrounds: its name box's outline, rim and panel for the windows, a selected tab's
## colours and BACK's for the highlight, its bands and stripes behind. Nothing of it is in this
## project; without it the creator keeps its own look (FRAMES).
func _ds_style() -> void:
	_kinds = FRAMES.duplicate(true)
	_frames.clear()
	_button_art.clear()
	if OverworldSprite.data_root == "" or not FileAccess.file_exists(OverworldSprite.data_root.path_join("ui/namein/cells.json")): return
	var dir := OverworldSprite.data_root.path_join("ui/namein")
	var top := Image.load_from_file(dir.path_join("top.png"))
	var bottom := Image.load_from_file(dir.path_join("bottom.png"))
	var tab := Image.load_from_file(dir.path_join("cell-00.png"))
	var back := Image.load_from_file(dir.path_join("cell-20.png"))
	if not (top and bottom and tab and back): return
	var outline := top.get_pixel(40, 1)
	var rim := top.get_pixel(40, 3)
	var cream := top.get_pixel(40, 10)
	var lit := _common_colors(tab)
	var lit_edge: Color = _common_colors(back)[0]
	_kinds = {
		"window": [outline, rim, cream],
		"tag": [outline, cream, rim],
		"option": [outline, rim, cream],
		"lit": [lit_edge, lit[1], lit[0]],
		"lit_dim": [rim, lit[1], lit[0]],
	}
	var sky := AtlasTexture.new()
	sky.atlas = ImageTexture.create_from_image(top)
	sky.region = Rect2(0, 48, 256, 144)  # below the name box
	_sky_art = sky
	var stripes := AtlasTexture.new()
	stripes.atlas = ImageTexture.create_from_image(bottom)
	stripes.region = Rect2(0, 0, 256, 96)  # above the keyboard's frame
	_panel_art = stripes
	# The game's touch buttons for the choices (blue, the highlighted one red) and its text font.
	var buttons := OverworldSprite.data_root.path_join("ui/buttons")
	for pair in [["option", "blue"], ["lit", "red"], ["lit_dim", "red-lit"]]:
		var art := Image.load_from_file(buttons.path_join(pair[1] + ".png"))
		if art:
			art.resize(art.get_width() * 2, art.get_height() * 2, Image.INTERPOLATE_NEAREST)
			_button_art[pair[0]] = ImageTexture.create_from_image(art)
	var font := game_font(OverworldSprite.data_root)
	if font:
		_font = font
		_game_font = true


## Platinum's text font from the hub data (ds2d.js writes ui/font), or null: an AngelCode bitmap
## font, 16 pixels, drawn at whole multiples of that so every pixel stays square.
static func game_font(data_root: String) -> FontFile:
	return Gba.load_font(data_root)


static func _platinum_font(data_root: String) -> FontFile:
	var file := data_root.path_join("ui/font/font.fnt")
	if data_root == "" or not FileAccess.file_exists(file): return null
	var font := FontFile.new()
	if font.load_bitmap_font(file) != OK: return null
	font.fixed_size_scale_mode = TextServer.FIXED_SIZE_SCALE_INTEGER_ONLY
	return font


## [image]'s opaque colours, most used first.
static func _common_colors(image: Image) -> Array:
	var counts := {}
	for y in image.get_height():
		for x in image.get_width():
			var c := image.get_pixel(x, y)
			if c.a > 0.5: counts[c] = counts.get(c, 0) + 1
	var colors := counts.keys()
	colors.sort_custom(func(a, b): return counts[a] > counts[b])
	return colors


# --- Left: the trainer ------------------------------------------------------------------------

func _build_preview() -> void:
	if _gba:
		_build_gba_preview()
		return
	# The left half of the screen, or all of it when the buttons are on the second screen.
	var area := Control.new()
	area.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var width := 1.0 if _bottom else 0.5
	_place(area, Vector2(0, 0), Vector2(width, 1))
	# The sky in flat bands, as an old handheld would draw it.
	var sky := TextureRect.new()
	var gradient := Gradient.new()
	gradient.interpolation_mode = Gradient.GRADIENT_INTERPOLATE_CONSTANT
	gradient.offsets = PackedFloat32Array(range(SKY.size()).map(func(i): return float(i) / SKY.size()))
	gradient.colors = PackedColorArray(SKY)
	var texture := GradientTexture2D.new()
	texture.gradient = gradient
	texture.fill_from = Vector2(0, 0)
	texture.fill_to = Vector2(0, 1)
	sky.texture = _sky_art if _sky_art else texture
	sky.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
	sky.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	sky.stretch_mode = TextureRect.STRETCH_SCALE
	_place(sky, Vector2(0, 0), Vector2(1, 1), area)

	var header := _box("window")
	if _gba:
		header.add_theme_stylebox_override("panel", _gba.style(2))
	var title := _text("Create your trainer", 48)
	title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	header.add_child(title)
	_place(header, Vector2(0.06, 0.04), Vector2(0.94, 0.04), area)

	# A pixel ground shadow, drawn small and scaled up like the sprite.
	var shadow_image := Image.create_empty(48, 12, false, Image.FORMAT_RGBA8)
	for y in 12:
		for x in 48:
			var d := Vector2((x + 0.5 - 24.0) / 24.0, (y + 0.5 - 6.0) / 6.0)
			if d.length_squared() <= 1.0: shadow_image.set_pixel(x, y, Color("1c2c58"))
	var shadow := TextureRect.new()
	shadow.texture = ImageTexture.create_from_image(shadow_image)
	shadow.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
	shadow.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	# The same size on the screen whatever the area's width.
	var half := 0.16 / width
	_place(shadow, Vector2(0.5 - half, 0.74), Vector2(0.5 + half, 0.74 + 0.08), area)

	var hero := TextureRect.new()
	hero.texture = _atlas
	hero.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
	hero.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	hero.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	_place(hero, Vector2(0.1, 0.2), Vector2(0.9, 0.8), area)


# --- Right: the buttons -----------------------------------------------------------------------

func _build_buttons() -> void:
	if _gba:
		_build_gba_options()
		return
	# The right half of the screen, or the whole second screen.
	var panel := Control.new()
	if _bottom:
		_place(panel, Vector2(0, 0), Vector2(1, 1), _bottom)
	else:
		_place(panel, Vector2(0.5, 0), Vector2(1, 1))
	var stripes := TextureRect.new()
	stripes.texture = _panel_art if _panel_art else _stripes()
	stripes.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
	stripes.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	stripes.stretch_mode = TextureRect.STRETCH_SCALE if _panel_art else TextureRect.STRETCH_TILE
	_place(stripes, Vector2(0, 0), Vector2(1, 1), panel)
	var grid := VBoxContainer.new()
	grid.add_theme_constant_override("separation", PIXEL)
	_place(grid, Vector2(0.03, 0.04), Vector2(0.97, 0.96), panel)
	for r in ROWS.size():
		var line := HBoxContainer.new()
		line.size_flags_vertical = Control.SIZE_EXPAND_FILL
		line.add_theme_constant_override("separation", 8)
		grid.add_child(line)
		var tag := _box("tag", 1)
		tag.custom_minimum_size = Vector2(TAG_WIDTH, 0)
		var name := _text(ROWS[r][0], _text_size)
		name.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
		name.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		if not _game_font: name.add_theme_color_override("font_shadow_color", Color("d8e8f8"))
		tag.add_child(name)
		line.add_child(tag)
		var pair := []
		for c in 2:
			var button := _button(1)
			button.size_flags_horizontal = Control.SIZE_EXPAND_FILL
			button.size_flags_stretch_ratio = 1.2 if c == 0 else 1.0
			_hook(button, r, c)
			line.add_child(button)
			pair.append(button)
		_buttons.append(pair)
	# NAME: one wide button; A opens the letter grid (_open_naming).
	var name_line := HBoxContainer.new()
	name_line.size_flags_vertical = Control.SIZE_EXPAND_FILL
	name_line.add_theme_constant_override("separation", 8)
	grid.add_child(name_line)
	var name_tag := _box("tag", 1)
	name_tag.custom_minimum_size = Vector2(TAG_WIDTH, 0)
	var name_label := _text("NAME", _text_size)
	name_label.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	name_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	if not _game_font: name_label.add_theme_color_override("font_shadow_color", Color("d8e8f8"))
	name_tag.add_child(name_label)
	name_line.add_child(name_tag)
	var name_button := _button(1)
	name_button.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_hook(name_button, NAME_ROW, 0)
	name_line.add_child(name_button)
	_buttons.append([name_button])
	var last := HBoxContainer.new()
	last.size_flags_vertical = Control.SIZE_EXPAND_FILL
	last.alignment = BoxContainer.ALIGNMENT_CENTER
	grid.add_child(last)
	var done := _button(1)
	done.custom_minimum_size = Vector2(260, 0)
	(done.get_meta("label") as Label).text = "DONE"
	_hook(done, DONE_ROW, 0)
	last.add_child(done)
	_buttons.append([done])


## A choice: a small pixel window with its label centred ([_light] marks the highlighted one).
## [padding] in art pixels inside the rim (a letter key needs less).
func _button(padding := 4, size := 0) -> PanelContainer:
	var button := _box("option", padding)
	var label := _text("", size if size > 0 else _text_size)
	label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	label.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	button.add_child(label)
	button.set_meta("label", label)
	button.set_meta("padding", padding)
	return button


## The highlight: a red cursor box (its outline pale on the blink's off beat).
func _light(button: PanelContainer, lit: bool, dim := false) -> void:
	var kind := ("lit_dim" if dim else "lit") if lit else "option"
	button.add_theme_stylebox_override("panel", _frame(kind, int(button.get_meta("padding", 4))))


func _hook(button: PanelContainer, r: int, c: int) -> void:
	button.gui_input.connect(func(event: InputEvent):
		if _naming or _ds_naming: return
		if event is InputEventMouseButton and event.pressed and event.button_index in [MOUSE_BUTTON_LEFT, MOUSE_BUTTON_RIGHT]:
			_row = r
			_col = c
			_press(-1 if event.button_index == MOUSE_BUTTON_RIGHT else 1))


func _box(kind: String, padding := 4) -> PanelContainer:
	var panel := PanelContainer.new()
	panel.add_theme_stylebox_override("panel", _frame(kind, padding))
	return panel


## A pixel window of [kind] (FRAMES) as a nine-slice: a 5 x 5 art-pixel tile, PIXEL screen pixels
## each, with the corner pixel cut away, the outline, the inner rim and the flat panel; its
## content sits [padding] art pixels in.
static func _frame(kind: String, padding := 4) -> StyleBoxTexture:
	var key := "%s|%d" % [kind, padding]
	if _frames.has(key): return _frames[key]
	if _button_art.has(kind):
		# The game's touch button: its rounded rim kept, its plain middle stretched (7 x 8 pixels
		# of rim each side, twice that drawn).
		var button := StyleBoxTexture.new()
		button.texture = _button_art[kind]
		button.texture_margin_left = 14
		button.texture_margin_right = 14
		button.texture_margin_top = 16
		button.texture_margin_bottom = 16
		button.set_content_margin_all(padding * PIXEL)
		_frames[key] = button
		return button
	var colors: Array = _kinds[kind]
	var image := Image.create_empty(5 * PIXEL, 5 * PIXEL, false, Image.FORMAT_RGBA8)
	for y in 5:
		for x in 5:
			var dx := mini(x, 4 - x)
			var dy := mini(y, 4 - y)
			var color := Color(0, 0, 0, 0)
			if dx == 0 and dy == 0: color = Color(0, 0, 0, 0)
			elif dx == 0 or dy == 0: color = colors[0]
			elif dx == 1 or dy == 1: color = colors[1]
			else: color = colors[2]
			image.fill_rect(Rect2i(x * PIXEL, y * PIXEL, PIXEL, PIXEL), color)
	var style := StyleBoxTexture.new()
	style.texture = ImageTexture.create_from_image(image)
	style.set_texture_margin_all(2 * PIXEL)
	style.set_content_margin_all(padding * PIXEL)
	_frames[key] = style
	return style


## Diagonal two-blue stripes, a tile of whole pixels.
static func _stripes() -> ImageTexture:
	var size := 8
	var image := Image.create_empty(size * PIXEL, size * PIXEL, false, Image.FORMAT_RGBA8)
	for y in size:
		for x in size:
			image.fill_rect(Rect2i(x * PIXEL, y * PIXEL, PIXEL, PIXEL), STRIPES[int(((x + y) % size) < size / 2)])
	return ImageTexture.create_from_image(image)


func _place(control: Control, from: Vector2, to: Vector2, parent: Node = self) -> void:
	control.anchor_left = from.x
	control.anchor_top = from.y
	control.anchor_right = to.x
	control.anchor_bottom = to.y
	parent.add_child(control)


func _text(value: String, size: int) -> Label:
	var label := Label.new()
	label.text = value
	label.add_theme_font_override("font", _font)
	label.add_theme_font_size_override("font_size", size)
	if _game_font:
		# The game's font carries its own colours and shadow.
		label.add_theme_color_override("font_color", Color.WHITE)
		return label
	label.add_theme_color_override("font_color", INK)
	label.add_theme_color_override("font_shadow_color", SHADOW)
	# Sizes are whole multiples of the font's 16 px design so every pixel stays square; the shadow
	# sits one font pixel down and right, as in DS text.
	label.add_theme_constant_override("shadow_offset_x", size / 16)
	label.add_theme_constant_override("shadow_offset_y", size / 16)
	return label


# --- Choices ----------------------------------------------------------------------------------

## A button's choices and the index of the current one.
func _options(cell: Array) -> Array:
	match cell[0]:
		"gender": return [["Boy", "Girl"], 0 if look.gender == "m" else 1]
		"skin": return [Character.SKINS.map(func(s): return s.capitalize()), maxi(0, Character.SKINS.find(look.skin))]
	var styles := _styles(cell[0])
	if styles.is_empty(): return [[""], 0]
	var chosen: Array = look[cell[0]]
	var style := 0
	for i in styles.size():
		if styles[i].name == chosen[0]: style = i
	if cell[1] == "style":
		return [styles.map(func(s): return s.name), style]
	var colors: Array = styles[style].colors
	var color := 0
	for i in colors.size():
		if colors[i].label == chosen[1]: color = i
	return [colors.map(func(c): return c.label.capitalize() if c.label != "" else ""), color]


func _styles(slot: String) -> Array:
	return CostumeParts.creator_styles(slot, look.gender, look[slot][0])


## A (step 1) or B (step -1) on the highlighted button.
func _press(step: int) -> void:
	if _row == NAME_ROW:
		if step > 0: _open_naming()
		return
	if _row == DONE_ROW:
		if step > 0: finish()
		return
	var cell: Array = ROWS[_row][1 + _col]
	var options: Array = _options(cell)
	var names: Array = options[0]
	if names.size() < 2:
		_refresh()
		return
	var index: int = posmod(options[1] + step, names.size())
	match cell[0]:
		"gender": look.gender = ["m", "f"][index]
		"skin": look.skin = Character.SKINS[index]
		_:
			var styles := _styles(cell[0])
			var chosen: Array = look[cell[0]]
			if cell[1] == "style":
				# Keep the colour when the new style has it.
				var style: Dictionary = styles[index]
				var keep: bool = style.colors.any(func(c): return c.label == chosen[1])
				look[cell[0]] = [style.name, chosen[1] if keep else style.colors[0].label]
			else:
				for s in styles:
					if s.name == chosen[0]: look[cell[0]] = [chosen[0], s.colors[index].label]
	_refresh()


## [look_changed] false when only the highlight moved: the trainer's sheet stays as it is.
func _refresh(look_changed := true) -> void:
	# A body change can drop parts made for the other one; settle each slot on a real pick.
	for s in Character.SLOTS:
		var styles := Character.styles(s[0], look.gender)
		if styles.is_empty(): continue
		var chosen: Array = look.get(s[0], ["", ""])
		var style: Dictionary = styles[0]
		for o in styles:
			if o.name == chosen[0]: style = o
		var color: Dictionary = style.colors[0]
		for c in style.colors:
			if c.label == chosen[1]: color = c
		look[s[0]] = [style.name, color.label]
	for r in _buttons.size():
		for c in _buttons[r].size():
			var button: PanelContainer = _buttons[r][c]
			if r < ROWS.size():
				var options: Array = _options(ROWS[r][1 + c])
				(button.get_meta("label") as Label).text = options[0][options[1]]
			elif r == NAME_ROW:
				var name := String(look.get("name", ""))
				(button.get_meta("label") as Label).text = name if name != "" else "Choose a name"
			_light(button, r == _row and c == _col)
	if look_changed or _atlas.atlas == null:
		var sheet := Character.build_sheet(look)
		_atlas.atlas = ImageTexture.create_from_image(sheet)
		if _gba: _front = ImageTexture.create_from_image(Character.build_front(look, sheet))
	_show_frame()
	if _gba_options: _gba_options.queue_redraw()
	_send_bottom()


## The buttons as drawn this frame, to the second screen (once per frame, however many changes).
func _send_bottom() -> void:
	if _bottom == null or _sending: return
	_sending = true
	await RenderingServer.frame_post_draw
	_sending = false
	if is_instance_valid(_bottom):
		_plugin.show_bottom(_bottom.get_texture().get_image().save_png_to_buffer())


## A touch on the second screen, in its pixels: a click on the button there.
func _on_bottom_touch(px: int, py: int) -> void:
	if not is_instance_valid(_bottom): return
	# The touch is in the screen's pixels; the 2D is laid out at size_2d_override.
	var x := px * _bottom.size_2d_override.x / _bottom.size.x
	var y := py * _bottom.size_2d_override.y / _bottom.size.y
	if _ds_naming:
		_ds_naming.touch(Vector2(x, y))
		_send_bottom()
		return
	for pressed in [true, false]:
		var click := InputEventMouseButton.new()
		click.button_index = MOUSE_BUTTON_LEFT
		click.pressed = pressed
		click.position = Vector2(x, y)
		click.global_position = click.position
		_bottom.push_input(click, true)


## The preview's loop: [motion (0 walk sheet, 1 run sheet), animated, seconds per facing, seconds
## per frame]. The trainer stands, walks, then runs, turning through every facing in each.
const SHOWCASE := [[0, false, 1.2, 1.0], [0, true, 1.2, 0.2], [1, true, 1.0, 0.1]]
const TURN := [1, 3, 0, 2]  # down, right, up, left: a turn on the spot


## The trainer stands, walks and runs on the spot, turning so its front, sides and back show.
func _show_frame() -> void:
	var cycle := 0.0
	for mode in SHOWCASE: cycle += mode[2] * TURN.size()
	var t := fmod(_time, cycle)
	for mode in SHOWCASE:
		var span: float = mode[2] * TURN.size()
		if t < span:
			var direction: int = TURN[int(t / mode[2])]
			var frame: int = int(t / mode[3]) % 4 if mode[1] else 0
			_atlas.region = Rect2((mode[0] * 16 + direction * 4 + frame) * 32, 0, 32, 32)
			return
		t -= span


func _process(delta: float) -> void:
	var beat := fmod(_time, BLINK * 2.0) < BLINK
	_time += delta
	_show_frame()
	if _gba_preview: _gba_preview.queue_redraw()
	if _naming and beat != (fmod(_time, BLINK * 2.0) < BLINK): _show_naming()
	if _ds_naming: _ds_naming.tick(delta)


func _unhandled_input(event: InputEvent) -> void:
	if _ds_naming:
		var used: bool = _ds_naming.handle(event)
		if not used and not _bottom and event is InputEventMouseButton and event.pressed:
			_ds_naming.touch(event.position)
			used = true
		if used:
			get_viewport().set_input_as_handled()
			_send_bottom()
		return
	if _naming:
		_naming_input(event)
		return
	var moved := true
	if event.is_action_pressed("move_up", true) or event.is_action_pressed("ui_up", true):
		_row = posmod(_row - 1, 8 if _gba else _buttons.size())
	elif event.is_action_pressed("move_down", true) or event.is_action_pressed("ui_down", true):
		_row = posmod(_row + 1, 8 if _gba else _buttons.size())
	elif event.is_action_pressed("move_left", true) or event.is_action_pressed("ui_left", true):
		_col = posmod(_col - 1, 2)
	elif event.is_action_pressed("move_right", true) or event.is_action_pressed("ui_right", true):
		_col = posmod(_col + 1, 2)
	elif event.is_action_pressed("interact"):
		moved = false
		_press(1)
	elif event.is_action_pressed("run"):
		moved = false
		_press(-1)
	else:
		return
	if moved:
		_col = mini(_col, (0 if _row >= NAME_ROW else 1) if _gba else _buttons[_row].size() - 1)
		_refresh(false)
	get_viewport().set_input_as_handled()


## The DS name screen (namein.gd), from the player's own Platinum naming screen in the hub data:
## the name box on the top screen and the keyboard on the bottom one, or side by side on one.
func _open_ds_naming() -> void:
	var screen := Namein.new()
	screen.dir = OverworldSprite.data_root.path_join("ui/namein")
	screen.font = _font
	screen.game_font = _game_font
	screen.entered = String(look.get("name", ""))
	var icon := AtlasTexture.new()
	icon.atlas = _atlas.atlas
	icon.region = Rect2(4 * 32, 0, 32, 32)  # standing, facing down
	screen.trainer = icon
	add_child(screen)
	var size := get_viewport().get_visible_rect().size
	var top := Control.new()
	top.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_place(top, Vector2.ZERO, Vector2.ONE)
	_ds_layers = [top]
	if _bottom:
		var below := Control.new()
		below.mouse_filter = Control.MOUSE_FILTER_IGNORE
		_place(below, Vector2.ZERO, Vector2.ONE, _bottom)
		_ds_layers.append(below)
		screen.build(top, Rect2(Vector2.ZERO, size), below, Rect2(Vector2.ZERO, Vector2(_bottom.size_2d_override)))
	else:
		if _gba:
			screen.build(top, Rect2(Vector2.ZERO, size), top, Rect2(Vector2.ZERO, size))
		else:
			screen.build(top, Rect2(Vector2.ZERO, Vector2(size.x / 2, size.y)), top, Rect2(Vector2(size.x / 2, 0), Vector2(size.x / 2, size.y)))
	screen.done.connect(func(entered: String):
		look["name"] = entered
		for layer in _ds_layers: layer.queue_free()
		_ds_layers.clear()
		screen.queue_free()
		_ds_naming = null
		_refresh(false))
	_ds_naming = screen
	_send_bottom()


## Letters and digits only, at most NAME_LENGTH of them.
static func _clean_name(text: String) -> String:
	var result := ""
	for character in text:
		if result.length() >= NAME_LENGTH: break
		var code := character.unicode_at(0)
		if (code >= 48 and code <= 57) or (code >= 65 and code <= 90) or (code >= 97 and code <= 122):
			result += character
	return result


# --- Naming: a DS-style letter grid over the trainer ------------------------------------------

func _open_naming() -> void:
	if Gba.available() or (OverworldSprite.data_root != "" and Namein.available(OverworldSprite.data_root)):
		_open_ds_naming()
		return
	_draft = String(look.get("name", ""))
	_keys.clear()
	_key = 0
	_naming = ColorRect.new()
	(_naming as ColorRect).color = Color(0.05, 0.08, 0.15, 0.6)
	# Over the trainer: the top screen with two screens, the left half on one.
	_place(_naming, Vector2(0, 0), Vector2(1.0 if _bottom else 0.5, 1))
	var panel := _box("window")
	# Ten keys a row need nearly all of the half screen.
	var side := 0.08 if _bottom else 0.02
	panel.anchor_left = side
	panel.anchor_right = 1.0 - side
	panel.anchor_top = 0.03
	panel.anchor_bottom = 0.97
	_naming.add_child(panel)
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 4)
	panel.add_child(column)
	var title := _text("Your trainer's name", 32)
	title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	column.add_child(title)
	_name_shown = _text("", 48)
	_name_shown.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	column.add_child(_name_shown)
	var rows: Array = KEYS.duplicate()
	rows.append(["DEL", "OK"])
	for r in rows.size():
		var line := HBoxContainer.new()
		line.alignment = BoxContainer.ALIGNMENT_CENTER
		line.add_theme_constant_override("separation", PIXEL)
		line.size_flags_vertical = Control.SIZE_EXPAND_FILL
		column.add_child(line)
		var labels: Array = Array(rows[r].split("")) if rows[r] is String else rows[r]
		for c in labels.size():
			var key := _button(2, 32)
			key.custom_minimum_size = Vector2(150 if labels[c].length() > 1 else 56, 0)
			(key.get_meta("label") as Label).text = labels[c]
			var index := _keys.size()
			key.gui_input.connect(func(event: InputEvent):
				if event is InputEventMouseButton and event.pressed and event.button_index == MOUSE_BUTTON_LEFT:
					_key = index
					_type(_keys[index][0]))
			line.add_child(key)
			_keys.append([labels[c], key, r, c])
	var hint := _text("A types  B deletes  START is OK", 16)
	hint.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	column.add_child(hint)
	_show_naming()


func _naming_input(event: InputEvent) -> void:
	var handled := true
	var here: Array = _keys[_key]
	if event.is_action_pressed("move_left", true) or event.is_action_pressed("ui_left", true):
		_key = _key_at(here[2], here[3] - 1, true)
	elif event.is_action_pressed("move_right", true) or event.is_action_pressed("ui_right", true):
		_key = _key_at(here[2], here[3] + 1, true)
	elif event.is_action_pressed("move_up", true) or event.is_action_pressed("ui_up", true):
		_key = _key_at(here[2] - 1, here[3], false)
	elif event.is_action_pressed("move_down", true) or event.is_action_pressed("ui_down", true):
		_key = _key_at(here[2] + 1, here[3], false)
	elif event.is_action_pressed("interact"):
		_type(here[0])
	elif event.is_action_pressed("run"):
		_type("DEL")
	elif event is InputEventJoypadButton and event.pressed and event.button_index == JOY_BUTTON_START:
		_type("OK")
	elif event is InputEventKey and event.pressed and not event.echo and event.keycode == KEY_BACKSPACE:
		_type("DEL")
	elif event is InputEventKey and event.pressed and not event.echo and event.unicode > 0 and _clean_name(char(event.unicode)) != "":
		_type(char(event.unicode))
	else:
		handled = false
	if handled:
		_show_naming()
		get_viewport().set_input_as_handled()


## The key in [row] nearest column [col] ([wrap]: along the row, around its ends).
func _key_at(row: int, col: int, wrap: bool) -> int:
	var rows := KEYS.size() + 1
	row = posmod(row, rows)
	var in_row: Array = []
	for i in _keys.size():
		if _keys[i][2] == row: in_row.append(i)
	if wrap: return in_row[posmod(col, in_row.size())]
	# Up or down: the key at the same place along the row (rows are centred and differ in length).
	var from_row: int = _keys[_key][2]
	var from_count := 0
	for k in _keys:
		if k[2] == from_row: from_count += 1
	var share := (col + 0.5) / float(from_count)
	return in_row[clampi(int(share * in_row.size()), 0, in_row.size() - 1)]


func _type(key: String) -> void:
	match key:
		"DEL": _draft = _draft.substr(0, maxi(0, _draft.length() - 1))
		"OK":
			look["name"] = _draft
			_naming.queue_free()
			_naming = null
			_refresh(false)
			return
		_:
			if _draft.length() < NAME_LENGTH: _draft += key
	_show_naming()


func _show_naming() -> void:
	if _naming == null: return
	_name_shown.text = _draft + "_".repeat(NAME_LENGTH - _draft.length())
	# The letter cursor blinks; the name's next blank does too.
	var on := fmod(_time, BLINK * 2.0) < BLINK
	for i in _keys.size():
		_light(_keys[i][1], i == _key, not on)
	if _draft.length() < NAME_LENGTH and not on:
		_name_shown.text = _draft + " " + "_".repeat(NAME_LENGTH - _draft.length() - 1)


## Saves the look and closes.
func finish() -> void:
	# Hiding the creator's bottom screen refreshes the card from the saved look.
	Character.save(look)
	if _bottom:
		_plugin.disconnect("bottom_touch", _on_bottom_touch)
		_plugin.hide_bottom()
	finished.emit(look)
	queue_free()

func _build_gba_options() -> void:
	var view := get_viewport().get_visible_rect().size
	var rect := Rect2(Vector2.ZERO, Vector2(_bottom.size_2d_override)) if _bottom else Rect2(Vector2(view.x / 2, 0), Vector2(view.x / 2, view.y))
	var fill := ColorRect.new()
	fill.position = rect.position
	fill.size = rect.size
	fill.color = _gba.color("menuPalette", 0)
	(_bottom if _bottom else self).add_child(fill)
	_gba_options = Gba.screen(_bottom if _bottom else self, rect)
	_gba_options.draw.connect(_draw_gba_options)
	_gba_options.gui_input.connect(func(event: InputEvent):
		if _ds_naming: return
		if event is InputEventMouseButton and event.pressed:
			_gba_touch(event.position, -1 if event.button_index == MOUSE_BUTTON_RIGHT else 1)
		elif event is InputEventScreenTouch and event.pressed: _gba_touch(event.position, 1))

func _gba_touch(at: Vector2, step: int) -> void:
	_row = clampi(int((at.y - 8) / 18), 0, 7)
	_col = 0 if _row >= NAME_ROW or at.x < 160 else 1
	_press(step)

func _draw_gba_options() -> void:
	_gba.menu(_gba_options, Rect2(0, 0, 240, 160))
	for r in 8:
		var y := 9 + r * 18
		var label := String(ROWS[r][0]) if r < 6 else "NAME" if r == 6 else "DONE"
		_gba.text(_gba_options, label, Vector2(20 if r < 7 else 98, y))
		# On a part's row the arrow points at the selected column (style or colour).
		if r == _row: _gba.arrow(_gba_options, Vector2((78 if _col == 0 else 154) if r < 6 else 8 if r < 7 else 86, y))
		if r < 6:
			for c in 2:
				var options := _options(ROWS[r][c + 1])
				var value := String(options[0][options[1]])
				var x := 88 if c == 0 else 164
				var limit := 64  # the first column stops short of the second column's arrow
				while _font.get_string_size(value, HORIZONTAL_ALIGNMENT_LEFT, -1, 16).x > limit: value = value.left(value.length() - 1)
				_gba.text(_gba_options, value, Vector2(x,y), limit)
		elif r == 6: _gba.text(_gba_options, String(look.get("name", "PLAYER")), Vector2(88,y))

## Behind the trainer, in the 240 x 160 screen's own pixels: sky in flat bands down to a grass
## horizon, a lighter oval base under the trainer and a soft shadow at their feet. The bands run past
## the screen's edges so a wider display shows more of them.
const BACKDROP_SKY := [Color("f8f8f0"), Color("e0f0f8"), Color("c8e4f8"), Color("b0d8f8"), Color("98c8f0"), Color("88b8e8")]
const BACKDROP_GRASS := [Color("98d880"), Color("88c870"), Color("78b860")]
const BACKDROP_BASE := [Color("b8e8a0"), Color("68a850")]  # top, rim
const BACKDROP_SHADOW := Color(0.1, 0.25, 0.1, 0.5)

func _draw_gba_backdrop(canvas: Control) -> void:
	if _backdrop_background:
		canvas.draw_texture(_backdrop_background, _backdrop_origin)
		canvas.draw_texture(_backdrop_base, _backdrop_base_position)
		return
	var left := -canvas.position.x / canvas.scale.x - 1
	var right := (canvas.get_viewport_rect().size.x - canvas.position.x) / canvas.scale.x + 1
	var top := -canvas.position.y / canvas.scale.y - 1
	var bottom := (canvas.get_viewport_rect().size.y - canvas.position.y) / canvas.scale.y + 1
	var horizon := 104.0
	# Sky bands, lightest at the horizon.
	var band := (horizon - 40.0) / BACKDROP_SKY.size()
	canvas.draw_rect(Rect2(left, top, right - left, 40 - top), BACKDROP_SKY[-1])
	for i in BACKDROP_SKY.size():
		canvas.draw_rect(Rect2(left, horizon - (i + 1) * band, right - left, band), BACKDROP_SKY[i])
	# Grass bands, darker toward the bottom.
	for i in BACKDROP_GRASS.size():
		var y := horizon + i * 8.0
		var height: float = (bottom - y) if i == BACKDROP_GRASS.size() - 1 else 8.0
		canvas.draw_rect(Rect2(left, y, right - left, height), BACKDROP_GRASS[i])
	# The base and the shadow, as whole-pixel ellipses.
	_pixel_oval(canvas, Vector2(120, 146), Vector2(44, 11), BACKDROP_BASE[1])
	_pixel_oval(canvas, Vector2(120, 145), Vector2(42, 9), BACKDROP_BASE[0])
	_pixel_oval(canvas, Vector2(120, 149), Vector2(18, 3), BACKDROP_SHADOW)

func _pixel_oval(canvas: Control, center: Vector2, radius: Vector2, color: Color) -> void:
	for row in range(-int(radius.y), int(radius.y)):
		var t := (row + 0.5) / radius.y
		var half := floorf(radius.x * sqrt(maxf(0.0, 1.0 - t * t)))
		if half > 0: canvas.draw_rect(Rect2(center.x - half, center.y + row, half * 2, 1), color)

func _load_gba_backdrop(canvas: Control) -> void:
	var root := Gba.data_root().path_join("ui/creator-backdrop")
	var selection := root.path_join("selected.txt")
	if not FileAccess.file_exists(selection): return
	var name := FileAccess.get_file_as_string(selection).strip_edges()
	if name.is_empty() or name in [".", ".."] or name.contains("/") or name.contains("\\"): return
	var dir := root.path_join(name)
	for file in ["background.png", "base.png", "info.json"]:
		if not FileAccess.file_exists(dir.path_join(file)): return
	var info = JSON.parse_string(FileAccess.get_file_as_string(dir.path_join("info.json")))
	if not info is Dictionary: return
	var at = info.get("base_position", [])
	if not at is Array or at.size() != 2: return
	if not (at[0] is float or at[0] is int) or not (at[1] is float or at[1] is int): return
	var background := Image.load_from_file(dir.path_join("background.png"))
	var base := Image.load_from_file(dir.path_join("base.png"))
	if not background or not base or background.is_empty() or base.is_empty(): return
	# Keep each source pixel whole; centre/crop horizontally and extend border pixels.
	var left := floori(-canvas.position.x / canvas.scale.x) - 1
	var top := floori(-canvas.position.y / canvas.scale.y) - 1
	var extent := (canvas.get_viewport_rect().size / canvas.scale).ceil() + Vector2(2, 2)
	var padded := Image.create(int(extent.x), int(extent.y), false, Image.FORMAT_RGBA8)
	var x_offset := floori((240 - background.get_width()) / 2.0)
	for y in padded.get_height():
		for x in padded.get_width():
			padded.set_pixel(x, y, background.get_pixel(clampi(x + left - x_offset, 0, background.get_width() - 1), clampi(y + top, 0, background.get_height() - 1)))
	_backdrop_origin = Vector2(left, top)
	_backdrop_background = ImageTexture.create_from_image(padded)
	_backdrop_base = ImageTexture.create_from_image(base)
	_backdrop_base_position = Vector2(floorf(at[0]), floorf(at[1]))

func _build_gba_preview() -> void:
	var view := get_viewport().get_visible_rect().size
	var rect := Rect2(Vector2.ZERO, view if _bottom else Vector2(view.x / 2, view.y))
	var fill := ColorRect.new()
	fill.size = rect.size
	fill.color = _gba.color("menuPalette",0)
	add_child(fill)
	_gba_preview = Gba.screen(self,rect)
	_gba_preview.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_load_gba_backdrop(_gba_preview)
	_gba_preview.draw.connect(func():
		_draw_gba_backdrop(_gba_preview)
		_gba.menu(_gba_preview, Rect2(8,8,224,32))
		var title := "Create your trainer"
		var width := _font.get_string_size(title,HORIZONTAL_ALIGNMENT_LEFT,-1,16).x
		_gba.text(_gba_preview,title,Vector2(floor((240-width)/2),16))
		if _front: _gba_preview.draw_texture_rect(_front, Rect2(56, 72, 80, 80), false)
		_gba_preview.draw_texture_rect(_atlas, Rect2(124, 88, 64, 64), false))
