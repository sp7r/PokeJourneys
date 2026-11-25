extends Node3D
## An NPC from the decomp's event data: sprite, facing, movement type and text.
## Movement types follow the Gen 4 table: 0 still, 2 look around, 3 wander,
## 4 wander up/down, 5 wander left/right, 14-17 always face up/down/left/right.

const STEP_TIME := 0.3
const FIXED_FACING := {14: Vector2i(0, -1), 15: Vector2i(0, 1), 16: Vector2i(-1, 0), 17: Vector2i(1, 0)}
const DIRS := [Vector2i(0, -1), Vector2i(0, 1), Vector2i(-1, 0), Vector2i(1, 0)]
## Decomp facing: 0 north, 1 south, 2 west, 3 east.
const FACING := [Vector2i(0, -1), Vector2i(0, 1), Vector2i(-1, 0), Vector2i(1, 0)]

const OverworldSprite = preload("res://scripts/overworld_sprite.gd")
var info := {}
var world: Node3D
var tile := Vector2i.ZERO
var home := Vector2i.ZERO
var text: Array = []
var movement := 0
var wander := Vector2i.ZERO
var moving := false
var talking := false

var sprite := OverworldSprite.new()
var _timer := 0.0


func setup(w: Node3D, data: Dictionary) -> void:
	world = w
	info = data
	tile = Vector2i(int(data["x"]), int(data["y"]))
	home = tile
	text = data.get("text", [])
	movement = int(data.get("movement", 0))
	var r: Array = data.get("range", [0, 0])
	wander = Vector2i(int(r[0]), int(r[1]))
	add_child(sprite)
	sprite.setup(data["sprite"])
	var f: int = {"up": 0, "down": 1, "left": 2, "right": 3}.get(str(data.get("facing", "down")), 1)
	sprite.face(FIXED_FACING.get(movement, FACING[f] if f >= 0 and f < 4 else Vector2i(0, 1)))
	position = world.tile_to_world(tile)
	_timer = randf_range(1.0, 3.0)


func face_toward(t: Vector2i) -> void:
	var d := t - tile
	if d != Vector2i.ZERO:
		sprite.face(Vector2i(signi(d.x), signi(d.y)) if absi(d.x) + absi(d.y) == 1 else sprite.facing)


func _process(delta: float) -> void:
	if moving or talking or movement in FIXED_FACING or movement == 0:
		return
	_timer -= delta
	if _timer > 0.0:
		return
	_timer = randf_range(1.5, 4.0)
	var dir: Vector2i = DIRS.pick_random()
	if movement == 2:  # look around
		sprite.face(dir)
		return
	if movement == 4:
		dir = [Vector2i(0, -1), Vector2i(0, 1)].pick_random()
	elif movement == 5:
		dir = [Vector2i(-1, 0), Vector2i(1, 0)].pick_random()
	elif movement != 3:
		return
	sprite.face(dir)
	var t := tile + dir
	var lim := wander.max(Vector2i.ONE)
	if absi(t.x - home.x) > lim.x or absi(t.y - home.y) > lim.y:
		return
	if not world.can_step(tile, t):
		return
	moving = true
	world.move_npc(self, t)
	var tw := create_tween()
	tw.tween_property(self, "position", world.tile_to_world(t), STEP_TIME)
	sprite.play_step(STEP_TIME, false)
	await tw.finished
	moving = false

