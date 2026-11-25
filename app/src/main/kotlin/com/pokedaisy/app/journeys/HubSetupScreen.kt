package com.pokedaisy.app.journeys

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.pokedaisy.app.companion.ui.AppBackdrop
import com.pokedaisy.app.companion.ui.GbaText
import com.pokedaisy.app.companion.ui.GbaTextMetrics
import com.pokedaisy.app.companion.ui.OptionButton
import com.pokedaisy.app.companion.ui.OptionColors
import com.pokedaisy.app.companion.ui.OptionListWindow
import com.pokedaisy.app.companion.ui.OptionTitleWindow
import com.pokedaisy.app.companion.ui.SetupProgressBar

/** [HubSetup]'s page in the app's FireRed-style windows, like PokeDaisy's own setup. */
@Composable
internal fun HubSetupScreen(setup: HubSetup, m: GbaTextMetrics, small: GbaTextMetrics, onBack: () -> Unit) {
    val page = setup.page
    val list = page as? HubSetup.Page.Checklist
    val found = list?.cartridges?.found.orEmpty()
    Box(Modifier.fillMaxSize()) {
        AppBackdrop()
        Column(Modifier.fillMaxSize().padding(16.dp)) {
            OptionTitleWindow(
                "VICTORY ISLAND", m,
                trailing = if (list != null) "${found.size} / ${HubCartridgeHeaders.games.size}" else null,
                onBack = if (page is HubSetup.Page.Building || page is HubSetup.Page.Preparing) null else onBack,
            )
            Spacer(Modifier.height(m.u * 4))
            OptionListWindow(m, Modifier.fillMaxWidth().weight(1f)) {
                Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = m.u * 4)) {
                    when (page) {
                        HubSetup.Page.Checking -> Line("Looking for your cartridges…", m)
                        HubSetup.Page.Preparing -> Line("Opening your cartridges…", m)
                        is HubSetup.Page.Checklist -> Checklist(page, m, small)
                        is HubSetup.Page.Building -> {
                            Line("Building Victory Island", m, value = true)
                            Spacer(Modifier.height(m.u * 4))
                            page.progress?.let { SetupProgressBar(it, m); Spacer(Modifier.height(m.u * 4)) }
                            if (page.step.isNotEmpty()) Line(page.step, small)
                            Spacer(Modifier.height(m.u * 4))
                            Line("This only happens once. Keep the screen on.", small, muted = true)
                            if (page.tip.isNotEmpty()) { Spacer(Modifier.height(m.u * 6)); Line(page.tip, small) }
                        }
                        is HubSetup.Page.Failed -> {
                            Line("The build stopped.", m, value = true)
                            Spacer(Modifier.height(m.u * 4))
                            Line(page.reason, small)
                        }
                    }
                }
            }
            Spacer(Modifier.height(m.u * 4))
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(m.u * 6)) {
                when {
                    list != null && list.ready -> {
                        OptionButton("Y: ROM FOLDER", small, onClick = setup::chooseFolder)
                        Spacer(Modifier.weight(1f))
                        OptionButton("A: BUILD VICTORY ISLAND", m, emphasis = true, modifier = Modifier.widthIn(min = 160.dp), onClick = setup::build)
                    }
                    list != null -> {
                        OptionButton("X: CHECK AGAIN", small, onClick = { setup.checkAgain() })
                        Spacer(Modifier.weight(1f))
                        OptionButton("A: CHOOSE ROM FOLDER", m, emphasis = true, modifier = Modifier.widthIn(min = 160.dp), onClick = setup::chooseFolder)
                    }
                    page is HubSetup.Page.Failed -> {
                        Spacer(Modifier.weight(1f))
                        OptionButton("A: TRY AGAIN", m, emphasis = true, modifier = Modifier.widthIn(min = 160.dp), onClick = { setup.checkAgain() })
                    }
                }
            }
        }
    }
}

@Composable
private fun Checklist(page: HubSetup.Page.Checklist, m: GbaTextMetrics, small: GbaTextMetrics) {
    val found = page.cartridges.found
    val missing = HubCartridgeHeaders.games.filter { it.key !in found }
    if (missing.isEmpty()) {
        Line("All five cartridges found!", m, value = true)
        Spacer(Modifier.height(m.u * 2))
        Line("Victory Island is built from them on this phone, once. Nothing from the games ships with the app.", small)
    } else {
        Line(if (missing.size == 1) "One cartridge is missing:" else "${missing.size} cartridges are missing:", m, value = true)
        Spacer(Modifier.height(m.u * 2))
        for (game in missing) {
            val wrong = page.cartridges.rejected[game.key].orEmpty()
            Line("${game.name} (${game.version}, ${game.code})", small)
            for (copy in wrong) Line("  ${copy.file.name}: ${copy.problems.joinToString(" ")}", small, muted = true)
        }
        Spacer(Modifier.height(m.u * 2))
        Line("Put it in your ROM folder, or choose the folder it's in.", small, muted = true)
    }
    Spacer(Modifier.height(m.u * 6))
    for (game in HubCartridgeHeaders.games) {
        val file = found[game.key]
        Row(Modifier.fillMaxWidth().padding(vertical = small.u), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.weight(1f)) { Line(game.name, small) }
            Line(if (file != null) "FOUND" else "MISSING", small, value = file != null, muted = file == null)
        }
    }
    if (page.note.isNotEmpty()) { Spacer(Modifier.height(m.u * 4)); Line(page.note, small, muted = true) }
}

@Composable
private fun Line(text: String, m: GbaTextMetrics, value: Boolean = false, muted: Boolean = false) {
    val (color, shadow) = when {
        value -> OptionColors.value to OptionColors.valueShadow
        muted -> OptionColors.muted to OptionColors.mutedShadow
        else -> OptionColors.label to OptionColors.labelShadow
    }
    GbaText(text, color, shadow, m, maxLines = Int.MAX_VALUE)
}
