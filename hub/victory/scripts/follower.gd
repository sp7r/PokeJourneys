extends Node3D
## The Vault Pokémon follows the player's previous tile. It starts in its ball.

signal unavailable(message: String)

const Sprite = preload("res://scripts/overworld_sprite.gd")
const BallRelease = preload("res://scripts/ball_release.gd")
const FRAME_COUNT := 16
const MIN_FRAME_SIZE := 16
const MAX_FRAME_SIZE := 64
const TOGGLE_COOLDOWN := 0.65

var _player: Node3D
var _sprite := Sprite.new()
var _tile := Vector2i.ZERO
var _movement: Tween
var _app: Object
var _request := 0
var _loading := false
var _cooldown: SceneTreeTimer
var _revealing := false
var _release: BallRelease


func attach(player: Node3D, trainer_sprite: Node3D) -> void:
	_player = player
	hide()
	add_child(_sprite)
	_sprite.position = trainer_sprite.position
	_sprite.scale = trainer_sprite.scale
	_player.placed.connect(_on_placed)
	_player.step_started.connect(_follow_step)
	if Engine.has_singleton("PokeJourneys"):
		_app = Engine.get_singleton("PokeJourneys")
		_app.connect("follower_ready", _on_loaded)


func toggle() -> void:
	if _loading or (_cooldown != null and _cooldown.time_left > 0.0): return
	_cooldown = get_tree().create_timer(TOGGLE_COOLDOWN)
	_request += 1
	if visible:
		_cancel_release()
		if _movement: _movement.kill()
		hide()
	elif _app != null:
		_loading = true
		_app.request_follower(_request)
	else:
		unavailable.emit("Choose a Pokémon in the Vault.")

## The plugin's request number identifies the follower that finished emerging on the map.
func visible_request() -> int:
	return _request if not _revealing and _sprite.is_visible_in_tree() else -1


func _on_loaded(request: int, bytes: PackedByteArray, message: String) -> void:
	if request != _request: return
	_loading = false
	if not message.is_empty():
		unavailable.emit(message)
		return
	var image := Image.new()
	if image.load_png_from_buffer(bytes) != OK:
		unavailable.emit("Couldn't load your follower's sprite.")
		return
	var frame_size := image.get_height()
	if frame_size < MIN_FRAME_SIZE or frame_size > MAX_FRAME_SIZE or image.get_width() != FRAME_COUNT * frame_size:
		unavailable.emit("Couldn't load your follower's sprite.")
		return
	# Loading can take longer than the first cooldown. Start it again with the animation.
	_cooldown = get_tree().create_timer(TOGGLE_COOLDOWN)
	_sprite.use_image(image, FRAME_COUNT, frame_size)
	_revealing = true
	_place_near_player()
	show()
	_release = BallRelease.new()
	add_child(_release)
	_release.opened.connect(_reveal)
	_release.play(_player.global_position)


func _reveal() -> void:
	_revealing = false
	_sprite.visible = _tile != _player.tile or _player.moving


func _cancel_release() -> void:
	if is_instance_valid(_release): _release.queue_free()
	_revealing = false


func _on_placed() -> void:
	# The room warp sets the player's facing immediately after placing them.
	if visible:
		_cancel_release()
		_place_near_player.call_deferred()


func _place_near_player() -> void:
	if _movement: _movement.kill()
	var facing: Vector2i = _player.facing
	var side := Vector2i(-facing.y, facing.x)
	_tile = _player.tile
	for offset in [-facing, side, -side, facing]:
		var candidate: Vector2i = _player.tile + offset
		if _player.world.can_step(_player.tile, candidate):
			_tile = candidate
			break
	position = _player.world.tile_to_world(_tile)
	_sprite.face(facing)
	_sprite.visible = not _revealing and _tile != _player.tile


func _follow_step(previous: Vector2i, duration: float, running: bool) -> void:
	if not visible: return
	if _movement: _movement.kill()
	if not _revealing: _sprite.show()
	var direction := previous - _tile
	if direction.length_squared() == 1 and _player.world.can_step(_tile, previous):
		var path: PackedVector3Array = _player.world.step_path(_tile, previous)
		_sprite.face(direction)
		_sprite.play_step(duration, running)
		_movement = create_tween()
		for waypoint in path:
			_movement.tween_property(self, "position", waypoint, duration / path.size())
	else:
		position = _player.world.tile_to_world(previous)
	_tile = previous
