package com.pokedaisy.app.journeys

import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.view.KeyEvent
import androidx.activity.ComponentActivity
import com.pokedaisy.app.Prefs
import com.pokedaisy.app.RomArchive
import com.pokedaisy.app.RomFolder
import com.pokedaisy.app.StorageAccess
import java.io.File
import kotlin.concurrent.thread

/** First-run pages and the library's existing folder/link/scan flow. */
internal class HubSetup(
    private val activity: ComponentActivity,
    private val screen: FireRedScreen,
    private val onBuild: (Map<String, File>) -> Unit,
) {
    private data class Rejected(val file: File, val problems: List<String>)
    private data class Cartridges(
        val found: Map<String, File> = emptyMap(),
        val rejected: Map<String, List<Rejected>> = emptyMap(),
    )

    private val prefs = Prefs(activity)
    private var cartridges = Cartridges()
    private var started = false
    private var awaitingAccess = false
    private var busy = false
    private var generation = 0
    private var checklistSelection = HubCartridgeHeaders.games.size
    var active = true; private set

    private val pickFolder = activity.registerForActivityResult(StorageAccess.PickFolder()) { uri ->
        if (uri == null) {
            checkAgain()
        } else {
            val path = StorageAccess.treePath(uri)
            if (path == null) {
                checkAgain("Choose a folder on this phone or its SD card.")
            } else {
                runCatching {
                    activity.contentResolver.takePersistableUriPermission(
                        uri, Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION,
                    )
                }
                if (RomFolder.coveredBy(prefs.romsFolders, path) == null) {
                    prefs.romsFolders = RomFolder.withFolder(prefs.romsFolders, path)
                }
                checkAgain()
            }
        }
    }

    fun show(state: Bundle?) {
        started = state?.getBoolean("hub-setup-started") == true
        awaitingAccess = state?.getBoolean("hub-setup-access") == true
        if (started) checkAgain() else showWelcome()
    }

    fun saveState(state: Bundle) {
        state.putBoolean("hub-setup-started", started)
        state.putBoolean("hub-setup-access", awaitingAccess)
    }

    fun onResume() {
        if (!active || !awaitingAccess) return
        // Older Android versions return a permission result even when the dialog did not pause the activity.
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R && !StorageAccess.hasAllFilesAccess(activity)) return
        onPermissionsResult()
    }

    fun onPermissionsResult() {
        if (!active || !awaitingAccess) return
        awaitingAccess = false
        if (StorageAccess.hasAllFilesAccess(activity)) pickFolder.launch(null) else {
            checkAgain("Folder access was not granted. Choose ROM folder to try again.")
        }
    }

    fun handlesKey(key: Int) = key in KEYS

    fun onKeyUp(key: Int): Boolean {
        if (!active || !handlesKey(key)) return false
        when (key) {
            KeyEvent.KEYCODE_DPAD_UP -> screen.moveSelection(-1)
            KeyEvent.KEYCODE_DPAD_DOWN -> screen.moveSelection(1)
            KeyEvent.KEYCODE_BUTTON_B, KeyEvent.KEYCODE_BACK -> back()
            KeyEvent.KEYCODE_DPAD_LEFT -> if (screen.options.isEmpty()) back() else screen.moveSelection(-1)
            KeyEvent.KEYCODE_DPAD_RIGHT -> if (screen.options.isEmpty()) screen.answer() else screen.moveSelection(1)
            else -> screen.answer()
        }
        return true
    }

    fun back() { if (!busy) screen.onB?.invoke() }

    private fun showWelcome() {
        showPages(
            "Victory Island setup",
            listOf(
                "Built on this phone from", "your own cartridges.", "No game data ships with the app.",
                "FireRed: English Rev 1", "HeartGold: US (IPKE)", "Platinum: US (CPUE)",
                "Black: English (IRBO)", "Black 2: English (IREO)",
            ).joinToString("\n"),
            "Check ROMs", { checkAgain() }, { activity.finish() },
        )
    }

    /** A long file name or version explanation can always be read to its end. */
    private fun showPages(title: String, body: String, done: String, onDone: () -> Unit, onBack: () -> Unit) {
        val pages = screen.wrapLines(body).chunked(4)
        fun page(index: Int) {
            clearScreen()
            screen.title = if (pages.size == 1) title else "$title ${index + 1}/${pages.size}"
            screen.lines = pages[index]
            screen.message = "B: Back / A: ${if (index < pages.lastIndex) "Next" else done}\nTap left / right."
            screen.onB = { if (index > 0) page(index - 1) else onBack() }
            screen.onA = { if (index < pages.lastIndex) page(index + 1) else onDone() }
        }
        page(0)
    }

    private fun showChecklist() {
        clearScreen()
        screen.title = "Cartridges: ${cartridges.found.size}/5 found"
        val ready = cartridges.found.size == HubCartridgeHeaders.games.size
        val choices = HubCartridgeHeaders.games.map { game ->
            val file = cartridges.found[game.key]
            FireRedScreen.Option(
                "${game.name}: ${if (file == null) "MISSING" else "FOUND"}",
                file?.name ?: if (cartridges.rejected[game.key].isNullOrEmpty()) game.version else "Wrong version: tap for details",
            ) {
                checklistSelection = screen.selection
                val details = buildString {
                    appendLine("${game.name}: ${game.version}")
                    appendLine("Needs code ${game.code}.")
                    if (file != null) {
                        appendLine("FOUND")
                        appendLine("File: ${file.name}")
                    } else {
                        appendLine("MISSING")
                        if (cartridges.rejected[game.key].isNullOrEmpty()) appendLine("No matching cartridge found.")
                    }
                    for (copy in cartridges.rejected[game.key].orEmpty()) {
                        appendLine("File: ${copy.file.name}")
                        appendLine(copy.problems.joinToString("\n"))
                    }
                }.trimEnd()
                showPages(game.name, details, "Checklist", ::showChecklist, ::showChecklist)
            }
        } + listOf(
            FireRedScreen.Option("Choose ROM folder") { chooseFolder() },
            FireRedScreen.Option("Check again") { checklistSelection = screen.selection; checkAgain() },
            FireRedScreen.Option("Build Victory Island", if (ready) null else "Find all five first", ready) { prepareBuild() },
        )
        screen.onB = { showWelcome() }
        screen.options = choices
        screen.moveSelection(checklistSelection)
        screen.message = "B: Welcome   A: Select\nSwipe or use D-pad to scroll."
    }

    fun checkAgain(extraNote: String = "") {
        active = true
        started = true
        busy = true
        val request = ++generation
        clearScreen()
        screen.title = "Checking cartridges"
        screen.message = "Looking in your ROM folders..."
        thread(name = "pokejourneys-hub-scan") {
            var warning = extraNote
            val result = runCatching {
                val scan = RomFolder.scan(activity, prefs)
                RomFolder.checkImported(activity)
                if (!scan.readable) warning += "\nSome folders could not be read. Choose ROM folder to check access."
                readCartridges(activity, prefs)
            }
            activity.runOnUiThread {
                if (request != generation || activity.isFinishing || activity.isDestroyed) return@runOnUiThread
                busy = false
                cartridges = result.getOrDefault(Cartridges())
                val note = if (result.isFailure) "Could not check cartridges. ${result.exceptionOrNull()?.message.orEmpty()}" else warning.trim()
                showChecklist()
                if (note.isNotEmpty()) showPages("Cartridge check", note, "Checklist", ::showChecklist, ::showChecklist)
            }
        }
    }

    private fun chooseFolder() {
        checklistSelection = screen.selection
        if (!StorageAccess.hasAllFilesAccess(activity)) {
            awaitingAccess = true
            screen.message = "Allow folder access, then\nchoose your ROM folder."
            StorageAccess.requestAllFilesAccess(activity)
        } else pickFolder.launch(null)
    }

    private fun prepareBuild() {
        if (busy || cartridges.found.size != HubCartridgeHeaders.games.size) return
        checklistSelection = screen.selection
        busy = true
        clearScreen()
        screen.title = "Preparing cartridges"
        screen.message = "Opening your ROMs and archives..."
        thread(name = "pokejourneys-hub-cartridges") {
            val prepared = runCatching { prepare(activity, cartridges.found) }
            activity.runOnUiThread {
                if (activity.isFinishing || activity.isDestroyed) return@runOnUiThread
                busy = false
                prepared.onSuccess { roms -> active = false; clearScreen(); onBuild(roms) }
                    .onFailure { checkAgain(it.message ?: "Could not open a cartridge.") }
            }
        }
    }

    private fun clearScreen() {
        screen.options = emptyList()
        screen.lines = emptyList()
        screen.progress = null
        screen.onA = null
        screen.onB = null
    }

    companion object {
        private val KEYS = setOf(
            KeyEvent.KEYCODE_BUTTON_A, KeyEvent.KEYCODE_BUTTON_B, KeyEvent.KEYCODE_BUTTON_START,
            KeyEvent.KEYCODE_ENTER, KeyEvent.KEYCODE_DPAD_CENTER, KeyEvent.KEYCODE_BACK,
            KeyEvent.KEYCODE_DPAD_UP, KeyEvent.KEYCODE_DPAD_DOWN, KeyEvent.KEYCODE_DPAD_LEFT, KeyEvent.KEYCODE_DPAD_RIGHT,
        )

        private fun readCartridges(context: Context, prefs: Prefs): Cartridges {
            val found = linkedMapOf<String, File>()
            val rejected = linkedMapOf<String, MutableList<Rejected>>()
            // Other regions may be absent from the supported library; their headers still explain a missing base.
            val files = (RomFolder.libraryRoms(context, prefs) + RomFolder.allRomFiles(context, prefs))
                .filter { it.absolutePath !in prefs.hiddenRoms }.distinctBy { it.absolutePath }
            for (file in files) {
                val header = RomArchive.readAt(file, 0, 0x200) ?: continue
                val match = HubCartridgeHeaders.inspect(header) ?: continue
                if (match.problems.isEmpty()) found.putIfAbsent(match.game.key, file) else {
                    rejected.getOrPut(match.game.key) { mutableListOf() } += Rejected(file, match.problems)
                }
            }
            return Cartridges(found, rejected)
        }

        private fun prepare(context: Context, found: Map<String, File>): Map<String, File> = found.mapValues { (key, file) ->
            val match = RomArchive.readAt(file, 0, 0x200)?.let(HubCartridgeHeaders::inspect)
            check(match != null && match.game.key == key && match.problems.isEmpty()) { "Check this cartridge again: ${file.name}" }
            // Each base has its own cache so RomArchive's three-file limit cannot evict another base during the build.
            RomArchive.playable(file, File(context.cacheDir, "hub-cartridges/$key"))
                ?: error("Could not unpack ${file.name}. Check the archive and free space.")
        }

        fun findRoms(context: Context, prefs: Prefs): Map<String, File> = prepare(context, readCartridges(context, prefs).found)
    }
}
