package com.pokedaisy.app.journeys

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ServerSyncRulesTest {
    @Test fun canonicalUrlsKeepServerFoldersStable() {
        assertEquals("https://example.com", ServerUrl.normalize(" HTTPS://EXAMPLE.COM:443/ "))
        assertEquals("http://192.168.1.4:5000", ServerUrl.normalize("http://192.168.1.4:5000///"))
        assertEquals("https://example.com/journeys", ServerUrl.normalize("https://example.com/journeys/"))
        assertEquals("http://[::1]:5000", ServerUrl.normalize("http://[::1]:5000/"))
    }

    @Test fun httpIsLimitedToLoopbackAndPrivateLanHosts() {
        listOf("127.0.0.1", "127.12.34.56", "localhost", "10.0.0.2", "172.16.0.1", "172.31.255.255",
            "192.168.0.1", "island.local", "my-island.local", "[::1]", "[0:0:0:0:0:0:0:1]").forEach {
            assertEquals("http://$it", ServerUrl.normalize("http://$it"))
        }
        listOf("example.com", "8.8.8.8", "172.15.0.1", "172.32.0.1", "192.169.0.1", "10.example.com",
            "island.local.example.com", "127.0.0.1.example.com", "10.0.0.256", "127.1", "2130706433",
            "0127.0.0.1", "0x7f.0.0.1", "[2001:db8::1]").forEach {
            assertNull(it, ServerUrl.normalize("http://$it"))
        }
        assertEquals("https://example.com", ServerUrl.normalize("https://example.com"))
    }

    @Test fun urlsCannotCarryCredentialsQueriesOrFragments() {
        listOf("", "example.com", "ftp://example.com", "https://user:password@example.com",
            "https://example.com?next=elsewhere", "https://example.com/#fragment", "https://example.com:0",
            "https://example.com:65536", "https://example.com/a/../b", "https://example.com/./").forEach {
            assertNull(it, ServerUrl.normalize(it))
        }
    }

    @Test fun walletChangesIncludeGainsSpendingAndRemovedStacks() {
        val before = WalletSnapshot(true, 1000, mapOf("mart:poke-ball" to 3, "tm:15" to 1, "costume:adventurer" to 1))
        val after = WalletSnapshot(true, 700, mapOf("mart:poke-ball" to 5, "costume:adventurer" to 1))
        assertEquals(WalletChange(-300, mapOf("mart:poke-ball" to 2, "tm:15" to -1)), after.difference(before))
        assertTrue(before.difference(before).empty)
        assertFalse(after.difference(before).empty)
        assertEquals(3, before.items["mart:poke-ball"])
    }

    @Test fun initialWalletIsReportedAsChangesFromZero() {
        val empty = WalletSnapshot(false, 0, emptyMap())
        val seeded = WalletSnapshot(true, 4500, mapOf("tm:15" to 1, "costume:adventurer" to 1))
        assertEquals(WalletChange(4500, seeded.items), seeded.difference(empty))
        assertTrue(WalletSnapshot(true, 0, mapOf("tm:15" to 0)).difference(empty).empty)
    }

    @Test fun mappingDecisionsKeepRefusedAndWithdrawingEntries() {
        for (state in listOf("stored", "withdrawing")) {
            assertFalse(VaultMappingRules.dropLocal("uploaded", state))
        }
        for (state in listOf(null, "withdrawn", "removed")) {
            assertTrue(VaultMappingRules.dropLocal("uploaded", state))
            assertFalse(VaultMappingRules.dropLocal("refused", state))
        }
        assertTrue(VaultMappingRules.fetch("stored", false))
        assertFalse(VaultMappingRules.fetch("stored", true))
        assertFalse(VaultMappingRules.fetch("withdrawing", false))
        assertTrue(VaultMappingRules.remoteWithdraw("uploaded"))
        assertFalse(VaultMappingRules.remoteWithdraw("refused"))
        assertFalse(VaultMappingRules.remoteWithdraw(null))
    }

    @Test fun shopIdsUseTheSharedWalletKeys() {
        assertEquals("mart:poke-ball", serverShopKey("mart", "poke-ball"))
        assertEquals("tm:15", serverShopKey("tm", "15"))
        assertEquals("costume:adventurer", serverShopKey("costumes", "adventurer"))
    }
}
