package com.pokedaisy.app.companion.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import com.pokedaisy.app.companion.data.save.Gen3SaveFormat
import com.pokedaisy.app.companion.data.save.eventFlagCount
import com.pokedaisy.app.companion.data.save.speciesNationalDex
import com.pokedaisy.app.companion.data.speciesNames
import com.pokedaisy.app.companion.i18n.tr
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

// Badge and system flag IDs in the retail Gen 3 games.
private fun Gen3SaveFormat.badges(): List<Pair<Int, String>> {
    val first = when (this) {
        Gen3SaveFormat.FIRERED_LEAFGREEN -> 0x820
        Gen3SaveFormat.EMERALD -> 0x867
        Gen3SaveFormat.RUBY_SAPPHIRE -> 0x807
    }
    val names = if (kanto) listOf("Boulder", "Cascade", "Thunder", "Rainbow", "Soul", "Marsh", "Volcano", "Earth")
        else listOf("Stone", "Knuckle", "Dynamo", "Heat", "Balance", "Feather", "Mind", "Rain")
    return names.mapIndexed { index, name -> first + index to tr("{0} Badge", tr(name)) }
}

private fun Gen3SaveFormat.storyFlags(): List<Pair<Int, String>> = when (this) {
    Gen3SaveFormat.FIRERED_LEAFGREEN -> listOf(
        0x829 to tr("Pokédex obtained"), 0x82C to tr("Pokémon League cleared"),
        linkRsFlag to tr("Sevii Islands link enabled"),
    )
    Gen3SaveFormat.EMERALD -> listOf(0x861 to tr("Pokédex obtained"), 0x864 to tr("Pokémon League cleared"))
    Gen3SaveFormat.RUBY_SAPPHIRE -> listOf(0x801 to tr("Pokédex obtained"), 0x804 to tr("Pokémon League cleared"))
}

private val debugSpecies by lazy {
    speciesNationalDex.mapIndexed { gameSpecies, national ->
        speciesNames[gameSpecies]?.takeIf { national in 1..386 }?.let { national to it }
    }.filterNotNull().sortedBy { it.first }
}

@Composable
internal fun Gen3DebugSavePage(
    state: PcBoxesState,
    m: GbaTextMetrics,
    modifier: Modifier,
    saving: Boolean,
    generate: (Int, Int) -> ByteArray,
) {
    val format = state.data.format
    val badges = remember(format) { format.badges() }
    val story = remember(format) { format.storyFlags() }
    var query by remember { mutableStateOf("") }
    var chosen by remember { mutableStateOf<Pair<Int, String>?>(null) }
    var level by remember { mutableStateOf("5") }
    var flagText by remember { mutableStateOf("") }
    var status by remember { mutableStateOf("") }
    val scope = rememberCoroutineScope()
    val focus = LocalFocusManager.current
    val keyboard = LocalSoftwareKeyboardController.current
    val busy = saving || state.generatingPokemon
    val candidates = remember(query) {
        val search = query.trim()
        if (search.isEmpty()) emptyList() else debugSpecies.filter { (dex, name) ->
            search.toIntOrNull()?.let { it == dex } ?: name.contains(search, ignoreCase = true)
        }.take(8)
    }
    val species = chosen ?: candidates.singleOrNull()
    val targetLevel = level.toIntOrNull()?.takeIf { it in 1..100 }
    val flagId = if (flagText.startsWith("0x", ignoreCase = true)) flagText.drop(2).toIntOrNull(16)
        else flagText.toIntOrNull()

    Column(modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(m.u * 3)) {
        OptionTitleWindow(tr("ADD POKÉMON"), m)
        OptionTextField(query, { query = it.take(24); chosen = null }, m, placeholder = tr("Species name or Pokédex number"))
        if (chosen == null && candidates.isNotEmpty()) OptionListWindow(m, Modifier.fillMaxWidth()) {
            Column {
                candidates.forEach { candidate ->
                    OptionLine(candidate.second, "#${candidate.first}", false, m, enabled = !busy) {
                        chosen = candidate
                        query = candidate.second
                        keyboard?.hide()
                        focus.clearFocus()
                    }
                }
            }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(m.u * 3), verticalAlignment = Alignment.CenterVertically) {
            GbaText(tr("Level"), OptionColors.label, OptionColors.labelShadow, m)
            OptionTextField(level, { level = it.filter(Char::isDigit).take(3) }, m, Modifier.weight(1f),
                placeholder = tr("1–100"), number = true)
            OptionButton(tr("ADD TO PC"), m, enabled = species != null && targetLevel != null && !busy, onClick = {
                if (species == null || targetLevel == null) return@OptionButton
                keyboard?.hide()
                focus.clearFocus()
                state.generatingPokemon = true
                status = tr("Creating Pokémon…")
                scope.launch {
                    try {
                        val slot = state.emptyDebugSlot() ?: error(tr("All PC boxes are full."))
                        val record = withContext(Dispatchers.IO) { generate(species.first, targetLevel) }
                        state.addDebugPokemon(slot, record)
                        status = tr("{0} added to Box {1}.", species.second, slot.box + 1)
                    } catch (cancelled: CancellationException) {
                        throw cancelled
                    } catch (error: Exception) {
                        status = error.message ?: tr("Couldn't create that Pokémon.")
                    } finally {
                        state.generatingPokemon = false
                    }
                }
            })
        }
        if (status.isNotEmpty()) GbaText(status, OptionColors.label, OptionColors.labelShadow, m, maxLines = Int.MAX_VALUE)

        OptionTitleWindow(tr("GYM BADGES"), m)
        EventFlagRows(state, badges, m, busy)
        OptionTitleWindow(tr("STORY FLAGS"), m)
        EventFlagRows(state, story, m, busy)
        OptionTextField(flagText, { flagText = it.trim().take(8) }, m, placeholder = tr("Flag ID (decimal or 0x hex)"), code = true)
        if (flagId != null && flagId in 1 until format.eventFlagCount) {
            EventFlagRows(state, listOf(flagId to tr("Flag {0}", "0x${flagId.toString(16).uppercase()}")), m, busy)
        }
    }
}

@Composable
private fun EventFlagRows(state: PcBoxesState, flags: List<Pair<Int, String>>, m: GbaTextMetrics, busy: Boolean) {
    val data = state.data
    OptionListWindow(m, Modifier.fillMaxWidth()) {
        Column {
            flags.forEach { (id, label) ->
                val enabled = data.eventFlag(id)
                OptionLine(label, if (enabled) tr("ON") else tr("OFF"), false, m, labelWeight = 0.8f, enabled = !busy) {
                    state.edit { setEventFlag(id, !enabled) }
                }
            }
        }
    }
}
