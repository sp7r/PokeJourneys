package com.pokedaisy.app

import android.content.Intent
import android.os.Bundle
import android.view.KeyEvent
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.platform.LocalInputModeManager
import androidx.compose.ui.platform.LocalWindowInfo
import androidx.compose.ui.input.InputMode
import androidx.compose.ui.unit.dp
import com.pokedaisy.app.companion.i18n.tr
import com.pokedaisy.app.companion.ui.*
import com.pokedaisy.app.companion.ui.theme.AppTheme
import com.pokedaisy.app.journeys.HubFollower
import com.pokedaisy.app.journeys.HubPageActivity
import com.pokedaisy.app.journeys.JourneyIds
import com.pokedaisy.app.journeys.JourneysBridge
import com.pokedaisy.app.journeys.ServerVault
import org.json.JSONArray
import org.json.JSONObject
import kotlin.concurrent.thread

class VaultActivity : ComponentActivity() {
    private lateinit var prefs: Prefs
    private var collection by mutableStateOf<JSONObject?>(null)
    private var busy by mutableStateOf(true)
    private var message by mutableStateOf("")
    private var titles by mutableStateOf<Map<String, String>>(emptyMap())
    private var destinations by mutableStateOf<List<String>>(emptyList())
    private var followerId by mutableStateOf<String?>(null)
    private data class Choice(val label: String, val args: List<String> = emptyList(), val followerId: String? = null) {
        /** The journeys whose saves the bridge changes for this choice. */
        val journeys: List<String> get() = when (args.firstOrNull()) {
            "deposit" -> listOf(args[1])
            "withdraw" -> listOf(args[2])
            "move" -> listOf(args[1], args.last())
            else -> emptyList()
        }
    }
    private var choices by mutableStateOf<List<Choice>?>(null)
    /** Journeys whose game was left with progress the game hasn't saved (its resume point is newer than its save). */
    private var unsaved by mutableStateOf<Set<String>>(emptySet())
    private val editSave = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        if (result.resultCode == RESULT_OK) {
            busy = true
            thread { runCatching { readCollection() }.onFailure(::failed) }
        }
    }

    /** [journeyId]'s resume-point folder, the same one the game screen uses. Null when its ROM isn't known. */
    private fun statesFor(journeyId: String): SaveStates? {
        val rom = JourneyIds.roms(this)[journeyId]?.takeIf { it.isFile } ?: return null
        return runCatching { SaveStates(getExternalFilesDir(null) ?: filesDir, "%08x".format(RomCrcs.of(this, rom))) }.getOrNull()
    }

    /**
     * After the bridge changes a game's save, the game must start from that save next time, not from its resume point:
     * the resume point still holds the save from before the move and would write it back.
     */
    private fun startFresh(journeyIds: List<String>) {
        journeyIds.forEach { id -> runCatching { statesFor(id)?.freshBootFile?.createNewFile() } }
    }

    /** Blocking. Journeys with progress not saved in the game. */
    private fun findUnsaved(): Set<String> = JourneyIds.roms(this).mapNotNull { (id, rom) ->
        val resume = statesFor(id)?.resumeFile?.takeIf { it.isFile } ?: return@mapNotNull null
        val save = SavesLocation.saveFor(this, prefs, rom)
        id.takeIf { resume.lastModified() > save.lastModified() + 2_000 }
    }.toSet()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        HubPageActivity.reportTopPageVisibility(this)
        prefs = Prefs(this)
        com.pokedaisy.app.companion.i18n.L10n.apply(prefs.appLanguage, null)
        setContent { AppTheme { CompactTextOnSmallWindows { Root() } } }
        thread {
            runCatching {
                val roms = RomFolder.libraryRoms(this, prefs)
                val registered = mutableListOf<String>()
                roms.forEach { rom ->
                    runCatching {
                        if (JourneyIds.register(this, prefs, rom).ok) {
                            registered += JourneyIds.idFor(rom)
                            if (SavesLocation.saveFor(this, prefs, rom).isFile)
                                JourneysBridge.run(this, "snapshot", JourneyIds.idFor(rom))
                        }
                    }
                }
                val names = JourneyIds.roms(this).mapValues { GameTitles.label(this, prefs, it.value) }
                runOnUiThread { titles = names; destinations = registered.distinct() }
                readCollection()
            }.onFailure { failed(it) }
        }
    }

    override fun onResume() {
        super.onResume()
        OptionColors.inGame = false
    }

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (event.keyCode == KeyEvent.KEYCODE_BUTTON_B || event.keyCode == KeyEvent.KEYCODE_BACK) {
            if (event.action == KeyEvent.ACTION_UP) {
                if (choices != null) choices = null else finish()
            }
            return true
        }
        return super.dispatchKeyEvent(event)
    }

    /** Blocking; collection is refreshed only after the command has completed. */
    private fun readCollection() {
        val syncMessage = ServerVault.sync(this)
        val result = JourneysBridge.run(this, "collection", "--json")
        val data = if (result.ok) JSONObject(result.output) else null
        val notSaved = runCatching { findUnsaved() }.getOrDefault(emptySet())
        val selectedFollower = HubFollower.selectedId(this)
        runOnUiThread {
            collection = data
            unsaved = notSaved
            followerId = selectedFollower
            message = if (result.ok) syncMessage else tr(result.error)
            busy = false
        }
    }

    private fun failed(error: Throwable) = runOnUiThread {
        message = tr("Couldn't read your journeys: {0}", error.message.orEmpty())
        busy = false
    }

    private fun act(choice: Choice) {
        choices = null
        if (busy) return
        busy = true
        thread {
            runCatching {
                val follower = choice.followerId
                if (follower != null) {
                    HubFollower.select(this, follower)
                    runOnUiThread {
                        followerId = follower
                        busy = false
                        Toast.makeText(this, tr("Press the left bumper to send it out on Victory Island."), Toast.LENGTH_SHORT).show()
                    }
                    return@thread
                }
                val result = ServerVault.run(this, *choice.args.toTypedArray())
                if (result.ok) startFresh(choice.journeys)
                runOnUiThread {
                    Toast.makeText(this, tr(if (result.ok) result.output else result.error),
                        if (result.ok) Toast.LENGTH_SHORT else Toast.LENGTH_LONG).show()
                }
                if (result.ok) readCollection() else runOnUiThread { busy = false }
            }.onFailure { failed(it) }
        }
    }

    private fun pick(mon: JSONObject, journey: String? = null) {
        if (busy || mon.optBoolean("egg")) return
        choices = if (journey == null) {
            val id = mon.getString("id")
            listOf(Choice(tr("FOLLOW IN HUB"), followerId = id)) + destinations.map { destination ->
                Choice(tr("TAKE TO {0}", titles[destination] ?: destination), listOf("withdraw", id, destination))
            }
        } else {
            val slot = (mon.getInt("slot") + 1).toString()
            val location = if (mon.getInt("box") == -1) listOf("party", slot)
                else listOf("box", (mon.getInt("box") + 1).toString(), slot)
            listOf(Choice(tr("PUT IN THE VAULT"), listOf("deposit", journey) + location)) +
                destinations.filter { it != journey }.map { id ->
                    Choice(tr("MOVE TO {0}", titles[id] ?: id), listOf("move", journey) + location + id)
                }
        }
    }

    private fun JSONArray.objects() = (0 until length()).map { getJSONObject(it) }

    @OptIn(androidx.compose.ui.ExperimentalComposeUiApi::class) // requestInputMode, as SettingsActivity uses it
    @Composable
    private fun Root() {
        BackHandler { if (choices != null) choices = null else finish() }
        val m = rememberGbaTextMetrics()
        val first = remember { FocusRequester() }
        val windowFocused = LocalWindowInfo.current.isWindowFocused
        val inputMode = LocalInputModeManager.current
        LaunchedEffect(windowFocused, busy) {
            if (windowFocused && !busy) {
                withFrameNanos { }
                inputMode.requestInputMode(InputMode.Keyboard)
                runCatching { first.requestFocus() }
            }
        }
        Box(Modifier.fillMaxSize()) {
            AppBackdrop()
            Column(Modifier.fillMaxSize().padding(16.dp).verticalScroll(rememberScrollState())) {
                OptionTitleWindow(tr("VAULT"), m,
                    trailing = tr("{0} SPECIES CAUGHT", collection?.optJSONArray("dex")?.length() ?: 0),
                    onBack = { finish() })
                Spacer(Modifier.height(m.u * 4))
                if (busy) GbaText(tr("Reading your journeys…"), OptionColors.label, OptionColors.labelShadow, m)
                if (message.isNotEmpty()) GbaText(message, OptionColors.label, OptionColors.labelShadow, m, maxLines = Int.MAX_VALUE)
                val vault = collection?.optJSONArray("vault")?.objects().orEmpty()
                OptionTitleWindow(tr("VAULT"), m)
                OptionListWindow(m, Modifier.fillMaxWidth()) {
                    Column {
                        if (vault.isEmpty()) GbaText(
                            tr("Nothing in the vault yet. Pick a Pokémon in a journey below to put it here."),
                            OptionColors.label, OptionColors.labelShadow, m, maxLines = Int.MAX_VALUE,
                            modifier = Modifier.padding(m.u * 4))
                        vault.forEach { mon ->
                            val follower = tr("FOLLOWER").takeIf { mon.optString("id") == followerId }
                            OptionLine(tr(mon.getString("summary")), follower, false, m, enabled = !busy) { pick(mon) }
                        }
                    }
                }
                if (BuildConfig.DEBUG) {
                    Spacer(Modifier.height(m.u * 4))
                    OptionButton(tr("DEBUG SAVE EDITOR"), m, enabled = !busy, onClick = {
                        editSave.launch(Intent(this@VaultActivity, SaveEditorActivity::class.java)
                            .putExtra(SaveEditorActivity.EXTRA_PICK, true)
                            .putExtra(SaveEditorActivity.EXTRA_DEBUG_VAULT, true))
                    })
                }
                collection?.optJSONArray("journeys")?.objects().orEmpty().forEach { journey ->
                    val mons = journey.optJSONArray("mons")?.objects().orEmpty()
                    if (mons.isNotEmpty()) {
                        val id = journey.getString("journeyId")
                        Spacer(Modifier.height(m.u * 4))
                        OptionTitleWindow(tr("{0} · {1}", titles[id] ?: journey.optString("game", id), journey.optString("trainer")), m)
                        if (id in unsaved) GbaText(
                            tr("You left this game without saving in it. Moving Pokémon in or out of it starts it again from its last save, so save in the game first."),
                            OptionColors.label, OptionColors.labelShadow, m, maxLines = Int.MAX_VALUE,
                            modifier = Modifier.padding(horizontal = m.u * 4, vertical = m.u * 2))
                        OptionListWindow(m, Modifier.fillMaxWidth()) {
                            Column {
                                mons.forEach { mon ->
                                    val box = mon.getInt("box")
                                    val slot = mon.getInt("slot") + 1
                                    val location = if (box == -1) tr("PARTY {0}", slot) else tr("BOX {0} · {1}", box + 1, slot)
                                    val summary = if (mon.optBoolean("shiny")) tr("★ {0}", mon.getString("summary")) else tr(mon.getString("summary"))
                                    OptionLine(location, summary, false, m, labelWeight = 0.3f,
                                        enabled = !busy && !mon.optBoolean("egg")) { pick(mon, id) }
                                }
                            }
                        }
                    }
                }
                Spacer(Modifier.height(m.u * 4))
                OptionButton(tr("BACK"), m, onClick = { finish() }, modifier = Modifier.focusRequester(first))
            }
            choices?.let { list ->
                OptionSelector(tr("VAULT"), list.indices.toList(), -1, { list[it].label }, m,
                    onPick = { act(list[it]) }, onDismiss = { choices = null })
            }
        }
    }
}
