extends AudioStreamPlayer
## The hub's music: one song outside and one per building ("music" in layout.json, by door), made from the
## player's DS cartridges by the build (music/<song>.qoa with music/music.json's loop points). A room reached by
## stairs keeps its building's song. Quiet when the songs aren't there.
const FADE := 0.25
var root: String
var songs := {}       # song name: {rate, frames, loopBegin, loopEnd}
var by_room := {}     # interior room: song name
var outside := ""
var playing_song := ""

func setup(data: String, layout: Dictionary) -> void:
	root = data.path_join("music")
	var list = JSON.parse_string(FileAccess.get_file_as_string(root.path_join("music.json"))) if FileAccess.file_exists(root.path_join("music.json")) else null
	if list is Dictionary: songs = list
	var music: Dictionary = layout.get("music", {})
	outside = music.get("island", "")
	var doors: Dictionary = music.get("doors", {})
	for entry in layout.get("interiors", []):
		if doors.has(entry.door): by_room[entry.room] = doors[entry.door]

## Plays the island's song ("" for the island) or the room's, fading from the one before.
func room(name: String) -> void:
	var song: String = outside if name.is_empty() else by_room.get(name, playing_song)
	if song == playing_song: return
	playing_song = song
	if playing:
		await create_tween().tween_property(self, "volume_db", -40.0, FADE).finished
	if song != playing_song: return # moved on while fading
	stop()
	var next := _load(song)
	if next == null: return
	stream = next
	volume_db = 0.0
	play()

func _load(song: String) -> AudioStreamWAV:
	if not songs.has(song): return null
	var file := root.path_join(song + ".qoa")
	if not FileAccess.file_exists(file): return null
	var info: Dictionary = songs[song]
	var wav := AudioStreamWAV.new()
	wav.format = AudioStreamWAV.FORMAT_QOA
	wav.stereo = true
	wav.mix_rate = int(info.rate)
	wav.data = FileAccess.get_file_as_bytes(file)
	wav.loop_mode = AudioStreamWAV.LOOP_FORWARD
	wav.loop_begin = int(info.loopBegin)
	wav.loop_end = int(info.loopEnd)
	return wav
