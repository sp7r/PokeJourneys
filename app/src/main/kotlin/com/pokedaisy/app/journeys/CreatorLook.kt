package com.pokedaisy.app.journeys

import android.content.Context
import android.graphics.BitmapFactory
import com.pokedaisy.app.companion.data.LookChar
import com.pokedaisy.app.companion.data.LookPart
import com.pokedaisy.app.companion.data.PlayerLook
import com.pokedaisy.app.companion.data.RomArt
import org.json.JSONObject
import java.io.File

/**
 * The player's own trainer from Victory Island's creator (hub/victory/scripts/character.gd) as a PLAYER LOOK pick
 * ([PICK]) in the Gen 3 games.
 *
 * The look is the signed-in account's `user://accounts/<id>/character.json` (the `:hub` process's Godot user dir: [saved]), stacked the hub's way
 * from the creator art in the APK's assets (`creator/sprites/`: the same layers, order and colour tints as
 * `build_sheet`). [hero] makes a whole hero of it in Emerald's sprite set (Heart and Soul's heroes are worn the same
 * way), which [PlayerLook.build] then fits into whichever game runs, frame by frame, as it does any other game's hero:
 * - walking and running (16x32: the middle 16 of the art's 32 columns, the window losing the fewest pixels), both bikes
 *   (32x32, as drawn; the Acro Bike's wheelies and hops from the riding frames, as for FireRed's heroes);
 * - the battle back picture's throw and the trainer card picture (64x64 from the art's 87x98 / 80x80 frames, the figure
 *   kept whole where it fits, feet on the bottom row), in one 15-colour palette of their own;
 * - poses the art doesn't have, made from the look's own standing frames: surfing (the legs cut off, sat down a few
 *   pixels), the field move, fishing and watering (standing, facing the way the game's frames do), decorating.
 * Dive keeps the game's own hero (its frames are drawn in the Dive palette), and so does the region map's head.
 * The overworld frames share one palette of at most 10 colours: what's left of the hero's slot once the colours the surf
 * blob, shadows and arrows draw with are kept.
 */
object CreatorLook {
    /** The pick's name in [com.pokedaisy.app.Prefs.playerLookFor]. */
    const val PICK = "CREATOR"

    /** The picker tile's name and where it comes from (as a hero's tile says its game). */
    const val LABEL = "YOU"
    const val SOURCE = "CREATOR"

    /** The running game wears the creator's look now (Compose state): the companion's MAP head ([HEAD], RomArt's
     * `regionmap/` like a hero's) and CARD picture ([frontPic]) follow it, as they do PlayerLook.worn. */
    val worn = androidx.compose.runtime.mutableStateOf(false)
    const val HEAD = "player_creator"

    private fun lookDir(filesDir: File) = File(com.pokedaisy.app.companion.data.LookArt.dir(filesDir), "creator")

    /** The look's front picture (64x64, 4bpp) and palette as the game's card shows it, kept by [build]. */
    fun frontPic(filesDir: File): Pair<ByteArray, ByteArray>? = runCatching {
        val d = lookDir(filesDir)
        (File(d, "front.bin").readBytes() to File(d, "front_pal.bin").readBytes()).takeIf { it.first.size == 2048 && it.second.size == 32 }
    }.getOrNull()

    /** Keeps what the companion shows of [hero]: the map head (16x16 from the standing frame's top, in its colours) and
     * the front picture. */
    internal fun keep(filesDir: File, hero: Map<LookPart, ByteArray>) = runCatching {
        val sheet = hero[LookPart.EM_WALKING] ?: return@runCatching
        val pal = RomArt.palette(hero[LookPart.OW_PAL] ?: return@runCatching)
        val stand = RomArt.sprite(sheet.copyOfRange(0, 256), pal, 16, 32)
        val top = (0 until 32).firstOrNull { y -> (0 until 16).any { stand.argb[y * 16 + it] != 0 } } ?: return@runCatching
        val head = RomArt.Image(16, 16).also { img -> for (y in 0 until 16) for (x in 0 until 16) img.argb[y * 16 + x] = stand.argb.getOrElse((top + y) * 16 + x) { 0 } }
        val file = File(RomArt.dir(filesDir), "regionmap/$HEAD.png")
        file.parentFile?.mkdirs()
        file.writeBytes(head.png())
        val d = lookDir(filesDir).apply { mkdirs() }
        hero[LookPart.FRONT]?.let { File(d, "front.bin").writeBytes(it) }
        hero[LookPart.FRONT_PAL]?.let { File(d, "front_pal.bin").writeBytes(it) }
        RomArt.announce()
    }

    /** An image as ARGB. */
    class Img(val w: Int, val h: Int, val px: IntArray)

    /** The creator art: [list] a folder's entries (folders and .png files), [load] one, null if missing. Paths are
     * under `sprites/`. */
    interface Art {
        fun list(dir: String): List<String>
        fun load(path: String): Img?
    }

    /** The art inside the APK (`creator/` in its assets, packed by app/build.gradle.kts with the hub). */
    fun apkArt(context: Context): Art = object : Art {
        private val assets = context.assets
        override fun list(dir: String) = runCatching { assets.list("creator/sprites/$dir")?.toList() }.getOrNull().orEmpty()
        override fun load(path: String): Img? = runCatching {
            assets.open("creator/sprites/$path").use { s ->
                val b = BitmapFactory.decodeStream(s, null, BitmapFactory.Options().apply { inPremultiplied = false }) ?: return null
                Img(b.width, b.height, IntArray(b.width * b.height).also { b.getPixels(it, 0, b.width, 0, 0, b.width, b.height) })
            }
        }.getOrNull()
    }

    /** The look the creator saved, or null if the player hasn't made one. */
    fun saved(filesDir: File): JSONObject? =
        runCatching { JSONObject(File(filesDir, "accounts/${DiscordSignIn.accountId(filesDir)}/character.json").readText()) }
            .getOrNull()?.takeIf { it.length() > 0 }

    // --- the hub's rules (character.gd) ---

    private val SLOTS = listOf("bottom" to "bottoms", "top" to "tops", "hair" to "hair", "hat" to "hats", "bag" to "carrying stuff")
    private val OPTIONAL = setOf("hat", "bag")
    private class Tint(val label: String, val hue: Float, val sat: Float, val value: Float)
    private val PALETTE = listOf(
        Tint("black", -1f, 0.12f, 0.32f), Tint("white", -1f, 0.08f, 1.6f), Tint("grey", -1f, 0.06f, 0.8f),
        Tint("red", 0f, 1f, 1f), Tint("orange", 0.07f, 1f, 1.1f), Tint("yellow", 0.14f, 1f, 1.2f),
        Tint("green", 0.33f, 0.9f, 0.9f), Tint("teal", 0.47f, 0.9f, 0.9f), Tint("blue", 0.6f, 1f, 1f),
        Tint("navy", 0.63f, 0.9f, 0.55f), Tint("purple", 0.77f, 0.85f, 0.9f), Tint("pink", 0.9f, 0.6f, 1.15f),
        Tint("brown", 0.07f, 0.7f, 0.55f),
    )
    private val SOURCES = listOf("blue", "red", "green", "purple", "pink", "navy", "aqua", "cyan", "orange", "yellow")

    private class Colour(val label: String, val rel: String, val tint: String? = null)
    private class Style(val name: String, val colours: List<Colour>)

    private fun fits(name: String, gender: String): Boolean {
        val words = name.lowercase().split(" ").filter { it.isNotEmpty() }
        val girl = "f" in words || "w" in words
        val boy = "m" in words
        if ("fm" in words || (girl && boy) || !(girl || boy)) return true
        return if (gender == "f") girl else boy
    }

    private fun label(name: String): String {
        val words = name.split(' ', '-', '_').filter { it.isNotEmpty() && it.lowercase() !in setOf("f", "m", "w", "fm") }
        if (words.isEmpty()) return name
        // Godot's String.capitalize: words split, each capitalised.
        return words.joinToString(" ") { w -> w.lowercase().replaceFirstChar { it.uppercase() } }
    }

    /** A style's drawn colours filled out to the whole PALETTE (drawn when there, else tinted from the best source). */
    private fun spectrum(drawn: List<Colour>): List<Colour> {
        if (drawn.isEmpty()) return drawn
        val byLabel = drawn.associateBy { it.label }
        val source = SOURCES.firstNotNullOfOrNull { byLabel[it] } ?: drawn[0]
        val result = ArrayList<Colour>()
        byLabel["original"]?.let { result += it }
        for (t in PALETTE) result += byLabel[t.label] ?: Colour(t.label, source.rel, t.label)
        return result + drawn.filter { it !in result }.sortedBy { it.label }
    }

    private fun colourOf(file: String) = file.removeSuffix(".png").split(" ").last { it.isNotEmpty() }.lowercase()

    private fun styles(art: Art, folder: String, optional: Boolean, gender: String): List<Style> {
        val result = ArrayList<Style>()
        if (optional) result += Style("None", listOf(Colour("", "")))
        val dir = "overworld walk/$folder"
        for (entry in art.list(dir).sortedWith(String.CASE_INSENSITIVE_ORDER)) {
            val base = entry.removeSuffix(".png")
            if (!fits(base, gender)) continue
            val colours = if (entry.endsWith(".png")) listOf(Colour("original", "$folder/$entry"))
            else art.list("$dir/$entry").filter { it.endsWith(".png") && fits(it.removeSuffix(".png"), gender) }
                .map { Colour(colourOf(it), "$folder/$entry/$it") }
            val name = label(base).replace("Boy ", "Short ").replace("Girl ", "Long ")
            spectrum(colours).takeIf { it.isNotEmpty() }?.let { result += Style(name, it) }
        }
        return result
    }

    /** The slot's pick for [look] ({label, rel, tint}) and its style's name; null for none. */
    private fun pick(art: Art, look: JSONObject, slot: String, folder: String, gender: String): Pair<String, Colour>? {
        val options = styles(art, folder, slot in OPTIONAL, gender)
        if (options.isEmpty()) return null
        val chosen = look.optJSONArray(slot)
        val chosenStyle = chosen?.optString(0)?.let(::label)
        val style = options.firstOrNull { it.name == chosenStyle } ?: options[0]
        val colour = style.colours.firstOrNull { it.label == chosen?.optString(1) } ?: style.colours[0]
        return colour.takeIf { it.rel.isNotEmpty() }?.let { style.name to it }
    }

    private fun layer(art: Art, path: String, tint: String?): Img? {
        val img = art.load(path) ?: return null
        val t = tint?.let { l -> PALETTE.firstOrNull { it.label == l } } ?: return img
        return Img(img.w, img.h, tint(img.px, t))
    }

    private fun stack(w: Int, h: Int, layers: List<Img>): Img {
        val out = IntArray(w * h)
        for (l in layers) for (y in 0 until minOf(h, l.h)) for (x in 0 until minOf(w, l.w)) {
            val i = y * w + x
            out[i] = over(l.px[y * l.w + x], out[i])
        }
        return Img(w, h, out)
    }

    /** One motion's 128x128 sheet of [look] ("walk", "run", "bike": rows down, left, right, up; columns stand, step,
     * stand, step), ARGB. A part the motion has no drawing of is left out. */
    fun canvas(art: Art, look: JSONObject, motion: String): IntArray {
        val gender = look.optString("gender", "m")
        val skin = look.optString("skin", "light")
        val parts = listOf(Colour("", "bases mf/$gender base $skin.png")) + SLOTS.mapNotNull { (slot, folder) -> pick(art, look, slot, folder, gender)?.second }
        return stack(128, 128, parts.mapNotNull { layer(art, "overworld $motion/${it.rel}", it.tint) }).px
    }

    // The trainer pictures' art is named its own way ("trainer back male/hair/hair 2/2 brown.png" for the overworld's
    // "hair/boy 2/boy 2 brown.png"): a part is the entry sharing the most words with the overworld pick's style.

    private val NOISE = setOf("m", "f", "w", "fm", "top", "tops", "bottom", "bottoms", "pants", "shirt", "short", "long", "boy", "girl", "hair")
    private fun words(s: String) = s.lowercase().removeSuffix(".png").split(Regex("[^a-z0-9]+")).filter { it.isNotEmpty() && it !in NOISE }.toSet()

    /** The picture art's file for [style] / [colour] under [dir]: the best-matching entry, its colour's file, or one
     * tinted to it. */
    private fun pictureLayer(art: Art, dir: String, style: String, colour: Colour): Img? {
        val want = words(style)
        val entry = art.list(dir).maxByOrNull { e -> (words(e) intersect want).size * 10 - words(e).size }
            ?.takeIf { e -> (words(e) intersect want).isNotEmpty() } ?: return null
        if (entry.endsWith(".png")) return layer(art, "$dir/$entry", null)
        val files = art.list("$dir/$entry").filter { it.endsWith(".png") }
        if (files.isEmpty()) return null
        val label = colour.label.takeIf { it != "original" } ?: colourOf(colour.rel.substringAfterLast('/'))
        files.firstOrNull { colourOf(it) == label }?.let { return layer(art, "$dir/$entry/$it", null) }
        val source = SOURCES.firstNotNullOfOrNull { s -> files.firstOrNull { colourOf(it) == s } } ?: files[0]
        return layer(art, "$dir/$entry/$source", label)
    }

    /** [look]'s trainer picture ("front": 80x80, "back": the throw's five 87x98 frames side by side). */
    fun picture(art: Art, look: JSONObject, which: String, requireAllLayers: Boolean = false): Img? {
        val gender = look.optString("gender", "m")
        val root = "trainer $which ${if (gender == "f") "female" else "male"}"
        val skin = look.optString("skin", "light")
        val base = art.list("$root/base").firstOrNull { skin in words(it) }?.let { layer(art, "$root/base/$it", null) } ?: return null
        val slots = if (which == "front") listOf("bottom" to "bottoms", "top" to "tops", "hair" to "hair", "hat" to "hats")
        else listOf("top" to "clothing", "hair" to "hair", "hat" to "hat")
        val dirs = art.list(root)
        val layers = mutableListOf(base)
        for ((slot, folder) in slots) {
            val (style, colour) = pick(art, look, slot, SLOTS.first { it.first == slot }.second, gender) ?: continue
            val sub = dirs.firstOrNull { it.equals(folder, ignoreCase = true) }
            // Hair is numbered the same in both ("Short 2" / "Long 2" -> "hair 2").
            val name = if (slot == "hair") "hair " + style.filter { it.isDigit() } else style
            val part = sub?.let { pictureLayer(art, "$root/$it", name, colour) }
            if (part != null) layers += part
            else if (requireAllLayers) return null
        }
        return stack(base.w, base.h, layers)
    }

    /** Fits the whole figure inside the hub card. Styles without front art use the dressed overworld sprite. */
    internal fun hubFrontPic(art: Art, look: JSONObject): Pair<ByteArray, ByteArray>? {
        val front = picture(art, look, "front", requireAllLayers = true)
        val portrait = front ?: cut(canvas(art, look, "walk"), 128, 0, 0, 32, 32).let { Img(it.w, it.h, it.px) }
        val frame = fitCardPortrait(portrait, if (front == null) 2f else 1f) ?: return null
        val palette = quantise(frame.px.toList(), 15)
        return tiles(frame, palette) to palette.bytes
    }

    private fun fitCardPortrait(portrait: Img, maxScale: Float): Frame? {
        var left = portrait.w
        var top = portrait.h
        var right = -1
        var bottom = -1
        for (y in 0 until portrait.h) for (x in 0 until portrait.w) {
            if (portrait.px[y * portrait.w + x] ushr 24 < 128) continue
            left = minOf(left, x)
            top = minOf(top, y)
            right = maxOf(right, x)
            bottom = maxOf(bottom, y)
        }
        if (right < left) return null

        val width = right - left + 1
        val height = bottom - top + 1
        // FireRed can show 59 columns of a 64x64 portrait. Leave room at the right and at the feet.
        val scale = minOf(maxScale, 58f / width, 62f / height)
        val fittedWidth = (width * scale + 0.5f).toInt().coerceIn(1, 58)
        val fittedHeight = (height * scale + 0.5f).toInt().coerceIn(1, 62)
        val xOffset = (58 - fittedWidth) / 2
        val yOffset = 62 - fittedHeight
        val pixels = IntArray(64 * 64)
        for (y in 0 until fittedHeight) for (x in 0 until fittedWidth) {
            val sourceX = left + (2 * x + 1) * width / (2 * fittedWidth)
            val sourceY = top + (2 * y + 1) * height / (2 * fittedHeight)
            val pixel = portrait.px[sourceY * portrait.w + sourceX]
            if (pixel ushr 24 >= 128) pixels[(yOffset + y) * 64 + xOffset + x] = pixel
        }
        return Frame(64, 64, pixels)
    }

    /** character.gd's _tint: coloured pixels to the tint's hue, their saturation and brightness scaled. */
    private fun tint(image: IntArray, t: Tint): IntArray = IntArray(image.size) { i ->
        val c = image[i]
        val a = c ushr 24
        val r = ((c shr 16) and 255) / 255f; val g = ((c shr 8) and 255) / 255f; val b = (c and 255) / 255f
        val max = maxOf(r, g, b); val min = minOf(r, g, b); val d = max - min
        val s = if (max == 0f) 0f else d / max
        if (a == 0 || s < 0.18f || max < 0.18f) return@IntArray c
        var h = when {
            d == 0f -> 0f
            max == r -> ((g - b) / d) / 6f
            max == g -> (2f + (b - r) / d) / 6f
            else -> (4f + (r - g) / d) / 6f
        }
        if (h < 0f) h += 1f
        if (t.hue >= 0f) h = t.hue
        (a shl 24) or hsv(h, (s * t.sat).coerceIn(0f, 1f), (max * t.value).coerceIn(0f, 1f))
    }

    private fun hsv(h: Float, s: Float, v: Float): Int {
        val h6 = (h * 6f) % 6f
        val i = h6.toInt()
        val f = h6 - i
        val p = v * (1 - s); val q = v * (1 - s * f); val t = v * (1 - s * (1 - f))
        val (r, g, b) = when (i) { 0 -> Triple(v, t, p); 1 -> Triple(q, v, p); 2 -> Triple(p, v, t); 3 -> Triple(p, q, v); 4 -> Triple(t, p, v); else -> Triple(v, p, q) }
        fun c8(x: Float) = (x * 255f + 0.5f).toInt().coerceIn(0, 255)
        return (c8(r) shl 16) or (c8(g) shl 8) or c8(b)
    }

    /** [src] over [dst] (Image.blend_rect). */
    private fun over(src: Int, dst: Int): Int {
        val sa = src ushr 24
        if (sa == 255 || dst ushr 24 == 0) return if (sa == 0) dst else src
        if (sa == 0) return dst
        val da = dst ushr 24
        val oa = sa + da * (255 - sa) / 255
        fun ch(sh: Int) = (((src shr sh) and 255) * sa + ((dst shr sh) and 255) * da * (255 - sa) / 255) / oa
        return (oa shl 24) or (ch(16) shl 16) or (ch(8) shl 8) or ch(0)
    }

    // --- into Emerald's sprite set ---

    /** A frame cut from an image: [w] x [h] ARGB, alpha either 0 or 255. */
    private class Frame(val w: Int, val h: Int, val px: IntArray)

    private fun cut(src: IntArray, srcW: Int, x0: Int, y0: Int, w: Int, h: Int) = Frame(w, h, IntArray(w * h) { i ->
        val x = x0 + i % w; val y = y0 + i / w
        if (x < 0 || y < 0 || x >= srcW || y * srcW + x >= src.size) 0 else src[y * srcW + x].let { if (it ushr 24 >= 128) it or (0xFF shl 24) else 0 }
    })

    /** The x window of [w] columns in [boxW]-wide cells that loses the fewest of the cells' pixels. */
    private fun window(cells: List<(Int, Int) -> Boolean>, boxW: Int, boxH: Int, w: Int) = (0..boxW - w).minBy { x0 ->
        cells.sumOf { op -> (0 until boxH).sumOf { y -> (0 until boxW).count { x -> (x < x0 || x >= x0 + w) && op(x, y) } } }
    }

    /** [f] moved [dy] pixels down (rows from above the top come in empty). */
    private fun lower(f: Frame, dy: Int) = Frame(f.w, f.h, IntArray(f.w * f.h) { i -> val y = i / f.w - dy; if (y < 0 || y >= f.h) 0 else f.px[y * f.w + i % f.w] })

    /** A 16-wide frame centred in a 32-wide one. */
    private fun wide(f: Frame) = Frame(32, f.h, IntArray(32 * f.h) { i -> val x = i % 32 - 8; if (x < 0 || x >= 16) 0 else f.px[(i / 32) * 16 + x] })

    /** Surfing: the standing frame with its legs cut off, sat down onto the blob. */
    private fun seated(f: Frame): Frame {
        val bottom = (f.h - 1 downTo 0).firstOrNull { y -> (0 until f.w).any { f.px[y * f.w + it] != 0 } } ?: return f
        val cut = Frame(f.w, f.h, IntArray(f.px.size) { i -> if (i / f.w > bottom - 8) 0 else f.px[i] })
        return lower(cut, 5)
    }

    /** The look as a hero in Emerald's sprite set ([LookPart] -> raw 4bpp, in its own two palettes: [LookPart.OW_PAL]
     * for the overworld, [LookPart.FRONT_PAL] / [LookPart.BACK_PAL] for the pictures); null with no art. [shared]: the
     * colours the game keeps in the hero's slot ([sharedColours]), which the overworld frames may use as they are. */
    fun hero(art: Art, look: JSONObject, shared: List<Int> = emptyList()): Map<LookPart, ByteArray>? {
        val walk = canvas(art, look, "walk")
        if (walk.none { it ushr 24 != 0 }) return null
        val run = canvas(art, look, "run")
        val bike = canvas(art, look, "bike")
        // Emerald's nine: down, up, left standing, then down, up and left's two steps (the art: rows down 0, left 1, up 3;
        // columns stand 0, steps 1 and 3). The games draw right as left mirrored.
        val order = listOf(0 to 0, 3 to 0, 1 to 0, 0 to 1, 0 to 3, 3 to 1, 3 to 3, 1 to 1, 1 to 3)
        fun opaque(c: IntArray, r: Int, col: Int) = { x: Int, y: Int -> c[(r * 32 + y) * 128 + col * 32 + x] ushr 24 >= 128 }
        val cells = listOf(walk, run).flatMap { c -> order.map { (r, col) -> opaque(c, r, col) } }
        val x0 = window(cells, 32, 32, 16)
        val bottom = cells.maxOf { op -> (31 downTo 0).firstOrNull { y -> (0 until 32).any { op(it, y) } } ?: 0 }
        fun narrow(c: IntArray, r: Int, col: Int) = lower(cut(c, 128, col * 32 + x0, r * 32, 16, 32), 31 - bottom)
        val walking = order.map { (r, col) -> narrow(walk, r, col) }
        val running = order.map { (r, col) -> narrow(run, r, col) }
        val riding = order.map { (r, col) -> cut(bike, 128, col * 32, r * 32, 32, 32) }.takeIf { _ -> bike.any { it ushr 24 != 0 } }
            ?: walking.map(::wide)
        val stand = walking.take(3)   // down, up, left
        val sheets = linkedMapOf(
            LookPart.EM_WALKING to walking,
            LookPart.EM_RUNNING to running,
            LookPart.EM_MACH_BIKE to riding,
            // Wheelies and hops: the riding frame facing the same way (FireRed's heroes are worn so too).
            LookPart.EM_ACRO_BIKE to (riding + listOf(0, 3, 0, 4, 1, 5, 1, 6, 2, 7, 2, 8, 3, 4, 5, 6, 7, 8).map { riding[it] }),
            LookPart.EM_SURFING to listOf(0, 0, 1, 1, 2, 2).map { wide(seated(stand[it])) },
            LookPart.EM_FIELD_MOVE to listOf(0, 0, 0, 0, 0).map { wide(stand[it]) },
            LookPart.EM_FISHING to listOf(0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2).map { wide(stand[it]) },
            LookPart.EM_WATERING to listOf(0, 0, 1, 1, 2, 2).map { wide(stand[it]) },
            LookPart.EM_DECORATING to listOf(stand[0]),
        )
        val out = LinkedHashMap<LookPart, ByteArray>()
        // The overworld's colours: at most 10, the hero's slot's free ones (PlayerLook.wearWith places them).
        val owPal = quantise(sheets.values.flatten().flatMap { it.px.toList() }, 10, shared)
        for ((part, frames) in sheets) out[part] = frames.fold(ByteArray(0)) { a, f -> a + tiles(f, owPal) }
        out[LookPart.OW_PAL] = owPal.bytes
        out[LookPart.OW_REFLECTION_PAL] = PlayerLook.reflect(owPal.bytes)

        // The pictures: 64x64, the window keeping the most of the figure, feet on the bottom row.
        val pics = ArrayList<Frame>()
        picture(art, look, "back")?.let { b ->
            val cw = b.w / 5
            val ops = (0 until 5).map { k -> { x: Int, y: Int -> b.px[y * b.w + k * cw + x] ushr 24 >= 128 } }
            val bx = window(ops, cw, b.h, 64)
            val bb = ops.maxOf { op -> (b.h - 1 downTo 0).firstOrNull { y -> (0 until cw).any { op(it, y) } } ?: 0 }
            val throwing = (0 until 5).map { k -> cut(b.px, b.w, k * cw + bx, bb - 63, 64, 64) }
            // Emerald's four: ready, wind-up, throw, standing; the art's five stand, then throw (as FireRed's).
            pics += listOf(1, 2, 3, 0).map { throwing[it] }
        }
        val front = picture(art, look, "front")?.let { f ->
            val op = { x: Int, y: Int -> f.px[y * f.w + x] ushr 24 >= 128 }
            val fx = window(listOf(op), f.w, f.h, 64)
            val fb = (f.h - 1 downTo 0).firstOrNull { y -> (0 until f.w).any { op(it, y) } } ?: (f.h - 1)
            cut(f.px, f.w, fx, fb - 63, 64, 64)
        }
        val picPal = quantise((pics + listOfNotNull(front)).flatMap { it.px.toList() }, 15)
        if (pics.size == 4) out[LookPart.BACK] = pics.fold(ByteArray(0)) { a, f -> a + tiles(f, picPal) }
        if (front != null) out[LookPart.FRONT] = tiles(front, picPal)
        if (pics.size == 4 || front != null) {
            out[LookPart.BACK_PAL] = picPal.bytes
            out[LookPart.FRONT_PAL] = picPal.bytes
        }
        return out
    }

    /** A palette for these pixels (+ see-through 0): [n] colours of their own plus any of [fixed] (the colours the
     * game keeps in the hero's slot - a pixel may take one of those as is), the two closest colours merged until they
     * fit. Closest by colour alone, so a small patch of its own colour (a hand's skin) isn't swallowed by a big one. */
    private class Pal(val bytes: ByteArray, val index: Map<Int, Int>)

    private class Group(val members: MutableList<Int>, var count: Int, val fixed: Int? = null) {
        fun centre(counts: Map<Int, Int>) = fixed ?: members.maxBy { counts[it] ?: 0 }
    }

    private fun quantise(px: List<Int>, n: Int, fixed: List<Int> = emptyList()): Pal {
        val counts = HashMap<Int, Int>()
        px.forEach { if (it ushr 24 != 0) counts.merge(bgr(it), 1, Int::plus) }
        val groups = fixed.distinct().map { Group(mutableListOf(), 0, it) }.toMutableList()
        for ((c, k) in counts) {
            val anchor = groups.firstOrNull { it.fixed == c }
            if (anchor != null) { anchor.members += c; anchor.count += k } else groups += Group(mutableListOf(c), k)
        }
        while (groups.count { it.fixed == null } > n) {
            var bi = 0; var bj = 1; var bd = Int.MAX_VALUE
            for (i in groups.indices) for (j in i + 1 until groups.size) {
                if (groups[i].fixed != null && groups[j].fixed != null) continue
                val d = dist(groups[i].centre(counts), groups[j].centre(counts))
                if (d < bd) { bd = d; bi = i; bj = j }
            }
            // Into the fixed one, else into the bigger.
            val (keep, drop) = listOf(groups[bi], groups[bj]).sortedWith(compareBy<Group> { it.fixed == null }.thenByDescending { it.count }).let { it[0] to it[1] }
            keep.members += drop.members; keep.count += drop.count
            groups.remove(drop)
        }
        val bytes = ByteArray(32)
        val index = HashMap<Int, Int>()
        groups.filter { it.members.isNotEmpty() }.sortedByDescending { it.count }.take(15).forEachIndexed { i, g ->
            val c = g.centre(counts)
            bytes[(i + 1) * 2] = c.toByte(); bytes[(i + 1) * 2 + 1] = (c shr 8).toByte()
            g.members.forEach { index[it] = i + 1 }
        }
        return Pal(bytes, index)
    }

    /** [f] as 4bpp tiles in reading order through [pal]. */
    private fun tiles(f: Frame, pal: Pal): ByteArray {
        val tw = f.w / 8
        val out = ByteArray(f.w * f.h / 2)
        for (y in 0 until f.h) for (x in 0 until f.w) {
            val c = f.px[y * f.w + x]
            val v = if (c ushr 24 == 0) 0 else pal.index[bgr(c)] ?: 0
            val o = ((y / 8) * tw + x / 8) * 32 + (y % 8) * 4 + (x % 8) / 2
            out[o] = (out[o].toInt() or (v shl if (x and 1 != 0) 4 else 0)).toByte()
        }
        return out
    }

    private fun bgr(argb: Int) = ((argb shr 19) and 31) or (((argb shr 11) and 31) shl 5) or (((argb shr 3) and 31) shl 10)
    /** How far apart two BGR555 colours look: brightness, and hue counted as much (navy and dark grey are near in
     * brightness, but merging them turns a navy shirt grey: shades of one colour merge first). */
    internal fun dist(a: Int, b: Int): Int {
        fun f(c: Int): Triple<Float, Float, Float> {
            val r = (c and 31).toFloat(); val g = ((c shr 5) and 31).toFloat(); val bl = ((c shr 10) and 31).toFloat()
            return Triple(r * 0.3f + g * 0.59f + bl * 0.11f, r - g, bl - (r + g) / 2)
        }
        val (l1, x1, y1) = f(a); val (l2, x2, y2) = f(b)
        return ((l1 - l2) * (l1 - l2) * 4 + ((x1 - x2) * (x1 - x2) + (y1 - y2) * (y1 - y2)) * 3).toInt()
    }

    // --- 32x32 walking and running ---

    /** Walking and running as drawn, 32x32 (Emerald's nine each, [hero]'s order and feet line), in [hero]'s overworld
     * colours (each pixel the nearest of the ones its sheets use: the 16 columns [hero] keeps have exactly those). */
    fun wideFrames(art: Art, look: JSONObject, hero: Map<LookPart, ByteArray>): Pair<List<ByteArray>, List<ByteArray>>? {
        val owPal = hero[LookPart.OW_PAL] ?: return null
        val walk = canvas(art, look, "walk")
        if (walk.none { it ushr 24 != 0 }) return null
        val run = canvas(art, look, "run")
        val order = listOf(0 to 0, 3 to 0, 1 to 0, 0 to 1, 0 to 3, 3 to 1, 3 to 3, 1 to 1, 1 to 3)
        fun opaque(c: IntArray, r: Int, col: Int) = { x: Int, y: Int -> c[(r * 32 + y) * 128 + col * 32 + x] ushr 24 >= 128 }
        val cells = listOf(walk, run).flatMap { c -> order.map { (r, col) -> opaque(c, r, col) } }
        val bottom = cells.maxOf { op -> (31 downTo 0).firstOrNull { y -> (0 until 32).any { op(it, y) } } ?: 0 }
        val used = HashSet<Int>()
        listOf(LookPart.EM_WALKING, LookPart.EM_RUNNING).forEach { p -> hero[p]?.forEach { b -> used += b.toInt() and 15; used += (b.toInt() shr 4) and 15 } }
        used -= 0
        if (used.isEmpty()) return null
        fun colour(i: Int) = (owPal[i * 2].toInt() and 0xFF) or ((owPal[i * 2 + 1].toInt() and 0xFF) shl 8)
        val index = HashMap<Int, Int>()
        fun nearest(c: Int) = index.getOrPut(c) { used.minBy { dist(colour(it), c) } }
        fun frame(c: IntArray, r: Int, col: Int): ByteArray {
            val f = lower(cut(c, 128, col * 32, r * 32, 32, 32), 31 - bottom)
            val out = ByteArray(512)
            for (y in 0 until 32) for (x in 0 until 32) {
                val p = f.px[y * 32 + x]
                val v = if (p ushr 24 == 0) 0 else nearest(bgr(p))
                val o = ((y / 8) * 4 + x / 8) * 32 + (y % 8) * 4 + (x % 8) / 2
                out[o] = (out[o].toInt() or (v shl if (x and 1 != 0) 4 else 0)).toByte()
            }
            return out
        }
        return order.map { (r, col) -> frame(walk, r, col) } to order.map { (r, col) -> frame(run, r, col) }
    }

    /**
     * Writes making [me]'s walking / running records 32x32 (PlayerLook's way for a Pokémon look): each record whose
     * frame table points into the hero's walking and running sheets gets a new table in the tail from [tail] over
     * [walk] / [run] (remapped through [map] into the slot), the size and shape of the hero's own 32x32 record (a
     * bike's: its OAM and subsprite tables). Empty if none is found.
     */
    private fun wideRecords(scan: PlayerLook.Scan, me: LookChar, walk: List<ByteArray>, run: List<ByteArray>, map: IntArray, tail: Int): List<Pair<Int, ByteArray>> {
        val rom = scan.rom
        val buf = java.nio.ByteBuffer.wrap(rom).order(java.nio.ByteOrder.LITTLE_ENDIAN)
        fun u16(o: Int) = buf.getShort(o).toInt() and 0xFFFF
        fun u32(o: Int) = buf.getInt(o)
        fun word(v: Int) = java.nio.ByteBuffer.allocate(4).order(java.nio.ByteOrder.LITTLE_ENDIAN).putInt(v).array()
        val parts = when (me.engine) {
            com.pokedaisy.app.companion.data.LookEngine.EMERALD -> listOf(LookPart.EM_WALKING, LookPart.EM_RUNNING)
            com.pokedaisy.app.companion.data.LookEngine.RUBY -> listOf(LookPart.RS_NORMAL)
            com.pokedaisy.app.companion.data.LookEngine.FIRERED -> listOf(LookPart.FR_NORMAL, LookPart.FR_SURF_RUN)
            else -> return emptyList()
        }
        val frames = walk + run   // 0-8 walking, 9-17 running
        val frRun = listOf(0, 3, 4, 1, 5, 6, 2, 7, 8)
        /** The 32x32 frame (index into [frames]) for the hero's sheet frame at ROM offset [a]; null if not one. */
        fun frameAt(a: Int): Int? {
            for (p in parts) for (h in scan.hitsOf(me, p)) {
                val size = PlayerLook.blob(me, p)?.size ?: continue
                if (a < h || a >= h + size || (a - h) % 256 != 0) continue
                val i = (a - h) / 256
                return when (p) {
                    LookPart.EM_WALKING, LookPart.FR_NORMAL -> i.takeIf { it < 9 }
                    LookPart.EM_RUNNING -> (9 + i).takeIf { i < 9 }
                    LookPart.RS_NORMAL -> i.takeIf { it < 18 }
                    LookPart.FR_SURF_RUN -> when (i) { in 3..11 -> 9 + frRun[i - 3]; 12 -> 3; 13 -> 4; else -> null }
                    else -> null
                }
            }
            return null
        }
        // The tables: an entry {ptr, size} pointing at a sheet's first frame, back to the table's first entry.
        val tables = HashSet<Int>()
        for (p in parts) for (h in scan.hitsOf(me, p)) for (ref in scan.refs[h].orEmpty()) {
            if (ref.half0 != 128 && ref.half0 != 256 && ref.half0 != 512) continue
            var t = ref.at
            while (t >= 8 && frameAt(u32(t - 8) - 0x08000000) != null && u16(t - 4) == ref.half0) t -= 8
            tables += t
        }
        if (tables.isEmpty()) return emptyList()
        val records = ArrayList<Pair<Int, Int>>()
        var big: Int? = null
        var o = 0x1C
        while (o + 8 <= rom.size) {
            val r = o - 0x1C
            if (u16(r) == 0xFFFF) {
                val t = u32(o) - 0x08000000
                if (t in tables) records += r to t
                else if (big == null && u16(r + 2) == me.owTag && u16(r + 8) == 32 && u16(r + 10) == 32) big = r
            }
            o += 4
        }
        val shape = big ?: return emptyList()
        if (records.isEmpty()) return emptyList()
        val writes = ArrayList<Pair<Int, ByteArray>>()
        var free = tail
        val frameOff = IntArray(frames.size) { i ->
            val at = free
            writes += at to PlayerLook.remap(frames[i], map)
            free += 512
            at
        }
        val oam = rom.copyOfRange(shape + 0x10, shape + 0x18)
        for ((r, t) in records) {
            val size = u16(t + 4)
            var n = 0
            while (t + n * 8 + 8 <= rom.size && u16(t + n * 8 + 4) == size && frameAt(u32(t + n * 8) - 0x08000000) != null) n++
            if (n == 0) continue
            val table = ByteArray(n * 8)
            for (i in 0 until n) {
                word(0x08000000 + frameOff[frameAt(u32(t + i * 8) - 0x08000000)!!]).copyInto(table, i * 8)
                table[i * 8 + 4] = 0x00; table[i * 8 + 5] = 0x02   // 512 bytes
            }
            if (free + table.size > rom.size) return emptyList()
            writes += free to table
            writes += (r + 6) to byteArrayOf(0x00, 0x02, 32, 0, 32, 0)
            writes += (r + 0x10) to oam
            writes += (r + 0x1C) to word(0x08000000 + free)
            free = (free + table.size + 3) and 3.inv()
        }
        return writes
    }

    /** The picker's tile: facing down standing, then its two steps, cropped to the pixels they use. */
    fun walk(context: Context): List<RomArt.Image>? {
        val look = saved(context.filesDir) ?: return null
        val hero = hero(apkArt(context), look) ?: return null
        val sheet = hero[LookPart.EM_WALKING] ?: return null
        val pal = RomArt.palette(hero[LookPart.OW_PAL] ?: return null)
        val three = listOf(0, 3, 4).map { RomArt.sprite(sheet.copyOfRange(it * 256, it * 256 + 256), pal, 16, 32) }
        fun used(x: Int, y: Int) = three.any { it.argb[y * 16 + x] != 0 }
        val top = (0 until 32).firstOrNull { y -> (0 until 16).any { used(it, y) } } ?: return null
        val left = (0 until 16).first { x -> (top until 32).any { used(x, it) } }
        val right = (15 downTo 0).first { x -> (top until 32).any { used(x, it) } }
        return three.map { src ->
            RomArt.Image(right - left + 1, 32 - top).also { img ->
                for (y in top until 32) for (x in left..right) img.argb[(y - top) * img.width + x - left] = src.argb[y * 16 + x]
            }
        }
    }

    /**
     * The patch dressing [me] (the hero of the game [scan] was made from) as the creator's look ([hero]): PLAYER LOOK's
     * own, worn as a Heart and Soul hero is (Emerald's sprite set, never [me]'s engine). Null if the ROM isn't one
     * PLAYER LOOK can dress up. [known]: the kept heroes, whose palettes a state may have loaded.
     */
    fun build(
        scan: PlayerLook.Scan, me: LookChar, hero: Map<LookPart, ByteArray>, known: Map<LookChar, Map<LookPart, ByteArray>> = emptyMap(),
        /** [wideFrames]: walking and running as drawn, the hero's records made 32x32 over them ([wideRecords]). */
        wide: Pair<List<ByteArray>, List<ByteArray>>? = null,
    ): PlayerLook.Patch? {
        val patch = PlayerLook.build(scan, me, LookChar.GOLD, hero, known) ?: return null
        if (wide == null) return patch
        val worn = PlayerLook.wear(me, LookChar.GOLD, hero) { scan.data(me, it) } ?: return patch
        // The tail past what the patch put there.
        val tail = maxOf((scan.free + 0x103) and 3.inv(), patch.blocks.maxOfOrNull { it.off + it.data.size } ?: 0).let { (it + 3) and 3.inv() }
        val extra = wideRecords(scan, me, wide.first, wide.second, worn.map, tail)
        if (extra.isEmpty()) return patch
        return PlayerLook.Patch(PlayerLook.merge(scan.rom, patch.blocks.map { it.off to it.data } + extra), patch.palettes, patch.playerPal)
    }

    /** [build] from the creator's saved look and the APK's art; null with no look saved or no art in the APK. */
    fun build(context: Context, scan: PlayerLook.Scan, me: LookChar, known: Map<LookChar, Map<LookPart, ByteArray>>): PlayerLook.Patch? {
        val look = saved(context.filesDir) ?: return null
        val art = apkArt(context)
        val hero = hero(art, look, sharedColours(scan, me)) ?: return null
        keep(context.filesDir, hero)
        return build(scan, me, hero, known, wideFrames(art, look, hero))
    }

    /** The colours [me]'s palette slot keeps for the surf blob, shadows and arrows ([LOOK_SHARED_COLOURS]), BGR555. */
    fun sharedColours(scan: PlayerLook.Scan, me: LookChar): List<Int> {
        val pal = scan.data(me, LookPart.OW_PAL) ?: return emptyList()
        return com.pokedaisy.app.companion.data.LOOK_SHARED_COLOURS[me.engine].orEmpty()
            .map { (pal[it * 2].toInt() and 0xFF) or ((pal[it * 2 + 1].toInt() and 0xFF) shl 8) }
    }
}
