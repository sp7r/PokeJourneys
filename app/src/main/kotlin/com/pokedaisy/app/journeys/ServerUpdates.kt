package com.pokedaisy.app.journeys

import com.pokedaisy.app.AppUpdater
import com.pokedaisy.app.BuildConfig
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

object ServerUpdates {
    fun pageUrl(): String = JourneyServer.officialUrl().trimEnd('/').let {
        if (it.isEmpty()) "" else "$it/download"
    }

    /** The official server's newest published release, if newer than [current]. Blocking. */
    fun check(current: String): AppUpdater.Release? {
        val server = JourneyServer.officialUrl().trimEnd('/')
        if (server.isEmpty()) return null
        return runCatching {
            val conn = (URL("$server/api/app/latest").openConnection() as HttpURLConnection).apply {
                connectTimeout = 8000
                readTimeout = 8000
                setRequestProperty("Accept", "application/json")
                setRequestProperty("User-Agent", "PokeJourneys/$current")
                setRequestProperty("X-App-Version", BuildConfig.VERSION_CODE.toString())
            }
            try {
                val body = conn.inputStream.use { JSONObject(it.readBytes().toString(Charsets.UTF_8)) }
                AppUpdater.Release(
                    version = body.getString("version"),
                    notes = body.optString("notes").trim(),
                    apkUrl = URL(URL("$server/"), body.getString("url")).toString(),
                    apkSize = body.getLong("size"),
                    pageUrl = "$server/download",
                    sha256 = body.optString("sha256").trim().takeIf { it.isNotEmpty() },
                )
            } finally {
                conn.disconnect()
            }
        }.getOrNull()?.takeIf { AppUpdater.isNewer(it.version, current) }
    }

    fun verifySha256(file: File, expected: String?): Boolean {
        if (expected.isNullOrBlank()) return true
        return runCatching {
            val digest = MessageDigest.getInstance("SHA-256")
            file.inputStream().use { input ->
                val buffer = ByteArray(1 shl 16)
                while (true) {
                    val count = input.read(buffer)
                    if (count < 0) break
                    digest.update(buffer, 0, count)
                }
            }
            val actual = digest.digest().joinToString("") { "%02x".format(it.toInt() and 0xff) }
            actual.equals(expected, ignoreCase = true)
        }.getOrDefault(false)
    }
}
