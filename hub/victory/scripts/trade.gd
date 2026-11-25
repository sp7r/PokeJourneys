extends CanvasLayer
## A trade with another player, after they accepted a trade request (or this player accepted theirs): this player's
## Vault on the left, both offers on the right, CONFIRM and CANCEL below, in FireRed's menu frames (drawn with
## chat.gd's helpers). The server swaps the two Pokémon when both confirm; see server/journeys-server/Trades.cs.
const SIZE := Vector2(240, 176)
const LINE := 16
const ROWS := 6  # Vault rows that fit in the left panel

var host: Node
var client: Node
var _trade := ""
var _with := ""
var _vault: Array = []
var _mine = null  # this player's offer (a Vault summary) or null
var _theirs = null
var _confirmed := {"mine": false, "theirs": false}
var _cursor := 0  # 0.._vault.size()-1 is the list; then CONFIRM, CANCEL
var _top := 0
var _screen: Control
var _hits: Array = []


func setup(main: Node, live: Node) -> void:
	host = main
	client = live
	layer = 8


func is_open() -> bool:
	return _screen != null


func receive(data: Dictionary) -> void:
	match String(data.get("type", "")):
		"trade_open":
			_trade = String(data.trade)
			_with = String(data.get("with", {}).get("name", "them"))
			_vault = data.get("vault", [])
			_mine = null
			_theirs = null
			_confirmed = {"mine": false, "theirs": false}
			_cursor = 0 if not _vault.is_empty() else _vault.size()
			_top = 0
			_open()
		"trade_update":
			if String(data.trade) != _trade: return
			_mine = data.get("mine")
			_theirs = data.get("theirs")
			_confirmed = data.get("confirmed", _confirmed)
		"trade_done":
			if String(data.trade) != _trade: return
			_close()
			host._show_pages(["Trade complete!", "You sent %s and received %s.\nIt's waiting in your Vault." % [_name(data.get("gave")), _name(data.get("got"))]])
		"trade_closed":
			if String(data.trade) != _trade: return
			_close()
			host._show_pages([String(data.get("reason", "The trade was closed."))])
	if _screen: _screen.queue_redraw()


func _name(mon) -> String:
	if not mon is Dictionary: return "a Pokémon"
	var nickname := String(mon.get("nickname", ""))
	var species := String(mon.get("species", ""))
	return species if nickname.is_empty() or nickname == species else "%s (%s)" % [nickname, species]


func _open() -> void:
	if _screen: return
	host.player.locked = true
	_screen = Control.new()
	_screen.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
	_screen.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_screen.size = SIZE
	add_child(_screen)
	_screen.draw.connect(_draw)
	_layout()


func _close() -> void:
	if not _screen: return
	_screen.queue_free()
	_screen = null
	_trade = ""
	host.player.locked = host.chat.is_open()


## Centred on the main screen in whole screen pixels, like the hub's other FireRed menus.
func _layout() -> void:
	var view: Vector2 = get_viewport().get_visible_rect().size
	var display_scale := get_viewport().get_final_transform().get_scale().x
	var pixels := maxi(1, floori(minf(view.x * 0.9 / SIZE.x, view.y * 0.9 / SIZE.y) * display_scale))
	var factor := pixels / display_scale
	_screen.scale = Vector2.ONE * factor
	_screen.position = (((view - SIZE * factor) / 2) * display_scale).floor() / display_scale


func _process(_delta: float) -> void:
	if _screen:
		_layout()
		_screen.visible = not host.message.is_open()


func _line(mon) -> String:
	if not mon is Dictionary: return "-"
	return "%s Lv%d" % [_name(mon), int(mon.get("level", 0))]


func _draw() -> void:
	var chat: Node = host.chat
	_hits.clear()
	chat._frame(_screen, Rect2(0, 0, 240, 32))
	chat._say(_screen, "TRADE WITH " + _with.to_upper(), Vector2(8, 8), "blue", 224)
	# Left: this player's Vault.
	chat._frame(_screen, Rect2(0, 32, 120, 112))
	if _vault.is_empty(): chat._say(_screen, "Your Vault is empty.", Vector2(8, 40), "dark", 104)
	_top = clampi(_top, maxi(0, _cursor - ROWS + 1), mini(_cursor, maxi(0, _vault.size() - ROWS)))
	for row in mini(ROWS, _vault.size() - _top):
		var index := _top + row
		var mon: Dictionary = _vault[index]
		var at := Vector2(8, 40 + row * LINE)
		if index == _cursor: chat._pointer(_screen, at)
		var offered: bool = _mine is Dictionary and int(_mine.get("id", -1)) == int(mon.get("id", -2))
		# Shiny Pokémon are green (FireRed's font has no star); the one on offer is red.
		chat._say(_screen, _line(mon), at + Vector2(14, 0), "red" if offered else "green" if bool(mon.get("shiny", false)) else "dark", 90)
		_hits.append([Rect2(0, at.y, 120, LINE), _offer.bind(index)])
	# Right: both offers.
	chat._frame(_screen, Rect2(120, 32, 120, 112))
	chat._say(_screen, "YOU OFFER", Vector2(128, 40), "green" if _confirmed.get("mine", false) else "dark")
	chat._say(_screen, _line(_mine), Vector2(128, 56), "green" if _mine is Dictionary and bool(_mine.get("shiny", false)) else "dark", 104)
	chat._say(_screen, "THEY OFFER", Vector2(128, 76), "green" if _confirmed.get("theirs", false) else "dark")
	chat._say(_screen, _line(_theirs), Vector2(128, 92), "green" if _theirs is Dictionary and bool(_theirs.get("shiny", false)) else "dark", 104)
	if _theirs is Dictionary: chat._say(_screen, "OT %s%s" % [String(_theirs.get("otName", "?")), "  SHINY" if bool(_theirs.get("shiny", false)) else ""], Vector2(128, 108), "dark", 104)
	var status := "Pick a Pokémon." if _mine == null else "Waiting for them." if _theirs == null else \
		"They confirmed!" if _confirmed.get("theirs", false) and not _confirmed.get("mine", false) else \
		"Waiting for them." if _confirmed.get("mine", false) else "CONFIRM to trade."
	chat._say(_screen, status, Vector2(128, 124), "red", 104)
	# Bottom: CONFIRM and CANCEL.
	for i in 2:
		var rect := Rect2(i * 120, 144, 120, 32)
		chat._frame(_screen, rect)
		if _cursor == _vault.size() + i: chat._pointer(_screen, rect.position + Vector2(8, 8))
		chat._say(_screen, ["CONFIRM", "CANCEL"][i], rect.position + Vector2(24, 8), "blue" if i == 0 and _mine != null and _theirs != null else "dark")
		_hits.append([rect, _confirm if i == 0 else _cancel])


func _offer(index: int) -> void:
	_cursor = index
	client._send({"type": "trade_offer", "trade": _trade, "vault": int(_vault[index].id)})


func _confirm() -> void:
	if _mine != null and _theirs != null: client._send({"type": "trade_confirm", "trade": _trade})


func _cancel() -> void:
	client._send({"type": "trade_cancel", "trade": _trade})


func _input(event: InputEvent) -> void:
	if not _screen or host.message.is_open(): return
	var total := _vault.size() + 2
	if event is InputEventMouseButton and event.pressed and event.button_index == MOUSE_BUTTON_LEFT and event.device != InputEvent.DEVICE_ID_EMULATION \
			or event is InputEventScreenTouch and event.pressed:
		var point: Vector2 = _screen.get_global_transform_with_canvas().affine_inverse() * event.position
		for hit in _hits:
			if hit[0].has_point(point):
				hit[1].call()
				break
	elif event.is_action_pressed("move_up", true) or event.is_action_pressed("ui_up", true): _cursor = posmod(_cursor - 1, total)
	elif event.is_action_pressed("move_down", true) or event.is_action_pressed("ui_down", true): _cursor = posmod(_cursor + 1, total)
	elif event.is_action_pressed("move_left", true) or event.is_action_pressed("ui_left", true):
		if _cursor == _vault.size() + 1: _cursor -= 1
	elif event.is_action_pressed("move_right", true) or event.is_action_pressed("ui_right", true):
		if _cursor == _vault.size(): _cursor += 1
	elif event.is_action_pressed("interact") or event is InputEventKey and event.pressed and event.keycode in [KEY_ENTER, KEY_KP_ENTER]:
		if _cursor < _vault.size(): _offer(_cursor)
		elif _cursor == _vault.size(): _confirm()
		else: _cancel()
	elif event.is_action_pressed("run") or event is InputEventKey and event.pressed and event.keycode == KEY_ESCAPE: _cancel()
	else: return
	_screen.queue_redraw()
	get_viewport().set_input_as_handled()
