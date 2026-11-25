extends Node3D
const CAMERA_DISTANCE := 0x29AEC1 / 4096.0 / 16.0
const CAMERA_PITCH := (65536 - 0xDD62) * 360.0 / 65536.0
const CAMERA_OFFSET := Vector3(0, sin(deg_to_rad(CAMERA_PITCH)), cos(deg_to_rad(CAMERA_PITCH))) * CAMERA_DISTANCE
const CAMERA_FOV := 0x05C1 * 360.0 / 65536.0 * 2.0
const OverworldSprite = preload("res://scripts/overworld_sprite.gd")
const Character = preload("res://scripts/character.gd")
const Wheel = preload("res://scripts/wheel.gd")
const Follower = preload("res://scripts/follower.gd")
const WeeklySighting = preload("res://scripts/weekly_sighting.gd")
@onready var world: Node3D = $Island
@onready var player: Node3D = $Player
@onready var camera: Camera3D = $Camera
@onready var message: PanelContainer = $UI/Message
var _args := {}
var _loaded := false
var _cinematic := false  # the intro flyover has the camera
var _coords := Label.new()
var wheel := Wheel.new()
var follower: Follower
var music: Node
var others: Node  # other players (others.gd)
var chat: Node
var trade: Node
func _ready() -> void:
	_whole_pixels()
	# Tile readout for reporting map problems: --coords or F3.
	_coords.add_theme_font_size_override("font_size", 32)
	_coords.add_theme_color_override("font_outline_color", Color.BLACK)
	_coords.add_theme_constant_override("outline_size", 8)
	_coords.position = Vector2(16, 8)
	$UI.add_child(_coords)
	$UI.add_child(wheel)
	for argument in OS.get_cmdline_user_args():
		var kv := argument.trim_prefix("--").split("=", true, 1)
		_args[kv[0]] = kv[1] if kv.size() > 1 else ""
	_coords.visible = _args.has("coords")
	var root: String = _args.get("data", OS.get_environment("JOURNEYS_HUB_DATA"))
	if root.is_empty(): root = ProjectSettings.globalize_path("user://hub-data")
	root = ProjectSettings.globalize_path(root)
	if not root.is_absolute_path(): root = DirAccess.open(".").get_current_dir().path_join(root).simplify_path()
	if not world.load_island(root, not _args.has("check")):
		printerr("Victory Island data not found or invalid in ", root, ". Run node tools/hub/victory/export.js")
		get_tree().quit(1)
		return
	var interiors = preload("res://scripts/interior.gd").new()
	add_child(interiors)
	interiors.setup(self, root, _args)
	if _args.has("grid"):
		for y in world.bounds.size.y:
			print("ROW ", world._types[y])
	if _args.has("check"):
		var result: Dictionary = world.check_reachable()
		var rooms_valid: bool = interiors.check(result)
		print(JSON.stringify(result))
		var valid: bool = result.reachable > 0 and rooms_valid
		for category in ["doors", "signs", "npcs"]:
			for entry in result[category]:
				if not entry.reachable: valid = false
		get_tree().quit(0 if valid else 1)
		return
	OverworldSprite.data_root = root
	music = preload("res://scripts/music.gd").new()
	add_child(music)
	music.setup(root, world.layout)
	music.room(interiors.active)
	preload("res://scripts/gba_frame.gd").label_style(_coords, 32)
	player.world = world
	var start: Vector2i = world.spawn_tile()
	if _args.has("at"):
		var coordinates: PackedStringArray = _args.at.split(",")
		if coordinates.size() == 2: start = Vector2i(int(coordinates[0]), int(coordinates[1]))
	if not world.bounds.has_point(start):
		printerr("Start tile outside map: ", start)
		get_tree().quit(1)
		return
	player.place(start)
	# The player's own look from the creator, once made; the game hero until then.
	Character.find_art(_args)
	var look := Character.load_saved()
	if not look.is_empty() and Character.available(): player.wear(Character.build_sheet(look))
	# A slight pull toward the camera along its view line keeps the sprite clear of the floor on steep
	# stairs; it is shrunk by the same amount so its size on screen stays.
	var pull := 0.08
	var sprite: Node3D = player.get_child(0)
	sprite.position = CAMERA_OFFSET.normalized() * pull
	# The sprite stands upright, so stretch it to look as tall as a camera-facing one.
	var keep := 1.0 - pull / CAMERA_DISTANCE
	sprite.scale = Vector3(keep, keep / cos(deg_to_rad(CAMERA_PITCH)), keep)
	follower = Follower.new()
	add_child(follower)
	follower.attach(player, sprite)
	follower.unavailable.connect(func(text: String): _show_pages([text]))
	world.spawn_npcs()
	# NPC sprites stand the same way as the player's.
	for npc in world.npcs.values():
		npc.sprite.position = sprite.position
		npc.sprite.scale = sprite.scale
	# Other players over the server's live connection (others.gd). Interiors stays main's last child.
	others = preload("res://scripts/others.gd").new()
	add_child(others)
	move_child(others, interiors.get_index())
	chat = preload("res://scripts/chat.gd").new()
	add_child(chat)
	chat.setup(self, others)
	trade = preload("res://scripts/trade.gd").new()
	add_child(trade)
	trade.setup(self, others)
	others.setup(self, interiors, _args)
	camera.fov = CAMERA_FOV
	camera.near = 0.5
	camera.far = 220.0
	_loaded = true
	_follow(1.0)
	for character in _args.get("walk", ""):
		var direction = {"u": Vector2i.UP, "d": Vector2i.DOWN, "l": Vector2i.LEFT, "r": Vector2i.RIGHT}.get(character)
		if direction != null: player.scripted.append(direction)
	if _args.has("speed"): Engine.time_scale = maxf(0.01, float(_args.speed))
	if _args.has("overview"):
		player.locked = true
		_overview(_args.overview)
	elif _args.has("shot") or _args.has("talk") or _args.has("wheel") or _args.has("chat") or _args.has("trade-demo"):
		_when_idle()
	# A normal start (no test flags) opens on the title screen, then shows layout.json's "welcome".
	# --title shows the title screen even with test flags (for screenshots); --autostart presses A on it.
	var testing := ["at", "walk", "shot", "talk", "overview", "notitle", "intro", "room", "wheel", "chat", "trade-demo"].any(func(k): return _args.has(k))
	if _args.has("title") or not testing:
		player.locked = true
		var title := preload("res://scripts/title.gd").new()
		# With a server the splash stays up after A: signing in, the server status, until the island is ready.
		title.hold = others.expects_server
		add_child(title)
		if _args.has("autostart"): get_tree().create_timer(1.0).timeout.connect(title.start)
		await title.started
		await _sign_in()
		if others.expects_server: await _wait_for_server(title)
		# The look belongs to the account that just signed in.
		look = Character.load_saved()
		if not look.is_empty() and Character.available(): player.wear(Character.build_sheet(look))
		player.locked = false
		# First start: the island flyover, then the character creator.
		if look.is_empty() or _args.has("intro"): await _play_intro()
		if look.is_empty() or _args.has("creator"): await _open_creator()
		# The welcome, then whatever the server announces (maintenance, updates, greetings).
		var welcome: Array = world.layout.get("welcome", []) + others.announcements
		print("welcome: ", " | ".join(welcome))
		_show_pages(welcome)
	elif _args.has("intro"):
		await _play_intro()
		get_tree().quit()
	elif _args.has("creator"):
		_open_creator()

## Pixel art scaled by 1.5 draws some pixels one wide and some two. So the 2D layer is laid out at
## the window's size divided by a whole number (the largest that keeps it at least 500 tall): a
## 1280 x 720 window stays as it is; the AYN Thor's top screen (1920 x 1080, about 1025 left above its
## navigation bar) draws at twice.
func _whole_pixels() -> void:
	var window := DisplayServer.window_get_size()
	var scale := maxi(1, window.y / 500)
	get_tree().root.content_scale_size = window / scale

## There's no offline play: the held splash shows "Connecting...", then the server status, until this player is in
## the island's room; when the server can't be reached it says so and A tries again. Then the splash fades out.
func _wait_for_server(title: Node) -> void:
	others.status_changed.connect(func(text: String): if is_instance_valid(title): title.status(text))
	title.status(others.status_text if not others.status_text.is_empty() else "Connecting to the server...")
	# A try made before signing in had no account yet: try again now.
	if not others.failure.is_empty(): others.retry()
	while not others.has_joined():
		if others.failure.is_empty():
			var result: Array = await others.settled
			if result[0]: break
		title.status("Can't reach the PokeJourneys server. Press A to try again.", true)
		await title.pressed
		title.status("Connecting to the server...")
		others.retry()
	# Long enough to read the status line.
	await get_tree().create_timer(1.5).timeout
	await title.finish()

## Discord sign-in (signin.gd), when the app has it set up and nobody is signed in yet.
func _sign_in() -> void:
	if not Engine.has_singleton("PokeJourneys"): return
	var app := Engine.get_singleton("PokeJourneys")
	if not app.sign_in_available() or app.account_name() != "": return
	var screen := preload("res://scripts/signin.gd").new()
	add_child(screen)
	await screen.finished

## The first-start flyover over the island (intro.gd, layout.json's "intro"); --intro plays it.
func _play_intro() -> void:
	player.locked = true
	_cinematic = true
	var intro := preload("res://scripts/intro.gd").new()
	intro.camera = camera
	intro.world = world
	intro.shots = world.layout.get("intro", [])
	add_child(intro)
	await intro.finished
	_cinematic = false
	_follow(1.0)
	player.locked = false

## The character creator (first start, --creator, or C on a keyboard); the hero wears the result.
func _open_creator() -> void:
	if not Character.available():
		printerr("Creator art not found in ", Character.art_root)
		return
	player.locked = true
	var creator := preload("res://scripts/creator.gd").new()
	creator.look = Character.load_saved()
	add_child(creator)
	var look: Dictionary = await creator.finished
	player.wear(Character.build_sheet(look))
	player.locked = false

func _process(delta: float) -> void:
	if _coords.visible: _coords.text = "%d,%d" % [player.tile.x, player.tile.y]
	if _loaded and not _cinematic and not _args.has("overview"): _follow(1.0 - exp(-12.0 * delta))

func _follow(weight: float) -> void:
	camera.position = camera.position.lerp(player.position + CAMERA_OFFSET, weight)
	camera.look_at(camera.position - CAMERA_OFFSET, Vector3.UP)

func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventKey and event.pressed and not event.echo and event.keycode == KEY_F3:
		_coords.visible = not _coords.visible
		return
	if _wheel_input(event): return
	if event is InputEventKey and event.pressed and not event.echo and event.keycode == KEY_T and _loaded and not player.locked:
		chat.toggle()
		get_viewport().set_input_as_handled()
		return
	if event.is_action_pressed("toggle_follower"):
		if _loaded and not player.locked: follower.toggle()
		return
	if event is InputEventKey and event.pressed and not event.echo and event.keycode == KEY_C and _loaded and not player.locked:
		_open_creator()
		return
	if event.is_action_pressed("quit"):
		get_tree().quit()
		return
	if not _loaded or not event.is_action_pressed("interact"): return
	if message.is_open():
		message.advance()
		return
	if player.moving or player.locked: return
	var npc = world.npc_at(player.tile + player.facing)
	if npc != null:
		await _show_pages(npc.talk(player.tile))
		if npc.info.get("role", "") == "journeys": await _pick_journey(npc.info)
		if npc.info.get("role", "") == "services": await _trainer_services(npc.info)
		if npc.info.get("role", "") == "vault": await _vault(npc.info)
		if npc.info.get("role", "") == "weekly_sighting": await WeeklySighting.speak(self, follower.visible_request())
		if npc.info.get("role", "") == "stadium_faq": await _stadium_faq(npc.info)
		if npc.info.get("role", "") == "shop": await preload("res://scripts/shop.gd").speak(self, npc.info.shop)
		if npc.info.get("role", "") == "battle_signup":
			await preload("res://scripts/battle_signup.gd").speak(self, Character.save_path().get_base_dir(), npc.info.modes)
		npc.done()
		return
	_show_pages(world.sign_at(player.tile + player.facing, player.facing))

func _show_pages(pages: Array) -> void:
	if pages.is_empty() or message.is_open(): return
	player.locked = true
	message.show_pages(pages)
	await message.closed
	player.locked = (chat != null and chat.is_open()) or (trade != null and trade.is_open())

func _pick_journey(captain: Dictionary) -> void:
	await preload("res://scripts/journey_menu.gd").pick(self, captain, _args.get("journeys", OverworldSprite.data_root.path_join("journeys.json")))

func _stadium_faq(attendant: Dictionary) -> void:
	var topics: Array = attendant.topics
	var labels: Array = topics.map(func(topic): return String(topic[0]))
	labels.append("Back")
	while true:
		player.locked = true
		message.ask(attendant.ask, labels)
		var choice: int = await message.answered
		player.locked = false
		if choice == topics.size(): return
		await _show_pages(topics[choice][1])

## Trainer Services: `options` lists [label, what it opens] ("creator": the character creator with
## the name screen; "intro": the island tour; "settings": the app's settings), then `cancel`; `after` is said when one is done.
func _trainer_services(clerk: Dictionary) -> void:
	var options: Array = clerk.get("options", [])
	var labels: Array = options.map(func(o): return String(o[0]))
	labels.append(String(clerk.get("cancel", "Not now")))
	player.locked = true
	message.ask(String(clerk.get("ask", "How can I help you?")), labels)
	var index: int = await message.answered
	player.locked = false
	if index >= options.size(): return
	match String(options[index][1]):
		"creator": await _open_creator()
		"intro": await _play_intro()
		"settings":
			_open_app_page("open_settings")
			return
	await _show_pages(clerk.get("after", []))

## The hot wheel (wheel.gd), held open with L3 (Q on a keyboard) while walking about. While it is open it
## takes every press: A or letting go picks, B closes it, left and right step round it. R3 (R on a
## keyboard) swaps the screen the app's menus open on. True when the event was the wheel's.
func _wheel_input(event: InputEvent) -> bool:
	var stick_button: int = event.button_index if event is InputEventJoypadButton else -1
	var key: int = event.physical_keycode if event is InputEventKey and not event.echo else -1
	if stick_button == JOY_BUTTON_LEFT_STICK or key == KEY_Q:
		if not event.pressed: wheel.close(true)
		elif _loaded and not wheel.is_open() and not player.locked and not player.moving: _open_wheel()
		return true
	if not wheel.is_open():
		if not event.is_pressed() or (stick_button != JOY_BUTTON_RIGHT_STICK and key != KEY_R): return false
		if _loaded and not player.locked: _swap_screens()
		return true
	if event.is_action_pressed("interact"): wheel.close(true)
	elif event.is_action_pressed("run"): wheel.close(false)
	elif event.is_action_pressed("move_right") or event.is_action_pressed("move_down"): wheel.step(1)
	elif event.is_action_pressed("move_left") or event.is_action_pressed("move_up"): wheel.step(-1)
	return true

## Opens the wheel and does what is picked. Each tile is [label, what it does, action]. With two screens the
## trainer card is already on the second one, so CARD is left out; INTERACT lists the players around.
func _open_wheel() -> void:
	var app = Engine.get_singleton("PokeJourneys") if Engine.has_singleton("PokeJourneys") else null
	var tiles := [
		["SETTINGS", "Change the settings", "settings"],
		["VAULT", "Your Pokémon from every journey", "vault"],
		["TRAINER", "Change how your trainer looks", "creator"],
	]
	# INTERACT takes SWAP's place (R3, or R on a keyboard, still swaps the screens).
	tiles.append(["INTERACT", "Players around you", "interact"])
	tiles.append(["CHAT", "Global and private messages", "chat"])
	if app == null or not app.has_second_screen(): tiles.push_front(["CARD", "Your trainer card", "card"])
	player.locked = true
	wheel.open(tiles.map(func(t): return t[0]), tiles.map(func(t): return t[1]))
	var index: int = await wheel.picked
	player.locked = false
	if index < 0: return
	match String(tiles[index][2]):
		"card": _open_app_page("open_companion")
		"settings": _open_app_page("open_settings")
		"vault": _open_app_page("open_vault")
		"creator": await _open_creator()
		"interact": await others.interact()
		"chat": chat.toggle()

## Swaps the screen the app's menus (the Vault, the settings) open on, and says which it is now.
func _swap_screens() -> void:
	if not Engine.has_singleton("PokeJourneys"):
		print("app: swap_pages")
		return
	var app := Engine.get_singleton("PokeJourneys")
	if not app.has_second_screen(): return
	_show_pages(["Menus now open on the %s screen." % app.swap_pages()])

## The PokeVault's clerk: asks `ask` with `open` and `cancel`, and opens the app's Vault.
func _vault(clerk: Dictionary) -> void:
	player.locked = true
	message.ask(String(clerk.get("ask", "Open your Vault?")), [String(clerk.get("open", "Open the Vault")), String(clerk.get("cancel", "Not now"))])
	var index: int = await message.answered
	player.locked = false
	if index == 0: _open_app_page("open_vault")

## A screen of the app shown over the hub, by the name of the `PokeJourneys` plugin method that opens it
## ("open_vault", "open_settings", "open_companion"); printed where there is no app, as on a desktop.
func _open_app_page(method: String) -> void:
	if Engine.has_singleton("PokeJourneys"): Engine.get_singleton("PokeJourneys").call(method)
	else: print("app: ", method)

func _when_idle() -> void:
	while not player.scripted.is_empty() or player.moving or player.locked:
		await get_tree().process_frame
	for i in 30: await get_tree().process_frame
	# --talk=N presses A N times (default once), to page through text or pick from a list.
	for n in (maxi(1, int(_args.get("talk", "1"))) if _args.has("talk") else 0):
		var press := InputEventAction.new()
		press.action = "interact"
		press.pressed = true
		Input.parse_input_event(press)
		for i in 20: await get_tree().process_frame
	# --wheel=N opens the hot wheel with its Nth tile pointed at (for screenshots).
	if _args.has("wheel"):
		_open_wheel()
		for n in int(_args.wheel) + 1: wheel.step(1)
		for i in 5: await get_tree().process_frame
	# --interact opens the INTERACT list of players around (for screenshots, with --live); --interact=0,3 then
	# picks the first player and their fourth action. "a" presses A on a page instead of picking.
	if _args.has("interact"):
		if _args.has("shot-delay"): await get_tree().create_timer(float(_args["shot-delay"])).timeout
		_args.erase("shot-delay")
		others.interact()
		for pick in String(_args.interact).split(",", false):
			for i in 20: await get_tree().process_frame
			if pick == "a" and message.is_open(): message.advance()
			elif message.is_asking(): message._answer(int(pick))
		for i in 10: await get_tree().process_frame
	# --trade-demo opens the trade window with sample offers (for a --shot of its layout; nothing is sent).
	if _args.has("trade-demo"):
		var mon := func(id: int, species: String, level: int, shiny := false): return {"id": id, "species": species, "nickname": "", "level": level, "shiny": shiny, "otName": "RED"}
		trade.receive({"type": "trade_open", "trade": "demo", "with": {"id": 2, "name": "Bot 07"}, "vault": [mon.call(1, "Pikachu", 12), mon.call(2, "Eevee", 15, true), mon.call(3, "Bulbasaur", 9)]})
		trade.receive({"type": "trade_update", "trade": "demo", "mine": mon.call(2, "Eevee", 15, true), "theirs": mon.call(9, "Psyduck", 20), "confirmed": {"mine": false, "theirs": true}})
	# --chat opens the panel; --chat=ID opens a private conversation, ready for typing.
	if _args.has("chat"):
		if _args.has("shot-delay"): await get_tree().create_timer(float(_args["shot-delay"])).timeout
		_args.erase("shot-delay")
		chat.open(int(_args.chat), "", true)
		for i in 5: await get_tree().process_frame
	if _args.has("shot"):
		# --shot-delay=S waits S seconds first (other players arriving over --live).
		if _args.has("shot-delay"): await get_tree().create_timer(float(_args["shot-delay"])).timeout
		await RenderingServer.frame_post_draw
		var error := get_viewport().get_texture().get_image().save_png(_args.shot)
		print("screenshot: ", _args.shot, " player tile ", player.tile, " error ", error)
		get_tree().quit(0 if error == OK else 1)

func _overview(path: String) -> void:
	var viewport := SubViewport.new()
	viewport.size = Vector2i(2560, 1536)
	viewport.world_3d = get_viewport().world_3d
	viewport.render_target_update_mode = SubViewport.UPDATE_ALWAYS
	add_child(viewport)
	var overview := Camera3D.new()
	overview.projection = Camera3D.PROJECTION_ORTHOGONAL
	overview.size = float(world.bounds.size.y)
	overview.far = 1000
	viewport.add_child(overview)
	overview.position = Vector3(world.bounds.size.x / 2.0 - 16, 300, world.bounds.size.y / 2.0 - 16)
	overview.rotation_degrees.x = -90
	overview.current = true
	for i in 5: await get_tree().process_frame
	await RenderingServer.frame_post_draw
	var error := viewport.get_texture().get_image().save_png(path)
	print("overview: ", path, " error ", error)
	get_tree().quit(0 if error == OK else 1)
