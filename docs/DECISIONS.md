# PokeJourneys: accepted decisions

The decisions that shape PokeJourneys, newest first within each section. When a decision changes, edit it here in
the same change as the code.

## Foundation

- **A fork of PokeDaisy** (https://github.com/lidor30/pokedaisy), credited as required by its license: "Based on PokeDaisy
  by Lidor Itzhari" stays in NOTICE, README, CREDITS and the app's About row and licenses screen. PokeDaisy's new
  features are merged in from `upstream`.
- **Keep the difference from upstream small.** Keep PokeDaisy's package (`com.pokedaisy.app`), files and structure. Add
  features in new files. Change PokeDaisy's files only for a hook, and prefer switching a feature off over deleting it.
- **The app is the PokeDaisy app with the Godot hub embedded**, not a Godot app hosting the emulators. The player sees one
  app.
- **Local first.** Saves, the Vault and trainers live on the device. No account or server is needed to play.
  Cheating can't be fully prevented this way, and that risk is accepted for now. Online features (trading, auctions,
  raids, ranked battles) arrive with a server later, and shared resources move to the server then.
- **No game data ships**: no ROMs, BIOS, firmware, saves, states, or anything extracted from a game. Players supply their
  ROMs; anything derived from them is built and kept on the device.
- **Free.** Donations through Ko-fi (https://ko-fi.com/sp7rr) may earn donor rewards, which are **original designs
  only**. Characters and Pokémon designs from the games may be achievement rewards, never donation rewards.

## Trainers

- **Several trainers per player.** Each trainer has its own Pokémon, Vault, items, money, journeys, saves and
  achievements. Nothing is shared between trainers.
- **One wallet and one bag per trainer (owner, 2026-11-14).** Money and items (Poké Balls, healing items and the like)
  belong to the trainer, not to a game: what is earned or bought in one journey is there in the next, and what is spent
  or used in one is gone from all. Victory Island uses the same money (Pokéyen): spending it there takes it from the
  games' balance. The first supported official save seeds the wallet. A journey gets the items and quantities its save
  can hold. Other items wait in the shared bag. The first time another save is seen, the bag keeps the larger existing
  stack for each item. Later saves contribute changes in money and items. A newer resume point takes precedence until
  the player saves in-game. Key items stay in their own journey.
- **Shops.** The Poké Mart buys and sells from its stock and shows the shared bag. The TM Shop lists every move
  available as a TM in the Gen 1–7 mainline games. TMs are shared by move and use the destination game's TM number.
  A move stays in the shared bag when the journey has no TM for it. Consuming a TM reduces the shared count.
  A game with reusable TMs receives one copy of an owned move. HMs stay with the games.
- **New official journeys (owner, 2026-11-17).** Start after the introduction and naming screens, using the hub
  trainer's name, gender, and custom appearance. Each cartridge initializes its own story state.
  Automatic starts apply to journeys without an existing save or resume point. Intro handoffs currently cover
  the mapped English cartridges across Gen 1 through Gen 5. Other languages and revisions need verified mappings;
  ROM hacks and 3DS are deferred. GB/GBC adapts the custom walking sprite to the original 16x16, four-shade format;
  the native game palette, battle artwork, and riding sprites remain cartridge-specific. The intro uses Blue as
  Kanto's rival, Barry in Sinnoh, and Hugh in Black 2 / White 2. Johto's later rival introduction remains in the story.
- **Return to hub.** The in-game companion exposes a Return to hub button on every tab. A Yes/No confirmation
  precedes the normal journey exit, resume-point save, Vault refresh, and return to Victory Island.
- **Hub follower.** Choose FOLLOW IN HUB on a Pokémon stored in the Vault. Left Bumper (F on a keyboard) throws its
  Poké Ball to send it out, or recalls it, with a short cooldown between presses. It starts in its ball whenever
  the hub boots and stays in the Vault.
- **Weekly Pokémon sightings.** The spotter beside the courtyard reader asks for five distinct Pokémon from National
  Dex #1–807, one at a time. Each matching follower earns a Sighting Stamp. The final request asks for a sixth species
  in its shiny colors and earns a Prism Medal. The spotter gives no further rewards until Monday in the device's local
  time. Each trainer's collection carries over between weeks.
- **Hub trainer card.** Rating starts at 1 and is bounded by 50. The ranked Stadium service calculates Rating
  changes for PvP. The trainer's highest Rating sets the badge color. Bronze starts at 1, Silver at 20, Gold at 35,
  and blue Diamond at 50. A win against a bot or another player adds one lifetime Experience point.
  All colors use the same milestones.
  The Poké Ball emblem starts at zero points. Stars 1–6 unlock at 5, 20, 50, 100, 300 and 1,000 points.
  The six-star badge has wings. The card reads a per-trainer standings snapshot when one is available.
  Ranked works like Halo 3's (owner, 2026-11-18): each ranked playlist keeps its own Rating, Experience is shared by
  every playlist and venue, and the card shows the best playlist Rating while the color follows the best peak.
  The ranked playlists are Random Singles, Random Doubles, Open Singles (Gen 7 Ubers rules) and Open Doubles (Doubles
  OU rules with Ubers allowed); specific tiers can become playlists later.
  The Stadium handles ranked and casual PvP signups. The Battle Dome handles Single, Double, and Triple practice
  battle signups against bots.
  The Stadium rankings attendant explains Rating, Experience, stars, and wings.
- **Battle Dome.** Offline bot battles use Pokémon Showdown's simulator and team validator through the browser-compatible
  pkmn packages. Singles use the Gen 7 Smogon OU, Ubers, UU, RU, NU, PU, ZU, and Little Cup formats; doubles use Gen 7
  Doubles OU and Doubles UU. Triples use Gen 6 Battle Spot Triples because Gen 7 removed the battle type. Pokémon are
  selected from the Vault and projected into battle without changing their stored data. Battle levels temporarily
  use the format standard: 100, Little Cup 5, or Battle Spot 50. Completed bot wins award one Experience once and
  preserve Rating. Pokémon art is read from the player's local caches and follower pack.
  Random teams are the default and do not require any Vault Pokémon. Singles also offer Showdown's Gen 7 Random Battle,
  including its balanced species levels and hidden opposing team. Doubles and triples default to Random Doubles and
  Random Triples (owner, 2026-11-18): Showdown's Gen 7 and Gen 6 Random Battle sets at their balanced levels, played as
  doubles or triples with the opposing team hidden, since the simulator has no Gen 6-7 random doubles format. Other tiers can assign legal random teams at their
  standard level. Vault teams remain optional.
  The battle screen is FireRed's own battle interface (owner, 2026-11-18): textbox, FIGHT / BAG / POKéMON / RUN and
  move menus, healthboxes, fonts, terrain, Poké Ball, trainer and move-effect sprites, exported from the player's
  FireRed cartridge into hub data and never packaged. Each turn plays out in order like the game: one message at a
  time, the move's animation, HP bars draining, faints, recalls and send-outs; commands lock while it plays and A or B
  hurries the text. Commands are given on the top screen with the controller or by touch; the lower screen shows the
  battle log. BAG explains that items can't be used in the Battle Dome; in Triple Battles it becomes SHIFT for the side
  Pokémon, which use a wider field. A win is recorded once its victory has played.

## Journeys and emulation

- **Saves always stay inside the app**, with automatic backups. The player can't pick a save folder.
- **Debug save editor.** Debug builds offer DEBUG SAVE EDITOR in the Vault for testing with supported Gen 3 saves.
  Its Debug tab toggles badges and story flags and generates a Pokémon from a Gen 3 encounter for the PC.
  Saving creates a backup, refreshes that journey's Vault snapshot, and makes the next launch load the edited save.
- **Turned off in official journeys:** in-game wireless and link play (DS Wi-Fi and local wireless, link cable,
  PokeDaisy's link play and co-op), fast-forward, player-made save states, and cheats. Trading and battling between
  players happen only in the hub.
- **Also off (2026-11-14):** the foe's hidden stats in battle INFO (an edge between players), PokeDaisy's themes and
  dark mode (the app wears one look), and the makeovers that patch a running game (rival look, text look, follower,
  day and night). The player's own look from the island's creator stays. RetroAchievements stays, beside the hub's own
  achievements.
- **No PokeDaisy menus.** The Vault opens from the PokeVault's clerk; the settings open from the companion (its SETTINGS
  tab in a game, its SETTINGS button on the island).
- **Progress without manual saving:** the app keeps its own automatic resume point when a game is left, so play picks up
  where it stopped. The player can't make, load or pick states. A resume point is thrown away whenever the Vault changes
  that game's save, and the Vault only moves Pokémon from what the game itself has saved.
- **ROM hacks are fully isolated.** No Pokémon, items, money or progress move between a hack and anything else, even when
  the hack uses its base game's save layout. A hack may still earn hub achievements and cosmetics.
- 3DS games (later) use the game's own hero and customization, from decrypted ROMs only.

## The Vault

- The Vault is separate from every game's PC. Each Pokémon in it has its own ID, never one based on its personality
  value.
- Moves follow the real games' rules: Gen 1 and 2 trade with each other and can go to Gen 7; Gen 3 and later only move
  forward. Anything the target game can't hold is refused.
- Every Pokémon is checked with PKHeX's legality analysis. One that fails may stay in its own journey but can't enter
  the Vault, move, trade or play ranked, unless it carries a hub origin record (see "Raids").
- A transfer must never lose or duplicate a Pokémon, including when the app is killed part-way. To do: a transfer
  journal that finishes or rolls back an interrupted move on the next start.

## Raids (planned)

- Weekly cooperative legendary raids. The first clear per trainer per event gives one guaranteed capture. Later clears
  give items, including species-bound orbs that raise one chosen IV by 1 (up to 31). There's a two-hour cooldown after
  any attempt.
- **Hub origin records (proposal).** Raid Pokémon and their upgrades fail PKHeX's legality check by design. Each one gets
  a record in the Vault: what it is, where it came from (event and date), and every upgrade applied, with the data it
  should have after each step. The Vault accepts a Pokémon that fails the legality check only when it matches such a
  record exactly. Anything else that fails is treated as cheated. Locally these records can't be made tamper-proof; when
  the server arrives, it issues and signs them.

## Open

- Whether hub-origin Pokémon may be moved into games, and which ones.
- Choice of the hub map: currently Frontier Terraces (`C:\Projects\hub-work\Frontier Terraces`, kept outside the
  repository because it contains game-derived art).
