package com.pokedaisy.app.journeys

import android.content.Context
import android.util.Log
import com.pokedaisy.app.Prefs
import com.pokedaisy.app.RomCrcs
import com.pokedaisy.app.RomFolder
import com.pokedaisy.app.SaveStates
import com.pokedaisy.app.SavesLocation
import org.json.JSONObject
import java.io.File

/** Blocking shop and save handoff calls into the shared wallet and bag. */
internal object HubEconomy {
    private const val TAG = "JourneyEconomy"

    fun shop(context: Context, action: String, shop: String, destination: String, item: String, quantity: Int): String {
        if (action == "list" && destination.isEmpty()) {
            val prefs = Prefs(context)
            val registered = JourneyIds.roms(context).values.toSet()
            RomFolder.libraryRoms(context, prefs)
                .filter { it !in registered && SavesLocation.saveFor(context, prefs, it).isFile }
                .forEach { JourneyIds.register(context, prefs, it) }
        }
        val args = mutableListOf("shop", action, shop)
        if (action != "list") args.addAll(listOf(item, quantity.toString()))
        if (destination.isNotEmpty()) args.addAll(listOf("--destination", destination))
        val result = ServerWallet.shop(context, action, shop, item, quantity, args.toTypedArray())
        return if (result.ok) result.output else failure(result.error.ifBlank { "The shop is unavailable. Please try again." })
    }

    fun failure(message: String): String = JSONObject().put("error", message).toString()

    fun balance(context: Context): Long = runCatching {
        ServerWallet.refresh(context)
        val account = DiscordSignIn.accountId(context.filesDir)
        val file = File(JourneysBridge.dataDir(context), "accounts/$account/economy.json")
        JSONObject(file.readText()).optJSONObject("funds")?.optLong("money") ?: 0L
    }.getOrDefault(0L)

    /** A newer resume point can contain unsaved progress. Resume that session and project the bag after a real save. */
    fun enter(context: Context, prefs: Prefs, rom: File): Boolean {
        val save = SavesLocation.saveFor(context, prefs, rom)
        if (!save.isFile || !JourneyIds.register(context, prefs, rom).ok) return false
        val states = SaveStates(context.getExternalFilesDir(null) ?: context.filesDir, "%08x".format(RomCrcs.of(context, rom)))
        val resume = states.resumeFile
        val canWrite = !resume.isFile || resume.lastModified() <= save.lastModified() + 2_000 || states.freshBootFile.exists()
        val args = mutableListOf("economy", "enter", JourneyIds.idFor(rom))
        if (canWrite) args += "--write"
        val result = ServerWallet.run(context, JourneyIds.idFor(rom), *args.toTypedArray())
        if (!result.ok) {
            Log.w(TAG, result.error)
            return false
        }
        // A save written before an interrupted launch still takes precedence over its older resume point.
        if (result.output == "changed" || result.output == "unchanged" && resume.isFile && save.lastModified() > resume.lastModified()) {
            states.freshBootFile.createNewFile()
        }
        return result.output == "pending"
    }

    fun leave(context: Context, rom: File) {
        val result = ServerWallet.run(context, JourneyIds.idFor(rom), "economy", "leave", JourneyIds.idFor(rom))
        if (!result.ok) Log.w(TAG, result.error)
    }
}
