extends RefCounted
## The counter menus share the trainer's wallet. Battle items and TMs go into the shared bag.

const Character = preload("res://scripts/character.gd")
const CostumeParts = preload("res://scripts/costume_parts.gd")

static func speak(host: Node, shop: String) -> void:
	if not Engine.has_singleton("PokeJourneys"):
		await host._show_pages(["Shop inventories are available in PokeJourneys."])
		return
	var app := Engine.get_singleton("PokeJourneys")
	var view := await _request(host, app, "list", shop)
	if view.has("error"): return
	if not view.ready:
		await host._show_pages(["Save in an official journey first to bring your money and bag to the island."])
		return

	if shop == "tm":
		await _browse_tms(host, app, view)
		return
	if shop == "costumes":
		await _browse_costumes(host, app, view)
		return

	while true:
		var choice := await _choose(host, "Money ¥%d. How can I help?" % view.money, ["Buy", "Sell", "Bag", "Back"])
		match choice:
			0, 1:
				var action := "buy" if choice == 0 else "sell"
				var updated := await _trade(host, app, view, action, shop)
				if not updated.is_empty(): view = updated
			2:
				await _show_bag(host, view)
			3:
				return


static func _browse_tms(host: Node, app: Object, view: Dictionary) -> void:
	var selected := 0
	while true:
		var stock: Array = view.stock
		selected = await _pick_item(host, view.money, stock, false, selected, true)
		if selected == stock.size(): return
		view = await _checkout(host, app, view, "buy", "tm", stock[selected])


static func _browse_costumes(host: Node, app: Object, view: Dictionary) -> void:
	while true:
		var choice := await _choose(host, "Money ¥%d. How can I help?" % view.money, ["Buy", "Wardrobe", "Back"])
		if choice == 2: return
		var wardrobe := choice == 1
		var stock: Array = view.stock.filter(func(item): return (item.owned > 0) == wardrobe)
		if stock.is_empty():
			await host._show_pages(["Your wardrobe is empty." if wardrobe else "You already own every costume."])
			continue
		var labels: Array = stock.map(func(item):
			return item.label if wardrobe else "%s  ¥%d" % [item.label, item.price])
		labels.append("Back")
		var selected := await _choose(host, "Choose something to wear." if wardrobe else "Choose a costume.", labels)
		if selected == stock.size(): continue
		var item: Dictionary = stock[selected]
		var look := CostumeParts.with_costume(Character.load_saved(), item.id)
		if look.is_empty():
			await host._show_pages(["That costume is unavailable."])
			continue
		if not wardrobe:
			if int(view.money) < int(item.price):
				await host._show_pages(["You don't have enough Pokéyen."])
				continue
			if await _choose(host, "Buy %s for ¥%d?" % [item.label, item.price], ["Yes", "Back"]) != 0: continue
			var updated := await _request(host, app, "buy", "costumes", item.id, 1)
			if updated.has("error"): continue
			view = updated
			if await _choose(host, "Bought %s. Wear it now?" % item.label, ["Yes", "Later"]) != 0: continue
		if not Character.save(look):
			await host._show_pages(["Couldn't put on that costume. Please try again."])
			continue
		host.player.wear(Character.build_sheet(look))
		app.hide_bottom()
		await host._show_pages(["Now wearing %s." % item.label])


static func _trade(host: Node, app: Object, view: Dictionary, action: String, shop: String) -> Dictionary:
	var selling := action == "sell"
	var stock: Array = view.stock
	if selling: stock = stock.filter(func(item): return item.owned > 0)
	if stock.is_empty():
		await host._show_pages(["You have no items this shop buys." if selling else "There's no stock."])
		return {}
	var selected := await _pick_item(host, view.money, stock, selling, 0, true)
	if selected == stock.size(): return {}
	return await _checkout(host, app, view, action, shop, stock[selected])


static func _pick_item(host: Node, money: int, stock: Array, selling: bool,
		initial: int = 0, hold_to_scroll: bool = false) -> int:
	var labels: Array = stock.map(func(item):
		var price := int(item.price) / 2 if selling else int(item.price)
		return "%s  ¥%d" % [item.label, price])
	labels.append("Back")
	return await _choose(host, "Money ¥%d. Choose an item." % money, labels, initial, hold_to_scroll)


static func _checkout(host: Node, app: Object, view: Dictionary, action: String, shop: String,
		item: Dictionary) -> Dictionary:
	var selling := action == "sell"
	var price := int(item.price) / 2 if selling else int(item.price)
	var limit := mini(99, int(item.owned)) if selling else mini(99,
		mini(int(view.money) / price, int(item.limit) - int(item.owned)))
	if limit < 1:
		await host._show_pages(["You already have as many of those as you can carry." if item.owned >= item.limit
			else "You don't have enough Pokéyen."])
		return view
	var amounts: Array = []
	for n in range(1, limit + 1): amounts.append("x%d" % n)
	amounts.append("Back")
	var amount := await _choose(host, "%s in your bag: %d. How many?" % [item.label, item.owned], amounts)
	if amount == limit: return view
	var quantity := amount + 1
	var confirm := "%s %d for ¥%d?" % ["Sell" if selling else "Buy", quantity, price * quantity]
	if await _choose(host, confirm, ["Yes", "Back"]) != 0: return view
	var updated := await _request(host, app, action, shop, item.id, quantity)
	if updated.has("error"): return view
	var pages := ["%s %s x%d." % ["Sold" if selling else "Bought", item.label, quantity]]
	if shop == "tm": pages.append("The TM is in your shared bag. It will sync to journeys that have it.")
	await host._show_pages(pages)
	return updated


static func _show_bag(host: Node, view: Dictionary) -> void:
	var keys: Array = view.bag.keys()
	if keys.is_empty():
		await host._show_pages(["Your shared bag is empty."])
		return
	keys.sort()
	var names := {}
	for item in view.stock: names[item.id] = item.label
	var pages := []
	for start in range(0, keys.size(), 3):
		var items := PackedStringArray()
		for key in keys.slice(start, start + 3):
			var label: String = key if key.begins_with("TM ") else names.get(key, key.capitalize())
			items.append("%s x%d" % [label, view.bag[key]])
		pages.append("    ".join(items))
	await host._show_pages(pages)


static func _choose(host: Node, prompt: String, options: Array, initial: int = 0, hold_to_scroll: bool = false) -> int:
	host.player.locked = true
	host.message.ask(prompt, options, initial, hold_to_scroll)
	var index: int = await host.message.answered
	host.player.locked = false
	return index


static func _request(host: Node, app: Object, action: String, shop: String, item: String = "",
		quantity: int = 0) -> Dictionary:
	host.player.locked = true
	app.shop_request(action, shop, "", item, quantity)
	var json: String = await app.shop_ready
	host.player.locked = false
	var parsed = JSON.parse_string(json)
	var response: Dictionary = parsed if parsed is Dictionary else {"error": "The shop is unavailable. Please try again."}
	if response.has("error"): await host._show_pages([response.error])
	return response
