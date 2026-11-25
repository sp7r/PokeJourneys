package com.pokedaisy.app.journeys

import android.content.Context
import com.pokedaisy.app.BuildConfig
import com.pokedaisy.app.companion.i18n.tr
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.HttpUrl.Companion.toHttpUrl
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.io.RandomAccessFile
import java.nio.file.Files
import java.nio.file.AtomicMoveNotSupportedException
import java.nio.file.StandardCopyOption
import java.security.MessageDigest
import java.util.concurrent.TimeUnit

/** Server selection and blocking, account-scoped calls. Call these off the UI thread. */
internal object JourneyServer {
    enum class Choice { OFFLINE, OFFICIAL, CUSTOM }
    private const val PREFS = "journeys-server"
    private val processLock = Any()
    private val http = OkHttpClient.Builder().followRedirects(false).followSslRedirects(false)
        .connectTimeout(10, TimeUnit.SECONDS).readTimeout(20, TimeUnit.SECONDS)
        .callTimeout(30, TimeUnit.SECONDS).build()
    private val jsonType = "application/json; charset=utf-8".toMediaType()

    // Settings lives in the main process; the island reads the same choice in its own process.
    @Suppress("DEPRECATION")
    private fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_MULTI_PROCESS)

    /** No offline play: a build with an official server uses it unless a custom server was chosen. */
    fun choice(context: Context): Choice {
        val stored = runCatching { Choice.valueOf(prefs(context).getString("choice", Choice.OFFLINE.name)!!) }.getOrDefault(Choice.OFFLINE)
        return if (stored == Choice.OFFLINE && officialUrl().isNotEmpty()) Choice.OFFICIAL else stored
    }

    fun customUrl(context: Context): String = prefs(context).getString("url", "").orEmpty()
    fun officialUrl(): String = BuildConfig.OFFICIAL_SERVER_URL.trim()

    fun choose(context: Context, choice: Choice, custom: String = customUrl(context)) {
        val url = if (choice == Choice.CUSTOM) ServerUrl.normalize(custom)
            ?: error(tr("Enter an https:// address, or http:// for a local server.")) else custom
        prefs(context).edit().putString("choice", choice.name).putString("url", url).apply()
    }

    fun selected(context: Context): Connection? {
        val choice = choice(context)
        if (choice == Choice.OFFLINE) return null
        val raw = if (choice == Choice.OFFICIAL) officialUrl() else customUrl(context)
        if (choice == Choice.OFFICIAL && raw.isEmpty()) return null
        val url = ServerUrl.normalize(raw) ?: error(tr("Enter an https:// address, or http:// for a local server."))
        return Connection(context.applicationContext, url, if (choice == Choice.OFFICIAL) tr("Official") else url)
    }

    fun label(context: Context): String = when (choice(context)) {
        Choice.OFFLINE -> tr("Offline")
        Choice.OFFICIAL -> if (officialUrl().isEmpty()) tr("Offline") else tr("Official")
        Choice.CUSTOM -> customUrl(context)
    }

    /** Both app processes serialize complete wallet and Vault operations, including their durable queues. */
    fun <T> locked(context: Context, action: () -> T): T = synchronized(processLock) {
        RandomAccessFile(File(context.filesDir, "journey-server.lock"), "rw").use { file ->
            file.channel.lock().use { action() }
        }
    }

    class Failure(val status: Int, message: String) : IOException(message)

    class Connection internal constructor(private val context: Context, val baseUrl: String, val name: String) {
        private val accountId = DiscordSignIn.account(context)?.id
        val folder: File get() {
            requireAccount()
            val hash = MessageDigest.getInstance("SHA-256").digest(baseUrl.toByteArray(Charsets.UTF_8))
                .take(8).joinToString("") { "%02x".format(it.toInt() and 255) }
            return File(context.filesDir, "accounts/$accountId/servers/$hash").apply { mkdirs() }
        }

        fun requireAccount() {
            check(accountId != null && DiscordSignIn.account(context)?.id == accountId) {
                tr("Sign in with Discord to use {0}.", name)
            }
        }

        /** The live connection for the hub: its WebSocket address and a session token checked just now. */
        fun live(): Pair<String, String> {
            get("/api/me")
            val token = session().optString("sessionToken")
            check(token.isNotBlank()) { tr("Sign in with Discord to use {0}.", name) }
            return baseUrl.replaceFirst("https://", "wss://").replaceFirst("http://", "ws://") + "/api/live" to token
        }

        fun get(path: String, query: Map<String, String> = emptyMap(), timeoutSeconds: Long? = null): JSONObject =
            JSONObject(call(path, null, query, timeoutSeconds))
        fun list(path: String): JSONArray = JSONArray(call(path, null))
        fun post(path: String, body: JSONObject): JSONObject = JSONObject(call(path, body))

        private fun call(path: String, body: JSONObject?, query: Map<String, String> = emptyMap(), timeoutSeconds: Long? = null): String {
            requireAccount()
            var token = session().optString("sessionToken").takeIf { it.isNotBlank() } ?: signIn()
            try {
                return request(path, body, token, query, timeoutSeconds)
            } catch (error: Failure) {
                if (error.status != 401) throw error
            }
            File(folder, "session.json").delete()
            token = signIn()
            return request(path, body, token, query, timeoutSeconds)
        }

        private fun session(): JSONObject = runCatching { File(folder, "session.json").let {
            if (it.isFile) JSONObject(it.readText()) else JSONObject()
        } }.getOrDefault(JSONObject())

        private fun signIn(): String {
            requireAccount()
            val body = JSONObject().put("accessToken", DiscordSignIn.accessToken(context))
            requireAccount()
            val answer = JSONObject(request("/api/auth/discord", body, null))
            val token = answer.getString("sessionToken")
            writeJson(File(folder, "session.json"), answer.toString())
            return token
        }

        private fun request(path: String, body: JSONObject?, token: String?, query: Map<String, String> = emptyMap(), timeoutSeconds: Long? = null): String {
            require(path.startsWith("/api/") && !path.contains('?') && !path.contains('#'))
            val url = (baseUrl + path).toHttpUrl().newBuilder()
            query.forEach { (key, value) -> url.addQueryParameter(key, value) }
            val request = Request.Builder().url(url.build())
            if (body != null) request.post(body.toString().toRequestBody(jsonType))
            if (token != null) request.header("Authorization", "Bearer $token")
            // The server refuses a version older than its newest release (426): UpdateRequiredActivity.
            request.header("X-App-Version", BuildConfig.VERSION_CODE.toString())
            try {
                val client = if (timeoutSeconds == null) http else http.newBuilder()
                    .readTimeout(timeoutSeconds, TimeUnit.SECONDS).callTimeout(timeoutSeconds + 10, TimeUnit.SECONDS).build()
                return client.newCall(request.build()).execute().use { response ->
                    val text = response.body?.string().orEmpty()
                    if (!response.isSuccessful) {
                        if (response.code >= 500) throw Failure(response.code, tr("Can't reach {0}.", name))
                        val message = runCatching { JSONObject(text).getString("error") }.getOrNull()
                            ?: tr("Server request failed ({0}).", response.code)
                        throw Failure(response.code, message)
                    }
                    text
                }
            } catch (error: Failure) {
                throw error
            } catch (error: IOException) {
                throw Failure(0, tr("Can't reach {0}.", name))
            }
        }
    }

    internal fun writeJson(file: File, text: String) {
        file.parentFile?.mkdirs()
        val temporary = File(file.parentFile, file.name + ".tmp")
        try {
            FileOutputStream(temporary).use { out -> out.write(text.toByteArray(Charsets.UTF_8)); out.fd.sync() }
            try {
                Files.move(temporary.toPath(), file.toPath(), StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING)
            } catch (_: AtomicMoveNotSupportedException) {
                Files.move(temporary.toPath(), file.toPath(), StandardCopyOption.REPLACE_EXISTING)
            }
        } finally { temporary.delete() }
    }
}
