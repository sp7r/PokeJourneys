extends Node3D
## An NPC from layout.json "npcs": tile, facing, sprite (an overworld texture of the games, built by
## tools/hub/victory/frames.js), text pages and an optional "move":
##   "still" (default) stands facing one way; "look" turns to look around now and then;
##   "pace" walks back and forth along "axis" ("x" or "y") up to "range" tiles from home;
##   "wander" steps in random directions, staying within "range" tiles of home.
## "every" is the average seconds between moves. It stops and turns to the player when talked to.

const OverworldSprite = preload("res://scripts/overworld_sprite.gd")
const FACING := {"up": Vector2i.UP, "down": Vector2i.DOWN, "left": Vector2i.LEFT, "right": Vector2i.RIGHT}
const DIRS := [Vector2i.UP, Vector2i.DOWN, Vector2i.LEFT, Vector2i.RIGHT]
const STEP_TIME := 0.32

var info := {}
var world: Node3D
var tile := Vector2i.ZERO
var home := Vector2i.ZERO
var text: Array = []
var home_facing := Vector2i.DOWN
var move := "still"
var axis := Vector2i.RIGHT
var reach := 3
var every := 2.5
var moving := false
var talking := false
var sprite := OverworldSprite.new()
var _timer := 0.0
var _pace_dir := 1


func setup(w: Node3D, data: Dictionary) -> void:
	world = w
	info = data
	tile = Vector2i(int(data.tile[0]), int(data.tile[1]))
	home = tile
	text = data.get("text", [])
	home_facing = FACING.get(String(data.get("facing", "down")), Vector2i.DOWN)
	move = String(data.get("move", "still"))
	axis = Vector2i.DOWN if String(data.get("axis", "x")) == "y" else Vector2i.RIGHT
	reach = int(data.get("range", 3))
	every = float(data.get("every", 2.5))
	add_child(sprite)
	sprite.setup(String(data.get("sprite", "")))
	sprite.face(home_facing)
	position = world.tile_to_world(tile)
	# "offset" [east, up, south] in tiles moves a standing NPC off the tile's middle, such as onto
	# a bench seat to look seated.
	var nudge: Array = data.get("offset", [0, 0, 0])
	position += Vector3(float(nudge[0]), float(nudge[1]), float(nudge[2]))
	_timer = randf_range(0.5, every * 1.5)


## Turns toward `from` (the player's tile) and returns the pages to show.
func talk(from: Vector2i) -> Array:
	talking = true
	var d := from - tile
	# Also across a counter: the player stands in line with it, a tile or two away.
	if (d.x == 0) != (d.y == 0): sprite.face(d.sign())
	return text


## Carries on once the conversation ends; standing NPCs turn back the way they were facing.
func done() -> void:
	talking = false
	if move == "still": sprite.face(home_facing)


func _process(delta: float) -> void:
	if moving or talking or move == "still": return
	_timer -= delta
	if _timer > 0.0: return
	_timer = randf_range(every * 0.5, every * 1.5)
	match move:
		"look":
			sprite.face(DIRS.pick_random())
		"pace":
			var next := tile + axis * _pace_dir
			if (next - home).length() > reach or not _free(next):
				_pace_dir = -_pace_dir
				next = tile + axis * _pace_dir
			sprite.face(axis * _pace_dir)
			if (next - home).length() <= reach and _free(next): _step(next)
		"wander":
			var dir: Vector2i = DIRS.pick_random()
			sprite.face(dir)
			var next := tile + dir
			if absi(next.x - home.x) <= reach and absi(next.y - home.y) <= reach and _free(next): _step(next)


func _free(to: Vector2i) -> bool:
	return to != world.player_tile and world.can_step(tile, to)


func _step(to: Vector2i) -> void:
	moving = true
	world.move_npc(self, to)
	var path: PackedVector3Array = world.step_path(tile, to)
	tile = to
	var tween := create_tween()
	for point in path: tween.tween_property(self, "position", point, STEP_TIME / path.size())
	sprite.play_step(STEP_TIME, false)
	await tween.finished
	moving = false
