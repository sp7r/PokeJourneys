package com.pokedaisy.app.journeys

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.graphics.Bitmap
import android.os.BatteryManager
import android.view.View
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.State
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.FilterQuality
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.ComposeView
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import com.pokedaisy.app.CompanionColors
import com.pokedaisy.app.companion.BatteryStatus
import com.pokedaisy.app.companion.DeviceBattery
import com.pokedaisy.app.companion.data.CardStyle
import com.pokedaisy.app.companion.data.RomArt
import com.pokedaisy.app.companion.data.TrainerCardArt
import com.pokedaisy.app.companion.data.TrainerCardInfo
import com.pokedaisy.app.companion.i18n.tk
import com.pokedaisy.app.companion.i18n.tr
import com.pokedaisy.app.companion.ui.AppBackdrop
import com.pokedaisy.app.companion.ui.BatteryIndicator
import com.pokedaisy.app.companion.ui.CompanionScreenSize
import com.pokedaisy.app.companion.ui.GbaText
import com.pokedaisy.app.companion.ui.GbaTextMetrics
import com.pokedaisy.app.companion.ui.OptionButton
import com.pokedaisy.app.companion.ui.OptionColors
import com.pokedaisy.app.companion.ui.OptionListWindow
import com.pokedaisy.app.companion.ui.OptionTitleWindow
import com.pokedaisy.app.companion.ui.PixelIcons
import com.pokedaisy.app.companion.ui.SidePanelHost
import com.pokedaisy.app.companion.ui.SidePanelOpenTab
import com.pokedaisy.app.companion.ui.rememberGbaTextMetrics
import com.pokedaisy.app.companion.ui.theme.AppTheme
import org.json.JSONArray
import java.io.File

/**
 * The companion while the player is on Victory Island ([HubActivity]'s second screen): the trainer's card and the
 * SETTINGS button, in the companion's own windows. With one screen it opens from PokeDaisy's tab at the right edge,
 * as its window over the island. In a game the companion is PokeDaisy's (CompanionScreen), which reads the running
 * game; the island has none, so this one shows what belongs to the trainer.
 *
 * The card is the games' own TRAINER CARD, drawn by PokeDaisy's [TrainerCardArt] from the art it keeps of the player's
 * FireRed (or Emerald) ROM, with the island's trainer on it: the name and picture from the creator, the time played
 * in every journey and the species caught across them. Without that art the same facts show as plain rows.
 */
object HubCompanion {

    /** What the companion shows. [card] is null until a FireRed or Emerald ROM has been scanned. */
    class Trainer(
        val name: String = "",
        val account: String = "",
        val lastJourney: String = "",
        val journeys: Int = 0,
        val caught: Int = 0,
        val hours: Int = 0,
        val minutes: Int = 0,
        val card: ImageBitmap? = null,
        val rank: StadiumRank = StadiumRank(),
        val rankBadge: ImageBitmap? = null,
        /** Shown instead of the card until the island is signed in and has its trainer from the server; "" once it has. */
        val waiting: String = tr("CONNECTING TO THE SERVER..."),
    )

    /** The signed-in account's trainer, read from the app's files. Reads and draws: not for the UI thread. */
    fun trainer(context: Context, waiting: String): Trainer {
        val files = context.filesDir
        val look = CreatorLook.saved(files)
        val account = DiscordSignIn.account(context)
        val stats = TrainerStats.read(context)
        val rank = StadiumRank.read(File(files, "accounts/${DiscordSignIn.accountId(files)}"))
        val badge = StadiumRankBadge.load(HubActivity.dataDir(context), rank.badge)
        val name = look?.optString("name").orEmpty()
        val caught = count(File(JourneysBridge.dataDir(context), "dex.json"))
        val hours = (stats.seconds / 3600).toInt().coerceAtMost(999)
        val minutes = ((stats.seconds / 60) % 60).toInt()
        val art = TrainerCardArt.load(RomArt.dir(files), CardStyle.KANTO) ?: TrainerCardArt.load(RomArt.dir(files), CardStyle.HOENN)
        val card = art?.let {
            val info = TrainerCardInfo(
                style = it.style, name = TrainerCardArt.enc(name.take(NAME_LENGTH)), female = look?.optString("gender") == "f",
                trainerId = ((account?.id?.toLongOrNull() ?: 0L) % 65536).toInt(),
                hours = hours, minutes = minutes, money = HubEconomy.balance(context), dexCaught = caught, badges = 0, stars = 0, hofDebut = 0,
            )
            val sprites = look?.let { saved -> runCatching { cardSprites(context, saved, runCatching { HubFollower.load(context).sheet }.getOrNull()) }.getOrNull() }
            runCatching { cardPicture(it, info, sprites, rank, badge).asImageBitmap() }.getOrNull()
        }
        return Trainer(
            name, account?.name.orEmpty(), stats.lastJourney, count(File(HubActivity.dataDir(context), "journeys.json")),
            caught, hours, minutes, card, rank,
            if (card == null) Bitmap.createBitmap(badge.argb, badge.width, badge.height, Bitmap.Config.ARGB_8888).asImageBitmap() else null,
            waiting,
        )
    }

    /** The best playlist Rating, with the playlist it comes from once one has been played. */
    private fun ratingText(rank: StadiumRank): String {
        val playlist = rank.ratingPlaylist?.let { StadiumRank.PLAYLISTS[it] } ?: return rank.rating.toString()
        return "${rank.rating} (${playlist.uppercase()})"
    }

    /** How many entries the JSON list in [file] has; 0 when it's missing. */
    private fun count(file: File): Int = runCatching { JSONArray(file.readText()).length() }.getOrDefault(0)

    /** A sprite drawn onto the card in full colour: width, height and ARGB pixels. */
    private class Sprite(val w: Int, val h: Int, val px: IntArray)

    /**
     * The card's picture: the trainer's own overworld sprite standing (the creator look) with their follower from
     * the Vault beside it, in place of a full-size trainer picture. No follower chosen: the trainer alone.
     */
    private fun cardSprites(context: Context, look: org.json.JSONObject, followerSheet: ByteArray?): List<Sprite> {
        val sheet = CreatorLook.canvas(CreatorLook.apkArt(context), look, "walk")
        val trainer = Sprite(32, 32, IntArray(32 * 32) { i -> sheet[(i / 32) * 128 + i % 32] })
        val follower = followerSheet?.takeIf { it.isNotEmpty() }
            ?.let { android.graphics.BitmapFactory.decodeByteArray(it, 0, it.size) }
            ?.let { bitmap ->
                // The hub's follower sheets: square frames, up, down, left, right; frame 4 stands facing down.
                val size = bitmap.height
                if (bitmap.width < size * 5) return@let null
                val pixels = IntArray(size * size)
                bitmap.getPixels(pixels, 0, size, size * 4, 0, size, size)
                // Larger pack art is shrunk (nearest pixel) to a trainer's 32 x 32, so both fit the window.
                if (size <= 32) Sprite(size, size, pixels)
                else Sprite(32, 32, IntArray(32 * 32) { i -> pixels[(i / 32 * size / 32) * size + (i % 32) * size / 32] })
            }
        return listOfNotNull(trainer, follower)
    }

    /** An empty 64x64 picture (colour 0 everywhere draws nothing), so the sprites go in its place. */
    private val NO_PICTURE = ByteArray(64 * 64 / 2) to ByteArray(32)

    /** The card's front without the game's screen behind it, cut to the card's own pixels. */
    private fun cardPicture(art: TrainerCardArt.Art, info: TrainerCardInfo, sprites: List<Sprite>?,
                            rank: StadiumRank, badge: RomArt.Image): Bitmap {
        val image = TrainerCardArt.render(art, info, back = false, colon = true, backdrop = false, pic = if (sprites.isNullOrEmpty()) null else NO_PICTURE,
            frontFooter = TrainerCardArt.FrontFooter(badge, "RATING" to rank.rating.toString(), "EXPERIENCE" to rank.winPoints.toString()))
        // The card's picture window: 72 x 80 at tile (19, 5). The trainer stands on the left and the follower
        // beside them on the right, both with their feet on the same line near the window's bottom.
        if (!sprites.isNullOrEmpty()) {
            val left = 19 * 8
            val floor = 5 * 8 + 70
            val slot = 72 / sprites.size
            sprites.forEachIndexed { index, sprite ->
                val x0 = left + index * slot + (slot - sprite.w) / 2
                val y0 = floor - sprite.h
                for (y in 0 until sprite.h) for (x in 0 until sprite.w) {
                    val pixel = sprite.px[y * sprite.w + x]
                    val px = x0 + x
                    val py = y0 + y
                    if (pixel ushr 24 < 128 || px !in left until left + 72 || py !in 5 * 8 until 5 * 8 + 80) continue
                    image.argb[py * image.width + px] = pixel
                }
            }
        }
        val (left, top, right, bottom) = TrainerCardArt.cardBounds(image).toList()
        val width = right - left
        val pixels = IntArray(width * (bottom - top)) { i -> image.argb[(top + i / width) * image.width + left + i % width] }
        return Bitmap.createBitmap(pixels, width, bottom - top, Bitmap.Config.ARGB_8888)
    }

    /**
     * Another player's trainer card, as a PNG, drawn like this player's own from what the hub knows of them (the
     * server's live connection): `name`, `id`, `look` (a whole creator look), `follower` { species }, `card`
     * { journeys: [{ id, badges, pokedex, hours }], current } and `stats` { money, experience, bestRating }.
     * Empty when there's no card art from this player's journeys. Reads and draws: not for the UI thread.
     */
    fun otherCard(context: Context, player: org.json.JSONObject): ByteArray {
        val files = context.filesDir
        val art = TrainerCardArt.load(RomArt.dir(files), CardStyle.KANTO) ?: TrainerCardArt.load(RomArt.dir(files), CardStyle.HOENN)
            ?: return ByteArray(0)
        val look = player.optJSONObject("look")
        val stats = player.optJSONObject("stats") ?: org.json.JSONObject()
        val card = player.optJSONObject("card") ?: org.json.JSONObject()
        val journeys = card.optJSONArray("journeys") ?: JSONArray()
        val current = (0 until journeys.length()).map { journeys.getJSONObject(it) }
            .let { list -> list.firstOrNull { it.optString("id") == card.optString("current") } ?: list.firstOrNull() }
        val hours = (0 until journeys.length()).sumOf { journeys.getJSONObject(it).optInt("hours") }.coerceIn(0, 999)
        val name = look?.optString("name").takeUnless { it.isNullOrBlank() } ?: player.optString("name")
        val rating = stats.optInt("bestRating", StadiumRank.MIN_RATING).coerceIn(StadiumRank.MIN_RATING, StadiumRank.MAX_RATING)
        val rank = StadiumRank(rating, stats.optInt("experience").coerceAtLeast(0), rating)
        val badge = StadiumRankBadge.load(HubActivity.dataDir(context), rank.badge)
        val info = TrainerCardInfo(
            style = art.style, name = TrainerCardArt.enc(name.take(NAME_LENGTH)), female = look?.optString("gender") == "f",
            trainerId = (player.optLong("id") % 65536).toInt(), hours = hours, minutes = 0,
            money = stats.optLong("money").coerceIn(0, 999_999), dexCaught = current?.optInt("pokedex"),
            badges = (1 shl (current?.optInt("badges") ?: 0).coerceIn(0, 8)) - 1, stars = 0, hofDebut = 0,
        )
        val species = player.optJSONObject("follower")?.optInt("species") ?: 0
        val followerSheet = if (species in 1..1025) runCatching { HubFollower.sheetFor(context, species, player.optJSONObject("follower")?.optBoolean("shiny") == true) }.getOrNull() else null
        val sprites = look?.let { runCatching { cardSprites(context, it, followerSheet) }.getOrNull() }
        val bitmap = cardPicture(art, info, sprites, rank, badge)
        return java.io.ByteArrayOutputStream().also { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }.toByteArray()
    }

    fun view(context: Context, trainer: State<Trainer>, onSettings: () -> Unit): View =
        CompanionColors.track(ComposeView(context)).apply {
            setContent { CompanionScreenSize { AppTheme { Screen(trainer.value, onSettings) } } }
        }

    /** One screen: PokeDaisy's tab for the screen's right edge, which opens the companion ([window]). */
    fun tab(context: Context, onOpen: () -> Unit): View =
        CompanionColors.track(ComposeView(context)).apply { setContent { SidePanelOpenTab(onOpen) } }

    /** One screen: the companion as PokeDaisy's window in the middle of a dim over the island; the X or a tap on the dim closes it. */
    fun window(context: Context, trainer: State<Trainer>, onSettings: () -> Unit, onClose: () -> Unit): View =
        CompanionColors.track(ComposeView(context)).apply {
            setContent {
                SidePanelHost(window = true, onClose = onClose) {
                    CompanionScreenSize { AppTheme { Screen(trainer.value, onSettings) } }
                }
            }
        }

    @Composable
    private fun Screen(trainer: Trainer, onSettings: () -> Unit) {
        val m = rememberGbaTextMetrics()
        val gap = m.u * 4
        Box(Modifier.fillMaxSize()) {
            AppBackdrop()
            Column(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(gap)) {
                OptionTitleWindow(tk("TRAINER CARD"), m) { DeviceCharge(m) }
                if (trainer.waiting.isNotEmpty()) {
                    // No card until the server has the trainer: a card from old files could show the wrong money or rank.
                    OptionListWindow(m, Modifier.fillMaxWidth().weight(1f)) {
                        Box(Modifier.fillMaxSize().padding(gap * 2), contentAlignment = Alignment.Center) {
                            GbaText(trainer.waiting, OptionColors.value, OptionColors.valueShadow, m)
                        }
                    }
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                        OptionButton(tk("SETTINGS"), m, onClick = onSettings, pixelIcon = PixelIcons.gear)
                    }
                    return@Column
                }
                trainer.card?.let { card ->
                    BoxWithConstraints(Modifier.fillMaxWidth().weight(1f), contentAlignment = Alignment.Center) {
                        val density = LocalDensity.current
                        val across = with(density) { maxWidth.toPx() } / card.width
                        val down = with(density) { maxHeight.toPx() } / card.height
                        // Whole screen pixels per GBA pixel, so the card stays crisp.
                        val scale = minOf(across, down).toInt().coerceAtLeast(1)
                        Canvas(Modifier.size(with(density) { (card.width * scale).toDp() }, with(density) { (card.height * scale).toDp() })) {
                            drawImage(
                                card, dstOffset = IntOffset.Zero, dstSize = IntSize(card.width * scale, card.height * scale),
                                filterQuality = FilterQuality.None,
                            )
                        }
                    }
                }
                OptionListWindow(m, if (trainer.card == null) Modifier.fillMaxWidth().weight(1f) else Modifier.fillMaxWidth()) {
                    Column(Modifier.fillMaxWidth().padding(gap * 2), verticalArrangement = Arrangement.spacedBy(gap)) {
                        // The card already says these.
                        if (trainer.card == null) {
                            Fact(tk("TRAINER"), trainer.name.ifEmpty { "-" }, m)
                            Fact(tk("TIME"), "%d:%02d".format(trainer.hours, trainer.minutes), m)
                            Fact(tk("POKéDEX"), trainer.caught.toString(), m)
                            Fact(tr("RATING|stadium"), ratingText(trainer.rank), m, trainer.rankBadge)
                            Fact(tr("EXPERIENCE"), trainer.rank.winPoints.toString(), m)
                        }
                        Fact(tk("ACCOUNT"), trainer.account.ifEmpty { tr("NOT SIGNED IN") }, m)
                        Fact(tk("JOURNEYS"), trainer.journeys.toString(), m)
                        Fact(tk("LAST JOURNEY"), trainer.lastJourney.ifEmpty { "-" }, m)
                    }
                }
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                    OptionButton(tk("SETTINGS"), m, onClick = onSettings, pixelIcon = PixelIcons.gear)
                }
            }
        }
    }

    @Composable
    private fun DeviceCharge(m: GbaTextMetrics) {
        val context = LocalContext.current.applicationContext
        DisposableEffect(context) {
            val receiver = object : BroadcastReceiver() {
                override fun onReceive(context: Context, intent: Intent) {
                    val level = intent.getIntExtra(BatteryManager.EXTRA_LEVEL, -1)
                    val scale = intent.getIntExtra(BatteryManager.EXTRA_SCALE, 100)
                    if (scale <= 0 || level !in 0..scale) return
                    val status = intent.getIntExtra(BatteryManager.EXTRA_STATUS, -1)
                    val charging = status == BatteryManager.BATTERY_STATUS_CHARGING || status == BatteryManager.BATTERY_STATUS_FULL
                    DeviceBattery.status.value = BatteryStatus(level * 100 / scale, charging)
                }
            }
            context.registerReceiver(receiver, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
                ?.let { receiver.onReceive(context, it) }
            onDispose { context.unregisterReceiver(receiver) }
        }
        BatteryIndicator(m)
    }

    /** One line of the trainer's facts: its [label], then its [value] in the settings' value colour. */
    @Composable
    private fun Fact(label: String, value: String, m: GbaTextMetrics, badge: ImageBitmap? = null) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(m.u * 8), verticalAlignment = Alignment.CenterVertically) {
            if (badge != null) Canvas(Modifier.size(m.u * badge.width, m.u * badge.height)) {
                drawImage(badge, dstSize = IntSize(size.width.toInt(), size.height.toInt()), filterQuality = FilterQuality.None)
            }
            GbaText(label, OptionColors.label, OptionColors.labelShadow, m)
            Spacer(Modifier.weight(1f))
            GbaText(value, OptionColors.value, OptionColors.valueShadow, m)
        }
    }

    /** The games' trainer names are seven letters at most. */
    private const val NAME_LENGTH = 7
}
