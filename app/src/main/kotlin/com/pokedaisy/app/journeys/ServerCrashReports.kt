package com.pokedaisy.app.journeys

import android.app.ActivityManager
import android.app.ApplicationExitInfo
import android.content.Context
import android.os.Build
import android.util.Log
import com.pokedaisy.app.BuildConfig
import org.json.JSONObject
import java.io.File
import kotlin.concurrent.thread

/**
 * Crash logs for the PokeJourneys server's admin console (its Crashes page, POST /api/crash). A Kotlin crash is
 * written to a file as it happens; the emulators' and the hub's native crashes and freezes come from Android's own
 * record of why the app last closed (Android 11 and later). Both are sent at the next start, once the player is
 * signed in to a server, and kept until then. They go only to the server the player chose.
 */
object ServerCrashReports {
    private const val TAG = "pokejourneys"

    private fun folder(context: Context) = File(context.filesDir, "crash-reports").apply { mkdirs() }

    /** Process start ([com.pokedaisy.app.PokeDaisyApp]): catch Kotlin crashes, then send what's waiting. */
    fun start(context: Context) {
        val app = context.applicationContext
        val previous = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { t, error ->
            runCatching {
                File(folder(app), "crash-${System.currentTimeMillis()}.txt")
                    .writeText("Thread ${t.name}\n${Log.getStackTraceString(error)}".take(32_000))
            }
            previous?.uncaughtException(t, error)
        }
        thread(name = "pokejourneys-crash-reports") { runCatching { collectExits(app); send(app) } }
    }

    /** Native crashes and freezes since the last look, as files beside the Kotlin ones. */
    private fun collectExits(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return
        val seen = context.getSharedPreferences("crash-reports", Context.MODE_PRIVATE)
        val since = seen.getLong("exits", 0L)
        val manager = context.getSystemService(ActivityManager::class.java) ?: return
        var newest = since
        for (exit in manager.getHistoricalProcessExitReasons(null, 0, 20)) {
            if (exit.timestamp <= since) continue
            newest = maxOf(newest, exit.timestamp)
            val kind = when (exit.reason) {
                ApplicationExitInfo.REASON_CRASH_NATIVE -> "Native crash"
                ApplicationExitInfo.REASON_ANR -> "App not responding"
                else -> continue // Kotlin crashes are caught above; the rest are normal closes.
            }
            // A freeze comes with the threads' stacks as text; a native crash's record is binary, so only its summary.
            val stacks = if (exit.reason == ApplicationExitInfo.REASON_ANR)
                runCatching { exit.traceInputStream?.bufferedReader()?.use { it.readText() } }.getOrNull().orEmpty() else ""
            File(folder(context), "exit-${exit.timestamp}.txt").writeText(
                ("$kind in ${exit.processName} (signal or status ${exit.status})\n${exit.description.orEmpty()}\n$stacks").take(32_000))
        }
        if (newest > since) seen.edit().putLong("exits", newest).apply()
    }

    private fun send(context: Context) {
        val files = folder(context).listFiles()?.sortedBy { it.name }?.takeLast(10) ?: return
        if (files.isEmpty()) return
        val server = runCatching { JourneyServer.selected(context) }.getOrNull() ?: return
        for (file in files) {
            val sent = runCatching {
                server.post("/api/crash", JSONObject()
                    .put("version", BuildConfig.VERSION_NAME)
                    .put("device", "${Build.MANUFACTURER} ${Build.MODEL}")
                    .put("android", Build.VERSION.RELEASE)
                    .put("trace", file.readText()))
            }
            // Not signed in or offline: try again next start.
            if (sent.isFailure) return
            file.delete()
        }
        folder(context).listFiles()?.sortedBy { it.name }?.dropLast(10)?.forEach { it.delete() }
    }
}
