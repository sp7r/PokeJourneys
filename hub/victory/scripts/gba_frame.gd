extends RefCounted
## Runtime-only FireRed artwork from the player's external hub data.
const Sprite = preload("res://scripts/overworld_sprite.gd")
var dir := ""
var art := {}
var metadata := {}
var _styles := {}
var font: FontFile

static func data_root() -> String:
	if Sprite.data_root != "": return Sprite.data_root
	for arg in OS.get_cmdline_user_args():
		if arg.begins_with("--data="): return arg.trim_prefix("--data=")
	var root := OS.get_environment("JOURNEYS_HUB_DATA")
	return root if root != "" else ProjectSettings.globalize_path("user://hub-data")

static func available(root: String = "") -> bool:
	if root == "": root = data_root()
	return FileAccess.file_exists(root.path_join("ui/firered/metadata.json"))

func _init(root: String = "") -> void:
	if root == "": root = data_root()
	dir = root.path_join("ui/firered")
	if available(root): metadata = JSON.parse_string(FileAccess.get_file_as_string(dir.path_join("metadata.json")))
	font = load_font(root)

static func load_font(root: String = "", naming := false) -> FontFile:
	if root == "": root = data_root()
	var faces: Array[Font] = []
	for file in [root.path_join("ui/firered/naming-font.fnt" if naming else "ui/firered/font.fnt"), root.path_join("ui/font/font.fnt")]:
		if not FileAccess.file_exists(file): continue
		var face := FontFile.new()
		if face.load_bitmap_font(file) == OK:
			face.fixed_size_scale_mode = TextServer.FIXED_SIZE_SCALE_INTEGER_ONLY
			faces.append(face)
	var pixel := load("res://fonts/PixelOperator.ttf") as FontFile
	pixel.antialiasing = TextServer.FONT_ANTIALIASING_NONE
	pixel.hinting = TextServer.HINTING_NONE
	pixel.subpixel_positioning = TextServer.SUBPIXEL_POSITIONING_DISABLED
	faces.append(pixel)
	var result := faces.pop_front() as FontFile
	result.fallbacks = faces
	return result


func texture(file: String) -> Texture2D:
	if not art.has(file):
		var image := Image.load_from_file(dir.path_join(file + ".png"))
		art[file] = ImageTexture.create_from_image(image) if image else null
	return art[file]

func color(palette: String, index: int) -> Color:
	var rgb: Array = metadata[palette][index]
	return Color8(rgb[0], rgb[1], rgb[2])

func menu(canvas: CanvasItem, rect: Rect2) -> void:
	canvas.draw_style_box(style(), rect)

func style(factor := 1) -> StyleBoxTexture:
	if _styles.has(factor): return _styles[factor]
	var box := StyleBoxTexture.new()
	var image := texture("menu").get_image()
	image.resize(24 * factor, 24 * factor, Image.INTERPOLATE_NEAREST)
	box.texture = ImageTexture.create_from_image(image)
	box.set_texture_margin_all(8 * factor)
	box.axis_stretch_horizontal = StyleBoxTexture.AXIS_STRETCH_MODE_TILE
	box.axis_stretch_vertical = StyleBoxTexture.AXIS_STRETCH_MODE_TILE
	box.set_content_margin_all(8 * factor)
	_styles[factor] = box
	return box

func dialogue(canvas: CanvasItem, at: Vector2, columns := 30) -> void:
	for y in 6:
		for x in columns:
			var tile := 7
			if y == 0 or y == 5:
				tile = 0 if x == 0 else 1 if x == 1 else 4 if x == columns - 1 else 3 if x == columns - 2 else 2
			else:
				var left := 5 if y == 1 or y == 4 else 10
				var right := 8 if y == 1 or y == 4 else 12
				tile = left if x == 0 else left + 1 if x == 1 else right + 1 if x == columns - 1 else right if x == columns - 2 else 7
			var target := Rect2(at + Vector2(x * 8, y * 8), Vector2(8, 8))
			var key := "tile-%d-%s" % [tile, y >= 3]
			if not art.has(key):
				var image := texture("message-sheet").get_image().get_region(Rect2i(tile % 5 * 8, int(tile / 5) * 8, 8, 8))
				if y >= 3: image.flip_y()
				art[key] = ImageTexture.create_from_image(image)
			canvas.draw_texture_rect(art[key], target, false)

func arrow(canvas: CanvasItem, at: Vector2) -> void:
	canvas.draw_texture(texture("arrow"), at)

func text(canvas: CanvasItem, value: String, at: Vector2, width := -1.0, face: Font = null) -> void:
	if face == null: face = font
	if width >= 0 and face.get_string_size(value, HORIZONTAL_ALIGNMENT_LEFT, -1, 16).x > width:
		while value != "" and face.get_string_size(value + "\u2026", HORIZONTAL_ALIGNMENT_LEFT, -1, 16).x > width:
			value = value.left(value.length() - 1)
		value += "\u2026"
	canvas.draw_string(face, at + Vector2(0, 13), value, HORIZONTAL_ALIGNMENT_LEFT, width, 16)

static func label_style(label: Label, size: int, face: FontFile = null) -> void:
	if face == null: face = load_font()
	label.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
	label.add_theme_font_override("font", face)
	label.add_theme_font_size_override("font_size", maxi(16, int(size / 16) * 16))
	label.add_theme_color_override("font_color", Color.WHITE if face.fixed_size > 0 else Color("404048"))
	label.add_theme_constant_override("shadow_offset_x", 0)
	label.add_theme_constant_override("shadow_offset_y", 0)
	label.add_theme_constant_override("outline_size", 0)

static func screen(parent: Node, rect: Rect2, native_size := Vector2(240,160)) -> Control:
	var control := Control.new()
	parent.add_child(control)
	var display_scale := control.get_viewport().get_final_transform().get_scale().x
	var pixels := maxi(1, floori(minf(rect.size.x / native_size.x, rect.size.y / native_size.y) * display_scale))
	var factor := pixels / display_scale
	control.size = native_size
	control.scale = Vector2.ONE * factor
	control.position = ((rect.position + (rect.size - native_size * factor) / 2) * display_scale).floor() / display_scale
	control.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
	return control
