package com.pokedaisy.app.journeys

import android.content.Context
import android.util.Log
import com.pokedaisy.app.companion.i18n.tr
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.UUID

/** Keeps the bridge's working wallet usable while reports wait for a connection. */
internal object ServerWallet {
    fun run(context: Context, source: String, vararg args: String): JourneysBridge.Result =
        JourneyServer.locked(context) {
            val server = JourneyServer.selected(context)
            if (server == null || DiscordSignIn.account(context) == null) JourneysBridge.run(context, *args)
            else Sync(context, server).around(source) { JourneysBridge.run(context, *args) }
        }

    fun shop(context: Context, action: String, shop: String, item: String, quantity: Int,
             args: Array<String>): JourneysBridge.Result = JourneyServer.locked(context) {
        val server = JourneyServer.selected(context)
            ?: return@locked JourneysBridge.run(context, *args)
        try {
            val sync = Sync(context, server)
            val pending = File(server.folder, "pending-shop.json")
            val retry = if (pending.isFile) JSONObject(pending.readText()).let {
                it.getString("action") == action && it.getString("item") == serverShopKey(shop, item) &&
                    it.getInt("count") == quantity
            } else false
            if (action != "list") sync.prepare()
            val listArgs = if (action == "list") args else arrayOf("shop", "list", shop)
            var view = sync.around("hub") { JourneysBridge.run(context, *listArgs) }
            if (!view.ok) return@locked view
            if (action != "list") {
                check(action == "buy" || action == "sell") { tr("This shop cannot make that trade.") }
                check(sync.prepare()) { tr("Save in an official journey to bring your money and bag to the island.") }
                if (!retry) {
                    JourneyServer.writeJson(pending, JSONObject().put("action", action)
                        .put("item", serverShopKey(shop, item)).put("count", quantity)
                        .put("requestId", UUID.randomUUID().toString()).toString())
                    sync.finishTrade()
                }
                check(sync.prepare()) { tr("Bring your wallet to this server first.") }
                view = sync.around("hub") { JourneysBridge.run(context, *listArgs) }
            }
            if (!view.ok) view else JourneysBridge.Result(0, sync.prices(JSONObject(view.output), shop).toString(), "")
        } catch (error: Exception) {
            JourneysBridge.Result(1, "", error.message ?: tr("Can't reach {0}.", server.name))
        }
    }

    /** CHECK signs in through the same recovery and wallet-linking path as playing. */
    fun check(context: Context): Long = JourneyServer.locked(context) {
        val server = JourneyServer.selected(context) ?: error(tr("Choose a server first."))
        val sync = Sync(context, server)
        sync.prepare()
        server.get("/api/wallet").getLong("money")
    }

    fun refresh(context: Context) = JourneyServer.locked(context) {
        JourneyServer.selected(context)?.let { server ->
            runCatching { Sync(context, server).prepare() }
                .onFailure { Log.w("JourneyEconomy", "Wallet sync is waiting", it) }
        }
        Unit
    }

    private class Sync(private val context: Context, private val server: JourneyServer.Connection) {
        private val file = File(server.folder, "pending-reports.json")
        private val data = if (file.isFile) JSONObject(file.readText()) else JSONObject().put("reports", JSONArray())
        private var reports: JSONArray
            get() = data.getJSONArray("reports")
            set(value) { data.put("reports", value) }

        fun around(source: String, action: () -> JourneysBridge.Result): JourneysBridge.Result {
            if (!data.has("baseline")) {
                data.put("baseline", export().json())
                save()
            }
            recoverReport()
            runCatching { prepare() }.onFailure(::waiting)
            val before = export()
            data.put("operation", JSONObject().put("source", source).put("before", before.json()))
            save()
            try {
                server.requireAccount()
                return action()
            } finally {
                recoverReport()
                runCatching { prepare() }.onFailure(::waiting)
            }
        }

        fun prepare(): Boolean {
            if (!data.has("baseline")) {
                data.put("baseline", export().json())
                save()
            }
            recoverReport()
            if (!flush()) return false
            finishTrade(importAnswer = false)
            var wallet = server.get("/api/wallet")
            if (!wallet.getBoolean("imported")) {
                if (!link()) return false
                if (!flush()) return false
                wallet = server.get("/api/wallet")
            }
            importWallet(wallet)
            data.put("baseline", export().json()).remove("seed")
            save()
            return true
        }

        private fun recoverReport() {
            val operation = data.optJSONObject("operation") ?: return
            val before = snapshot(operation.getJSONObject("before"))
            val after = export()
            val change = after.difference(before)
            if (!change.empty || after.ready && !before.ready) {
                val report = report(operation.getString("source"), change)
                // The first save's seed belongs in the first import when it happened without a connection.
                if (!data.getJSONObject("baseline").optBoolean("ready") && after.ready) {
                    data.put("baseline", after.json()).put("seed", report.getString("requestId"))
                }
                reports.put(report)
            }
            data.remove("operation")
            save()
        }

        /**
         * The server's wallet wins: linking brings nothing from the phone (an empty "import" only marks the wallet as
         * linked), and changes made on the phone before the link are dropped. prepare() then copies the server's
         * money and bag onto the phone.
         */
        private fun link(): Boolean {
            reports = JSONArray().put(report("import", WalletChange(0L, emptyMap())))
            data.remove("seed")
            save()
            return true
        }

        private fun flush(): Boolean {
            while (reports.length() > 0) {
                val first = reports.getJSONObject(0)
                try {
                    server.post("/api/wallet/report", first)
                } catch (error: JourneyServer.Failure) {
                    if (error.status == 409 && first.getString("source") != "import" &&
                        error.message == "Bring your wallet to this server first.") {
                        if (!link()) return false
                        continue
                    }
                    if (error.status == 409 && first.getString("source") == "import" &&
                        error.message == "This wallet was already brought to this server.") {
                        reports.remove(0)
                        save()
                        continue
                    }
                    throw error
                }
                reports.remove(0)
                if (first.getString("source") == "import") {
                    val seed = data.optString("seed")
                    reports = JSONArray().also { remaining ->
                        for (i in 0 until reports.length()) {
                            val row = reports.getJSONObject(i)
                            if (row.getString("requestId") != seed) remaining.put(row)
                        }
                    }
                    data.remove("seed")
                }
                save()
            }
            return true
        }

        fun finishTrade(importAnswer: Boolean = true) {
            val pending = File(server.folder, "pending-shop.json")
            if (!pending.isFile) return
            val trade = JSONObject(pending.readText())
            val action = trade.getString("action")
            val body = JSONObject(trade.toString()).apply { remove("action") }
            val answer = try {
                server.post("/api/shop/$action", body)
            } catch (error: JourneyServer.Failure) {
                // A rejected trade made no change. An uncertain response must keep its original requestId.
                if (error.status in 400..499 && error.status != 401) pending.delete()
                throw error
            }
            if (importAnswer) importWallet(answer.getJSONObject("wallet"))
            check(pending.delete()) { "Couldn't finish saving the shop trade." }
        }

        fun prices(view: JSONObject, shop: String): JSONObject {
            val cache = File(server.folder, "shop.json")
            val catalog = runCatching {
                server.list("/api/shop").also { JourneyServer.writeJson(cache, it.toString()) }
            }.getOrElse { error ->
                waiting(error)
                if (cache.isFile) JSONArray(cache.readText()) else JSONArray()
            }
            val products = (0 until catalog.length()).map { catalog.getJSONObject(it) }
                .filter { !it.has("enabled") || it.optBoolean("enabled") || it.optInt("enabled") == 1 }
                .associateBy { it.getString("item") }
            val stock = view.getJSONArray("stock")
            view.put("stock", JSONArray().also { visible ->
                for (i in 0 until stock.length()) {
                    val row = stock.getJSONObject(i)
                    val product = products[serverShopKey(shop, row.getString("id"))] ?: continue
                    row.put("price", product.getLong("price"))
                    if (!product.isNull("maxOwned")) row.put("limit", product.getInt("maxOwned"))
                    visible.put(row)
                }
            })
            return view
        }

        private fun export(): WalletSnapshot {
            server.requireAccount()
            val result = JourneysBridge.run(context, "economy", "export")
            check(result.ok) { result.error }
            return snapshot(JSONObject(result.output))
        }

        private fun importWallet(wallet: JSONObject) {
            server.requireAccount()
            val temporary = File.createTempFile("wallet-", ".json", context.cacheDir)
            try {
                temporary.writeText(JSONObject().put("ready", true).put("money", wallet.getLong("money"))
                    .put("items", wallet.getJSONObject("items")).toString())
                val result = JourneysBridge.run(context, "economy", "import", temporary.path)
                check(result.ok) { result.error }
            } finally { temporary.delete() }
        }

        private fun save() = JourneyServer.writeJson(file, data.toString())
        private fun waiting(error: Throwable) { Log.w("JourneyEconomy", "Wallet sync is waiting", error) }
    }

    private fun report(source: String, change: WalletChange): JSONObject = JSONObject()
        .put("source", source).put("money", change.money).put("items", JSONObject(change.items))
        .put("requestId", UUID.randomUUID().toString())

    private fun snapshot(json: JSONObject): WalletSnapshot {
        val items = json.getJSONObject("items")
        return WalletSnapshot(json.optBoolean("ready"), json.getLong("money"),
            items.keys().asSequence().associateWith { items.getInt(it) }.filterValues { it != 0 })
    }

    private fun WalletSnapshot.json(): JSONObject = JSONObject().put("ready", ready)
        .put("money", money).put("items", JSONObject(items))
}
