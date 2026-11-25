// Gentle wind sway for tree tops, bunting and flags. COLOR.r holds each vertex's height above the
// bottom of its model on that tile (divided by 8), so the base stays put and the top moves most.
shader_type spatial;
render_mode unshaded, cull_disabled;

uniform sampler2D albedo_texture : source_color, filter_nearest, repeat_enable;
uniform float amount = 0.03;
uniform float speed = 1.2;
uniform float scissor = 0.5;

void vertex() {
	float height = COLOR.r * 8.0;
	vec3 world = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
	float phase = world.x * 0.55 + world.z * 0.35;
	VERTEX.x += sin(TIME * speed + phase) * amount * height;
	VERTEX.z += cos(TIME * speed * 0.8 + phase) * amount * 0.5 * height;
}

void fragment() {
	vec4 color = texture(albedo_texture, UV);
	ALBEDO = color.rgb;
	ALPHA = color.a;
	ALPHA_SCISSOR_THRESHOLD = scissor;
}
