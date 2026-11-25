extends RefCounted

const Character = preload("res://scripts/character.gd")
const PARTS := {
	"adventurer": {
		"top": ["Adventurer Tunic", "green"],
		"bottom": ["Adventurer Leggings", "brown"],
		"hat": ["Adventurer Cap", "green"],
	},
	"martial-arts": {
		"top": ["Martial Arts Gi", "orange"],
		"bottom": ["Martial Arts Pants", "orange"],
	},
	"champions-cape": {"bag": ["Champions Cape", "burgundy"]},
	"golden-spikes": {"hair": ["Golden Spikes", "yellow"]},
}


## A costume only replaces the slots it includes, leaving the rest of the trainer's look intact.
static func with_costume(look: Dictionary, id: String) -> Dictionary:
	var parts: Dictionary = PARTS.get(id, {})
	if parts.is_empty() or not Character.available(): return {}
	var result := Character.DEFAULT.duplicate(true)
	result.merge(look, true)
	for slot in parts:
		var part: Array = parts[slot]
		var styles := Character.styles(slot, result.gender)
		if not styles.any(func(style): return style.name == part[0] and style.colors.any(
				func(color): return color.label == part[1])):
			return {}
	result.merge(parts, true)
	return result


## Shop parts are equipped from the wardrobe. Keep any piece already worn when editing a trainer.
static func creator_styles(slot: String, gender: String, worn: String) -> Array:
	var reserved := []
	for parts in PARTS.values():
		if parts.has(slot): reserved.append(parts[slot][0])
	return Character.styles(slot, gender).filter(func(style):
		return style.name == worn or not reserved.has(style.name))
