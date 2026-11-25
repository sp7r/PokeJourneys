extends CanvasLayer
## Title screen shown when the hub starts: the splash art, the logo and a blinking "Press A".
## Pressing A (or clicking) emits `started`. With `hold` the splash then stays up, showing status() lines (signing in,
## the server status) until finish() fades it out; `pressed` reports a later press (to retry).

signal started
signal pressed

var hold := false
var _waiting := false

var _prompt: Label
var _done := false
var _time := 0.0


func _ready() -> void:
	layer = 10
	var splash := TextureRect.new()
	splash.texture = load("res://branding/splash.png")
	splash.set_anchors_preset(Control.PRESET_FULL_RECT)
	splash.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	splash.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_COVERED
	add_child(splash)
	var logo := TextureRect.new()
	logo.texture = load("res://branding/logo.png")
	logo.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	logo.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	logo.anchor_left = 0.2
	logo.anchor_right = 0.8
	logo.anchor_top = 0.04
	logo.anchor_bottom = 0.62
	add_child(logo)
	_prompt = Label.new()
	_prompt.text = "PRESS A TO START"
	var font := load("res://fonts/PixelOperator.ttf") as FontFile
	font.antialiasing = TextServer.FONT_ANTIALIASING_NONE
	_prompt.add_theme_font_override("font", font)
	_prompt.add_theme_font_size_override("font_size", 48)
	_prompt.add_theme_color_override("font_color", Color.WHITE)
	_prompt.add_theme_color_override("font_outline_color", Color(0.05, 0.15, 0.35))
	_prompt.add_theme_constant_override("outline_size", 12)
	_prompt.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_prompt.anchor_left = 0.0
	_prompt.anchor_right = 1.0
	_prompt.anchor_top = 0.8
	_prompt.anchor_bottom = 0.9
	add_child(_prompt)


func _process(delta: float) -> void:
	_time += delta
	if not _done or _waiting: _prompt.visible = fmod(_time, 1.0) < 0.65


func _unhandled_input(event: InputEvent) -> void:
	var press: bool = event.is_action_pressed("interact") or (event is InputEventMouseButton and event.pressed) or (event is InputEventJoypadButton and event.pressed)
	if not press: return
	if _waiting:
		get_viewport().set_input_as_handled()
		_waiting = false
		pressed.emit()
		return
	if _done: return
	get_viewport().set_input_as_handled()
	start()


## Fades the title out and emits `started` (also used by the --autostart test flag).
func start() -> void:
	if _done: return
	_done = true
	if hold:
		status("Starting...")
		started.emit()
		return
	_prompt.visible = false
	var tween := create_tween()
	for child in get_children():
		tween.parallel().tween_property(child, "modulate:a", 0.0, 0.6)
	await tween.finished
	started.emit()
	queue_free()


## A steady line where "PRESS A TO START" was (signing in, "Server Online · 12 players online"). With `ask`, it blinks
## and the next press emits `pressed`.
func status(text: String, ask := false) -> void:
	print("title: ", text)
	_prompt.text = text
	_prompt.visible = true
	_waiting = ask


## Fades the held splash out, once the island is ready.
func finish() -> void:
	_waiting = false
	var tween := create_tween()
	for child in get_children():
		tween.parallel().tween_property(child, "modulate:a", 0.0, 0.6)
	await tween.finished
	queue_free()
