extends PanelContainer
## External FireRed dialogue (original window fallback): pages advanced with interact, and an optional
## pick list (ask) shown in a second box above it, moved with up/down and picked with interact.

const Gba = preload("res://scripts/gba_frame.gd")
var _gba: Gba
var _native_width := 240

signal closed
signal answered(index: int)

var _pages: Array = []
var _label: Label
var _font: FontFile
var _choices: PanelContainer
var _list: VBoxContainer
var _options: Array = []
var _cursor := 0
var _top := 0  # first option shown when the list is longer than ROWS
var _menu_width := 96
var _hold_to_scroll := false
var _scroll_dir := 0
var _scroll_wait := 0.0
const ROWS := 6
const SCROLL_DELAY := 0.28
const SCROLL_REPEAT := 0.065


func _ready() -> void:
	add_theme_stylebox_override("panel", _box_style())
	# PokeDaisy's pixel font, drawn at three times its 16 px design size, like DS text on this screen, with no smoothing.
	_font = load("res://fonts/PixelOperator.ttf") as FontFile
	_font.antialiasing = TextServer.FONT_ANTIALIASING_NONE
	_font.hinting = TextServer.HINTING_NONE
	_font.subpixel_positioning = TextServer.SUBPIXEL_POSITIONING_DISABLED
	_label = _text_label()
	_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_label.custom_minimum_size = Vector2(0, 104)
	add_child(_label)
	visible = false
	_font = Gba.load_font()
	Gba.label_style(_label, 48, _font)
	if Gba.available():
		_gba = Gba.new()
		_label.hide()
		add_theme_stylebox_override("panel", StyleBoxEmpty.new())
		texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST


func _box_style() -> StyleBoxFlat:
	var style := StyleBoxFlat.new()
	style.bg_color = Color(0.97, 0.97, 0.97)
	style.border_color = Color(0.36, 0.42, 0.55)
	style.set_border_width_all(6)
	style.set_corner_radius_all(10)
	style.content_margin_left = 28
	style.content_margin_right = 28
	style.content_margin_top = 18
	style.content_margin_bottom = 18
	return style


func _text_label() -> Label:
	var label := Label.new()
	label.add_theme_font_override("font", _font)
	label.add_theme_color_override("font_color", Color(0.25, 0.25, 0.28))
	label.add_theme_color_override("font_shadow_color", Color(0.78, 0.78, 0.8))
	label.add_theme_constant_override("shadow_offset_x", 3)
	label.add_theme_constant_override("shadow_offset_y", 3)
	label.add_theme_font_size_override("font_size", 48)
	Gba.label_style(label,48,_font)
	return label


func is_open() -> bool:
	return visible


func is_asking() -> bool:
	return _choices != null


## Show pages one at a time; emits `closed` after the last.
func show_pages(pages: Array) -> void:
	_pages = []
	for p in pages:  # \f inside a message also starts a new page
		_pages.append_array(String(p).split("\f", false))
	if _gba:
		var wrapped: Array = []
		for page in _pages: wrapped.append_array(_paginate(String(page)))
		_pages = wrapped
	if _pages.is_empty():
		return
	visible = true
	_label.text = _pages.pop_front()


func advance() -> void:
	if is_asking():
		_answer(_cursor)
		return
	if not _pages.is_empty():
		_label.text = _pages.pop_front()
		return
	visible = false
	closed.emit()


## Shows `question` with a list of `options`; emits `answered` with the picked index, or the last
## option's index when backed out of with B (so the last option should be the "no" one, as in the games).
func ask(question: String, options: Array, initial: int = 0, hold_to_scroll: bool = false) -> void:
	_pages = []
	visible = true
	_label.text = question
	_options = options
	_cursor = clampi(initial, 0, options.size() - 1)
	_top = 0
	_hold_to_scroll = hold_to_scroll
	_scroll_dir = 0
	_scroll_wait = 0.0
	_choices = PanelContainer.new()
	if _gba:
		_menu_width = 96
		for option in options:
			_menu_width = maxi(_menu_width, int(_font.get_string_size(String(option), HORIZONTAL_ALIGNMENT_LEFT, -1, 16).x) + 32)
		_choices.hide()
		add_child(_choices)
		_draw_cursor()
		return
	_choices.add_theme_stylebox_override("panel", _box_style())
	_list = VBoxContainer.new()
	_choices.add_child(_list)
	for i in mini(options.size(), ROWS):
		_list.add_child(_text_label())
	get_parent().add_child(_choices)
	# Sits on the right, just above this box.
	_choices.anchor_left = 1.0
	_choices.anchor_right = 1.0
	_choices.anchor_top = anchor_top
	_choices.anchor_bottom = anchor_top
	_choices.grow_horizontal = Control.GROW_DIRECTION_BEGIN
	_choices.grow_vertical = Control.GROW_DIRECTION_BEGIN
	_choices.offset_right = offset_right
	_choices.offset_bottom = offset_top - 8
	_draw_cursor()


func _draw_cursor() -> void:
	if _gba:
		_top = clampi(_top, _cursor - ROWS + 1, _cursor)
		queue_redraw()
		return
	_top = clampi(_top, _cursor - ROWS + 1, _cursor)
	for row in _list.get_child_count():
		var i := _top + row
		var more := (row == 0 and _top > 0) or (row == ROWS - 1 and i < _options.size() - 1)
		(_list.get_child(row) as Label).text = ("> " if i == _cursor else "   ") + String(_options[i]) + (" ..." if more else "")


func _answer(index: int) -> void:
	_choices.queue_free()
	_choices = null
	visible = false
	answered.emit(index)


func _unhandled_input(event: InputEvent) -> void:
	if not is_asking(): return
	if event.is_action_pressed("ui_up") or event.is_action_pressed("move_up"):
		_cursor = posmod(_cursor - 1, _options.size())
	elif event.is_action_pressed("ui_down") or event.is_action_pressed("move_down"):
		_cursor = posmod(_cursor + 1, _options.size())
	elif event.is_action_pressed("run"):
		_answer(_options.size() - 1)
		get_viewport().set_input_as_handled()
		return
	else:
		return
	_draw_cursor()
	get_viewport().set_input_as_handled()

func _process(delta: float) -> void:
	if _hold_to_scroll and is_asking():
		var down := Input.is_action_pressed("ui_down") or Input.is_action_pressed("move_down")
		var up := Input.is_action_pressed("ui_up") or Input.is_action_pressed("move_up")
		var direction := int(down) - int(up)
		if direction != _scroll_dir:
			_scroll_dir = direction
			_scroll_wait = SCROLL_DELAY
		elif direction != 0:
			_scroll_wait -= delta
			if _scroll_wait <= 0.0:
				var steps := 1 + floori(-_scroll_wait / SCROLL_REPEAT)
				_scroll_wait += steps * SCROLL_REPEAT
				_cursor = posmod(_cursor + direction * steps, _options.size())
				_draw_cursor()
	if not _gba or not visible: return
	var view := get_viewport_rect().size
	var factor := maxi(1, floori(minf(view.x / 240, view.y / 160)))
	_native_width = int(view.x / factor / 8) * 8
	set_anchors_preset(Control.PRESET_TOP_LEFT)
	scale = Vector2.ONE * factor
	position = Vector2(floor((view.x - _native_width * factor) / 2), view.y - 48 * factor)
	size = Vector2(_native_width, 48)
	queue_redraw()

func _draw() -> void:
	if not _gba: return
	_gba.dialogue(self, Vector2.ZERO, _native_width / 8)
	var lines: Array[String] = []
	var line := ""
	for word in _label.text.replace("\n", " ").split(" "):
		if _font.get_string_size(line + " " + word, HORIZONTAL_ALIGNMENT_LEFT, -1, 16).x > _native_width - 32 and line != "":
			lines.append(line)
			line = word
		else: line += (" " if line != "" else "") + word
	lines.append(line)
	for i in mini(2, lines.size()): _gba.text(self, lines[i], Vector2(16, 8 + i * 16))
	if not is_asking(): return
	var count := mini(ROWS, _options.size())
	var width := mini(_menu_width, _native_width - 8)
	var at := Vector2(_native_width - width - 8, -count * 16 - 16)
	_gba.menu(self, Rect2(at, Vector2(width, count * 16 + 16)))
	for row in count:
		_gba.text(self, String(_options[_top + row]), at + Vector2(24, 8 + row * 16), width - 32)
		if _top + row == _cursor: _gba.arrow(self, at + Vector2(8, 8 + row * 16))

func _paginate(value: String) -> Array:
	var view := get_viewport_rect().size
	var factor := maxi(1, floori(minf(view.x / 240, view.y / 160)))
	var width := int(view.x / factor / 8) * 8 - 32
	var lines: Array[String] = []
	for paragraph in value.split("\n"):
		var line := ""
		for word in paragraph.split(" "):
			if _font.get_string_size(line + " " + word,HORIZONTAL_ALIGNMENT_LEFT,-1,16).x > width and line != "":
				lines.append(line)
				line = word
			else: line += (" " if line != "" else "") + word
		lines.append(line)
	var pages: Array = []
	for i in range(0,lines.size(),2): pages.append(lines[i] + ("\n" + lines[i + 1] if i + 1 < lines.size() else ""))
	return pages
