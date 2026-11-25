extends PanelContainer
## HGSS-style text box: pages of text, advanced with the interact button.

signal closed

var _pages: Array = []
var _label: Label


func _ready() -> void:
	var style := StyleBoxFlat.new()
	style.bg_color = Color(0.97, 0.97, 0.97)
	style.border_color = Color(0.36, 0.42, 0.55)
	style.set_border_width_all(6)
	style.set_corner_radius_all(10)
	style.content_margin_left = 28
	style.content_margin_right = 28
	style.content_margin_top = 18
	style.content_margin_bottom = 18
	add_theme_stylebox_override("panel", style)
	_label = Label.new()
	_label.add_theme_color_override("font_color", Color(0.25, 0.25, 0.28))
	_label.add_theme_color_override("font_shadow_color", Color(0.78, 0.78, 0.8))
	_label.add_theme_constant_override("shadow_offset_x", 2)
	_label.add_theme_constant_override("shadow_offset_y", 2)
	_label.add_theme_font_size_override("font_size", 30)
	_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_label.custom_minimum_size = Vector2(0, 84)
	add_child(_label)
	visible = false


func is_open() -> bool:
	return visible


## Show pages one at a time; emits `closed` after the last.
func show_pages(pages: Array) -> void:
	_pages = []
	for p in pages:  # \f inside a message also starts a new page
		_pages.append_array(String(p).split("\f", false))
	if _pages.is_empty():
		return
	visible = true
	_label.text = _pages.pop_front()


func advance() -> void:
	if not _pages.is_empty():
		_label.text = _pages.pop_front()
		return
	visible = false
	closed.emit()
