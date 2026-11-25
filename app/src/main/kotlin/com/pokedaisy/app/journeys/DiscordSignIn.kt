package com.pokedaisy.app.journeys

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.util.Base64
import android.util.Log
import com.pokedaisy.app.BuildConfig
import okhttp3.FormBody
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.io.File
import java.security.MessageDigest
import java.security.SecureRandom
import kotlin.concurrent.thread

/**
 * Signing in with Discord (OAuth2 with PKCE, Discord's flow for apps without a server): the player signs in in the
 * Discord app (or on Discord's own page in the browser when the app isn't installed), Discord sends a one-time code back to [Callback], and the app trades it for a
 * token and reads the player's Discord id and name. No password reaches PokeJourneys, and nothing needs a server
 * yet; a PokeJourneys server can later check the same token with Discord.
 *
 * Needs a Discord application's client id: `discord.clientId` in local.properties (or DISCORD_CLIENT_ID), with
 * `discord-<client id>:/authorize/callback` added to the application's OAuth2 redirects and Public Client turned on.
 * Without one, [available] is false and the hub skips its sign-in screen.
 *
 * The account (id, name and tokens) is kept in the app's private files, readable by both of its processes.
 */
object DiscordSignIn {
    private const val TAG = "pokejourneys"
    private const val AUTHORIZE = "https://discord.com/oauth2/authorize"
    private const val TOKEN = "https://discord.com/api/oauth2/token"
    private const val ME = "https://discord.com/api/users/@me"

    class Account(val id: String, val name: String)

    /** Called with the account, or null and a message for the player. */
    var listener: ((Account?, String) -> Unit)? = null

    // The sign-in in progress (the hub's process keeps it while the browser is open).
    private var verifier: String? = null
    private var state: String? = null
    // Whether this run of the hub already sent the player to the Discord app.
    private var triedApp = false

    private val clientId get() = BuildConfig.DISCORD_CLIENT_ID
    private val redirect get() = "discord-$clientId:/authorize/callback"

    fun available(): Boolean = clientId.isNotBlank()

    private fun file(context: Context) = File(context.filesDir, "discord-account.json")

    /** The folder name for the signed-in account's own files (accounts/<id>/), or "local" with nobody signed in. */
    fun accountId(filesDir: File): String =
        runCatching { JSONObject(File(filesDir, "discord-account.json").readText()).getString("id") }.getOrNull()
            ?.takeIf { it.isNotBlank() } ?: "local"

    /** The signed-in account, or null. */
    fun account(context: Context): Account? = runCatching {
        val json = JSONObject(file(context).readText())
        Account(json.getString("id"), json.getString("name"))
    }.getOrNull()

    /** Opens Discord's sign-in page; the answer comes to [listener]. */
    fun start(activity: Activity) {
        val random = SecureRandom()
        val code = ByteArray(32).also(random::nextBytes)
        val verifier = base64(code)
        val state = base64(ByteArray(16).also(random::nextBytes))
        this.verifier = verifier
        this.state = state
        val challenge = base64(MessageDigest.getInstance("SHA-256").digest(verifier.toByteArray(Charsets.US_ASCII)))
        val url = Uri.parse(AUTHORIZE).buildUpon()
            .appendQueryParameter("response_type", "code")
            .appendQueryParameter("client_id", clientId)
            .appendQueryParameter("scope", "identify")
            .appendQueryParameter("redirect_uri", redirect)
            .appendQueryParameter("code_challenge", challenge)
            .appendQueryParameter("code_challenge_method", "S256")
            .appendQueryParameter("state", state)
            .appendQueryParameter("prompt", "consent")
            .build()
        // The first try goes to the Discord app's own link (discord://action/oauth2/authorize, same query); a try after
        // that, or without the app, goes to Discord's page in the browser.
        val inApp = Uri.parse("discord://action/oauth2/authorize?" + url.encodedQuery)
        runCatching {
            check(!triedApp)
            triedApp = true
            activity.startActivity(Intent(Intent.ACTION_VIEW, inApp).setPackage("com.discord"))
        }
            .recoverCatching { activity.startActivity(Intent(Intent.ACTION_VIEW, url)) }
            .onFailure { finish(null, "Couldn't open Discord.") }
    }

    /** Discord's answer at the redirect: trades the code for a token, then reads who signed in. Off the UI thread. */
    fun complete(context: Context, uri: Uri) {
        val expected = state
        val verifier = verifier
        val code = uri.getQueryParameter("code")
        when {
            uri.getQueryParameter("error") != null -> return finish(null, "Sign-in was cancelled.")
            code == null || verifier == null || uri.getQueryParameter("state") != expected ->
                return finish(null, "Sign-in didn't finish.")
        }
        state = null
        this.verifier = null
        thread(name = "pokejourneys-discord") {
            val result = runCatching {
                val http = OkHttpClient()
                val form = FormBody.Builder()
                    .add("grant_type", "authorization_code")
                    .add("code", code!!)
                    .add("redirect_uri", redirect)
                    .add("client_id", clientId)
                    .add("code_verifier", verifier!!)
                    .build()
                val token = http.newCall(Request.Builder().url(TOKEN).post(form).build()).execute().use { response ->
                    val body = response.body?.string().orEmpty()
                    check(response.isSuccessful) { "token ${response.code}" }
                    JSONObject(body)
                }
                val access = token.getString("access_token")
                val me = http.newCall(Request.Builder().url(ME).header("Authorization", "Bearer $access").build())
                    .execute().use { response ->
                        val body = response.body?.string().orEmpty()
                        check(response.isSuccessful) { "user ${response.code}: $body" }
                        JSONObject(body)
                    }
                val name = me.optString("global_name").takeIf { it.isNotBlank() && it != "null" } ?: me.getString("username")
                val saved = JSONObject()
                    .put("id", me.getString("id"))
                    .put("name", name)
                    .put("username", me.getString("username"))
                    .put("access_token", access)
                    .put("refresh_token", token.optString("refresh_token"))
                    .put("expires_at", System.currentTimeMillis() / 1000 + token.optLong("expires_in"))
                    .put("scope", token.optString("scope"))
                file(context).writeText(saved.toString())
                Account(me.getString("id"), name)
            }
            result.onFailure { Log.w(TAG, "Discord sign-in failed", it) }
            finish(result.getOrNull(), if (result.isSuccess) "" else "Couldn't reach Discord.")
        }
    }

    /** Blocking sign-in token access: call off the UI thread; never expose this to Godot. */
    @Synchronized
    internal fun accessToken(context: Context, forceRefresh: Boolean = false): String {
        val saved = runCatching { JSONObject(file(context).readText()) }.getOrNull()
            ?: error("Sign in to Discord first.")
        if (forceRefresh || saved.optLong("expires_at") <= System.currentTimeMillis() / 1000 + 60) {
            val refresh = saved.optString("refresh_token")
            check(refresh.isNotBlank()) { "Sign in to Discord again." }
            val form = FormBody.Builder().add("grant_type", "refresh_token")
                .add("client_id", clientId).add("refresh_token", refresh).build()
            val token = OkHttpClient().newCall(Request.Builder().url(TOKEN).post(form).build())
                .execute().use { response ->
                    check(response.isSuccessful) { "Discord token refresh failed (${response.code}). Sign in again." }
                    JSONObject(response.body?.string().orEmpty())
                }
            saved.put("access_token", token.getString("access_token"))
                .put("expires_at", System.currentTimeMillis() / 1000 + token.getLong("expires_in"))
            token.optString("refresh_token").takeIf { it.isNotBlank() }?.let { saved.put("refresh_token", it) }
            if (token.has("scope")) saved.put("scope", token.getString("scope"))
            // Keep refresh rotation durable without leaving a partially written account file.
            val pending = File(context.filesDir, "discord-account.tmp")
            pending.writeText(saved.toString())
            check(pending.renameTo(file(context))) { "Couldn't save refreshed Discord sign-in." }
        }
        return saved.getString("access_token")
    }

    fun signOut(context: Context) {
        file(context).delete()
    }

    private fun finish(account: Account?, message: String) {
        listener?.invoke(account, message)
    }

    private fun base64(bytes: ByteArray) = Base64.encodeToString(bytes, Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP)

    /**
     * Discord's redirect (`discord-<client id>:/authorize/callback`). It runs in the hub's process, where the sign-in
     * started, and closes straight away: the app's task, with the hub in it, comes back to the front.
     */
    class Callback : Activity() {
        override fun onCreate(savedInstanceState: Bundle?) {
            super.onCreate(savedInstanceState)
            intent?.data?.let { complete(applicationContext, it) }
            startActivity(Intent(this, HubActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_REORDER_TO_FRONT))
            finish()
        }
    }
}
