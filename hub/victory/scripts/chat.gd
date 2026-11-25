extends CanvasLayer
## Global and private chat on the live connection, typed on the device's own keyboard, in a floating FireRed-style window on the main screen.
const Gba = preload("res://scripts/gba_frame.gd")
const FONT := preload("res://fonts/PixelOperator.ttf")
const NATIVE_WIDTH := 240  # GBA pixels; the window is drawn at the hub's FireRed scale
const LINE := 16
const MARGIN := 16.0
# FireRed's message colours (text, shadow): dark, blue, red, green. Used as drawn colours without FireRed data.
const TONES := {"dark": [2, 3], "blue": [8, 9], "red": [4, 5], "green": [6, 7]}
const FALLBACK := {"dark": Color8(99, 99, 99), "blue": Color8(49, 82, 206), "red": Color8(230, 8, 8), "green": Color8(33, 156, 8)}
const PHRASES := ["Hi!", "Want to trade?", "Want to battle?", "Nice follower!", "Thanks!", "Good luck on your journey!", "See you around!"]

var host: Node
var client: Node
var _self_id := 0
var _messages := {}  # message id -> server message
var _people := {0: "Global"}  # 0 is global; other keys are the private recipient's id
var _unread := {}
var _drafts := {}
var _history: Array = []  # direct history can arrive before the room identifies this player
var _seen := {}
var _notices: Array = []
var _channel := 0
var _opened := false
var _typing := false
var _quick := false
var _phrase := 0
var _scroll := 0.0  # pixels scrolled up from the newest message
var _items: Array = []
var _total := 0.0
var _hits: Array = []  # [Rect2, Callable] in window coordinates, from the last draw
var _error := ""
var _sent_at := -10000
var _pending := {}
var _surface: Control
var _screen: Control
var _feed: Control
var _gba: Gba
var _pixel: FontFile
var _fonts := {}  # tone -> font


func setup(main: Node, live: Node) -> void:
	host = main
	client = live
	layer = 7
	_pixel = FONT.duplicate()
	_pixel.antialiasing = TextServer.FONT_ANTIALIASING_NONE
	_pixel.subpixel_positioning = TextServer.SUBPIXEL_POSITIONING_DISABLED
	if Gba.available(): _gba = Gba.new()


func set_player_id(id: int) -> void:
	_self_id = id
	for waiting in _history: _store(waiting.entry, bool(waiting.live))
	_history.clear()
	_refresh()


func receive(data: Dictionary) -> void:
	match String(data.get("type", "")):
		"chat_history":
			# The reconnect snapshot also removes messages deleted while this player was offline.
			_messages.clear()
			_history.clear()
			for entry in data.get("messages", []):
				if entry is Dictionary:
					if _self_id == 0: _history.append({"entry": entry, "live": false})
					else: _store(entry, false)
		"chat":
			if _self_id == 0: _history.append({"entry": data, "live": true})
			else: _store(data, true)
		"chat_deleted":
			var id := int(data.id)
			_messages.erase(id)
			_history = _history.filter(func(m): return int(m.entry.id) != id)
			_notices = _notices.filter(func(m): return int(m.id) != id)
	_refresh()


func _thread(entry: Dictionary) -> int:
	if String(entry.channel) == "global": return 0
	var from: Dictionary = entry.get("from", {})
	var to: Dictionary = entry.to if entry.get("to") is Dictionary else {}
	var person: Dictionary = to if int(from.get("id", 0)) == _self_id else from
	return int(person.get("id", 0))


func _store(entry: Dictionary, live: bool) -> void:
	var id := int(entry.id)
	var thread := _thread(entry)
	if thread > 0:
		var person: Dictionary = entry.to if int(entry.from.id) == _self_id else entry.from
		_people[thread] = String(person.get("name", "Player %d" % thread))
	var fresh := not _seen.has(id)
	_seen[id] = true
	_messages[id] = entry
	if not _pending.is_empty() and int(entry.from.id) == _self_id and thread == int(_pending.channel) and String(entry.text) == String(_pending.text):
		var draft := String(_drafts.get(thread, ""))
		if draft.begins_with(String(_pending.text)): _drafts[thread] = draft.substr(String(_pending.text).length())
		_pending.clear()
	if live and fresh:
		if int(entry.from.id) != _self_id and (not _opened or _channel != thread): _unread[thread] = true
		if bool(entry.get("notice", false)): _notices.append(entry)


func is_open() -> bool:
	return _opened


func toggle() -> void:
	if _opened: close()
	else: open()


func open(id: int = 0, player_name: String = "", typing := false) -> void:
	if host.message.is_open() or (not _opened and (host.player.locked or host.player.moving)): return
	if id > 0: _people[id] = player_name if not player_name.is_empty() else String(_people.get(id, "Player %d" % id))
	_channel = id
	_typing = false
	_quick = false
	_scroll = 0.0
	_unread.erase(id)
	_error = ""
	if not _opened:
		_opened = true
		host.player.locked = true
		_build_screen()
	if typing: _start_typing()
	_refresh()


func close() -> void:
	if not _opened: return
	_stop_typing()
	_opened = false
	_screen.draw.disconnect(_draw_panel)
	_surface.queue_free()
	_surface = null
	_screen = null
	if not host.message.is_open(): host.player.locked = false


func _build_screen() -> void:
	_surface = Control.new()
	_surface.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(_surface)
	_screen = Control.new()
	_screen.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
	_screen.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_surface.add_child(_screen)
	_feed = Control.new()
	_feed.clip_contents = true
	_feed.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
	_feed.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_screen.add_child(_feed)
	_layout()
	_screen.draw.connect(_draw_panel)
	_feed.draw.connect(_draw_feed)


func _layout() -> void:
	# A floating window in the top-right corner, drawn in GBA pixels at a whole number of screen pixels each, like
	# the hub's FireRed menus. While the device's keyboard is up it shortens so the text box stays above it.
	var view: Vector2 = get_viewport().get_visible_rect().size
	var bottom := minf(view.y * 0.6, 440.0)
	if _typing and DisplayServer.has_feature(DisplayServer.FEATURE_VIRTUAL_KEYBOARD):
		var keyboard := DisplayServer.virtual_keyboard_get_height()
		if keyboard > 0: bottom = minf(bottom, view.y - keyboard * view.y / float(DisplayServer.window_get_size().y) - MARGIN * 2)
	var display_scale := get_viewport().get_final_transform().get_scale().x
	var pixels := maxi(1, floori(minf(560.0, view.x - MARGIN * 2) / NATIVE_WIDTH * display_scale))
	var factor := pixels / display_scale
	var size := Vector2(NATIVE_WIDTH, maxf(120, floorf(bottom / factor / 8) * 8))
	_screen.scale = Vector2.ONE * factor
	_screen.position = (Vector2(view.x - NATIVE_WIDTH * factor - MARGIN, MARGIN) * display_scale).floor() / display_scale
	if _screen.size != size:
		_screen.size = size
		_feed.position = Vector2(8, 40)
		_feed.size = Vector2(NATIVE_WIDTH - 24, floorf((size.y - 40 - 40) / LINE) * LINE)
		_refresh()


func _process(_delta: float) -> void:
	if host == null: return
	if not _pending.is_empty() and Time.get_ticks_msec() - _sent_at > 10000:
		handle_error("No chat receipt yet. Check your connection before trying again.")
	if _opened:
		_layout()
		_screen.queue_redraw()  # the caret blinks and the arrows bob
		_surface.visible = not host.message.is_open()
	elif not _notices.is_empty() and not host.player.locked and not host.player.moving and not host.message.is_open() and not client._busy:
		var notice: Dictionary = _notices.pop_front()
		host._show_pages(["Server: " + String(notice.text)])


func _refresh() -> void:
	_items.clear()
	_total = 0.0
	if _feed != null:
		var entries: Array = _messages.values().filter(func(m): return _thread(m) == _channel)
		entries.sort_custom(func(a, b): return int(a.id) < int(b.id))
		for entry in entries: _add_item(entry)
		if not _pending.is_empty() and int(_pending.channel) == _channel:
			_add_item({"from": {"id": _self_id, "name": _self_name()}, "text": _pending.text})
		_scroll = clampf(_scroll, 0, maxf(0, _total - _feed.size.y))
	if not _opened: return
	_screen.queue_redraw()
	_feed.queue_redraw()


func _self_name() -> String:
	for entry in _messages.values():
		if int(entry.get("from", {}).get("id", 0)) == _self_id: return String(entry.from.name)
	return "You"


## Each message is "NAME: text", the name in FireRed blue (others), green (you) or red (server notices).
func _add_item(entry: Dictionary) -> void:
	var notice := bool(entry.get("notice", false))
	var from: Dictionary = entry.get("from", {})
	var mine := not notice and int(from.get("id", 0)) == _self_id
	var name := "SERVER" if notice else String(from.get("name", "?"))
	var lines := _wrap(name + ": " + String(entry.text), _feed.size.x - 12)
	_items.append({"lines": lines, "name": name.length() + 1, "tone": "red" if notice else "green" if mine else "blue"})
	_total += LINE * lines.size()


## Wraps at spaces where it can, and inside a word only when the word alone is too wide.
func _wrap(value: String, width: float) -> Array[String]:
	var result: Array[String] = []
	var line := ""
	for word in value.split(" "):
		var joined := word if line.is_empty() else line + " " + word
		if _width(joined) <= width:
			line = joined
			continue
		if not line.is_empty(): result.append(line)
		line = ""
		for letter in word:
			if _width(line + letter) > width and not line.is_empty():
				result.append(line)
				line = ""
			line += letter
	if not line.is_empty() or result.is_empty(): result.append(line)
	return result


func _width(value: String) -> float:
	return _tone("dark").get_string_size(value, HORIZONTAL_ALIGNMENT_LEFT, -1, 16).x


func _fit(value: String, width: float) -> String:
	if _width(value) <= width: return value
	while not value.is_empty() and _width(value + "...") > width: value = value.left(-1)
	return value + "..."


## FireRed's font in one of its message colours. Its glyphs carry their colours (text and shadow), so each colour is
## a recoloured copy of the exported sheet, kept in user://. Without FireRed data, Pixel Operator is drawn in colour.
func _tone(tone: String) -> Font:
	if _fonts.has(tone): return _fonts[tone]
	var face: Font = _pixel
	if _gba and _gba.font is FontFile and FileAccess.file_exists(_gba.dir.path_join("font.png")):
		face = _gba.font
		if tone != "dark":
			var sheet := Image.load_from_file(_gba.dir.path_join("font.png"))
			var dark: Array = TONES.dark
			var wanted: Array = TONES[tone]
			var from := [_gba.color("messagePalette", dark[0]), _gba.color("messagePalette", dark[1])]
			var to := [_gba.color("messagePalette", wanted[0]), _gba.color("messagePalette", wanted[1])]
			for y in sheet.get_height():
				for x in sheet.get_width():
					var pixel := sheet.get_pixel(x, y)
					if pixel.a == 0: continue
					for i in 2:
						if pixel.is_equal_approx(from[i]): sheet.set_pixel(x, y, to[i])
			var folder := "user://chat-font"
			DirAccess.make_dir_recursive_absolute(folder)
			sheet.save_png(folder.path_join(tone + ".png"))
			var layout := FileAccess.get_file_as_string(_gba.dir.path_join("font.fnt")).replace("file=\"font.png\"", "file=\"%s.png\"" % tone)
			var file := FileAccess.open(folder.path_join(tone + ".fnt"), FileAccess.WRITE)
			if file:
				file.store_string(layout)
				file.close()
				var tinted := FontFile.new()
				if tinted.load_bitmap_font(folder.path_join(tone + ".fnt")) == OK:
					tinted.fixed_size_scale_mode = TextServer.FIXED_SIZE_SCALE_INTEGER_ONLY
					tinted.fallbacks = (_gba.font as FontFile).fallbacks
					face = tinted
	_fonts[tone] = face
	return face


func _say(canvas: CanvasItem, value: String, at: Vector2, tone := "dark", width := -1.0) -> float:
	if width > 0: value = _fit(value, width)
	var face := _tone(tone)
	var color: Color = Color.WHITE if face != _pixel else FALLBACK[tone]
	canvas.draw_string(face, at + Vector2(0, 13), value, HORIZONTAL_ALIGNMENT_LEFT, -1, 16, color)
	return _width(value)


func _frame(canvas: CanvasItem, rect: Rect2) -> void:
	if _gba: _gba.menu(canvas, rect)
	else:
		canvas.draw_rect(rect, Color.WHITE)
		canvas.draw_rect(rect.grow(-1), Color8(99, 99, 99), false, 2)


func _pointer(canvas: CanvasItem, at: Vector2, flip := false) -> void:
	var art: Texture2D = _gba.texture("arrow") if _gba else null
	if art: canvas.draw_texture_rect(art, Rect2(at + Vector2(16 if flip else 0, 0), Vector2(-16 if flip else 16, 16)), false)
	else:
		var tip := at + Vector2(2 if flip else 10, 8)
		var back := 6 * (1 if flip else -1)
		canvas.draw_colored_polygon(PackedVector2Array([tip, tip + Vector2(back, -5), tip + Vector2(back, 5)]), Color8(99, 99, 99))


## A small bobbing arrow in FireRed's red, with its shadow: more messages above or below, or "touch to type".
func _more(canvas: CanvasItem, at: Vector2, up: bool) -> void:
	var bob := float(int(Time.get_ticks_msec() / 250) % 2) * (-1.0 if up else 1.0)
	var y := at.y + bob
	for layer in 2:
		var o := Vector2(1, 1) if layer == 0 else Vector2.ZERO
		var color := Color8(255, 189, 115) if layer == 0 else Color8(230, 8, 8)
		var points := PackedVector2Array([Vector2(at.x, y + 5), Vector2(at.x + 7, y + 5), Vector2(at.x + 3.5, y + 1)]) if up 			else PackedVector2Array([Vector2(at.x, y + 1), Vector2(at.x + 7, y + 1), Vector2(at.x + 3.5, y + 5)])
		for p in points.size(): points[p] += o
		canvas.draw_colored_polygon(points, color)


func _button(rect: Rect2, action: Callable) -> void:
	_hits.append([rect, action])


func _draw_panel() -> void:
	_hits.clear()
	var h := _screen.size.y
	# Header: the conversation between arrows, QUICK and CLOSE.
	_frame(_screen, Rect2(0, 0, 144, 32))
	_pointer(_screen, Vector2(6, 8), true)
	_pointer(_screen, Vector2(122, 8))
	var title := String(_people.get(_channel, "Global"))
	var others_unread := _unread.keys().any(func(id): return id != _channel)
	var room := 96.0 - (8 if others_unread else 0)
	var shown := _fit(title, room)
	var x := 25 + floorf((room - _width(shown)) / 2)
	x += _say(_screen, shown, Vector2(x, 8), "blue")
	if others_unread: _say(_screen, "!", Vector2(x + 2, 8), "red")
	_button(Rect2(0, 0, 72, 32), _change_channel.bind(-1))
	_button(Rect2(72, 0, 72, 32), _change_channel.bind(1))
	_frame(_screen, Rect2(144, 0, 48, 32))
	_say(_screen, "QUICK", Vector2(152, 8), "red" if _quick else "dark")
	_button(Rect2(144, 0, 48, 32), _toggle_quick)
	_frame(_screen, Rect2(192, 0, 48, 32))
	_say(_screen, "CLOSE", Vector2(200, 8))
	_button(Rect2(192, 0, 48, 32), close)
	# The messages (drawn by the clipped feed) and their scroll marks.
	_frame(_screen, Rect2(0, 32, NATIVE_WIDTH, h - 64))
	if not _quick and _total > _feed.size.y:
		if _scroll < _total - _feed.size.y: _more(_screen, Vector2(226, 38), true)
		if _scroll > 0: _more(_screen, Vector2(226, h - 46), false)
	# The text box and SEND, in the same menu frames: one line, showing the end of a long draft.
	var top := h - 32
	_frame(_screen, Rect2(0, top, 192, 32))
	_button(Rect2(0, top, 192, 32), _start_typing)
	var draft := String(_drafts.get(_channel, ""))
	var can_send := not draft.strip_edges().is_empty()
	if not _error.is_empty(): _say(_screen, _error, Vector2(8, top + 8), "red", 176)
	elif draft.is_empty() and not _typing: _say(_screen, "Touch here to chat.", Vector2(8, top + 8))
	else:
		var tail := draft
		while not tail.is_empty() and _width(tail) > 168: tail = tail.substr(1)
		var end := _say(_screen, tail, Vector2(8, top + 8))
		if _typing and int(Time.get_ticks_msec() / 530) % 2 == 0:
			var caret: Texture2D = _gba.texture("underscore") if _gba else null
			var at := Vector2(8 + end + 1, top + 16)
			if caret: _screen.draw_texture(caret, at)
			else: _screen.draw_rect(Rect2(at + Vector2(0, 5), Vector2(6, 2)), Color8(99, 99, 99))
	_frame(_screen, Rect2(192, top, 48, 32))
	_say(_screen, "SEND", Vector2(203, top + 8), "blue" if can_send else "dark")
	_button(Rect2(192, top, 48, 32), _send_or_type)


func _send_or_type() -> void:
	if String(_drafts.get(_channel, "")).strip_edges().is_empty(): _start_typing()
	else: send()


func _draw_feed() -> void:
	if _quick:
		for i in PHRASES.size():
			var at := Vector2(0, i * LINE)
			if i == _phrase: _pointer(_feed, at)
			_say(_feed, PHRASES[i], at + Vector2(16, 0), "dark", _feed.size.x - 20)
			_button(Rect2(at + _feed.position, Vector2(_feed.size.x, LINE)), _pick_phrase.bind(i))
		return
	if _items.is_empty():
		_say(_feed, "No messages yet. Say hello!" if _channel == 0 else "Say hello!", Vector2(0, 0))
		return
	var y := 0.0 if _total <= _feed.size.y else _feed.size.y - _total + _scroll
	for item in _items:
		var lines: Array = item.lines
		for i in lines.size():
			if y + LINE >= 0 and y <= _feed.size.y:
				var line: String = lines[i]
				if i == 0:
					var cut := mini(int(item.name), line.length())
					var x := _say(_feed, line.left(cut), Vector2(0, y), item.tone)
					_say(_feed, line.substr(cut), Vector2(x, y))
				else: _say(_feed, line, Vector2(0, y))
			y += LINE


func _pick_phrase(index: int) -> void:
	_phrase = index
	_type(PHRASES[index])


func _toggle_quick() -> void:
	_stop_typing()
	_quick = not _quick


## Typing opens the device's own keyboard; its letters, backspace and enter come back as key events in _input.
func _start_typing() -> void:
	_typing = true
	_quick = false
	_error = ""
	if DisplayServer.has_feature(DisplayServer.FEATURE_VIRTUAL_KEYBOARD):
		DisplayServer.virtual_keyboard_show(String(_drafts.get(_channel, "")), Rect2(), DisplayServer.KEYBOARD_TYPE_DEFAULT, 200)


func _stop_typing() -> void:
	_typing = false
	if DisplayServer.has_feature(DisplayServer.FEATURE_VIRTUAL_KEYBOARD): DisplayServer.virtual_keyboard_hide()


func _type(value: String) -> void:
	var clean := ""
	for letter in value:
		var code := letter.unicode_at(0)
		if code >= 32 and not (code >= 127 and code <= 159): clean += letter
	_drafts[_channel] = (String(_drafts.get(_channel, "")) + clean).left(200)
	_typing = true
	_quick = false
	_error = ""
	_refresh()


func _delete() -> void:
	_drafts[_channel] = String(_drafts.get(_channel, "")).left(-1)
	_refresh()


func send() -> void:
	var text := String(_drafts.get(_channel, "")).strip_edges()
	if text.is_empty(): return
	if not _pending.is_empty(): _error = "Waiting for the server to receive your message."
	elif Time.get_ticks_msec() - _sent_at < 1000: _error = "Wait a second before sending another message."
	else:
		var packet := {"type": "chat", "text": text}
		if _channel == 0: packet["channel"] = "global"
		else: packet["to"] = _channel
		if client._send(packet):
			_sent_at = Time.get_ticks_msec()
			_pending = {"channel": _channel, "text": text}
			_drafts[_channel] = ""
			_error = ""
			_scroll = 0.0
			_stop_typing()
		else: _error = "You're offline. Your message hasn't been sent."
	_refresh()


func handle_error(text: String) -> bool:
	if _pending.is_empty(): return false
	var id := int(_pending.channel)
	if String(_drafts.get(id, "")).is_empty(): _drafts[id] = String(_pending.text)
	_pending.clear()
	_error = text
	_refresh()
	return true


func _change_channel(step: int) -> void:
	var channels := _people.keys()
	_channel = channels[posmod(channels.find(_channel) + step, channels.size())]
	_unread.erase(_channel)
	_scroll = 0.0
	_quick = false
	_stop_typing()
	_error = ""
	_refresh()


func _scroll_by(step: float) -> void:
	_scroll = clampf(_scroll + step * LINE, 0, maxf(0, _total - _feed.size.y))
	_refresh()


func _back() -> void:
	if _quick: _quick = false
	elif _typing: _stop_typing()
	else: close()
	_refresh()


func _touch(point: Vector2) -> void:
	for i in range(_hits.size() - 1, -1, -1):
		if _hits[i][0].has_point(point):
			_hits[i][1].call()
			break
	_refresh()


func _input(event: InputEvent) -> void:
	# Message boxes own their presses even if one opens while this panel is present.
	if not _opened or host.message.is_open(): return
	if event is InputEventMouseButton:
		if event.pressed:
			if event.button_index == MOUSE_BUTTON_WHEEL_UP: _scroll_by(3)
			elif event.button_index == MOUSE_BUTTON_WHEEL_DOWN: _scroll_by(-3)
			elif event.button_index == MOUSE_BUTTON_LEFT and event.device != InputEvent.DEVICE_ID_EMULATION: _touch(_screen.get_global_transform_with_canvas().affine_inverse() * event.position)
	elif event is InputEventScreenTouch and event.pressed:
		_touch(_screen.get_global_transform_with_canvas().affine_inverse() * event.position)
	elif event is InputEventScreenDrag:
		_scroll_by(event.relative.y / LINE)
	elif event.is_pressed():
		if event is InputEventKey:
			if event.keycode == KEY_ESCAPE: _back()
			elif event.keycode == KEY_BACKSPACE: _delete()
			elif event.keycode == KEY_ENTER or event.keycode == KEY_KP_ENTER:
				if _typing: send()
				elif _quick: _type(PHRASES[_phrase])
				else: _start_typing()
			elif event.keycode == KEY_TAB: _change_channel(-1 if event.shift_pressed else 1)
			elif event.keycode == KEY_F2: _stop_typing(); _quick = not _quick
			elif event.keycode == KEY_T and not _typing and not _quick: close()
			elif event.unicode >= 32 and not event.ctrl_pressed and not event.alt_pressed and not event.meta_pressed: _type(char(event.unicode))
			else: _navigate(event)
		elif event.is_action_pressed("run"): _back()
		elif event.is_action_pressed("interact"):
			if _typing: send()
			elif _quick: _type(PHRASES[_phrase])
			else: _start_typing()
		elif event is InputEventJoypadButton and event.button_index == JOY_BUTTON_X: _stop_typing(); _quick = not _quick
		else: _navigate(event)
	_refresh()
	get_viewport().set_input_as_handled()


func _navigate(event: InputEvent) -> void:
	var direction := Vector2i.ZERO
	if event.is_action_pressed("move_left", true) or event.is_action_pressed("ui_left", true): direction.x = -1
	elif event.is_action_pressed("move_right", true) or event.is_action_pressed("ui_right", true): direction.x = 1
	elif event.is_action_pressed("move_up", true) or event.is_action_pressed("ui_up", true): direction.y = -1
	elif event.is_action_pressed("move_down", true) or event.is_action_pressed("ui_down", true): direction.y = 1
	if _quick: _phrase = posmod(_phrase + direction.y + direction.x, PHRASES.size())
	elif direction.x != 0: _change_channel(direction.x)
	elif direction.y != 0: _scroll_by(-direction.y)

