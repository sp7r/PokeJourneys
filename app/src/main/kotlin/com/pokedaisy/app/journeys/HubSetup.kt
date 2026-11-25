package com.pokedaisy.app.journeys

import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.view.KeyEvent
import androidx.activity.ComponentActivity
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.pokedaisy.app.Prefs
import com.pokedaisy.app.RomArchive
import com.pokedaisy.app.RomFolder
import com.pokedaisy.app.StorageAccess
import java.io.File
import kotlin.concurrent.thread

/**
 * Victory Island's first run, one page (HubSetupScreen): the five cartridges it's built from, found or not. All five:
 * BUILD VICTORY ISLAND. Otherwise it names what's missing (or why a copy doesn't fit) and offers the ROM folder.
 * Then the build's own progress, on the same page.
 */
internal class HubSetup(
    private val activity: ComponentActivity,
    private val onBuild: (Map<String, File>) -> Unit,
) {
    data class Rejected(val file: File, val problems: List<String>)
    data class Cartridges(
        val found: Map<String, File> = emptyMap(),
        val rejected: Map<String, List<Rejected>> = emptyMap(),
    )

    sealed interface Page {
        data object Checking : Page
        data object Preparing : Page
        /** The checklist: [Cartridges.found] all five or not, and a note (a folder that couldn't be read). */
        data class Checklist(val cartridges: Cartridges, val note: String = "") : Page {
            val ready get() = HubCartridgeHeaders.games.all { it.key in cartridges.found }
        }
        data class Building(val step: String = "", val progress: Float? = null, val tip: String = "") : Page
        data class Failed(val reason: String) : Page
    }

    var page by mutableStateOf<Page>(Page.Checking)

    private val prefs = Prefs(activity)
    private var awaitingAccess = false
    private var generation = 0

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
        awaitingAccess = state?.getBoolean("hub-setup-access") == true
        checkAgain()
    }

    fun saveState(state: Bundle) {
        state.putBoolean("hub-setup-access", awaitingAccess)
    }

    fun onResume() {
        if (!awaitingAccess) return
        // Older Android versions return a permission result even when the dialog did not pause the activity.
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R && !StorageAccess.hasAllFilesAccess(activity)) return
        onPermissionsResult()
    }

    fun onPermissionsResult() {
        if (!awaitingAccess) return
        awaitingAccess = false
        if (StorageAccess.hasAllFilesAccess(activity)) pickFolder.launch(null) else {
            checkAgain("Folder access was not granted. Choose your ROM folder to try again.")
        }
    }

    /** A controller: A the page's main button, Y the ROM folder, B back. True when the key was this page's. */
    fun onKeyUp(key: Int): Boolean {
        val p = page
        when (key) {
            KeyEvent.KEYCODE_BUTTON_A, KeyEvent.KEYCODE_BUTTON_START, KeyEvent.KEYCODE_ENTER, KeyEvent.KEYCODE_DPAD_CENTER -> when {
                p is Page.Checklist && p.ready -> build()
                p is Page.Checklist -> chooseFolder()
                p is Page.Failed -> checkAgain()
                else -> return false
            }
            KeyEvent.KEYCODE_BUTTON_Y -> if (p is Page.Checklist) chooseFolder() else return false
            KeyEvent.KEYCODE_BUTTON_X -> if (p is Page.Checklist) checkAgain() else return false
            else -> return false
        }
        return true
    }

    fun checkAgain(extraNote: String = "") {
        val request = ++generation
        page = Page.Checking
        thread(name = "pokejourneys-hub-scan") {
            var warning = extraNote
            val result = runCatching {
                val scan = RomFolder.scan(activity, prefs)
                RomFolder.checkImported(activity)
                if (!scan.readable) warning += "\nSome folders could not be read. Choose your ROM folder again to give access."
                readCartridges(activity, prefs)
            }
            activity.runOnUiThread {
                if (request != generation || activity.isFinishing || activity.isDestroyed) return@runOnUiThread
                val note = if (result.isFailure) "Could not check your cartridges. ${result.exceptionOrNull()?.message.orEmpty()}" else warning.trim()
                page = Page.Checklist(result.getOrDefault(Cartridges()), note)
            }
        }
    }

    fun chooseFolder() {
        if (!StorageAccess.hasAllFilesAccess(activity)) {
            awaitingAccess = true
            StorageAccess.requestAllFilesAccess(activity)
        } else pickFolder.launch(null)
    }

    fun build() {
        val list = page as? Page.Checklist ?: return
        if (!list.ready) return
        page = Page.Preparing
        thread(name = "pokejourneys-hub-cartridges") {
            val prepared = runCatching { prepare(activity, list.cartridges.found) }
            activity.runOnUiThread {
                if (activity.isFinishing || activity.isDestroyed) return@runOnUiThread
                prepared.onSuccess { roms -> page = Page.Building(); onBuild(roms) }
                    .onFailure { checkAgain(it.message ?: "Could not open a cartridge.") }
            }
        }
    }

    companion object {
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
