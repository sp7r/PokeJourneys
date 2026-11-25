package com.pokedaisy.app.journeys

import android.content.Context
import org.json.JSONObject
import java.util.concurrent.Executors
import kotlin.concurrent.thread

/** Authenticated choice relay. Simulation and the displayed perspective stay in the battle page. */
internal class PvpBattle(context: Context, val config: JSONObject, private val receive: (JSONObject) -> Unit) : AutoCloseable {
    private val connection = JourneyServer.selected(context) ?: error("Connect to a server to battle another player.")
    private val id = config.getString("battle").also { require(it.matches(Regex("[a-zA-Z0-9_-]{1,64}"))) }
    private val path = "/api/battles/$id"
    private val writes = Executors.newSingleThreadExecutor { task -> Thread(task, "pvp-choices") }
    @Volatile private var closed = false
    @Volatile private var ended = false
    private var polling: Thread? = null

    fun start() {
        if (polling != null || closed) return
        polling = thread(name = "pvp-events") {
            var after = 0
            while (!closed && !ended) {
                try {
                    val answer = connection.get("$path/events", mapOf("after" to after.toString()), timeoutSeconds = 35)
                    val events = answer.getJSONArray("events")
                    for (index in 0 until events.length()) {
                        if (closed) return@thread
                        val event = events.getJSONObject(index)
                        if (event.optString("type") == "end") ended = true
                        receive(event)
                    }
                    after = answer.getInt("next")
                } catch (error: Exception) {
                    if (closed) break
                    if (!retryable(error)) { failed(error); break }
                    if (!pause()) break
                }
            }
        }
    }

    fun choice(turn: Int, choice: String, check: String) {
        if (turn < 1 || choice.length > 200 || check.length > 64) return
        post("choice", JSONObject().put("turn", turn).put("choice", choice).put("check", check))
    }

    fun result(winner: Int, check: String) {
        if (winner !in -1..1 || check.length > 64) return
        post("result", JSONObject().put("winner", if (winner == -1) JSONObject.NULL else winner).put("check", check))
    }

    fun forfeit(done: () -> Unit) = post("forfeit", JSONObject(), done)

    /** Return only after queued choices and the result have reached the server. */
    @Synchronized fun settled(done: () -> Unit) { if (!closed) writes.execute { if (!closed) done() } }

    @Synchronized private fun post(action: String, body: JSONObject, done: (() -> Unit)? = null) {
        if (closed) return
        writes.execute {
            while (!closed) {
                if (ended) { done?.invoke(); return@execute }
                try {
                    connection.post("$path/$action", body)
                    if (!closed) done?.invoke()
                    return@execute
                } catch (error: Exception) {
                    if (closed) return@execute
                    if (error is JourneyServer.Failure && error.status == 409 && ended) { done?.invoke(); return@execute }
                    if (!retryable(error)) {
                        failed(error)
                        if (action == "forfeit") done?.invoke()
                        return@execute
                    }
                    // The same body (and choice turn) is retried before any later submission.
                    if (!pause()) return@execute
                }
            }
        }
    }

    private fun retryable(error: Exception) = error is JourneyServer.Failure && (error.status == 0 || error.status >= 500 || error.status == 429)
    private fun failed(error: Exception) {
        if (!closed && !ended) receive(JSONObject().put("type", "error").put("message", error.message ?: "The battle connection failed."))
    }

    private fun pause(): Boolean = try { Thread.sleep(1500); !closed } catch (_: InterruptedException) { false }

    @Synchronized override fun close() {
        closed = true
        polling?.interrupt()
        writes.shutdownNow()
    }
}
