extends RefCounted

const STICK_DEADZONE := 0.5


## The strongest left stick from the connected controllers, with a dead zone around the center.
static func left_stick() -> Vector2:
	var stick := Vector2.ZERO
	for pad in Input.get_connected_joypads():
		var tilt := Vector2(Input.get_joy_axis(pad, JOY_AXIS_LEFT_X), Input.get_joy_axis(pad, JOY_AXIS_LEFT_Y))
		if tilt.length_squared() > stick.length_squared(): stick = tilt
	return stick if stick.length_squared() >= STICK_DEADZONE * STICK_DEADZONE else Vector2.ZERO
