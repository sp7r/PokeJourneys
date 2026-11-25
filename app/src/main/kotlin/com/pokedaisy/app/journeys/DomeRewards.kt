package com.pokedaisy.app.journeys

import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.nio.file.AtomicMoveNotSupportedException
import java.nio.file.Files
import java.nio.file.StandardCopyOption

/** One Experience per completed bot win; every playlist's Rating and peak Rating are preserved. */
internal object DomeRewards {
    @Synchronized
    fun recordWin(accountDir: File, matchId: String): StadiumRank {
        require(matchId.matches(Regex("[a-f0-9]{32}")))
        val file = File(accountDir, "stadium-rank.json")
        val data = if (file.isFile) JSONObject(file.readText()) else JSONObject()
        val before = StadiumRank.fromJson(data)
        val recorded = data.optJSONArray("botResults") ?: JSONArray()
        if ((0 until recorded.length()).any { recorded.optString(it) == matchId }) return before
        val after = before.afterBattle(won = true)
        val ids = JSONArray()
        for (i in maxOf(0, recorded.length() - 255) until recorded.length()) ids.put(recorded.getString(i))
        ids.put(matchId)
        StadiumRank.toJson(after, data).put("botResults", ids)
        accountDir.mkdirs()
        val temporary = File(accountDir, "stadium-rank.json.tmp")
        try {
            FileOutputStream(temporary).use { out -> out.write(data.toString().toByteArray()); out.fd.sync() }
            try {
                Files.move(temporary.toPath(), file.toPath(), StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING)
            } catch (_: AtomicMoveNotSupportedException) {
                Files.move(temporary.toPath(), file.toPath(), StandardCopyOption.REPLACE_EXISTING)
            }
        } finally { temporary.delete() }
        return after
    }
}
