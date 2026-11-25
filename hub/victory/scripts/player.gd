extends Node3D
signal stepped(tile: Vector2i, behaviour: String)
signal step_attempted(tile: Vector2i)
signal placed
signal step_started(previous: Vector2i, duration: float, running: bool)
const OverworldSprite = preload("res://scripts/overworld_sprite.gd")
const Joypad = preload("res://scripts/joypad.gd")
const WALK_TIME := 0.25
const RUN_TIME := 0.13
const MAX_STEP := 1.01
const DIRS := {"move_up": Vector2i.UP, "move_down": Vector2i.DOWN, "move_left": Vector2i.LEFT, "move_right": Vector2i.RIGHT}
var world: Node3D
var tile := Vector2i.ZERO
var facing := Vector2i.DOWN
var moving := false
var locked := false
var scripted: Array[Vector2i] = []
var _sprite := OverworldSprite.new()

func _ready() -> void:
	add_child(_sprite)

func place(t: Vector2i) -> void:
	tile = t
	world.player_tile = t
	position = world.tile_to_world(t)
	if _sprite.texture == null: _sprite.setup("SPRITE_HERO")
	placed.emit()

## Swaps in the sheet built from the player's own look (character.gd).
func wear(sheet: Image) -> void:
	_sprite.use_image(sheet, 32, 32)
	_sprite.face(facing)

func face(dir: Vector2i) -> void:
	facing = dir
	_sprite.face(dir)

func _process(_delta: float) -> void:
	if world == null or moving or locked: return
	var dir := Vector2i.ZERO
	if not scripted.is_empty():
		dir = scripted.pop_front()
	else:
		for action in DIRS:
			if Input.is_action_pressed(action):
				dir = DIRS[action]
				break
		if dir == Vector2i.ZERO:
			var stick := Joypad.left_stick()
			if absf(stick.x) > absf(stick.y):
				dir = Vector2i(int(signf(stick.x)), 0)
			else:
				dir = Vector2i(0, int(signf(stick.y)))
	if dir == Vector2i.ZERO: return
	face(dir)
	var target := tile + dir
	step_attempted.emit(target)
	if locked or not world.can_step(tile, target): return
	moving = true
	var running := Input.is_action_pressed("run")
	var duration := RUN_TIME if running else WALK_TIME
	step_started.emit(tile, duration, running)
	world.player_tile = target
	_sprite.play_step(duration, running)
	var tw := create_tween()
	var path: PackedVector3Array = world.step_path(tile, target)
	for waypoint in path:
		tw.tween_property(self, "position", waypoint, duration / path.size())
	await tw.finished
	tile = target
	moving = false
	stepped.emit(tile, world.behaviour(tile))
