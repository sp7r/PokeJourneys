extends Node3D
## The throw and opening flash. The follower appears when the flash starts.

signal opened

const CLOSED := [
	"   ###   ",
	"  #RRR#  ",
	" #RRRRR# ",
	"#RRRRRRR#",
	"###WWW###",
	"#WW#W#WW#",
	" #WWWWW# ",
	"  #WWW#  ",
	"   ###   ",
]
const OPEN := [
	"   ###   ",
	"  #RRR#  ",
	"   #R#   ",
	"    #    ",
	"    *    ",
	"  #WWW#  ",
	" #WWWWW# ",
	"  #WWW#  ",
	"   ###   ",
]
const FLASH := [
	"     *     ",
	"  *  *  *  ",
	"   * * *   ",
	"    WWW    ",
	"    WWW    ",
	"***WWWWW***",
	"    WWW    ",
	"    WWW    ",
	"   * * *   ",
	"  *  *  *  ",
	"     *     ",
]
const PALETTE := {"#": Color("222638"), "R": Color("e54848"), "W": Color("fff9ed"), "*": Color("ffd66b")}

var _sprite := Sprite3D.new()


func play(from: Vector3) -> void:
	_sprite.texture = _texture(CLOSED)
	_sprite.texture_filter = BaseMaterial3D.TEXTURE_FILTER_NEAREST
	_sprite.billboard = BaseMaterial3D.BILLBOARD_ENABLED
	_sprite.shaded = false
	_sprite.pixel_size = 1.0 / 22.0
	_sprite.render_priority = 1
	add_child(_sprite)
	var start := from + Vector3.UP * 0.65
	_throw(0.0, start)
	var animation := create_tween()
	animation.tween_method(_throw.bind(start), 0.0, 1.0, 0.27)
	animation.tween_callback(func(): _sprite.texture = _texture(OPEN))
	animation.tween_interval(0.05)
	animation.tween_callback(_flash)
	animation.tween_property(_sprite, "modulate:a", 0.0, 0.14)
	animation.tween_callback(queue_free)


func _throw(progress: float, start: Vector3) -> void:
	var landing := global_position + Vector3.UP * 0.35
	_sprite.global_position = start.lerp(landing, progress) + Vector3.UP * sin(progress * PI) * 0.65


func _flash() -> void:
	if is_queued_for_deletion(): return
	_sprite.texture = _texture(FLASH)
	_sprite.scale *= 1.4
	opened.emit()


func _texture(rows: Array) -> ImageTexture:
	var image := Image.create_empty(rows[0].length(), rows.size(), false, Image.FORMAT_RGBA8)
	for y in rows.size():
		for x in rows[y].length():
			if PALETTE.has(rows[y][x]): image.set_pixel(x, y, PALETTE[rows[y][x]])
	return ImageTexture.create_from_image(image)
