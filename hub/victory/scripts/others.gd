extends Node
## Other players in the hub, over the PokeJourneys server's live connection (server README "Live connection").
## Sends where this player stands, their look and follower, and draws everyone else in the same room: their
## trainer, their follower Pokémon walking behind them, and a name tag above each head (this player's too).
##
## The app's plugin gives the server address and session (live_connect -> live_ready). On a PC without the
## app, --live=http://127.0.0.1:5281 signs in a test player with the server's development sign-in
## (--live-name=Name, default "Hub tester").
const Character = preload("res://scripts/character.gd")
const OverworldSprite = preload("res://scripts/overworld_sprite.gd")
const TAG_FONT := preload("res://fonts/PixelOperator.ttf")
const STEP_TIME := 0.25
## Where a name tag's bottom sits, in tiles above the feet (a 32-pixel trainer is 2 tiles tall).
const HEAD := 1.55
const DIRS := {"up": Vector2i.UP, "down": Vector2i.DOWN, "left": Vector2i.LEFT, "right": Vector2i.RIGHT}
## The island's NPC sheets that are Pokémon, for followers when the app can't draw one (a PC test).
const ISLAND_POKEMON := {25: "pikachu_1", 39: "purin_1", 54: "koduck_1", 79: "yadon_1"}

var host: Node3D
var interiors: Node
var _socket := WebSocketPeer.new()
var _url := ""
var _token := ""
var _connected := false
var _retry := 0.0
var _room := ""
var _remotes := {}  # id -> remote dictionary
var _tags: Control
var _own_tag: PanelContainer
var _app = null
var _follower_requests := {}  # request -> remote id
var _next_request := 1
var _sheets := {}  # look JSON -> Image, shared by players who look alike
var _friends := {}  # player id -> true
var _blocked := {}  # player id -> true: players this one has blocked (the server keeps them apart)
var _notices: Array = []  # requests, answers and refusals waiting until the player is free
var _busy := false  # the Interact menu or a notice is open
var _asked_at := -100000  # when this player last sent a request (msec)


func setup(main: Node3D, rooms: Node, args: Dictionary) -> void:
	host = main
	interiors = rooms
	_tags = Control.new()
	_tags.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_tags.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	# Under the message box and menus, above the world.
	host.get_node("UI").add_child(_tags)
	host.get_node("UI").move_child(_tags, 0)
	host.player.stepped.connect(func(_tile, _behaviour): _send_move())
	host.player.placed.connect(func(): _send_move.call_deferred())
	if Engine.has_singleton("PokeJourneys"):
		# The app's plugin always has these. (has_method() can't see an Android plugin's methods, so it isn't used.)
		_app = Engine.get_singleton("PokeJourneys")
		_app.connect("live_ready", _on_live_ready)
		_app.connect("remote_follower_ready", _on_remote_follower)
		_app.connect("card_ready", func(request: int, png: PackedByteArray): card_drawn.emit(request, png))
		expects_server = true
		_app.live_connect()
	elif args.has("live"):
		_test_name = String(args.get("live-name", "Hub tester"))
		expects_server = true
		_live_base = String(args.live).trim_suffix("/")
		_live_name = _test_name
		_dev_sign_in(_live_base, _test_name)
var _test_name := ""


func _dev_sign_in(base: String, name: String) -> void:
	var request := HTTPRequest.new()
	add_child(request)
	request.timeout = 10.0
	request.request(base + "/api/auth/dev", ["Content-Type: application/json"], HTTPClient.METHOD_POST, JSON.stringify({"name": name}))
	var result: Array = await request.request_completed
	request.queue_free()
	var answer = JSON.parse_string((result[3] as PackedByteArray).get_string_from_utf8()) if result[1] == 200 else null
	if not answer is Dictionary:
		printerr("live: development sign-in failed (", result[1], "). Start the server with --dev-signin.")
		if not _joined:
			failure = "Development sign-in failed."
			settled.emit(false, failure)
		return
	_on_live_ready(base.replace("https://", "wss://").replace("http://", "ws://") + "/api/live", String(answer.sessionToken), "")


func _on_live_ready(url: String, token: String, message: String) -> void:
	if _retrying:
		_retrying = false
		host.player.locked = false
	if not message.is_empty():
		print("live: ", message)
		# There's no offline play: before the island the title screen waits (settled), after it a Retry prompt.
		if not _joined:
			failure = message
			settled.emit(false, message)
		elif _app != null: _notices.append({"type": "offline", "message": message})
		return
	_url = url
	_token = token
	_fetch_status(url.replace("wss://", "https://").replace("ws://", "http://").trim_suffix("/api/live"))
	_open()
var _retrying := false

## Whether the island waits for the server: always in the app, and with --live on a PC.
var expects_server := false
## The server's announcements, shown after the welcome (from /api/status).
var announcements: Array = []
var _joined := false
var _live_base := ""
var _live_name := ""
## The island is ready (true: this player is in the room) or the server can't be reached (false, why).
signal settled(ok: bool, message: String)
## The title screen's line: "Server Online · 12 players online".
signal status_changed(text: String)


## Why the server couldn't be reached before the island ("" while trying or once in), and the last status line.
var failure := ""
var status_text := ""


func has_joined() -> bool:
	return _joined


## Tries the server again after it couldn't be reached.
func retry() -> void:
	failure = ""
	if _app != null: _app.live_connect()
	elif not _live_base.is_empty(): _dev_sign_in(_live_base, _live_name)


func _fetch_status(base: String) -> void:
	var request := HTTPRequest.new()
	add_child(request)
	request.timeout = 10.0
	if request.request(base + "/api/status") != OK: return
	var result: Array = await request.request_completed
	request.queue_free()
	var answer = JSON.parse_string((result[3] as PackedByteArray).get_string_from_utf8()) if result[1] == 200 else null
	if not answer is Dictionary: return
	announcements = answer.get("announcements", [])
	var players := int(answer.get("players", 0))
	status_text = "Server Online · %d %s online" % [players, "player" if players == 1 else "players"]
	status_changed.emit(status_text)


func _open() -> void:
	_socket = WebSocketPeer.new()
	_socket.handshake_headers = PackedStringArray(["Authorization: Bearer " + _token])
	_socket.inbound_buffer_size = 1 << 20
	if _socket.connect_to_url(_url) != OK: _retry = 5.0


func _process(delta: float) -> void:
	if _url.is_empty(): return
	_socket.poll()
	match _socket.get_ready_state():
		WebSocketPeer.STATE_OPEN:
			if not _connected:
				_connected = true
				_room = ""
				print("live: connected")
				_send_profile()
				_send_move()
			while _socket.get_available_packet_count() > 0:
				var data = JSON.parse_string(_socket.get_packet().get_string_from_utf8())
				if data is Dictionary: _receive(data)
		WebSocketPeer.STATE_CLOSED:
			if _connected:
				_connected = false
				print("live: disconnected (", _socket.get_close_reason(), ")")
				_clear()
				_retry = 3.0
			_retry -= delta
			if _retry <= 0.0:
				# In the app, ask again: the session may have ended (a fresh one comes with live_ready).
				if _app != null:
					_url = ""
					_app.live_connect()
				else: _open()
	_place_tags()
	if not _notices.is_empty() and not _busy and not host.message.is_open() and not host.player.locked and not host.player.moving:
		_show_notice(_notices.pop_front())


func _send(message: Dictionary) -> bool:
	return _connected and _socket.send_text(JSON.stringify(message)) == OK


func _room_name() -> String:
	return "island" if interiors.active.is_empty() else String(interiors.active)


func _send_move() -> void:
	var facing := "down"
	for name in DIRS:
		if DIRS[name] == host.player.facing: facing = name
	_send({"type": "move", "room": _room_name(), "x": host.player.tile.x, "y": host.player.tile.y, "facing": facing})


func _send_profile() -> void:
	var look := Character.load_saved()
	_send({"type": "profile", "look": look if not look.is_empty() else null, "follower": null, "card": null})


## Turning on the spot also tells the room.
func _physics_process(_delta: float) -> void:
	if _connected and host.player.facing != _last_facing:
		_last_facing = host.player.facing
		if not host.player.moving: _send_move()
var _last_facing := Vector2i.DOWN


func _receive(data: Dictionary) -> void:
	match String(data.get("type", "")):
		"room":
			host.chat.set_player_id(int(data.you))
			_clear()
			_room = String(data.room)
			for player in data.players: _add(player)
			print("live: in ", _room, " with ", _remotes.size(), " other players")
			if not _joined:
				_joined = true
				settled.emit(true, "")
		"joined": _add(data.player)
		"profile":
			var id := int(data.player.id)
			if _remotes.has(id):
				_remove(id)
				_add(data.player)
		"moved":
			var id := int(data.player.id)
			if _remotes.has(id): _walk(_remotes[id], Vector2i(int(data.player.x), int(data.player.y)), String(data.player.facing))
		"status":
			var id := int(data.id)
			if _remotes.has(id): _set_status(_remotes[id], String(data.status))
		"left": _remove(int(data.id))
		"friends":
			_friends.clear()
			for id in data.get("ids", []): _friends[int(id)] = true
		"blocks":
			_blocked.clear()
			for id in data.get("ids", []): _blocked[int(id)] = true
		"reported": pass
		"request": _notices.append(data)
		"answer": _notices.append(data)
		"chat", "chat_history", "chat_deleted": host.chat.receive(data)
		"trade_open", "trade_update", "trade_done", "trade_closed": host.trade.receive(data)
		"battle_start":
			if _app != null: _app.open_pvp_battle(JSON.stringify(data))
			else: print("live: battle_start ", JSON.stringify(data))
		"error":
			print("live: ", data.get("error", ""))
			if host.chat.handle_error(String(data.get("error", ""))): return
			# Refusals of this player's own requests (not nearby anymore, already asked...) are worth saying.
			if Time.get_ticks_msec() - _asked_at < 5000: _notices.append({"type": "say", "pages": [String(data.get("error", ""))]})


func _add(info: Dictionary) -> void:
	var id := int(info.id)
	if _remotes.has(id): _remove(id)
	var node := Node3D.new()
	host.add_child(node)
	var sprite := OverworldSprite.new()
	node.add_child(sprite)
	var mine: Node3D = host.player.get_child(0)
	var sheet := _sheet(info.get("look"))
	if sheet != null: sprite.use_image(sheet, 32, 32)
	else: sprite.setup("SPRITE_HERO")
	sprite.position = mine.position
	sprite.scale = mine.scale
	var remote := {"id": id, "node": node, "sprite": sprite, "tile": Vector2i(int(info.x), int(info.y)),
			"facing": DIRS.get(String(info.facing), Vector2i.DOWN), "tween": null, "pet": null, "pet_tile": Vector2i.ZERO,
			"name": String(info.get("name", "")), "status": "", "tag": _tag(String(info.get("name", ""))),
			"card": info.get("card"), "stats": info.get("stats"), "follower": info.get("follower"), "look": info.get("look")}
	_remotes[id] = remote
	node.position = host.world.tile_to_world(remote.tile)
	sprite.face(remote.facing)
	_set_status(remote, String(info.get("status", "")))
	var follower = info.get("follower")
	if follower is Dictionary and follower.has("species"): _follower(remote, int(follower.species), bool(follower.get("shiny", false)))


func _remove(id: int) -> void:
	if not _remotes.has(id): return
	var remote: Dictionary = _remotes[id]
	remote.node.queue_free()
	if remote.pet != null: remote.pet.queue_free()
	remote.tag.queue_free()
	_remotes.erase(id)


func _clear() -> void:
	for id in _remotes.keys(): _remove(id)


## Steps a remote player to their new tile (several steps at once when updates were missed).
func _walk(remote: Dictionary, to: Vector2i, facing: String) -> void:
	var direction: Vector2i = DIRS.get(facing, Vector2i.DOWN)
	var from: Vector2i = remote.tile
	remote.facing = direction
	if remote.tween != null: remote.tween.kill()
	if from == to:
		remote.sprite.face(direction)
		return
	var previous := from
	remote.tile = to
	var one_step := (to - from).length_squared() == 1
	remote.sprite.face(direction)
	if one_step:
		remote.sprite.play_step(STEP_TIME, false)
		var path: PackedVector3Array = host.world.step_path(from, to)
		remote.tween = create_tween()
		for waypoint in path: remote.tween.tween_property(remote.node, "position", waypoint, STEP_TIME / path.size())
	else:
		remote.node.position = host.world.tile_to_world(to)
	_pet_follow(remote, previous, one_step)


## A follower sprite: from the app when it can draw that Pokémon from the player's journeys, else one of
## the island's own Pokémon sheets.
func _follower(remote: Dictionary, species: int, shiny: bool) -> void:
	if _app != null:
		var request := _next_request
		_next_request += 1
		_follower_requests[request] = remote.id
		_app.remote_follower(request, species, shiny)
	elif ISLAND_POKEMON.has(species) and OverworldSprite.exists(ISLAND_POKEMON[species]):
		var pet := OverworldSprite.new()
		pet.setup(ISLAND_POKEMON[species])
		_place_pet(remote, pet)


func _on_remote_follower(request: int, bytes: PackedByteArray) -> void:
	var id = _follower_requests.get(request)
	_follower_requests.erase(request)
	if id == null or not _remotes.has(id) or bytes.is_empty(): return
	var image := Image.new()
	if image.load_png_from_buffer(bytes) != OK or image.get_height() == 0: return
	var pet := OverworldSprite.new()
	pet.use_image(image, image.get_width() / image.get_height(), image.get_height())
	_place_pet(_remotes[id], pet)


func _place_pet(remote: Dictionary, pet: OverworldSprite) -> void:
	var mine: Node3D = host.player.get_child(0)
	pet.position = mine.position
	pet.scale = mine.scale
	host.add_child(pet)
	remote.pet = pet
	remote.pet_tile = remote.tile - remote.facing
	pet.global_position = host.world.tile_to_world(remote.pet_tile) + mine.position
	pet.face(remote.facing)


## The follower steps onto the tile its trainer just left, as this player's own follower does.
func _pet_follow(remote: Dictionary, left: Vector2i, one_step: bool) -> void:
	var pet = remote.pet
	if pet == null: return
	var mine: Node3D = host.player.get_child(0)
	var direction: Vector2i = left - remote.pet_tile
	remote.pet_tile = left
	if one_step and direction.length_squared() == 1:
		pet.face(direction)
		pet.play_step(STEP_TIME, false)
		create_tween().tween_property(pet, "global_position", host.world.tile_to_world(left) + mine.position, STEP_TIME)
	else:
		pet.global_position = host.world.tile_to_world(left) + mine.position


## A look as the creator saves it. One with only gender and seed (a test bot's) is made up from the seed.
func _sheet(look) -> Image:
	if not look is Dictionary or not Character.available(): return null
	var full: Dictionary = look
	if not look.has("hair") and look.has("seed"): full = _made_up(int(look.seed), String(look.get("gender", "m")))
	var key := JSON.stringify(full)
	if not _sheets.has(key): _sheets[key] = Character.build_sheet(full)
	return _sheets[key]


func _made_up(seed: int, gender: String) -> Dictionary:
	var random := RandomNumberGenerator.new()
	random.seed = seed
	var look := {"gender": gender if gender in ["m", "f"] else "m", "skin": Character.SKINS[random.randi() % Character.SKINS.size()]}
	for slot in Character.SLOTS:
		var styles: Array = Character.styles(slot[0], look.gender)
		if styles.is_empty(): continue
		# Optional slots (hats, bags) stay empty two times in three.
		var style: Dictionary = styles[0] if slot[2] and random.randi() % 3 != 0 else styles[random.randi() % styles.size()]
		var color: Dictionary = style.colors[random.randi() % style.colors.size()]
		look[slot[0]] = [style.name, color.label]
	return look


## A name tag: white text on a see-through dark box, drawn above the trainer's head.
func _tag(text: String) -> PanelContainer:
	var panel := PanelContainer.new()
	panel.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var box := StyleBoxFlat.new()
	box.bg_color = Color(0.12, 0.12, 0.14, 0.6)
	box.set_corner_radius_all(4)
	box.content_margin_left = 6
	box.content_margin_right = 6
	box.content_margin_top = -4
	box.content_margin_bottom = -2
	panel.add_theme_stylebox_override("panel", box)
	var label := Label.new()
	# PixelOperator (fonts/, credited) rather than the game font, whose letters have grey shading built in;
	# at exactly twice its 16-pixel size, so every letter stays crisp.
	label.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
	label.add_theme_font_override("font", TAG_FONT)
	label.add_theme_font_size_override("font_size", 32)
	label.add_theme_color_override("font_color", Color.WHITE)
	# A one-pixel black shadow keeps the white letters sharp on the dark box.
	label.add_theme_color_override("font_shadow_color", Color.BLACK)
	label.add_theme_constant_override("shadow_offset_x", 2)
	label.add_theme_constant_override("shadow_offset_y", 2)
	label.text = text
	panel.add_child(label)
	_tags.add_child(panel)
	return panel


func _set_status(remote: Dictionary, status: String) -> void:
	remote.status = status
	var label: Label = remote.tag.get_child(0)
	# "afk" and "shopping" show after the name; "away:" players have left the room already.
	var shown := "AFK" if status == "afk" else ("Shopping" if status == "shopping" else "")
	label.text = remote.name if shown.is_empty() else "%s · %s" % [remote.name, shown]


func _place_tags() -> void:
	var camera: Camera3D = host.camera
	var mine: Node3D = host.player.get_child(0)
	var head := Vector3(0, HEAD * mine.scale.y, 0) + mine.position
	if _connected and _own_tag == null:
		var own := _test_name
		if _app != null: own = String(_app.account_name())
		var look := Character.load_saved()
		own = String(look.get("name", own))
		if not own.is_empty():
			_own_tag = _tag(own)
			print("live: your name tag says ", own)
	if _own_tag != null:
		_own_tag.visible = _connected
		_put(_own_tag, camera, host.player.global_position + head)
	for remote in _remotes.values():
		_put(remote.tag, camera, remote.node.global_position + head)


func _put(tag: Control, camera: Camera3D, at: Vector3) -> void:
	if camera.is_position_behind(at):
		tag.visible = false
		return
	var point := camera.unproject_position(at)
	tag.size = tag.get_combined_minimum_size()
	tag.position = (point - Vector2(tag.size.x / 2.0, tag.size.y)).round()
	tag.visible = Rect2(Vector2.ZERO, get_viewport().get_visible_rect().size).grow(64).has_point(point)


# --- Interact: the quick actions wheel's INTERACT tile -------------------------------------------------------------

## Lists the other players on screen, nearest first, and does what is picked for one of them.
func interact() -> void:
	if _busy: return
	if not _connected:
		await host._show_pages(["You're not connected to a server, so there's nobody to meet yet."])
		return
	var here := _on_screen()
	if here.is_empty():
		await host._show_pages(["There's nobody nearby right now."])
		return
	_busy = true
	var labels: Array = here.map(func(r): return String(r.name) + (" (friend)" if _friends.has(r.id) else ""))
	labels.append("Back")
	var pick := await _ask("Who would you like to talk to?", labels, true)
	if pick < here.size() and _remotes.has(here[pick].id): await _player_menu(here[pick])
	_busy = false


func _on_screen() -> Array:
	var camera: Camera3D = host.camera
	var view := Rect2(Vector2.ZERO, get_viewport().get_visible_rect().size)
	var found := _remotes.values().filter(func(r):
		var at: Vector3 = r.node.global_position
		return not camera.is_position_behind(at) and view.has_point(camera.unproject_position(at)))
	var me: Vector2i = host.player.tile
	found.sort_custom(func(a, b): return (a.tile - me).length_squared() < (b.tile - me).length_squared())
	return found


func _player_menu(remote: Dictionary) -> void:
	var actions := ["Trainer card"]
	if not _friends.has(remote.id): actions.append("Add friend")
	actions.append_array(["Message", "Trade request", "Battle request", "Unblock" if _blocked.has(remote.id) else "Block", "Report", "Back"])
	var pick: String = actions[await _ask("%s%s" % [remote.name, " is your friend." if _friends.has(remote.id) else "."], actions, actions.size() > 6)]
	match pick:
		"Trainer card": await _show_card(remote)
		"Add friend": await _request(remote, "friend", "", "Friend request sent to %s." % remote.name)
		"Trade request": await _request(remote, "trade", "", "Trade request sent to %s." % remote.name)
		"Battle request": await _request(remote, "battle", "", "Battle request sent to %s." % remote.name)
		"Message":
			host.chat.open(int(remote.id), String(remote.name), true)
		"Block":
			if await _ask("Block %s? You won't see each other's chat, and neither of you can send the other requests or messages." % remote.name, ["Block", "Back"]) == 0:
				_send({"type": "block", "player": remote.id})
				await host._show_pages(["You blocked %s. You can unblock them here any time." % remote.name])
		"Unblock":
			_send({"type": "unblock", "player": remote.id})
			await host._show_pages(["You unblocked %s." % remote.name])
		"Report": await _report(remote)


## Reports a player to the server's moderators, who see what they said recently. Blocking is offered too.
func _report(remote: Dictionary) -> void:
	var reasons := ["Rude or hurtful chat", "Spam", "Cheating", "Inappropriate name or look", "Something else", "Back"]
	var pick := await _ask("Why are you reporting %s?" % remote.name, reasons, true)
	if pick == reasons.size() - 1: return
	_asked_at = Time.get_ticks_msec()
	_send({"type": "report", "player": remote.id, "reason": reasons[pick]})
	if _blocked.has(remote.id):
		await host._show_pages(["Thanks. Your report about %s was sent to the moderators." % remote.name])
		return
	if await _ask("Thanks. Your report was sent to the moderators. Block %s too?" % remote.name, ["Block", "No"]) == 0:
		_send({"type": "block", "player": remote.id})
		await host._show_pages(["You blocked %s." % remote.name])


func _request(remote: Dictionary, kind: String, text: String, sent: String) -> void:
	_asked_at = Time.get_ticks_msec()
	_send({"type": "request", "to": remote.id, "kind": kind, "text": text if kind == "message" else null})
	await host._show_pages([sent])


## The trainer card as pages: Rating and Experience from the server's records, then the journeys the player
## reports (badges, Pokédex, hours).
func _card_pages(remote: Dictionary) -> Array:
	var pages := []
	var stats = remote.get("stats")
	var line := "%s's Trainer Card." % remote.name
	if stats is Dictionary:
		var rating = stats.get("bestRating")
		line += " Rating %s, Experience %s, Battle Points %s." % [str(int(rating)) if rating != null else "unranked", str(int(stats.get("experience", 0))), str(int(stats.get("battlePoints", 0)))]
	pages.append(line)
	var card = remote.get("card")
	if card is Dictionary:
		if String(card.get("story", "")) != "": pages.append("Story: %s." % String(card.story))
		for journey in card.get("journeys", []):
			if not journey is Dictionary: continue
			pages.append("%s: %d badges, %d in the Pokédex, %d hours played%s." % [String(journey.get("name", "?")), int(journey.get("badges", 0)),
					int(journey.get("pokedex", 0)), int(journey.get("hours", 0)), ", Champion" if journey.get("champion", false) else ""])
	var follower = remote.get("follower")
	if follower is Dictionary and follower.has("species"):
		pages.append("Their follower is Pokémon #%d%s." % [int(follower.species), " (shiny!)" if follower.get("shiny", false) else ""])
	if pages.size() == 1: pages.append("They haven't shared their journeys yet.")
	return pages


## A request, an answer or a refusal, shown once the player is free.
func _show_notice(notice: Dictionary) -> void:
	_busy = true
	var from_name := String(notice.get("from", {}).get("name", "Someone")) if notice.get("from") is Dictionary else "Someone"
	match String(notice.get("type", "")):
		"say": await host._show_pages(notice.pages)
		"offline":
			await _ask("Can't reach the PokeJourneys server. %s" % String(notice.message), ["Retry"])
			# Stay put until the server answers (live_ready unlocks, or brings this back).
			host.player.locked = true
			_retrying = true
			_app.live_connect()
		"request":
			var kind := String(notice.get("kind", ""))
			if kind == "message":
				await host._show_pages(["%s: %s" % [from_name, String(notice.get("text", ""))]])
			else:
				var question: String = {"friend": "%s wants to be friends.", "trade": "%s would like to trade.",
						"battle": "%s challenges you to a battle!"}.get(kind, "%s asks you something.") % from_name
				var accept := await _ask(question, ["Accept", "Decline"]) == 0
				_send({"type": "answer", "id": notice.id, "accept": accept})
				if accept and kind == "friend": await host._show_pages(["You and %s are now friends." % from_name])
				elif accept and kind == "trade": pass  # the trade window opens (trade.gd)
				elif accept and kind == "battle": pass  # the battle screen opens by itself
		"answer":
			var kind := String(notice.get("kind", ""))
			if not notice.get("accept", false): await host._show_pages(["%s declined your %s request." % [from_name, kind]])
			elif kind == "friend": await host._show_pages(["%s accepted your friend request. You're now friends!" % from_name])
			elif kind == "trade": pass  # the trade window opens by itself (trade.gd)
			elif kind == "battle": pass  # the battle screen opens by itself
	_busy = false


func _ask(question: String, labels: Array, scroll := false) -> int:
	host.player.locked = true
	host.message.ask(question, labels, 0, scroll)
	var choice: int = await host.message.answered
	host.player.locked = false
	return choice


# --- Another player's trainer card ----------------------------------------------------------------------------------

signal card_drawn(request: int, png: PackedByteArray)


## Their trainer card as the app draws it (like this player's own, with their sprite and follower), over the island
## until A or B is pressed. Without the app, or without card art from this player's journeys, it is read out as pages.
func _show_card(remote: Dictionary) -> void:
	var png := PackedByteArray()
	if _app != null:
		var request := _next_request
		_next_request += 1
		var look = remote.get("look")
		if look is Dictionary and not look.has("hair") and look.has("seed"): look = _made_up(int(look.seed), String(look.get("gender", "m")))
		_app.player_card(request, JSON.stringify({"id": remote.id, "name": remote.name, "look": look,
				"follower": remote.get("follower"), "card": remote.get("card"), "stats": remote.get("stats")}))
		while true:
			var answer: Array = await card_drawn
			if answer[0] == request:
				png = answer[1]
				break
	var image := Image.new()
	if png.is_empty() or image.load_png_from_buffer(png) != OK:
		await host._show_pages(_card_pages(remote))
		return
	host.player.locked = true
	var dim := ColorRect.new()
	dim.color = Color(0, 0, 0, 0.5)
	dim.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	var picture := TextureRect.new()
	picture.texture = ImageTexture.create_from_image(image)
	picture.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
	# The largest whole-number scale that fits most of the screen, so the card's pixels stay square.
	var view := get_viewport().get_visible_rect().size
	var scale := maxi(1, mini(int(view.x * 0.9 / image.get_width()), int(view.y * 0.85 / image.get_height())))
	picture.size = Vector2(image.get_width(), image.get_height()) * scale
	picture.position = ((view - picture.size) / 2).round()
	picture.stretch_mode = TextureRect.STRETCH_SCALE
	dim.add_child(picture)
	host.get_node("UI").add_child(dim)
	await get_tree().process_frame
	while not (Input.is_action_just_pressed("interact") or Input.is_action_just_pressed("run")):
		await get_tree().process_frame
	dim.queue_free()
	# The press that closed the card shouldn't also talk to whoever stands in front.
	await get_tree().process_frame
	host.player.locked = false
