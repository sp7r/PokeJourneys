extends SceneTree
func _initialize():
	var args = OS.get_cmdline_user_args()
	var source = args[0]
	var output = args[1]
	var result := {}
	for group in ["terrain", "buildings", "decorations"]:
		var mesh = load(source.path_join("data/" + group + ".res"))
		var surfaces := []
		for i in mesh.get_surface_count():
			var a = mesh.surface_get_arrays(i)
			var m = mesh.surface_get_material(i)
			var vertices := []
			var uv := []
			for v in a[Mesh.ARRAY_VERTEX]: vertices.append([v.x,v.y,v.z])
			for v in a[Mesh.ARRAY_TEX_UV]: uv.append([v.x,v.y])
			var image = m.albedo_texture.get_image() if m.albedo_texture else null
			var texture = group + "-" + str(i) + ".png"
			if image: image.save_png(output.path_join(texture))
			surfaces.append({"name":m.resource_name,"texture":texture,"path":m.albedo_texture.resource_path if m.albedo_texture else "", "vertices":vertices,"uv":uv,"indices":Array(a[Mesh.ARRAY_INDEX]) if a[Mesh.ARRAY_INDEX] != null else [],"transparency":m.transparency,"scissor":m.alpha_scissor_threshold,"cull":m.cull_mode,"shading":m.shading_mode,"color":str(m.albedo_color),"priority":m.render_priority,"depth":m.no_depth_test})
		result[group]=surfaces
	var f=FileAccess.open(output.path_join("reference-meshes.json"),FileAccess.WRITE)
	f.store_string(JSON.stringify(result))
	quit()
