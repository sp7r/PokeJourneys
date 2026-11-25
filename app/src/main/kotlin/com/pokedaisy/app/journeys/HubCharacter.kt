package com.pokedaisy.app.journeys

import android.content.Context
import org.json.JSONObject
import java.io.File

/**
 * The creator's character kept with the Discord account on the server (/api/character), so a new install or another
 * phone skips the creator. The hub's own copy stays the account's `character.json` (character.gd, CreatorLook.kt).
 */
internal object HubCharacter {
    private fun file(context: Context) = File(context.filesDir, "accounts/${DiscordSignIn.accountId(context.filesDir)}/character.json")

    private fun local(context: Context): JSONObject? =
        runCatching { JSONObject(file(context).readText()) }.getOrNull()?.takeIf { it.length() > 0 }

    /**
     * Blocking, before the hub reads the look: no character on the phone takes the server's; one on the phone that the
     * server lacks (made before it kept them) goes up.
     */
    fun sync(context: Context) {
        if (DiscordSignIn.account(context) == null) return
        val server = JourneyServer.selected(context) ?: return
        val saved = server.get("/api/character").optJSONObject("look")?.takeIf { it.length() > 0 }
        val mine = local(context)
        when {
            mine == null && saved != null -> {
                file(context).parentFile?.mkdirs()
                JourneyServer.writeJson(file(context), saved.toString(2))
            }
            mine != null && saved == null -> server.post("/api/character", JSONObject().put("look", mine))
        }
    }

    /** Blocking: the creator saved a new look; the server keeps it too. */
    fun upload(context: Context) {
        if (DiscordSignIn.account(context) == null) return
        val mine = local(context) ?: return
        JourneyServer.selected(context)?.post("/api/character", JSONObject().put("look", mine))
    }
}
