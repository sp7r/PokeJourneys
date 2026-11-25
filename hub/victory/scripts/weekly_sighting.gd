extends RefCounted
## Shows the Pokémon Spotter's weekly dialogue after the app checks the visible follower.

static func speak(host: Node, follower_request: int) -> void:
	if not Engine.has_singleton("PokeJourneys"):
		await host._show_pages(["I keep a journal of the Pokémon I've spotted around the island."])
		return
	var app := Engine.get_singleton("PokeJourneys")
	host.player.locked = true
	app.weekly_sighting(follower_request)
	var response: String = await app.weekly_sighting_ready
	var pages = JSON.parse_string(response)
	host.player.locked = false
	if pages is Array: await host._show_pages(pages)
