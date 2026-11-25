package com.pokedaisy.app

object JourneyRules {
    /** Allow player-controlled fast-forward, slow motion and rewind. */
    const val FAST_FORWARD = false
    /** Allow manual save-state slots and their player actions. */
    const val SAVE_STATE_SLOTS = false
    /** Allow cheat codes and gameplay patches. */
    const val CHEATS = false
    /** Allow in-game link trading and battles. */
    const val LINK_PLAY = false
    /** Allow co-op sessions and invitations. */
    const val COOP = false
    /** Allow DS Wi-Fi and local wireless. */
    const val DS_WIRELESS = false
    /** Check for and install app updates, from the PokeJourneys server's published releases (journeys/ServerUpdates.kt). */
    const val UPDATES = true
    /**
     * Allow the library's save tools: the save editor (boxes, bag, money), trading between saves outside the Vault,
     * restoring a backup, loading a save file, and keeping a game's save in a folder of its own. Off: each could edit
     * a save or put a Pokémon back after the Vault moved it, duplicating it (owner's review, 2026-11-13).
     */
    const val SAVE_TOOLS = false
    /**
     * Allow PATCH A ROM (applying a .bps patch to a ROM in the library). Off (owner's review, 2026-11-13): hacks come
     * as the player's own patched files, and any ROM that isn't a known retail dump is kept apart from the Vault anyway
     * (GameTitles.isKnownRetail).
     */
    const val ROM_PATCH = false
    /**
     * Show PokeDaisy's own screens: the library and what opens from it (its settings, save tools, PC BOXES, link play),
     * and games started straight from a ROM file, a frontend or a home-screen shortcut. Off (owner, 2026-11-14): every
     * start goes to Victory Island and games start only from there; first-time setup still shows.
     */
    const val POKEDAISY_SCREENS = false
    /** Offer the foe's hidden stats (IVs, EVs, nature) in battle INFO. Off (owner, 2026-11-14): an edge in battles between players. */
    const val FOE_IVS = false
    /** Offer PokeDaisy's colour themes and dark mode. Off (owner, 2026-11-14): the whole app wears one look. */
    const val THEMES = false
    /**
     * Offer the makeovers that patch a running game: RIVAL LOOK, TEXT LOOK, FOLLOWER and DAY AND NIGHT. Off (owner,
     * 2026-11-14): journeys play as the games are. PLAYER LOOK stays: it wears the trainer made on Victory Island.
     */
    const val MAKEOVERS = false
    /**
     * Offer MAKEOVER > FLY ON and RIDE ON (a balloon, helicopter, zeppelin or plane for FLY; a motorcycle or scooter for
     * the bike). Off (owner, 2026-11-25): everyone flies the game's own Pokémon and rides the game's own bike.
     */
    const val VEHICLES = false
    /**
     * Fixed for every player, with no setting (owner, 2026-11-25): the party's lead follows the player where the game can
     * show it (FOLLOWER), the overworld follows the clock (DAY AND NIGHT), and FLY flies over the map (FLY STYLE SCENIC,
     * the seen maps only). RIVAL LOOK and TEXT LOOK stay the game's own ([MAKEOVERS] off).
     */
    const val FOLLOWER = true
    const val DAY_AND_NIGHT = true
    const val SCENIC_FLY = true
    /** Offer COLLECTION (SETTINGS > JOURNEYS): every journey's Pokémon in one list, to look at only. Off (owner, 2026-11-25): the Vault has them. */
    const val COLLECTION = false
    /** Offer SPRITE PACK (SETTINGS > JOURNEYS): other games' looks loaded from a pack file. Off (owner, 2026-11-25). */
    const val SPRITE_PACK = false
    /** Offer SETTINGS > GAME > PLAYS AS, which reads an unrecognised ROM as a game the player picks. Off (owner, 2026-11-14). */
    const val PLAYS_AS = false

    /** The library's per-game menu items that [SAVE_TOOLS] covers, by their English label. */
    val SAVE_TOOL_ITEMS = setOf("SAVE EDITOR", "RESTORE BACKUP", "LOAD SAVE", "SAVE FOLDER", "DEFAULT SAVE FOLDER")

    /** The library's TOOLS cards that [SAVE_TOOLS] covers, by their id. */
    val SAVE_TOOL_CARDS = setOf("EDIT", "TRADE", "PALPARK", "TRANSFER")

    /**
     * Settings PokeJourneys doesn't offer (owner's review, 2026-11-13), by their label on the settings pages:
     * - the library's own launcher and media: Victory Island is the launcher;
     * - where saves and states live, save backups and resuming: saves always stay inside the app, the save bridge
     *   backs up before every write, and games always resume from the app's own resume point;
     * - PokeDaisy's own services: its update check, crash reports, Discord server and help pages;
     * - feature tips.
     */
    private val REMOVED_SETTINGS = setOf(
        "DUAL-SCREEN LAUNCHER", "COVER ART", "ScreenScraper", "GAME NAMES", "SUPPORTED ONLY", "HIDDEN GAMES", "RUN SETUP",
        "GAME SAVES", "ALSO LOOK IN", "SAVE STATES", "SAVE BACKUPS", "RESUME GAMES",
        "VERSION", "CRASH REPORTS", "DISCORD", "HELP",
        "TIPS",
    )

    fun actionAllowed(name: String): Boolean = when (name) {
        "FF", "FF_HOLD", "FF_TOGGLE", "SPEED_CYCLE", "SLOWMO_HOLD", "REWIND_HOLD", "REWIND" -> FAST_FORWARD
        "SAVE_STATE", "LOAD_STATE", "UNDO_SAVE", "UNDO_LOAD", "SLOT_NEXT", "SLOT_PREV", "STATES" -> SAVE_STATE_SLOTS
        "WILD" -> CHEATS
        else -> true
    }

    fun settingAllowed(label: String): Boolean = label !in REMOVED_SETTINGS && when (label) {
        "FF", "FF / SPEED", "FF SPEED", "FF MODE", "GAME SPEED", "SCENE SPEEDS", "FF MUSIC", "SPEED OPTIONS",
        "BATTLE SPEED", "TEXT SPEED", "MENU SPEED", "BIKE SPEED", "SURF SPEED", "REWIND", "INSTANT TEXT" -> FAST_FORWARD
        "SAVE STATES", "STATES", "SAVE STATE", "LOAD STATE", "UNDO SAVE", "UNDO LOAD", "SLOT NEXT", "SLOT PREV" -> SAVE_STATE_SLOTS
        "CHEATS", "REUSABLE TMS", "TRADE EVOS", "WILD ENCOUNTERS", "SHINY ODDS",
        // Owner, 2026-11-25: GAMEPLAY keeps AUTO REFILL, LOW HP BEEP, SHINY ALERT and AUTO-RUN; the rest are too cheaty.
        "NO HMS NEEDED", "EXP SHARE", "LEVEL CAP", "RUNNING SHOES", "FIELD POISON", "BOSS RETRY", "NUZLOCKE", "RUN INDOORS" -> CHEATS
        // Owner, 2026-11-25: no MAKEOVER group; every journey wears the creator's look (Prefs.playerLookFor).
        "MAKEOVER", "PLAYER LOOK" -> MAKEOVERS
        "LINK PLAY" -> LINK_PLAY
        "CO-OP" -> COOP
        "FOE IVS" -> FOE_IVS
        "THEME", "DARK MODE" -> THEMES
        "RIVAL LOOK", "TEXT LOOK", "FOLLOWER", "DAY AND NIGHT" -> MAKEOVERS
        "FLY ON", "RIDE ON" -> VEHICLES
        "FLY STYLE", "FLIGHT AREA" -> !SCENIC_FLY
        else -> actionAllowed(label.replace(' ', '_'))
    }
}
