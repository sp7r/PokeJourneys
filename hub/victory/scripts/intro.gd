extends CanvasLayer
const Gba = preload("res://scripts/gba_frame.gd")
## The first-start flyover: the camera glides over Victory Island from shot to shot (layout.json's
## "intro"), a caption under each, then fades to black and emits `finished`. A skips it.
##
## A shot: {"caption", "tile": [x, y] looked at, "distance" from it, "pitch" and "yaw" in degrees
## (yaw 0 looks north, as the field camera does), "seconds" on screen}. The camera spends the first
## part of each shot gliding there from the last one, then drifts slowly around the spot.

signal finished

const GLIDE := 0.45  # share of a shot spent moving to it
const DRIFT := 6.0   # degrees of yaw the camera drifts while holding a shot

var camera: Camera3D
var world: Node
var shots: Array = []

var _caption: Label
var _box: PanelContainer
var _fade: ColorRect
var _poses: Array = []  # per shot: [target, yaw, pitch, distance]
var _time := 0.0
var _total := 0.0
var _lens := [0.0, 0.0]  # the field camera's fov and far, given back at the end
var _shown := -1
var _done := false


func _ready() -> void:
	layer = 8
	# A wider lens than the field camera's, and far enough to take in the whole island.
	_lens = [camera.fov, camera.far]
	camera.fov = 30.0
	camera.far = 800.0
	for shot in shots:
		var tile := Vector2i(int(shot.tile[0]), int(shot.tile[1]))
		var target: Vector3 = world.tile_to_world(tile) + Vector3(0, 1, 0)
		_poses.append([target, float(shot.get("yaw", 0)), float(shot.get("pitch", 45)), float(shot.get("distance", 40))])
		_total += float(shot.get("seconds", 5))
	var font := Gba.load_font()
	font.antialiasing = TextServer.FONT_ANTIALIASING_NONE
	_box = PanelContainer.new()
	var style := StyleBoxFlat.new()
	style.bg_color = Color(0.97, 0.96, 0.91)
	style.border_color = Color(0.22, 0.22, 0.25)
	style.set_border_width_all(4)
	style.set_corner_radius_all(10)
	style.anti_aliasing = false
	style.set_content_margin_all(14)
	_box.add_theme_stylebox_override("panel", Gba.new().style(2) if Gba.available() else style)
	_box.anchor_left = 0.12
	_box.anchor_right = 0.88
	_box.anchor_top = 0.76
	_box.anchor_bottom = 0.76
	add_child(_box)
	_caption = Label.new()
	_caption.add_theme_font_override("font", font)
	_caption.add_theme_font_size_override("font_size", 48)
	_caption.add_theme_color_override("font_color", Color(0.22, 0.22, 0.25))
	_caption.add_theme_color_override("font_shadow_color", Color(0.75, 0.75, 0.78))
	_caption.add_theme_constant_override("shadow_offset_x", 3)
	_caption.add_theme_constant_override("shadow_offset_y", 3)
	_caption.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_caption.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART  # a long caption takes two lines
	Gba.label_style(_caption, 48, font)
	_box.add_child(_caption)
	_box.modulate.a = 0.0
	_fade = ColorRect.new()
	_fade.color = Color.BLACK
	_fade.set_anchors_preset(Control.PRESET_FULL_RECT)
	_fade.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(_fade)
	create_tween().tween_property(_fade, "color:a", 0.0, 1.0)
	if _poses.is_empty():
		_finish()
		return
	_place(_poses[0], 0.0)


func _process(delta: float) -> void:
	if _done: return
	_time += delta
	if _time >= _total:
		_finish()
		return
	# Which shot, and how far into it.
	var start := 0.0
	var index := 0
	for i in shots.size():
		var length := float(shots[i].get("seconds", 5))
		if _time < start + length:
			index = i
			break
		start += length
	var length := float(shots[index].get("seconds", 5))
	var into := (_time - start) / length
	var here: Array = _poses[index]
	var before: Array = _poses[maxi(index - 1, 0)]
	var glide := smoothstep(0.0, 1.0, clampf(into / GLIDE, 0.0, 1.0))
	var pose := [before[0].lerp(here[0], glide), lerpf(before[1], here[1], glide),
		lerpf(before[2], here[2], glide), lerpf(before[3], here[3], glide)]
	_place(pose, DRIFT * into)
	if index != _shown:
		_shown = index
		_show_caption(String(shots[index].get("caption", "")))


## Puts the camera [pose] = [target, yaw, pitch, distance] away from its target, turned by [drift].
func _place(pose: Array, drift: float) -> void:
	var yaw := deg_to_rad(pose[1] + drift)
	var pitch := deg_to_rad(pose[2])
	var back := Vector3(sin(yaw) * cos(pitch), sin(pitch), cos(yaw) * cos(pitch))
	camera.position = pose[0] + back * pose[3]
	camera.look_at(pose[0], Vector3.UP)


func _show_caption(text: String) -> void:
	var tween := create_tween()
	if _box.modulate.a > 0.0: tween.tween_property(_box, "modulate:a", 0.0, 0.25)
	tween.tween_callback(func(): _caption.text = text)
	if text != "": tween.tween_property(_box, "modulate:a", 1.0, 0.35)


func _unhandled_input(event: InputEvent) -> void:
	if _done: return
	if event.is_action_pressed("interact") or (event is InputEventJoypadButton and event.pressed and event.button_index == JOY_BUTTON_START):
		get_viewport().set_input_as_handled()
		_finish()


func _finish() -> void:
	if _done: return
	_done = true
	var tween := create_tween()
	tween.tween_property(_box, "modulate:a", 0.0, 0.3)
	tween.parallel().tween_property(_fade, "color:a", 1.0, 0.8)
	await tween.finished
	camera.fov = _lens[0]
	camera.far = _lens[1]
	finished.emit()
	queue_free()
