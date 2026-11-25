class_name OverworldSprite
extends Sprite3D
## An HGSS overworld sprite sheet: 32x32 frames in a row.
## Per 16 frames: up, down, left, right, each stand / walk / stand / walk. A second
## set of 16 (the player's) is running.

const DIR_BASE := {Vector2i(0, -1): 0, Vector2i(0, 1): 4, Vector2i(-1, 0): 8, Vector2i(1, 0): 12}

static var data_root := ""
static var _index := {}

var facing := Vector2i(0, 1)
var _frames := 1
var _step := 0


static func exists(sprite_id: String) -> bool:
	_load_index()
	return _index.has(sprite_id)


static func _load_index() -> void:
	if _index.is_empty():
		var parsed = JSON.parse_string(FileAccess.get_file_as_string(data_root.path_join("sprites.json"))) if FileAccess.file_exists(data_root.path_join("sprites.json")) else {}
		_index = parsed if parsed is Dictionary else {}
		# NPC sheets built from the games by tools/hub/victory/frames.js.
		var npcs := data_root.path_join("npc-sprites.json")
		if FileAccess.file_exists(npcs):
			var more = JSON.parse_string(FileAccess.get_file_as_string(npcs))
			if more is Dictionary: _index.merge(more)


func setup(sprite_id: String) -> void:
	_load_index()
	if not _index.has(sprite_id):
		return
	var info: Dictionary = _index[sprite_id]
	var image := Image.load_from_file(data_root.path_join(info["sheet"]))
	if image == null: return
	use_image(image, int(info["frames"]), float(info["h"]))


## Shows a sheet built in the hub (the player's own look from the creator) instead of a game texture.
func use_image(image: Image, frames: int, height: float) -> void:
	texture = ImageTexture.create_from_image(image)
	_frames = frames
	hframes = _frames
	# Stand upright and flat to the screen, as in the DS games. The camera never turns sideways, only
	# tilts down, so facing south keeps every sprite square to the view wherever it is on screen
	# (turning toward the camera's position would skew sprites away from the middle).
	billboard = BaseMaterial3D.BILLBOARD_DISABLED
	texture_filter = BaseMaterial3D.TEXTURE_FILTER_NEAREST
	alpha_cut = SpriteBase3D.ALPHA_CUT_DISCARD
	shaded = false
	pixel_size = 1.0 / 16.0
	offset = Vector2(0, height / 2.0 - 2.0)  # feet on the tile
	show_frame(false, false)


## Standing (walking=false) or mid-step; alternates feet between steps.
func show_frame(walking: bool, running: bool) -> void:
	if _frames < 16:
		frame = 0
		return
	var base: int = DIR_BASE.get(facing, 4)
	if running and _frames >= 32:
		base += 16
	frame = base + ((1 if _step % 2 == 0 else 3) if walking else 0)


func face(dir: Vector2i) -> void:
	facing = dir
	show_frame(false, false)


## Animate one tile of movement taking `time` seconds.
func play_step(time: float, running: bool) -> void:
	show_frame(true, running)
	await get_tree().create_timer(time * 0.5).timeout
	show_frame(false, running)
	_step += 1

