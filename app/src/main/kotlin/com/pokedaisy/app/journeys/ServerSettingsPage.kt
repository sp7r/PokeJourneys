package com.pokedaisy.app.journeys

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import com.pokedaisy.app.companion.i18n.tk
import com.pokedaisy.app.companion.i18n.tr
import com.pokedaisy.app.companion.ui.GbaText
import com.pokedaisy.app.companion.ui.GbaTextMetrics
import com.pokedaisy.app.companion.ui.OptionButton
import com.pokedaisy.app.companion.ui.OptionColors
import com.pokedaisy.app.companion.ui.OptionLine
import com.pokedaisy.app.companion.ui.OptionListWindow
import com.pokedaisy.app.companion.ui.OptionTextField
import com.pokedaisy.app.companion.ui.PageHint
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

@Composable
internal fun ServerSettingsPage(m: GbaTextMetrics, small: GbaTextMetrics) {
    val context = LocalContext.current.applicationContext
    val scope = rememberCoroutineScope()
    var choice by remember { mutableStateOf(JourneyServer.choice(context)) }
    var url by remember { mutableStateOf(JourneyServer.customUrl(context)) }
    var busy by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf("") }
    val account = DiscordSignIn.account(context)

    fun save(): Boolean = runCatching {
        JourneyServer.choose(context, choice, url)
        if (choice == JourneyServer.Choice.CUSTOM) url = JourneyServer.customUrl(context)
        message = ""
    }.onFailure { message = it.message.orEmpty() }.isSuccess

    fun pick(value: JourneyServer.Choice) {
        choice = value
        message = ""
        if (value != JourneyServer.Choice.CUSTOM || ServerUrl.normalize(url) != null) save()
    }

    Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState())) {
        PageHint(tr("Your wallet, bag and Vault live on the server, for your Discord account. Pick another server only if you host your own."), m, small)
        OptionListWindow(m, Modifier.fillMaxWidth()) {
            Column {
                // Offline is only offered by a build without an official server (self-built apps).
                if (JourneyServer.officialUrl().isEmpty()) {
                    OptionLine(tk("OFFLINE"), if (choice == JourneyServer.Choice.OFFLINE) tk("ON") else null,
                        false, m, enabled = !busy) { pick(JourneyServer.Choice.OFFLINE) }
                }
                if (JourneyServer.officialUrl().isNotEmpty()) {
                    OptionLine(tk("OFFICIAL"), if (choice == JourneyServer.Choice.OFFICIAL) tk("ON") else null,
                        false, m, enabled = !busy) { pick(JourneyServer.Choice.OFFICIAL) }
                }
                OptionLine(tk("CUSTOM URL"), if (choice == JourneyServer.Choice.CUSTOM) tk("ON") else null,
                    false, m, enabled = !busy) { pick(JourneyServer.Choice.CUSTOM) }
                Column(Modifier.padding(horizontal = m.u * 4, vertical = m.u * 2)) {
                    if (choice == JourneyServer.Choice.CUSTOM) {
                        OptionTextField(url, { if (!busy) { url = it; message = "" } }, small,
                            placeholder = "https://server.example.com")
                    }
                    GbaText(if (account == null) tr("Not signed in with Discord.") else tr("Discord: {0}", account.name),
                        OptionColors.label, OptionColors.labelShadow, small,
                        Modifier.padding(vertical = m.u * 4), maxLines = 4)
                    Row(horizontalArrangement = Arrangement.spacedBy(m.u * 4)) {
                        if (choice == JourneyServer.Choice.CUSTOM) {
                            OptionButton(tk("SAVE"), m, enabled = !busy, onClick = { save() })
                        }
                        OptionButton(tk("CHECK"), m, enabled = !busy && choice != JourneyServer.Choice.OFFLINE, onClick = {
                            if (save()) {
                                busy = true
                                message = tr("Checking server…")
                                scope.launch {
                                    val result = withContext(Dispatchers.IO) { runCatching { ServerWallet.check(context) } }
                                    message = result.fold({ tr("Wallet: {0} Pokéyen", it) }, { it.message.orEmpty() })
                                    busy = false
                                }
                            }
                        })
                    }
                    if (message.isNotEmpty()) GbaText(message, OptionColors.value, OptionColors.valueShadow, small,
                        Modifier.padding(vertical = m.u * 4), maxLines = Int.MAX_VALUE)
                }
            }
        }
    }
}
