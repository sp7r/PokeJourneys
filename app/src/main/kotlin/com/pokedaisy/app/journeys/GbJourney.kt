package com.pokedaisy.app.journeys

import com.pokedaisy.app.companion.data.Gen1Charset

/** Cartridge identities and locations documented by pret's matching English symbol maps. */
internal object GbJourney {
    data class Game(
        val generation: Int,
        val sprites: List<Int>,
        val name: Int,
        val map: Int,
        val speech: Int,
        val prepare: Int = 0,
        val skip: Int = 0,
        val resetSprite: Int = 0,
        val loadFont: Int = 0,
        val clearScreen: Int = 0,
        val spriteUpdates: Int = 0,
        val profile: Int = 0,
        val gender: Int = 0,
        val clockBuffer: Int = 0,
        val initTime: Int = 0,
        val rivalName: Int = 0,
    )

    private val KANTO = Game(
        generation = 1, sprites = listOf(0x14180), name = 0xD158, map = 0xD35E,
        speech = 0x6115, prepare = 0x60CA, skip = 0x61BC, resetSprite = 0x28A6,
        loadFont = 0x36A0, clearScreen = 0x190F, spriteUpdates = 0xCFCB, rivalName = 0xD34A,
    )
    private val YELLOW = KANTO.copy(
        sprites = listOf(0x14571), name = 0xD157, map = 0xD35D,
        speech = 0x5E85, prepare = 0x5E27, skip = 0x5F2A, resetSprite = 0x279C,
        loadFont = 0x36A3, clearScreen = 0x16DD, spriteUpdates = 0xCFCA, rivalName = 0xD349,
    )
    private val JOHTO = Game(
        generation = 2, sprites = listOf(0xC0000), name = 0x1D1A3, map = 0x1D159,
        speech = 0x5FA5, clockBuffer = 0xCF7E, initTime = 0x0538,
    )
    private val CRYSTAL = JOHTO.copy(
        sprites = listOf(0xC0000, 0xC7A40), name = 0x1D47D, map = 0x1D432,
        speech = 0x5F99, profile = 0x5B8F, gender = 0xD472, clockBuffer = 0xD086, initTime = 0x0677,
    )
    val games = mapOf(
        "ea9bcae617fdf159b045185467ae58b2e4a48b9a" to KANTO,
        "d7037c83e1ae5b39bde3c30787637ba1d4c48ce2" to KANTO,
        "cc7d03262ebfaf2f06772c1a480c7d9d5f4a38e1" to YELLOW,
        "d8b8a3600a465308c9953dfa04f0081c05bdcb94" to JOHTO,
        "49b163f7e57702bc939d642a18f591de55d92dae" to JOHTO,
        "f4cd194bdee0d04ca4eac29e09b8e4e9d818c133" to CRYSTAL,
        "f2f52230b536214ef7c9924f483392993e226cfb" to CRYSTAL,
        "a0fc810f1d4e124434f7be2c989ab5b5892ddf36" to CRYSTAL,
    )

    fun encode(name: String): ByteArray {
        val chars = name.trim().take(7).mapNotNull { c ->
            Gen1Charset.EN.chars.entries.firstOrNull { it.value == c.toString() }?.key
        }
        return ByteArray(8) { (chars.getOrNull(it) ?: 0x50).toByte() }
    }
}
