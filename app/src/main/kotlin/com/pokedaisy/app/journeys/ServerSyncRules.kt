package com.pokedaisy.app.journeys

import java.net.URI
import java.util.Locale

/** Rules shared by the picker and the blocking sync calls. */
internal object ServerUrl {
    fun normalize(text: String): String? = runCatching {
        val uri = URI(text.trim())
        val scheme = uri.scheme?.lowercase(Locale.ROOT)
        require(scheme == "https" || scheme == "http")
        val host = uri.host?.lowercase(Locale.ROOT) ?: error("Missing host")
        require(uri.rawUserInfo == null && uri.rawQuery == null && uri.rawFragment == null)
        require(uri.port == -1 || uri.port in 1..65535)
        require(scheme == "https" || isLocal(host))
        val path = uri.rawPath.orEmpty().trimEnd('/')
        require(path.split('/').none { it == "." || it == ".." })
        val port = uri.port.takeUnless { it == -1 || scheme == "https" && it == 443 || scheme == "http" && it == 80 }
        "$scheme://$host${port?.let { ":$it" }.orEmpty()}$path"
    }.getOrNull()

    private fun isLocal(host: String): Boolean {
        if (host == "localhost" || host == "[::1]" || host == "[0:0:0:0:0:0:0:1]") return true
        if (host.endsWith(".local") && host.split('.').all { it.matches(Regex("[a-z0-9](?:[a-z0-9-]*[a-z0-9])?")) }) return true
        val parts = host.split('.')
        if (parts.size != 4 || parts.any { !it.matches(Regex("0|[1-9][0-9]{0,2}")) }) return false
        val numbers = parts.map { it.toInt() }
        if (numbers.any { it > 255 }) return false
        return numbers[0] == 127 || numbers[0] == 10 ||
            numbers[0] == 172 && numbers[1] in 16..31 || numbers[0] == 192 && numbers[1] == 168
    }
}

internal data class WalletChange(val money: Long, val items: Map<String, Int>) {
    val empty: Boolean get() = money == 0L && items.isEmpty()
}

internal data class WalletSnapshot(val ready: Boolean, val money: Long, val items: Map<String, Int>) {
    fun difference(before: WalletSnapshot) = WalletChange(money - before.money,
        (items.keys + before.items.keys).mapNotNull { key ->
            val count = items.getOrDefault(key, 0) - before.items.getOrDefault(key, 0)
            if (count == 0) null else key to count
        }.toMap())
}

internal object VaultMappingRules {
    fun dropLocal(mappingState: String, serverState: String?): Boolean =
        mappingState == "uploaded" && serverState != "stored" && serverState != "withdrawing"

    fun fetch(serverState: String, hasLocal: Boolean): Boolean = serverState == "stored" && !hasLocal
    fun remoteWithdraw(mappingState: String?): Boolean = mappingState == "uploaded"
}

internal fun serverShopKey(shop: String, item: String): String = when (shop) {
    "mart" -> "mart:$item"
    "tm" -> "tm:$item"
    "costumes" -> "costume:$item"
    else -> error("This shop is unavailable.")
}
