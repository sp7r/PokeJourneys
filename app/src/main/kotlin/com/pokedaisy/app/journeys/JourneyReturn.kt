package com.pokedaisy.app.journeys

import androidx.compose.foundation.layout.heightIn
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.pokedaisy.app.companion.i18n.tr
import com.pokedaisy.app.companion.ui.OptionButton
import com.pokedaisy.app.companion.ui.OptionConfirm
import com.pokedaisy.app.companion.ui.rememberGbaTextMetrics

@Composable
internal fun ReturnToHubButton(onClick: () -> Unit) {
    OptionButton(
        tr("Return to hub"), rememberGbaTextMetrics(), onClick,
        modifier = Modifier.heightIn(min = 36.dp),
    )
}

@Composable
internal fun ReturnToHubConfirm(onConfirm: () -> Unit, onDismiss: () -> Unit) {
    OptionConfirm(
        title = tr("Return to hub"),
        message = tr("Close this journey and return to Victory Island?"),
        confirmLabel = tr("Yes"),
        cancelLabel = tr("No"),
        m = rememberGbaTextMetrics(),
        onConfirm = onConfirm,
        onDismiss = onDismiss,
    )
}
