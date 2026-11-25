package com.pokedaisy.app.journeys

import android.content.Context
import com.pokedaisy.app.companion.i18n.tr
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.UUID

/** Mirrors the chosen server's Vault into the bridge's existing Vault. All calls are blocking. */
internal object ServerVault {
    fun sync(context: Context): String = JourneyServer.locked(context) {
        val server = JourneyServer.selected(context) ?: return@locked ""
        runCatching { Sync(context, server).sync() }.getOrElse { it.message.orEmpty() }
    }

    fun run(context: Context, vararg args: String): JourneysBridge.Result = JourneyServer.locked(context) {
        val server = JourneyServer.selected(context)
        if (server == null || DiscordSignIn.account(context) == null) return@locked JourneysBridge.run(context, *args)
        try {
            Sync(context, server).run(args)
        } catch (error: Exception) {
            JourneysBridge.Result(1, "", error.message ?: tr("Can't reach {0}.", server.name))
        }
    }

    private class Sync(private val context: Context, private val server: JourneyServer.Connection) {
        private val file = File(server.folder, "vault-map.json")
        private val mappings = read(file)
        private val operationsFile = File(server.folder, "vault-withdrawals.json")
        private val operations = read(operationsFile)
        private val importFile = File(server.folder, "vault-import.json")

        fun run(args: Array<out String>): JourneysBridge.Result {
            server.requireAccount()
            recoverImport()
            return if (args.firstOrNull() == "withdraw") withdraw(args) else JourneysBridge.run(context, *args)
        }

        fun sync(): String {
            recoverWithdrawals()
            recoverImport()
            var local = entries()
            for (entry in local) {
                val id = entry.getString("id")
                if (mappings.has(id)) continue
                val data = bridge("vault", "data", id).output
                try {
                    val row = server.post("/api/vault/deposit", JSONObject().put("data", data)
                        .put("journey", entry.optString("fromGame"))
                        .put("requestId", "deposit-$id"))
                    mappings.put(id, JSONObject().put("serverId", row.get("id").toString()).put("state", "uploaded"))
                } catch (error: JourneyServer.Failure) {
                    if (error.status != 400 && error.status != 409) throw error
                    mappings.put(id, JSONObject().put("serverId", JSONObject.NULL).put("state", "refused")
                        .put("message", error.message))
                }
                saveMap()
            }
            val remote = server.get("/api/me").getJSONArray("vault").objects()
                .associateBy { it.get("id").toString() }
            val localIds = local.map { it.getString("id") }.toSet()
            for (id in mappings.keys().asSequence().toList()) {
                val mapping = mappings.getJSONObject(id)
                val state = remote[mapping.optString("serverId")]?.getString("state")
                if (id in localIds && VaultMappingRules.dropLocal(mapping.getString("state"), state)) {
                    bridge("vault", "drop", id)
                    mappings.remove(id)
                    saveMap()
                } else if (id !in localIds) {
                    mappings.remove(id)
                    saveMap()
                }
            }
            local = entries()
            val existing = local.mapNotNull { mappings.optJSONObject(it.getString("id"))?.optString("serverId") }.toSet()
            for ((id, row) in remote) {
                if (!VaultMappingRules.fetch(row.getString("state"), id in existing)) continue
                val entity = server.get("/api/vault/$id")
                val temporary = File.createTempFile("vault-", ".txt", context.cacheDir)
                try {
                    temporary.writeText(entity.getString("data"))
                    val args = mutableListOf("vault", "import", temporary.path)
                    entity.optString("originGame").takeIf { it.isNotBlank() && it != "null" }
                        ?.let { args.addAll(listOf("--from", it)) }
                    JourneyServer.writeJson(importFile, JSONObject().put("serverId", id)
                        .put("before", JSONArray(entries().map { it.getString("id") })).toString())
                    val imported = JSONObject(bridge(*args.toTypedArray()).output)
                    mappings.put(imported.getString("id"), JSONObject().put("serverId", id).put("state", "uploaded"))
                    saveMap()
                    check(importFile.delete()) { "Couldn't finish saving the Vault import." }
                } finally { temporary.delete() }
            }
            return entries().mapNotNull { entry ->
                mappings.optJSONObject(entry.getString("id"))?.takeIf { it.optString("state") == "refused" }
                    ?.let { entry.getString("summary") + ": " + it.getString("message") }
            }.joinToString("\n")
        }

        private fun withdraw(args: Array<out String>): JourneysBridge.Result {
            val id = args[1]
            if (!VaultMappingRules.remoteWithdraw(mappings.optJSONObject(id)?.optString("state")))
                return JourneysBridge.run(context, *args)
            recoverWithdrawals()
            val serverId = mappings.getJSONObject(id).getString("serverId")
            val operation = JSONObject().put("serverId", serverId).put("journey", args[2])
                .put("requestId", "withdraw-$id-${random().take(16)}")
                .put("finishId", random()).put("phase", "reserve")
            operations.put(id, operation)
            saveOperations()
            try {
                reserve(operation)
            } catch (error: JourneyServer.Failure) {
                if (error.status in 400..499 && error.status != 401) {
                    operations.remove(id)
                    saveOperations()
                }
                throw error
            }
            val result = try {
                server.requireAccount()
                JourneysBridge.run(context, *args)
            } catch (error: Exception) {
                JourneysBridge.Result(1, "", error.message.orEmpty())
            }
            operation.put("phase", if (result.ok) "confirm" else "cancel")
            saveOperations()
            // A written save is successful even if confirmation has to wait for the next connection.
            val finished = runCatching { finish(id, operation, result.ok) }
            if (!result.ok) finished.getOrThrow()
            return result
        }

        private fun recoverWithdrawals() {
            val local = entries().map { it.getString("id") }.toSet()
            for (id in operations.keys().asSequence().toList()) {
                val operation = operations.getJSONObject(id)
                if (operation.getString("phase") == "reserve") {
                    // Retry the reservation with the same id when its first response was lost.
                    try {
                        reserve(operation)
                    } catch (error: JourneyServer.Failure) {
                        if (error.status != 400 && error.status != 404 && error.status != 409) throw error
                        operations.remove(id)
                        saveOperations()
                        continue
                    }
                }
                val confirmed = operation.getString("phase") == "confirm" ||
                    operation.getString("phase") == "reserve" && id !in local
                try {
                    finish(id, operation, confirmed)
                } catch (error: JourneyServer.Failure) {
                    if (error.status != 404) throw error
                    operations.remove(id)
                    saveOperations()
                }
            }
        }

        private fun recoverImport() {
            if (!importFile.isFile) return
            val pending = JSONObject(importFile.readText())
            val before = pending.getJSONArray("before")
            val ids = (0 until before.length()).map { before.getString(it) }.toSet()
            val added = entries().filter { it.getString("id") !in ids }
            check(added.size <= 1) { "Couldn't match the interrupted Vault import." }
            added.singleOrNull()?.let {
                mappings.put(it.getString("id"), JSONObject().put("serverId", pending.getString("serverId"))
                    .put("state", "uploaded"))
                saveMap()
            }
            check(importFile.delete()) { "Couldn't finish saving the Vault import." }
        }

        private fun reserve(operation: JSONObject) {
            server.post("/api/vault/${operation.getString("serverId")}/withdraw", JSONObject()
                .put("journey", operation.getString("journey")).put("requestId", operation.getString("requestId")))
        }

        private fun finish(id: String, operation: JSONObject, confirmed: Boolean) {
            val action = if (confirmed) "confirm" else "cancel"
            server.post("/api/vault/${operation.getString("serverId")}/withdraw/$action",
                JSONObject().put("requestId", operation.getString("finishId")))
            if (confirmed) {
                mappings.remove(id)
                saveMap()
            }
            operations.remove(id)
            saveOperations()
        }

        private fun entries(): List<JSONObject> = JSONArray(bridge("vault", "list", "--json").output).objects()
        private fun bridge(vararg args: String): JourneysBridge.Result {
            server.requireAccount()
            return JourneysBridge.run(context, *args).also { check(it.ok) { it.error } }
        }
        private fun saveMap() = JourneyServer.writeJson(file, mappings.toString())
        private fun saveOperations() = JourneyServer.writeJson(operationsFile, operations.toString())
    }

    private fun random() = UUID.randomUUID().toString().replace("-", "")
    private fun read(file: File): JSONObject = if (file.isFile) JSONObject(file.readText()) else JSONObject()
    private fun JSONArray.objects(): List<JSONObject> = (0 until length()).map { getJSONObject(it) }
}
