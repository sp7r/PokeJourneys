extends RefCounted
## The player's look: picks from the creator art (assets/creator, the credited Character
## Customization Resources pack at native size), saved per account in user://accounts/<id>/character.json and stacked into
## the hero's overworld sheet.
##
## The art has one 128 x 128 sheet per part and motion ("overworld walk", "overworld run"): rows
## down, left, right, up; columns stand, step, stand, step, 32 x 32 each. Parts are folders of
## colour files (hair/boy 2/boy 2 brown.png) or single files (hats/fedora.png).

## Each Discord account keeps its own look (accounts/<id>/; "local" when nobody is signed in or there's no app).
const SAVE := "user://accounts/%s/character.json"
## Creator slots in drawing order: [key, folder under "overworld walk", optional].
const SLOTS := [["bottom", "bottoms", false], ["top", "tops", false], ["hair", "hair", false],
		["hat", "hats", true], ["bag", "carrying stuff", true]]
const SKINS := ["pale", "light", "medium", "dark"]
const DEFAULT := {"gender": "m", "skin": "light", "hair": ["Short 2", "brown"], "top": ["Vest", "blue"],
		"bottom": ["Shorts", "red"], "hat": ["None", ""], "bag": ["None", ""]}
## Sheet rows in the art, in the hub's direction order (up, down, left, right).
const ROWS := [3, 0, 1, 2]

## The colours every part comes in: [label, hue (or -1 to keep the colour out), saturation and
## brightness factors]. A part's own drawn colour of the same name is used when the pack has one;
## the rest are recoloured from one drawn colour (see _tint), so a new part needs drawing only once.
const PALETTE := [["black", -1, 0.12, 0.32], ["white", -1, 0.08, 1.6], ["grey", -1, 0.06, 0.8],
		["red", 0.0, 1.0, 1.0], ["orange", 0.07, 1.0, 1.1], ["yellow", 0.14, 1.0, 1.2],
		["green", 0.33, 0.9, 0.9], ["teal", 0.47, 0.9, 0.9], ["blue", 0.6, 1.0, 1.0],
		["navy", 0.63, 0.9, 0.55], ["purple", 0.77, 0.85, 0.9], ["pink", 0.9, 0.6, 1.15],
		["brown", 0.07, 0.7, 0.55]]
## Drawn colours to recolour from, best first (saturated ones keep their shading best).
const SOURCES := ["blue", "red", "green", "purple", "pink", "navy", "aqua", "cyan", "orange", "yellow"]

static var art_root := ""
static var _tinted := {}
static var _styles := {}


## --creator-art=<dir>, then JOURNEYS_CREATOR_ART, then the repo's assets/creator.
static func find_art(args: Dictionary) -> void:
	art_root = args.get("creator-art", OS.get_environment("JOURNEYS_CREATOR_ART"))
	if art_root.is_empty():
		art_root = ProjectSettings.globalize_path("res://").path_join("../../assets/creator").simplify_path()


static func available() -> bool:
	return DirAccess.dir_exists_absolute(art_root.path_join("sprites/overworld walk/bases mf"))


## The signed-in account's look file (CreatorLook.kt reads the same one for the games).
static func save_path() -> String:
	var id := ""
	if Engine.has_singleton("PokeJourneys"): id = Engine.get_singleton("PokeJourneys").account_id()
	return SAVE % (id if not id.is_empty() else "local")


static func load_saved() -> Dictionary:
	var path := save_path()
	var parsed = JSON.parse_string(FileAccess.get_file_as_string(path)) if FileAccess.file_exists(path) else null
	return parsed if parsed is Dictionary else {}


static func save(look: Dictionary) -> bool:
	DirAccess.make_dir_recursive_absolute(save_path().get_base_dir())
	var file := FileAccess.open(save_path(), FileAccess.WRITE)
	if file == null: return false
	file.store_string(JSON.stringify(look, "  "))
	file.flush()
	var ok := file.get_error() == OK
	file.close()
	# The server keeps it with the account too (HubCharacter.kt), so a new install skips the creator.
	if ok and Engine.has_singleton("PokeJourneys"):
		Engine.get_singleton("PokeJourneys").character_saved()
	return ok


## The parts for one slot and gender: [{name, colors: [{label, rel}]}], with "None" first for
## optional slots. Styles and colour files marked " f" / " w" are for girls, " m" for boys.
static func styles(slot: String, gender: String) -> Array:
	# Listed once per slot and body: on Android the art is inside the APK, where every folder
	# listing is slow, and the creator asks for these on each press.
	var key := slot + "|" + gender + "|" + art_root
	if not _styles.has(key): _styles[key] = _list_styles(slot, gender)
	return _styles[key]


static func _list_styles(slot: String, gender: String) -> Array:
	var folder := ""
	var optional := false
	for s in SLOTS:
		if s[0] == slot:
			folder = s[1]
			optional = s[2]
	var result := []
	if optional: result.append({"name": "None", "colors": [{"label": "", "rel": ""}]})
	var dir := art_root.path_join("sprites/overworld walk").path_join(folder)
	var names := Array(DirAccess.get_directories_at(dir)) + Array(DirAccess.get_files_at(dir))
	# By name with runs of spaces as one, so "girl  3" sorts between "girl 2" and "girl 4".
	names.sort_custom(func(a, b): return _sort_key(a).naturalnocasecmp_to(_sort_key(b)) < 0)
	for entry in names:
		if not _fits(entry.get_basename(), gender): continue
		var colors := []
		if entry.ends_with(".png"):
			colors.append({"label": "original", "rel": folder.path_join(entry)})
		elif DirAccess.dir_exists_absolute(dir.path_join(entry)):
			for file in DirAccess.get_files_at(dir.path_join(entry)):
				if file.ends_with(".png") and _fits(file.get_basename(), gender):
					colors.append({"label": file.get_basename().split(" ", false)[-1].to_lower(), "rel": folder.path_join(entry).path_join(file)})
		colors = _spectrum(colors)
		# The pack's "boy N" / "girl N" hair is named by length, as in the earlier creator.
		var label := _label(entry.get_basename()).replace("Boy ", "Short ").replace("Girl ", "Long ")
		if not colors.is_empty(): result.append({"name": label, "colors": colors})
	return result


static func _sort_key(name: String) -> String:
	return " ".join(name.split(" ", false))


static func _fits(name: String, gender: String) -> bool:
	var words := name.to_lower().split(" ", false)
	var girl := words.has("f") or words.has("w")
	var boy := words.has("m")
	if words.has("fm") or (girl and boy) or not (girl or boy): return true
	return girl if gender == "f" else boy


static func _label(name: String) -> String:
	var words := Array(name.split(" ", false)).filter(func(w): return not w.to_lower() in ["f", "m", "w", "fm"])
	return " ".join(words).capitalize() if not words.is_empty() else name


## Fills a style's drawn colours out to the whole PALETTE: palette colours first (drawn when the
## pack has them, else recoloured from the best source), then any other drawn ones (wine, beige...).
static func _spectrum(drawn: Array) -> Array:
	if drawn.is_empty(): return drawn
	var by_label := {}
	for c in drawn: by_label[c.label] = c
	var source: Dictionary = drawn[0]
	for name in SOURCES:
		if by_label.has(name):
			source = by_label[name]
			break
	var result := []
	if by_label.has("original"): result.append(by_label.original)
	for entry in PALETTE:
		result.append(by_label[entry[0]] if by_label.has(entry[0]) else {"label": entry[0], "rel": source.rel, "tint": entry[0]})
	var rest := drawn.filter(func(c): return not result.has(c))
	rest.sort_custom(func(a, b): return a.label < b.label)
	return result + rest


## Recolours a part's sheet to a PALETTE colour: only its coloured pixels change, so black lines,
## whites and greys stay; the shading carries over as brightness.
static func _tint(image: Image, label: String) -> Image:
	var entry: Array = []
	for e in PALETTE:
		if e[0] == label: entry = e
	if entry.is_empty(): return image
	var result: Image = image.duplicate()
	for y in result.get_height():
		for x in result.get_width():
			var c := result.get_pixel(x, y)
			if c.a == 0.0 or c.s < 0.18 or c.v < 0.18: continue
			var hue: float = c.h if entry[1] < 0 else entry[1]
			result.set_pixel(x, y, Color.from_hsv(hue, clampf(c.s * entry[2], 0, 1), clampf(c.v * entry[3], 0, 1), c.a))
	return result


## The colour entry ({label, rel, tint?}) of a slot's pick for this look, or {} for none (falls back
## to the first style/colour).
static func pick(look: Dictionary, slot: String) -> Dictionary:
	var options := styles(slot, String(look.get("gender", "m")))
	if options.is_empty(): return {}
	var chosen: Array = look.get(slot, ["", ""])
	var style: Dictionary = options[0]
	for o in options:
		if o.name == chosen[0]: style = o
	var color: Dictionary = style.colors[0]
	for c in style.colors:
		if c.label == chosen[1]: color = c
	return color if color.rel != "" else {}


## The hero sheet for this look: one row of 32 frames of 32 x 32 (16 walking, then 16 running),
## each direction stand / step / stand / step, as OverworldSprite reads it.
static func build_sheet(look: Dictionary) -> Image:
	var gender := String(look.get("gender", "m"))
	var skin := String(look.get("skin", "light"))
	var layers := [{"rel": "bases mf/%s base %s.png" % [gender, skin]}]
	for s in SLOTS:
		var part := pick(look, s[0])
		if not part.is_empty(): layers.append(part)
	var sheet := Image.create_empty(32 * 32, 32, false, Image.FORMAT_RGBA8)
	for motion in 2:
		var canvas := Image.create_empty(128, 128, false, Image.FORMAT_RGBA8)
		for part in layers:
			var layer := _layer(["walk", "run"][motion], part)
			if layer == null: continue
			canvas.blend_rect(layer, Rect2i(0, 0, 128, 128), Vector2i.ZERO)
		for d in 4:
			for c in 4:
				sheet.blit_rect(canvas, Rect2i(c * 32, ROWS[d] * 32, 32, 32), Vector2i((motion * 16 + d * 4 + c) * 32, 0))
	return sheet


## One part's sheet for a motion, recoloured when the pick is a made colour (kept for reuse).
static func _layer(motion: String, part: Dictionary) -> Image:
	var key := "%s|%s|%s" % [motion, part.rel, part.get("tint", "")]
	if _tinted.has(key): return _tinted[key]
	var path := art_root.path_join("sprites/overworld " + motion).path_join(part.rel)
	var layer := Image.load_from_file(path) if FileAccess.file_exists(path) else null
	if layer == null: return null
	layer.convert(Image.FORMAT_RGBA8)
	if part.has("tint"): layer = _tint(layer, part.tint)
	_tinted[key] = layer
	return layer


## Names shared by the overworld and front art, without body suffixes or plural variants.
static func _front_name(value: String) -> String:
	var words := Array(_sort_key(value.get_basename().to_lower()).split(" ", false))
	while not words.is_empty() and words[-1] in ["f", "m", "fm", "w"]: words.pop_back()
	return " ".join(words).replace("bottoms", "bottom").replace("capris", "capri")


## One front counterpart of the actual overworld pick; missing parts stay out of the preview.
static func _front_pick(look: Dictionary, slot: String, root: String) -> Dictionary:
	var chosen := pick(look, slot)
	if chosen.is_empty(): return {}
	var rel := String(chosen.rel)
	var folder := String(rel.split("/")[0])
	var name := _front_name(rel.get_base_dir().get_file() if rel.split("/").size() > 2 else rel.get_file())
	if slot == "hair":
		if name.begins_with("boy ") or name.begins_with("girl "): name = "hair " + name.get_slice(" ", 1)
	var aliases := {"classy bottom": "classy pants", "formal bottom": "formal pants",
		"scarf shirt": "scarf top", "trenchcoat": "trench coat", "cat": "cat ears", "miner": "mining"}
	if String(look.get("gender", "m")) == "f":
		aliases.merge({"classy bottom": "classy bottom", "formal bottom": "evening bottom",
			"scarf shirt": "scarf shirt", "school uniform": "school uniform top",
			"school uniform bottom": "school girl", "lord suit top": "lord shirt",
			"lord suit pants": "lords pants", "beret": "baguette", "cat": "cate"}, true)
	name = aliases.get(name, name)
	var dir := root.path_join(folder)
	var entries := Array(DirAccess.get_directories_at(dir)) + Array(DirAccess.get_files_at(dir))
	entries.sort()
	for entry in entries:
		if _front_name(entry) != name: continue
		var drawn := []
		if entry.ends_with(".png"):
			drawn.append({"label": "original", "rel": dir.path_join(entry)})
		else:
			for file in DirAccess.get_files_at(dir.path_join(entry)):
				if file.ends_with(".png"):
					drawn.append({"label": file.get_basename().split(" ", false)[-1].to_lower(), "rel": dir.path_join(entry).path_join(file)})
		var colors := _spectrum(drawn)
		if colors.is_empty(): return {}
		for color in colors:
			if color.label == chosen.label or (chosen.label == "blond" and color.label == "blonde"): return color
		return colors[0]
	return {}


## Battle-style front at its native 80 x 80, using the same look and colour rules as the sheet.
static func build_front(look: Dictionary, sheet: Image) -> Image:
	var body := "female" if String(look.get("gender", "m")) == "f" else "male"
	var root := art_root.path_join("sprites/trainer front " + body)
	var layers := []
	var base_name := "base " + String(look.get("skin", "light"))
	for file in DirAccess.get_files_at(root.path_join("base")):
		if _front_name(file) == base_name:
			layers.append({"rel": root.path_join("base").path_join(file)})
			break
	for slot in ["bottom", "top", "hair", "hat"]:
		var part := _front_pick(look, slot, root)
		if not part.is_empty(): layers.append(part)
		elif not pick(look, slot).is_empty():
			# Costumes with overworld art only still get a fully dressed preview.
			var stand := sheet.get_region(Rect2i(128, 0, 32, 32))
			stand.resize(64, 64, Image.INTERPOLATE_NEAREST)
			var preview := Image.create_empty(80, 80, false, Image.FORMAT_RGBA8)
			preview.blit_rect(stand, Rect2i(0, 0, 64, 64), Vector2i(8, 8))
			return preview
	var canvas := Image.create_empty(80, 80, false, Image.FORMAT_RGBA8)
	for part in layers:
		var key := "front|%s|%s" % [part.rel, part.get("tint", "")]
		if not _tinted.has(key):
			if not FileAccess.file_exists(part.rel): continue
			var image := Image.load_from_file(part.rel)
			if image == null: continue
			image.convert(Image.FORMAT_RGBA8)
			_tinted[key] = _tint(image, part.tint) if part.has("tint") else image
		canvas.blend_rect(_tinted[key], Rect2i(0, 0, 80, 80), Vector2i.ZERO)
	return canvas
