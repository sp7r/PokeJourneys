extends Control
## The hot wheel: a ring of tiles held open with L3 (Q on a keyboard). The left stick points at a
## tile, left and right step round the ring, and letting go of L3 (or A) picks the tile pointed at;
## B closes it with nothing picked. Drawn in FireRed's menu frame and font when the player's export
## is there (gba_frame.gd), plain boxes otherwise.

const Gba = preload("res://scripts/gba_frame.gd")
const Joypad = preload("res://scripts/joypad.gd")
const NATIVE := Vector2(240, 160)   # the GBA's screen: the ring is laid out in its pixels
const TILE := Vector2(88, 28)
const RADIUS := Vector2(76, 40)
const HINT_Y := 62.0

## Emitted when the wheel closes: the tile picked, or -1 for none.
signal picked(index: int)

var labels: Array = []
var hints: Array = []
var cursor := -1
var _gba: Gba
var _font: FontFile


func _ready() -> void:
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
	visible = false
	if Gba.available(): _gba = Gba.new()
	_font = _gba.font if _gba else Gba.load_font()


func is_open() -> bool:
	return visible


## Opens the ring with one tile per label; `hint_lines` says what each does, under the ring.
func open(tile_labels: Array, hint_lines: Array) -> void:
	labels = tile_labels
	hints = hint_lines
	cursor = -1
	visible = true
	queue_redraw()


func close(pick: bool) -> void:
	if not visible: return
	visible = false
	picked.emit(cursor if pick else -1)


## Moves the cursor round the ring: 1 is clockwise.
func step(by: int) -> void:
	cursor = 0 if cursor < 0 else posmod(cursor + by, labels.size())
	queue_redraw()


func _process(_delta: float) -> void:
	if not visible: return
	var stick := Joypad.left_stick()
	if stick == Vector2.ZERO: return
	var nearest := 0
	for i in labels.size():
		if _direction(i).dot(stick) > _direction(nearest).dot(stick): nearest = i
	if nearest != cursor:
		cursor = nearest
		queue_redraw()


## Which way tile `i` lies from the middle: the first is at the top, the rest follow clockwise.
func _direction(i: int) -> Vector2:
	var angle := TAU * i / labels.size() - PI / 2
	return Vector2(cos(angle), sin(angle))


func _draw() -> void:
	draw_rect(Rect2(Vector2.ZERO, size), Color(0, 0, 0, 0.4))
	# Whole screen pixels per GBA pixel, like the hub's other FireRed screens.
	var factor := maxf(1.0, floorf(minf(size.x / NATIVE.x, size.y / NATIVE.y)))
	draw_set_transform(size / 2, 0.0, Vector2.ONE * factor)
	for i in labels.size():
		var rect := Rect2((_direction(i) * RADIUS - TILE / 2).round(), TILE)
		_tile(rect, String(labels[i]), i == cursor)
	if cursor >= 0 and cursor < hints.size():
		var hint := String(hints[cursor])
		var width := _font.get_string_size(hint, HORIZONTAL_ALIGNMENT_LEFT, -1, 16).x
		var box := Rect2(Vector2(-width / 2 - 8, HINT_Y - 6).round(), Vector2(width + 16, 24))
		draw_rect(box, Color(0, 0, 0, 0.6))
		draw_string(_font, box.position + Vector2(8, 17), hint, HORIZONTAL_ALIGNMENT_LEFT, -1, 16, Color.WHITE)


func _tile(rect: Rect2, label: String, chosen: bool) -> void:
	if _gba:
		_gba.menu(self, rect)
	else:
		draw_rect(rect, Color("5c6b8c"))
		draw_rect(rect.grow(-2), Color("f8f8f8"))
	var at := rect.position + Vector2(18, 6)
	if _gba:
		_gba.text(self, label, at, rect.size.x - 26)
		if chosen: _gba.arrow(self, rect.position + Vector2(9, 8))
	else:
		draw_string(_font, at + Vector2(0, 13), label, HORIZONTAL_ALIGNMENT_LEFT, rect.size.x - 26, 16, Color("404048"))
		if chosen: draw_string(_font, rect.position + Vector2(8, 19), ">", HORIZONTAL_ALIGNMENT_LEFT, -1, 16, Color("404048"))
	# The tiles not pointed at sit back.
	if not chosen: draw_rect(rect, Color(0, 0, 0, 0.3))
