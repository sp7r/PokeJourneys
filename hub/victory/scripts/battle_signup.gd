extends RefCounted
## Keeps one battle signup in the current account's local hub data.

const MODES := {
	"ranked": "Ranked PvP",
	"ranked_random_singles": "Ranked Random Singles",
	"ranked_random_doubles": "Ranked Random Doubles",
	"ranked_open_singles": "Ranked Open Singles",
	"ranked_open_doubles": "Ranked Open Doubles",
	"casual": "Casual PvP",
	"practice": "Single Battles",
	"practice_doubles": "Double Battles",
	"practice_triples": "Triple Battles",
}


static func speak(host: Node, account_dir: String, modes: Array) -> void:
	if modes.size() == 1 and String(modes[0]).begins_with("practice"):
		var plugin = Engine.get_singleton("PokeJourneys") if Engine.has_singleton("PokeJourneys") else null
		if plugin != null:
			plugin.open_bot_battle(modes[0])
		else:
			await host._show_pages(["Battle Dome battles are available in the Android app."])
		return
	# Keep the original filename so existing signups are recognized at either venue.
	var path := account_dir.path_join("stadium-signup.txt")
	var current := _read(path)
	if current in modes:
		var actions := ["Withdraw signup", "Back"]
		if modes.size() > 1: actions.push_front("Change battle")
		var action := await _ask(host, "Signed up for %s." % MODES[current], actions)
		match actions[action]:
			"Back": return
			"Withdraw signup":
				var removed := DirAccess.remove_absolute(path) == OK
				await host._show_pages(["Your signup was withdrawn." if removed else "I couldn't withdraw your signup."])
				return

	var labels := modes.map(func(mode): return MODES[mode])
	labels.append("Back")
	var choice := await _ask(host, "Which battle would you like to sign up for?", labels)
	if choice == modes.size(): return
	if not current.is_empty() and current not in modes:
		var replace := await _ask(host, "Replace your signup for %s?" % MODES[current], ["Replace signup", "Keep signup"])
		if replace != 0: return
	var mode: String = modes[choice]
	if not _save(path, mode):
		await host._show_pages(["I couldn't save your signup. Please try again."])
		return
	await host._show_pages(["You're signed up for %s." % MODES[mode],
		"Your signup is saved on this device.",
		"Practice battles aren't open yet." if mode.begins_with("practice") else "Matchmaking isn't open yet."])


static func _ask(host: Node, prompt: String, labels: Array) -> int:
	host.player.locked = true
	host.message.ask(prompt, labels)
	var choice: int = await host.message.answered
	host.player.locked = false
	return choice


static func _read(path: String) -> String:
	if not FileAccess.file_exists(path): return ""
	var mode := FileAccess.get_file_as_string(path)
	return mode if MODES.has(mode) else ""


static func _save(path: String, mode: String) -> bool:
	if DirAccess.make_dir_recursive_absolute(path.get_base_dir()) != OK: return false
	var temp := path + ".tmp"
	var file := FileAccess.open(temp, FileAccess.WRITE)
	if file == null: return false
	var stored := file.store_string(mode)
	file.close()
	if stored and DirAccess.rename_absolute(temp, path) == OK: return true
	DirAccess.remove_absolute(temp)
	return false
