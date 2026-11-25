extends SceneTree
## Matches the hub's textures to the original games' animation frames (see frames.js).
## Args: <data dir> <frame sources dir>. A hub texture matches a frame when both have the same size,
## the same transparent pixels and the same pattern of colours (palette ignored). The whole frame set
## is then recoloured to the hub texture's palette, so palette variants (yellow and pink flowers) work.

func _init() -> void:
	var args := OS.get_cmdline_user_args()
	var data: String = args[0]
	var sources: String = args[1]
	# Only textures the game names as frames ("name.1", "name.2" ...), listed by frames.js.
	var frame_names: Dictionary = JSON.parse_string(FileAccess.get_file_as_string(args[2]))
	# Frame sets: every "<base>_<n>.png" group with 2 or more distinct frames.
	var by_shape := {}  # shape key -> [frame paths (in order), index of the matching frame]
	var set_count := 0
	for folder in DirAccess.get_directories_at(sources):
		if not frame_names.has(folder): continue
		var allowed: Array = frame_names[folder]
		var groups := {}
		for file in DirAccess.get_files_at(sources.path_join(folder)):
			if not allowed.has(file.get_basename()): continue
			var m := RegEx.create_from_string("^(.+)_(\\d+)\\.png$").search(file)
			if m == null: continue
			var base := m.get_string(1)
			if not groups.has(base): groups[base] = {}
			groups[base][int(m.get_string(2))] = sources.path_join(folder).path_join(file)
		for base in groups:
			var numbers: Array = groups[base].keys()
			numbers.sort()
			if numbers.size() < 2: continue
			var paths: Array = numbers.map(func(n): return groups[base][n])
			var images: Array = paths.map(func(p): return Image.load_from_file(p))
			if images.any(func(i): return i == null): continue
			var keys: Array = images.map(func(i): return _shape(i))
			if keys.all(func(k): return k == keys[0]) and images.all(func(i): return i.get_data() == images[0].get_data()): continue
			set_count += 1
			for k in keys.size():
				# Prefer the longest set when several share a frame.
				if not by_shape.has(keys[k]) or (by_shape[keys[k]][0] as Array).size() < paths.size():
					by_shape[keys[k]] = [paths, k, folder + " " + base]
	print("Distinct animated frame sets: ", set_count)
	# Hub textures: every material in every mesh group.
	var result := {}
	var frames_dir := data.path_join("frames")
	for group in ["terrain", "buildings", "decorations", "deck", "deck2"]:
		var mtl := data.path_join(group).path_join(group + ".mtl")
		if not FileAccess.file_exists(mtl): continue
		var material := ""
		for line in FileAccess.get_file_as_string(mtl).split("\n"):
			line = line.strip_edges()
			if line.begins_with("newmtl "): material = line.substr(7)
			elif line.begins_with("map_Kd ") and not result.has(material):
				var texture := data.path_join(group).path_join(line.substr(7))
				var image := Image.load_from_file(texture)
				if image == null: continue
				var key := _shape(image)
				# Plain textures (one or two colours) have too generic a shape to identify.
				if _colour_count(image) < 3 or not by_shape.has(key): continue
				var entry: Array = by_shape[key]
				var match_image := Image.load_from_file(entry[0][entry[1]])
				var colours := _colour_map(match_image, image)
				var out_dir := frames_dir.path_join(material.validate_filename())
				DirAccess.make_dir_recursive_absolute(out_dir)
				var files := []
				for n in (entry[0] as Array).size():
					var frame := Image.load_from_file(entry[0][n])
					_recolour(frame, colours)
					var name := "%d.png" % n
					frame.save_png(out_dir.path_join(name))
					files.append("frames/" + material.validate_filename() + "/" + name)
				result[material] = {"frames": files, "start": entry[1], "source": entry[2]}
	var file := FileAccess.open(data.path_join("frames.json"), FileAccess.WRITE)
	file.store_string(JSON.stringify(result, "  ", true))
	print("Hub textures with original frames: ", result.size())
	for material in result: print("  ", material, " <- ", result[material].source, " (", result[material].frames.size(), " frames)")
	if args.size() > 3: _npc_sprites(data, sources, args[3])
	quit(0)

## Sheets for the NPCs in layout.json: each "sprite" names an overworld texture file of the games
## ("seaman_1" is HeartGold's sailor). Its frames are laid in a row (up, down, left, right; four
## each), the format overworld_sprite.gd reads. The first of HeartGold, Platinum, Black 2 that has it wins.
func _npc_sprites(data: String, sources: String, layout_path: String) -> void:
	var layout = JSON.parse_string(FileAccess.get_file_as_string(layout_path))
	var index := {}
	var npcs: Array = layout.get("npcs", []).duplicate()
	for interior in layout.get("interiors", []):
		npcs.append_array(interior.get("npcs", []))
	for npc in npcs:
		var sprite: String = npc.get("sprite", "")
		if sprite.is_empty() or index.has(sprite): continue
		for game in ["hg-extract", "pt-extract", "b2-extract"]:
			var folder := sources.path_join(game + "__" + sprite)
			if not DirAccess.dir_exists_absolute(folder): continue
			var stem := sprite.trim_suffix("_1")
			var frames: Array = []
			var n := 1
			while FileAccess.file_exists(folder.path_join("%s_%d.png" % [stem, n])):
				frames.append(Image.load_from_file(folder.path_join("%s_%d.png" % [stem, n])))
				n += 1
			if frames.size() < 16: continue
			var w: int = frames[0].get_width()
			var h: int = frames[0].get_height()
			var sheet := Image.create(w * frames.size(), h, false, Image.FORMAT_RGBA8)
			for k in frames.size():
				frames[k].convert(Image.FORMAT_RGBA8)
				sheet.blit_rect(frames[k], Rect2i(0, 0, w, h), Vector2i(k * w, 0))
			DirAccess.make_dir_recursive_absolute(data.path_join("sprites"))
			sheet.save_png(data.path_join("sprites").path_join(sprite + ".png"))
			index[sprite] = {"sheet": "sprites/" + sprite + ".png", "frames": frames.size(), "w": w, "h": h}
			print("NPC sprite ", sprite, " <- ", game, " (", frames.size(), " frames)")
			break
		if not index.has(sprite): print("NPC sprite ", sprite, " not found in the extractions")
	var file := FileAccess.open(data.path_join("npc-sprites.json"), FileAccess.WRITE)
	file.store_string(JSON.stringify(index, "  ", true))

## Size, transparency and colour pattern, ignoring which colours are used.
static func _shape(image: Image) -> String:
	image.convert(Image.FORMAT_RGBA8)
	var seen := {}
	var parts := PackedStringArray([str(image.get_width()), str(image.get_height())])
	for y in image.get_height():
		for x in image.get_width():
			var c := image.get_pixel(x, y)
			if c.a8 == 0:
				parts.append("-")
				continue
			var rgb := c.to_rgba32()
			if not seen.has(rgb): seen[rgb] = seen.size()
			parts.append(str(seen[rgb]))
	return ",".join(parts)

static func _colour_count(image: Image) -> int:
	var seen := {}
	for y in image.get_height():
		for x in image.get_width():
			var c := image.get_pixel(x, y)
			if c.a8 > 0: seen[c.to_rgba32()] = true
	return seen.size()

static func _colour_map(from: Image, to: Image) -> Dictionary:
	var colours := {}
	for y in from.get_height():
		for x in from.get_width():
			var a := from.get_pixel(x, y)
			if a.a8 == 0: continue
			colours[a.to_rgba32()] = to.get_pixel(x, y)
	return colours

static func _recolour(image: Image, colours: Dictionary) -> void:
	image.convert(Image.FORMAT_RGBA8)
	for y in image.get_height():
		for x in image.get_width():
			var c := image.get_pixel(x, y)
			if c.a8 == 0: continue
			if colours.has(c.to_rgba32()):
				image.set_pixel(x, y, colours[c.to_rgba32()])
				continue
			# A colour the matched frame doesn't use: shift it by the change of the nearest one it does.
			var best := -1
			var gap := INF
			for key in colours:
				var k := Color.hex(key)
				var d := (k.r - c.r) ** 2 + (k.g - c.g) ** 2 + (k.b - c.b) ** 2
				if d < gap: gap = d; best = key
			if best != -1:
				var from := Color.hex(best)
				var to: Color = colours[best]
				image.set_pixel(x, y, Color(clampf(c.r + to.r - from.r, 0, 1), clampf(c.g + to.g - from.g, 0, 1), clampf(c.b + to.b - from.b, 0, 1), c.a))
