package com.pokedaisy.app.journeys

import android.content.Context
import java.io.File
import kotlin.concurrent.thread

/**
 * The PokeJourneys save bridge: the trainer profile, the journey library and the vault that moves Pokémon between
 * games (src/Journeys.Core, on PKHeX.Core). It's compiled ahead of time for Android and shipped as
 * lib/arm64-v8a/libjourneys.so (app/build.gradle.kts, journeysBridge), a program this runs with the same commands as
 * the desktop `journeys` command line. Its data lives in the app's own files folder.
 *
 * Blocking (starts a process and waits for it): never call on the UI thread.
 */
object JourneysBridge {

    class Result(val exitCode: Int, val output: String, val error: String) {
        val ok: Boolean get() = exitCode == 0
    }

    /** Where the bridge keeps its profile, library, vault and backups. */
    fun dataDir(context: Context): File = File(context.getExternalFilesDir(null), "journeys").apply { mkdirs() }

    /** Runs the bridge with [args] (for example "show", "emerald") and returns what it printed. */
    fun run(context: Context, vararg args: String): Result {
        val program = File(context.applicationInfo.nativeLibraryDir, "libjourneys.so")
        val process = ProcessBuilder(listOf(program.path) + args)
            .apply {
                environment()["JOURNEYS_DATA"] = dataDir(context).path
                environment()["JOURNEYS_ACCOUNT"] = DiscordSignIn.accountId(context.filesDir)
            }
            .start()
        var error = ""
        val errors = thread(name = "journeys-stderr") { error = process.errorStream.bufferedReader().readText() }
        val output = process.inputStream.bufferedReader().readText()
        val exitCode = process.waitFor()
        errors.join()
        return Result(exitCode, output.trim(), error.trim())
    }
}
