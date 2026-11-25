extends CanvasLayer
const Gba = preload("res://scripts/gba_frame.gd")
## Sign-in after the title screen: "Sign in with Discord". A opens Discord's own sign-in page
## (the app's PokeJourneys plugin, journeys/DiscordSignIn.kt); no password passes through
## PokeJourneys. Emits `finished` once signed in.

signal finished

const INK := Color(0.22, 0.22, 0.25)

var _app: Object
var _status: Label
var _button: PanelContainer
var _busy := false
var _done := false


func _ready() -> void:
	layer = 10
	_app = Engine.get_singleton("PokeJourneys") if Engine.has_singleton("PokeJourneys") else null
	if _app:
		_app.connect("signed_in", _on_signed_in)
		_app.connect("sign_in_failed", _on_failed)
	var font := Gba.load_font()
	font.antialiasing = TextServer.FONT_ANTIALIASING_NONE

	var splash := TextureRect.new()
	splash.texture = load("res://branding/splash.png")
	splash.set_anchors_preset(Control.PRESET_FULL_RECT)
	splash.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	splash.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_COVERED
	splash.modulate = Color(0.55, 0.6, 0.7)
	add_child(splash)

	var panel := _box(Color(0.97, 0.96, 0.91), INK, 4, 10)
	panel.anchor_left = 0.22
	panel.anchor_right = 0.78
	panel.anchor_top = 0.24
	panel.anchor_bottom = 0.24
	add_child(panel)
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 22)
	panel.add_child(column)
	column.add_child(_text("Sign in", 48, font))
	var why := _text("Your trainer is saved to your Discord account. PokeJourneys never sees your password.", 32, font)
	why.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	column.add_child(why)

	_button = _box(Color(0.97, 0.9, 0.58), Color(0.85, 0.2, 0.18), 4, 10)
	_button.custom_minimum_size = Vector2(0, 76)
	var label := _text("SIGN IN WITH DISCORD", 32, font)
	label.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	_button.add_child(label)
	_button.gui_input.connect(func(event: InputEvent):
		if event is InputEventMouseButton and event.pressed: _start())
	column.add_child(_button)

	_status = _text("Press A", 32, font)
	if not Gba.available(): _status.add_theme_color_override("font_color", Color(0.35, 0.35, 0.4))
	column.add_child(_status)


func _unhandled_input(event: InputEvent) -> void:
	if _done: return
	if event.is_action_pressed("interact"):
		get_viewport().set_input_as_handled()
		_start()


func _start() -> void:
	if _busy or _done: return
	_busy = true
	_status.text = "Opening Discord..."
	if _app: _app.sign_in()


## Back in the hub with no answer from Discord (the player left Discord without signing in): unlock the button.
func _notification(what: int) -> void:
	if what != NOTIFICATION_APPLICATION_FOCUS_IN or not _busy: return
	await get_tree().create_timer(5.0).timeout
	if _busy: _on_failed("Didn't hear back from Discord.")


func _on_signed_in(name: String) -> void:
	_busy = false
	_done = true
	_status.text = "Welcome, %s!" % name
	await get_tree().create_timer(1.2).timeout
	_app.disconnect("signed_in", _on_signed_in)
	_app.disconnect("sign_in_failed", _on_failed)
	var tween := create_tween()
	for child in get_children():
		tween.parallel().tween_property(child, "modulate:a", 0.0, 0.5)
	await tween.finished
	finished.emit()
	queue_free()


func _on_failed(message: String) -> void:
	_busy = false
	_status.text = message + " Press A to try again."


func _box(fill: Color, rim: Color, rim_width: int, corner: int) -> PanelContainer:
	var panel := PanelContainer.new()
	var style := StyleBoxFlat.new()
	style.bg_color = fill
	style.border_color = rim
	style.set_border_width_all(rim_width)
	style.set_corner_radius_all(corner)
	style.anti_aliasing = false
	style.set_content_margin_all(rim_width + 14)
	panel.add_theme_stylebox_override("panel", Gba.new().style(2) if Gba.available() else style)
	return panel


func _text(value: String, size: int, font: FontFile) -> Label:
	var label := Label.new()
	label.text = value
	label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	label.add_theme_font_override("font", font)
	label.add_theme_font_size_override("font_size", size)
	label.add_theme_color_override("font_color", INK)
	label.add_theme_color_override("font_shadow_color", Color(0.75, 0.75, 0.78))
	label.add_theme_constant_override("shadow_offset_x", size / 16)
	label.add_theme_constant_override("shadow_offset_y", size / 16)
	Gba.label_style(label, size, font)
	return label
