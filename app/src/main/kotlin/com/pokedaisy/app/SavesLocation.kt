package com.pokedaisy.app

import android.content.Context
import java.io.File

/**
 * Where game-save (SRAM/flash) files live, and how a ROM's save file is found
 * inside that folder. The format is identical whether the file is named
 * `.sav` (mGBA/standalone convention) or `.srm` (RetroArch/libretro convention)
 * — it's the same raw save-RAM dump either way, so both are recognized.
 */
object SavesLocation {

    /** PokeJourneys: saves always stay in the app's own saves folder. */
    fun dir(context: Context, prefs: Prefs = Prefs(context)): File {
        val dir = File(context.getExternalFilesDir(null), "saves")
        dir.mkdirs()
        return dir
    }

    /** PokeJourneys: saves always stay in the app, including DS saves. */
    fun saveFor(context: Context, prefs: Prefs, rom: File): File =
        resolve(dir(context, prefs), rom)

    /** [dirs] for [rom]: a DS game's own folder first - melonDS keeps a game's save beside it (`<rom name>.sav`), so
     * that's the save the player has, and where a new one goes - while it can be written there (or already holds the
     * save); then the rest, so a save made elsewhere before still loads. */
    fun dirsFor(rom: File, nds: Boolean, dirs: List<File>): List<File> {
        val beside = rom.absoluteFile.parentFile ?: return dirs
        if (!nds || !(beside.canWrite() || resolve(beside, rom).exists())) return dirs
        return (listOf(beside) + dirs).distinctBy { it.absolutePath }
    }

    /** [saveFor]'s rule: [own] if set, else the first of [dirs] with a save for [rom], else a new one in [dirs]' first. */
    fun saveIn(own: File?, dirs: List<File>, rom: File): File {
        own?.let { return resolve(it, rom) }
        return dirs.asSequence().map { resolve(it, rom) }.firstOrNull { it.exists() } ?: resolve(dirs.first(), rom)
    }

    /** The saves folder, then the ALSO LOOK IN folders, in [saveFor]'s order. */
    fun searchDirs(context: Context, prefs: Prefs): List<File> =
        (listOf(dir(context, prefs)) + prefs.extraSaveDirs.map(::File)).distinctBy { it.absolutePath }

    /** A folder that already holds saves, offered by first-time setup. */
    class Suggestion(val dir: File, val saves: Int)

    /**
     * Folders likely to hold the player's existing saves, with at least one
     * `.sav` / `.srm` in them: the linked ROMs folders (saves kept next to the
     * games) and its `saves/`, then RetroArch's save folders on every volume.
     * Blocking (lists folders) and needs All files access to see anything.
     */
    fun suggestions(prefs: Prefs): List<Suggestion> {
        val candidates = buildList {
            prefs.romsFolders.forEach { add(File(it)); add(File(it, "saves")) }
            for (root in StorageAccess.volumeRoots()) {
                for (core in RETROARCH_SAVE_DIRS) add(File(root, "RetroArch/saves/$core"))
                add(File(root, "RetroArch/saves"))
            }
        }
        return candidates.distinctBy { it.absolutePath }.mapNotNull { dir ->
            val n = dir.listFiles { f -> f.isFile && f.extension.lowercase() in SAVE_EXTENSIONS }?.size ?: 0
            if (n > 0) Suggestion(dir, n) else null
        }
    }

    private val SAVE_EXTENSIONS = setOf("sav", "srm")
    /** RetroArch's GBA cores, for "sort saves by core" setups. */
    private val RETROARCH_SAVE_DIRS = listOf("mGBA", "gpSP", "VBA-M", "VBA Next", "Beetle GBA")

    /**
     * Resolves [romBaseName]'s save file inside [dir]. Prefers an existing
     * `.sav`, falls back to an existing `.srm` (e.g. a save copied in from
     * RetroArch), and defaults to `.sav` for a brand-new save.
     */
    fun resolve(dir: File, romBaseName: String): File {
        val sav = File(dir, "$romBaseName.sav")
        if (sav.exists()) return sav
        val srm = File(dir, "$romBaseName.srm")
        if (srm.exists()) return srm
        return sav
    }

    /** [resolve] for [rom]: the first of its [RomArchive.saveNames] with a save in [dir],
     * else a new `.sav` under the first (an archive's save follows RetroArch's name). */
    fun resolve(dir: File, rom: File): File {
        val names = RomArchive.saveNames(rom)
        return names.asSequence().map { resolve(dir, it) }.firstOrNull { it.exists() } ?: resolve(dir, names.first())
    }
}
