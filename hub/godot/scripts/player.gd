extends Node3D
signal stepped(tile: Vector2i, behaviour: String)
signal bumped(tile: Vector2i, behaviour: String)
const OverworldSprite = preload("res://scripts/overworld_sprite.gd")
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
	_sprite.setup("SPRITE_HERO")

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
	if dir == Vector2i.ZERO: return
	face(dir)
	var target := tile + dir
	if world.behaviour(target) == "door":
		bumped.emit(target, "door")
		return
	if not world.can_step(tile, target): return
	moving = true
	var running := Input.is_action_pressed("run")
	var duration := RUN_TIME if running else WALK_TIME
	world.player_tile = target
	_sprite.play_step(duration, running)
	var tw := create_tween()
	tw.tween_property(self, "position", world.tile_to_world(target), duration)
	await tw.finished
	tile = target
	moving = false
	stepped.emit(tile, world.behaviour(tile))
