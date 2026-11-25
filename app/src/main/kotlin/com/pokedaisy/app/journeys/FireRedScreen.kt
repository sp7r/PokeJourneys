package com.pokedaisy.app.journeys

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Rect
import android.graphics.RectF
import android.graphics.Typeface
import android.view.MotionEvent
import android.view.View
import java.io.File
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min

/**
 * A FireRed-style screen at the GBA's 240x160, scaled by whole pixels like the hub's windows (hub/victory/scripts/
 * gba_frame.gd): a menu window at the top (title, lines, a progress bar) and FireRed's message box at the bottom,
 * with the blinking arrow when it waits for A. The art and font are the player's own, from the hub data's
 * ui/firered (made from their FireRed cartridge in the build's second step); until they exist the same layout is
 * drawn with plain windows.
 */
class FireRedScreen(context: Context, private val ui: File) : View(context) {

    var title = ""; set(v) { field = v; invalidate() }
    var lines: List<String> = emptyList(); set(v) { field = v; invalidate() }
    /** 0..1, or null for no bar. */
    var progress: Float? = null; set(v) { field = v; invalidate() }
    var message = ""; set(v) { field = v; invalidate() }
    /** Shown as the blinking arrow: what A (or a tap) does. */
    var onA: (() -> Unit)? = null; set(v) { field = v; invalidate() }
    var onB: (() -> Unit)? = null
    class Option(val label: String, val detail: String? = null, val enabled: Boolean = true, val action: () -> Unit)
    var options: List<Option> = emptyList(); set(v) { field = v; selection = 0; optionOffset = 0; invalidate() }
    var selection = 0; private set
    private var optionOffset = 0
    private val optionBounds = mutableListOf<Pair<Int, RectF>>()
    private var touchStartY = 0f

    fun moveSelection(delta: Int) {
        if (options.isEmpty()) return
        selection = (selection + delta).coerceIn(0, options.lastIndex)
        invalidate()
    }

    fun answer() {
        if (options.isEmpty()) onA?.invoke() else options.getOrNull(selection)?.takeIf { it.enabled }?.action?.invoke()
    }

    /** Wrapped body text, including long file names, for pages that must be readable in full. */
    fun wrapLines(value: String): List<String> = wrap(value, 208f)

    private class Glyph(val src: Rect, val xoffset: Int, val yoffset: Int, val advance: Int)
    private class Art(val font: Bitmap, val glyphs: Map<Int, Glyph>, val menu: Bitmap, val sheet: Bitmap, val arrow: Bitmap)
    private var art: Art? = null
    private val pixels = Paint().apply { isFilterBitmap = false; isAntiAlias = false }
    private val fill = Paint()
    private val plain = Paint().apply { isAntiAlias = true; typeface = Typeface.MONOSPACE; textSize = 11f; color = Color.rgb(64, 64, 72) }

    init { setBackgroundColor(Color.BLACK); isFocusable = true; reload() }

    /** Picks up the FireRed art once the build has made it. */
    fun reload() {
        if (art != null) return
        art = runCatching {
            val fnt = File(ui, "font.fnt"); if (!fnt.exists()) return
            val glyphs = HashMap<Int, Glyph>()
            for (line in fnt.readLines()) if (line.startsWith("char ")) {
                val f = Regex("(\\w+)=(-?\\d+)").findAll(line).associate { it.groupValues[1] to it.groupValues[2].toInt() }
                val x = f.getValue("x"); val y = f.getValue("y")
                glyphs[f.getValue("id")] = Glyph(Rect(x, y, x + f.getValue("width"), y + f.getValue("height")), f["xoffset"] ?: 0, f["yoffset"] ?: 0, f.getValue("xadvance"))
            }
            fun png(name: String) = BitmapFactory.decodeFile(File(ui, "$name.png").path) ?: error("no $name.png")
            Art(png("font"), glyphs, png("menu"), png("message-sheet"), png("arrow"))
        }.getOrNull()
        invalidate()
    }

    override fun onTouchEvent(event: MotionEvent): Boolean {
        if (event.action == MotionEvent.ACTION_DOWN) touchStartY = event.y
        if (event.action == MotionEvent.ACTION_UP) {
            val scale = screenScale()
            val drag = (touchStartY - event.y) / scale
            if (options.isNotEmpty() && kotlin.math.abs(drag) > 12f) {
                moveSelection(if (drag > 0) 1 else -1)
                performClick()
                return true
            }
            val x = (event.x - floor((width - 240 * scale) / 2)) / scale
            val y = (event.y - floor((height - 160 * scale) / 2)) / scale
            if (options.isNotEmpty()) {
                optionBounds.firstOrNull { it.second.contains(x, y) }?.let { (index, _) ->
                    selection = index; invalidate(); answer()
                }
                if (y in 112f..160f) { if (x < 120f) onB?.invoke() else answer() }
            } else if (x in 0f..240f && y in 0f..160f) {
                if (onB != null && y >= 112f && x < 120f) onB?.invoke() else answer()
            }
            performClick()
        }
        return true
    }
    override fun performClick(): Boolean = super.performClick()

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        val scale = screenScale()
        canvas.save()
        canvas.translate(floor((width - 240 * scale) / 2), floor((height - 160 * scale) / 2))
        canvas.scale(scale, scale)
        // the top window grows with its lines; the message box is FireRed's, 30 tiles by 6
        val bar = progress
        val body = 16 * (1 + lines.size) + if (bar != null) 16 else 0
        val top = RectF(8f, 8f, 232f, if (options.isNotEmpty()) 104f else min(104f, 8f + 16 + body))
        window(canvas, top)
        var y = top.top + 8
        text(canvas, title, top.left + 8, y, top.width() - 16); y += 16
        if (bar != null) { progressBar(canvas, top.left + 8, y + 4, top.width() - 16, bar); y += 16 }
        for (line in lines) { if (y + 16 > top.bottom - 4) break; text(canvas, line, top.left + 8, y, top.width() - 16); y += 16 }
        optionBounds.clear()
        if (options.isNotEmpty()) {
            fun rowHeight(index: Int) = if (options[index].detail == null) 16f else 32f
            optionOffset = optionOffset.coerceAtMost(selection)
            while ((optionOffset..selection).sumOf { rowHeight(it).toDouble() } > top.bottom - 4 - y) optionOffset++
            for (index in optionOffset..options.lastIndex) {
                val h = rowHeight(index)
                if (y + h > top.bottom - 4) break
                val option = options[index]
                optionBounds += index to RectF(top.left, y, top.right, y + h)
                pixels.alpha = if (option.enabled) 255 else 100
                plain.alpha = pixels.alpha
                text(canvas, if (index == selection) ">" else "", 16f, y, 8f)
                text(canvas, option.label, 28f, y, 192f)
                option.detail?.let { text(canvas, it, 28f, y + 16, 192f) }
                pixels.alpha = 255; plain.alpha = 255
                y += h
            }
            if (optionOffset > 0) text(canvas, "^", 222f, 16f, 8f)
            if (optionBounds.lastOrNull()?.first != options.lastIndex) text(canvas, "v", 222f, 88f, 8f)
        }
        dialogue(canvas, 112f)
        val wrapped = wrap(message, 208f).take(2)
        wrapped.forEachIndexed { i, line -> text(canvas, line, 16f, 120f + i * 16, 208f) }
        if (onA != null) {
            val bob = if ((System.currentTimeMillis() / 300) % 2 == 0L) 0f else 1f
            val at = 16f + (wrapped.lastOrNull()?.let { measure(it) } ?: 0f) + 2
            val ay = 120f + (wrapped.size - 1).coerceAtLeast(0) * 16 + bob
            art?.let { canvas.drawBitmap(it.arrow, at, ay, pixels) } ?: run { fill.color = Color.rgb(224, 8, 8); canvas.drawRect(at + 2, ay + 5, at + 8, ay + 9, fill) }
            postInvalidateDelayed(150)
        }
        canvas.restore()
    }

    private fun screenScale() = max(1, floor(min(width / 240f, height / 160f)).toInt()).toFloat()

    /** gba_frame.gd's menu: menu.png as a nine-slice with 8-pixel borders, the edges and middle tiled. */
    private fun window(canvas: Canvas, r: RectF) {
        val a = art
        if (a == null) {
            fill.color = Color.rgb(99, 99, 99); canvas.drawRect(r, fill)
            fill.color = Color.WHITE; canvas.drawRect(r.left + 2, r.top + 2, r.right - 2, r.bottom - 2, fill); return
        }
        val l = r.left.toInt(); val t = r.top.toInt(); val rr = r.right.toInt(); val b = r.bottom.toInt()
        fun part(sx: Int, sy: Int, dx: Int, dy: Int, w: Int, h: Int) = canvas.drawBitmap(a.menu, Rect(sx, sy, sx + w, sy + h), Rect(dx, dy, dx + w, dy + h), pixels)
        var x = l + 8
        while (x < rr - 8) { val w = min(8, rr - 8 - x); part(8, 0, x, t, w, 8); part(8, 16, x, b - 8, w, 8)
            var yy = t + 8; while (yy < b - 8) { part(8, 8, x, yy, w, min(8, b - 8 - yy)); yy += 8 }; x += 8 }
        var yy = t + 8
        while (yy < b - 8) { val h = min(8, b - 8 - yy); part(0, 8, l, yy, 8, h); part(16, 8, rr - 8, yy, 8, h); yy += 8 }
        part(0, 0, l, t, 8, 8); part(16, 0, rr - 8, t, 8, 8); part(0, 16, l, b - 8, 8, 8); part(16, 16, rr - 8, b - 8, 8, 8)
    }

    /** gba_frame.gd's dialogue: the message box from message-sheet's 8x8 tiles, the lower half mirrored. */
    private fun dialogue(canvas: Canvas, at: Float) {
        val a = art
        if (a == null) { window(canvas, RectF(0f, at, 240f, at + 48)); return }
        val columns = 30
        for (y in 0 until 6) for (x in 0 until columns) {
            val tile = if (y == 0 || y == 5) when (x) { 0 -> 0; 1 -> 1; columns - 1 -> 4; columns - 2 -> 3; else -> 2 } else {
                val left = if (y == 1 || y == 4) 5 else 10; val right = if (y == 1 || y == 4) 8 else 12
                when (x) { 0 -> left; 1 -> left + 1; columns - 1 -> right + 1; columns - 2 -> right; else -> 7 }
            }
            val src = Rect(tile % 5 * 8, tile / 5 * 8, tile % 5 * 8 + 8, tile / 5 * 8 + 8)
            val dst = RectF(x * 8f, at + y * 8, x * 8f + 8, at + y * 8 + 8)
            if (y >= 3) {
                canvas.save(); canvas.scale(1f, -1f, 0f, dst.centerY()); canvas.drawBitmap(a.sheet, src, dst, pixels); canvas.restore()
            } else canvas.drawBitmap(a.sheet, src, dst, pixels)
        }
    }

    private fun progressBar(canvas: Canvas, x: Float, y: Float, w: Float, value: Float) {
        fill.color = Color.rgb(99, 99, 99); canvas.drawRect(x, y, x + w, y + 7, fill)
        fill.color = Color.rgb(214, 214, 206); canvas.drawRect(x + 1, y + 1, x + w - 1, y + 6, fill)
        val filled = (w - 2) * value.coerceIn(0f, 1f)
        fill.color = Color.rgb(33, 156, 8); canvas.drawRect(x + 1, y + 1, x + 1 + filled, y + 6, fill)
        fill.color = Color.rgb(148, 247, 148); canvas.drawRect(x + 1, y + 1, x + 1 + filled, y + 3, fill)
    }

    private fun measure(s: String): Float {
        val a = art ?: return plain.measureText(s)
        return s.sumOf { (a.glyphs[it.code] ?: a.glyphs['?'.code])?.advance ?: 6 }.toFloat()
    }

    private fun text(canvas: Canvas, value: String, x: Float, y: Float, width: Float) {
        var s = value
        if (measure(s) > width) { while (s.isNotEmpty() && measure("$s…") > width) s = s.dropLast(1); s += "…" }
        val a = art
        if (a == null) { canvas.drawText(s, x, y + 12, plain); return }
        var at = x
        for (c in s) {
            val g = a.glyphs[c.code] ?: a.glyphs['?'.code] ?: run { at += 6; null } ?: continue
            canvas.drawBitmap(a.font, g.src, RectF(at + g.xoffset, y + g.yoffset, at + g.xoffset + g.src.width(), y + g.yoffset + g.src.height()), pixels)
            at += g.advance
        }
    }

    private fun wrap(s: String, width: Float): List<String> {
        val out = ArrayList<String>()
        for (para in s.split('\n')) {
            var line = ""
            for (word in para.split(' ')) {
                val next = if (line.isEmpty()) word else "$line $word"
                if (measure(next) <= width) line = next else {
                    if (line.isNotEmpty()) out += line
                    line = word
                    while (measure(line) > width && line.length > 1) {
                        var end = 1
                        while (end < line.length && measure(line.take(end + 1)) <= width) end++
                        out += line.take(end); line = line.drop(end)
                    }
                }
            }
            out += line
        }
        return out
    }

}
