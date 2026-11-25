extends RefCounted

static func load_obj(path: String) -> ArrayMesh:
	var mesh := ArrayMesh.new()
	if not FileAccess.file_exists(path):
		push_warning("Missing terrain: " + path)
		return mesh
	var vertices: Array[Vector3] = []
	var uvs: Array[Vector2] = []
	var normals: Array[Vector3] = []
	var materials := {}
	var groups := {}
	var current := ""
	var overrides := {}
	var config_path := path.get_base_dir().path_join("materials.json")
	if FileAccess.file_exists(config_path):
		var parsed = JSON.parse_string(FileAccess.get_file_as_string(config_path))
		if parsed is Dictionary:
			overrides = parsed
		else:
			push_warning("Invalid material overrides: " + config_path)
	for raw in FileAccess.get_file_as_string(path).split("\n"):
		var line := raw.strip_edges()
		var p := line.split(" ", false)
		if p.is_empty(): continue
		match p[0]:
			"mtllib":
				var mtl_path := path.get_base_dir().path_join(line.substr(7))
				var name := ""
				if not FileAccess.file_exists(mtl_path): continue
				for entry in FileAccess.get_file_as_string(mtl_path).split("\n"):
					entry = entry.strip_edges()
					if entry.begins_with("newmtl "):
						name = entry.substr(7)
					elif entry.begins_with("map_Kd "):
						materials[name] = mtl_path.get_base_dir().path_join(entry.substr(7))
			"v":
				vertices.append(Vector3(float(p[1]), float(p[3]), -float(p[2])))
			"vt":
				uvs.append(Vector2(float(p[1]), 1.0 - float(p[2])))
			"vn":
				normals.append(Vector3(float(p[1]), float(p[3]), -float(p[2])))
			"usemtl":
				current = line.substr(7)
			"f":
				if not groups.has(current): groups[current] = []
				for i in range(2, p.size() - 1):
					groups[current].append_array([p[1], p[i], p[i + 1]])
	for name in groups:
		var texture_path: String = materials.get(name, "")
		var basename := texture_path.get_file().get_basename().to_lower()
		var config: Dictionary = overrides.get(name, {})
		var default_lift := 0.0 if basename in ["grass01", "sea_on", "sea_un", "pond_on", "river"] or basename.begins_with("sea") else 0.004
		var lift := float(config.get("lift", default_lift))
		var verts := PackedVector3Array()
		var texcoords := PackedVector2Array()
		var norms := PackedVector3Array()
		for token in groups[name]:
			var indices: PackedStringArray = token.split("/")
			var vi := int(indices[0])
			verts.append(vertices[vi - 1 if vi > 0 else vertices.size() + vi] + Vector3(0, lift, 0))
			var ti := int(indices[1]) if indices.size() > 1 else 0
			texcoords.append(uvs[ti - 1 if ti > 0 else uvs.size() + ti] if ti != 0 else Vector2.ZERO)
			var ni := int(indices[2]) if indices.size() > 2 else 0
			norms.append(normals[ni - 1 if ni > 0 else normals.size() + ni] if ni != 0 else Vector3.UP)
		# COLOR.r: height of each vertex above the lowest point of this surface on its tile, / 8.
		# The sway shader uses it so a model's base stays put; other materials ignore it.
		var floor_of := {}
		for v in verts:
			var cell := Vector2i(roundi(v.x), roundi(v.z))
			floor_of[cell] = minf(floor_of.get(cell, v.y), v.y)
		var colors := PackedColorArray()
		for v in verts:
			colors.append(Color(clampf((v.y - floor_of[Vector2i(roundi(v.x), roundi(v.z))]) / 8.0, 0.0, 1.0), 0, 0, 1))
		var arrays := []
		arrays.resize(Mesh.ARRAY_MAX)
		arrays[Mesh.ARRAY_VERTEX] = verts
		arrays[Mesh.ARRAY_TEX_UV] = texcoords
		arrays[Mesh.ARRAY_NORMAL] = norms
		arrays[Mesh.ARRAY_COLOR] = colors
		mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
		mesh.surface_set_name(mesh.get_surface_count() - 1, name)
		var mat := StandardMaterial3D.new()
		if FileAccess.file_exists(texture_path):
			var image := Image.load_from_file(texture_path)
			if image != null: mat.albedo_texture = ImageTexture.create_from_image(image)
		mat.shading_mode = int(config.get("shading", BaseMaterial3D.SHADING_MODE_UNSHADED))
		if config.has("color"):
			var tint: Array = config.color
			mat.albedo_color = Color(float(tint[0]), float(tint[1]), float(tint[2]), float(tint[3]))
		mat.texture_filter = BaseMaterial3D.TEXTURE_FILTER_NEAREST
		mat.texture_repeat = true
		mat.transparency = int(config.get("transparency", BaseMaterial3D.TRANSPARENCY_ALPHA_SCISSOR))
		mat.alpha_scissor_threshold = float(config.get("scissor", 0.5))
		mat.cull_mode = int(config.get("cull", BaseMaterial3D.CULL_DISABLED))
		mat.render_priority = int(config.get("priority", 0))
		mesh.surface_set_material(mesh.get_surface_count() - 1, mat)
	return mesh

