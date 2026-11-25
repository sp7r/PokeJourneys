<div align="center">

<img src="assets/branding/logo.png" alt="PokeJourneys Online" width="560">

**Based on PokeDaisy by Lidor Itzhari - https://github.com/lidor30/pokedaisy**

</div>

# PokeJourneys Online

One trainer, every journey. PokeJourneys is a fork of [PokeDaisy](https://github.com/lidor30/pokedaisy): its
emulators (mGBA for Game Boy, Game Boy Color and GBA, melonDS for DS), dual-screen support for handhelds like the AYN
Thor, and its live companion all come from PokeDaisy, and PokeDaisy's new features are merged in as they arrive.

PokeJourneys adds:

- **One trainer across every game.** Each game you play is a journey, with your trainer's name and IDs in its save.
- **The Vault.** Every Pokémon you own across all your journeys in one place, moved between games by the real games'
  transfer rules (talk to the clerk in the PokeVault on Victory Island). Each Pokémon is checked with PKHeX's legality analysis.
- **Saves always kept inside the app**, with automatic backups.
- **A hub world** (in progress, `hub/`).

> **No games are included, ever.** Use copies of games you own. The built-in emulators use their own BIOS
> replacements.

PokeJourneys is free. Donations help pay for servers: https://ko-fi.com/sp7rr

## Supported games

The emulators, companion and game support come from PokeDaisy. Its table of supported games:

Any Game Boy, Game Boy Color, GBA or DS game plays. The companion needs one of the games below, **in the exact
version listed** (ROM hacks are recognized by their file, so another version
shows a "not supported" notice).

✅ works · ◐ partly · — not yet

| Game                           | Version                    | Party | Bag | Battle | Map |   Dex   | Guide |
| ------------------------------ | -------------------------- | :---: | :-: | :----: | :-: | :-----: | :---: |
| Red / Blue (GB)                | USA/Europe                 |  ✅   | ✅  |   ◐    | ✅  |   ✅    |  ✅   |
| PureRed / PureBlue (GB)        | 2.7.6                      |  ✅   | ✅  |   ◐    | ✅  |   ✅    |   —   |
| Yellow (GB)                    | USA/Europe                 |  ✅   | ✅  |   ◐    | ✅  |   ✅    |  ✅   |
| Yellow (GB)                    | DE / FR / IT / ES          |  ✅   | ✅  |   ◐    | ✅  |   ✅    |  ✅   |
| Yellow Legacy (GB)             | 1.0.10                     |  ✅   | ✅  |   ◐    | ✅  |   ✅    |   ✅   |
| Gold / Silver (GBC)            | USA/Europe                 |  ✅   | ✅  |   ◐    | ✅  |   ✅    |   —   |
| Crystal (GBC)                  | USA, USA/Europe rev 1, AU  |  ✅   | ✅  |   ◐    | ✅  |   ✅    |  ✅   |
| Crystal Legacy (GBC)           | 1.3.1                      |  ✅   | ✅  |   ◐    | ✅  |   ✅    |   ✅   |
| Crystal Clear (GBC)            | 2.5.11, 2.6.0 (4 builds)   |  ✅   | ✅  |   ◐    | ✅  |   ✅    |   —   |
| Prism (GBC)                    | 0.95 build 254             |  ✅   | ✅  |   ◐    | ✅  |   ✅    |   —   |
| Polished Crystal (GBC)         | 3.2.0-3.2.3 (16 builds)    |  ✅   | ✅  |   ◐    | ✅  |   ✅    |  ✅   |
| FireRed                        | USA/Europe, rev 0 and 1    |  ✅   | ✅  |   ✅   | ✅  |   ✅    |  ✅   |
| FireRed                        | ES / DE / FR / IT / JP     |  ✅   | ✅  |   ✅   | ✅  |   ✅    |  ✅   |
| LeafGreen                      | USA/Europe, rev 0 and 1    |  ✅   | ✅  |   ◐    | ✅  |   ✅    |  ✅   |
| LeafGreen                      | ES / DE / FR / IT / JP     |  ✅   | ✅  |   ◐    | ✅  |   ✅    |  ✅   |
| Emerald                        | USA/Europe                 |  ✅   | ✅  |   ✅   | ✅  |   ✅    |  ✅   |
| Emerald                        | ES / DE / FR / IT / JP     |  ✅   | ✅  |   ✅   | ✅  |   ✅    |  ✅   |
| FireRed / Emerald, randomized  | UPR ZX 4.6.1, USA/Europe   |  ✅   | ✅  |   ✅   | ✅  |   ✅    |   ◐   |
| Ruby                           | USA, rev 0, 1 and 2        |  ✅   | ✅  |   ◐    | ✅  |   ✅    |  ✅   |
| Ruby                           | ES/DE/FR/IT/JP, rev 0-1    |  ✅   | ✅  |   ◐    | ✅  |   ✅    |  ✅   |
| Sapphire                       | USA, rev 0, 1 and 2        |  ✅   | ✅  |   ◐    | ✅  |   ✅    |  ✅   |
| Sapphire                       | ES/DE/FR/IT/JP, rev 0-1    |  ✅   | ✅  |   ◐    | ✅  |   ✅    |  ✅   |
| Platinum (DS)                  | USA rev 1, FR/ES rev 0     |  ✅   | ✅  |   ◐    | ✅  |   ✅    |  ✅   |
| HeartGold (DS)                 | USA, EU, every language    |  ✅   | ✅  |   —    | ✅  |   ✅    |  ✅   |
| SoulSilver (DS)                | USA, EU, every language    |  ✅   | ✅  |   —    | ✅  |   ✅    |  ✅   |
| Black (DS)                     | USA/Europe, every language |  ✅   | ✅  |   ◐    | ✅  |   ✅    |  ✅   |
| White (DS)                     | USA/Europe, every language |  ✅   | ✅  |   ◐    | ✅  |   ✅    |  ✅   |
| Black 2 (DS)                   | USA/Europe, every language |  ✅   | ✅  |   ◐    | ✅  |   ✅    |  ✅   |
| White 2 (DS)                   | USA/Europe, every language |  ✅   | ✅  |   ◐    | ✅  |   ✅    |  ✅   |
| Origin HeartGold (DS)          | 4.0.3 English 1.0.0        |  ✅   | ✅  |   ◐    | ✅  |   ✅    |   —   |
| Renegade Platinum (DS)         | 1.2.0, 1.3.0 (+ Classic)   |  ✅   | ✅  |   ◐    | ✅  |   ✅    |   —   |
| Unbound                        | 2.1.1.1                    |  ✅   | ✅  |   ◐    | ✅  |   ✅    |  ✅   |
| Unbound                        | 2.1.1.1 French             |  ✅   | ✅  |   ◐    | ✅  |   ✅    |  ✅   |
| Radical Red                    | 4.1                        |  ✅   | ✅  |   ◐    | ✅  |   ✅    |  ✅   |
| Gaia                           | 3.2                        |  ✅   | ✅  |   ◐    | ✅  |   ✅    |  ✅   |
| Odyssey                        | 4.1.1                      |  ✅   | ✅  |   ◐    | ✅  |   ✅    |  ✅   |
| Heart and Soul                 | 2.0.6                      |  ✅   | ✅  |   ✅   | ✅  |   ✅    |  ✅   |
| Amethyst                       | 1.3.0, 1.4.1               |  ✅   | ✅  |   ◐    | ✅  |   ✅    |  ✅   |
| Celia's Stupid Romhack         | 1.1.4                      |  ✅   | ✅  |   ◐    | ✅  |   ✅    |  ✅   |
| Orange Islands                 | Beta 5.7, an older beta    |  ✅   | ✅  |   ◐    | ✅  |   ✅    |  ✅   |
| Ultra Violet                   | 1.22                       |  ✅   | ✅  |   ◐    | ✅  |   ✅    |  ✅   |
| FireRed Rocket Edition         | the one release            |  ✅   | ✅  |   ◐    | ✅  |   ✅    |  ✅   |
| Ash Gray                       | 4.5.3, Fork Bug Fix 1.0    |  ✅   | ✅  |   ◐    | ✅  |   ✅    |  ✅   |
| Ghost Grey                     | 1.0.1, 1.0.2, 1.0.4        |  ✅   | ✅  |   ◐    | ✅  |   ✅    |  ✅   |
| Let's Go Pikachu / Eevee       | English (4 builds)         |  ✅   | ✅  |   ◐    | ✅  |   ✅    |  ✅   |
| Sword and Shield Ultimate Plus | 1.2.1.2 + its 3 patches    |  ✅   | ✅  |   ◐    | ✅  |   ✅    |  ✅   |
| GS Chronicles                  | 2.7.6                      |  ✅   | ✅  |   ◐    | ✅  |   ✅    |  ✅   |
| Recharged Yellow               | 1.8.0, 1.9.0, 1.9.4, 1.9.7 |  ✅   | ✅  |   ◐    | ✅  |   ✅    |  ✅   |
| Emerald Legacy                 | 1.1.4                      |  ✅   | ✅  |   ◐    | ✅  |   ✅    |  ✅   |
| Lazarus                        | 2.0                        |  ✅   | ✅  |   ◐    | ✅  |   ✅    |   ◐   |
| Emerald Seaglass               | 3.0                        |  ✅   | ✅  |   ◐    | ✅  |   ✅    |   ◐   |
| Too Many Types 2               | 1.5.2                      |  ✅   | ✅  |   ◐    | ✅  |   ✅    |   ◐   |
| Glazed                         | 9.2.0                      |  ✅   | ✅  |   ◐    | ✅  |   ✅    |   ◐   |
| Emerald Imperium               | 1.3.1                      |  ✅   | ✅  |   ◐    | ✅  |   ✅    |   ◐   |
| Quetzal                        | English Alpha 9 v0         |  ✅   | ✅  |   ◐    | ✅  |   ✅    |   ◐   |
| Quetzal                        | Spanish Alpha 9 v0         |  ✅   | ✅  |   ◐    | ✅  |   ✅    |   ◐   |
| Quetzal                        | Alpha 9 v1 (EN / ES)       |  ✅   | ✅  |   ◐    | ✅  |   ✅    |   ◐   |
| Quetzal                        | Alpha 0.8.4 (EN / ES)      |  ✅   | ✅  |   ◐    | ✅  |   ✅    |   ◐   |
| Moemon Quetzal                 | Alpha 0.8.4 Hotfix (EN/ES) |  ✅   | ✅  |   ◐    | ✅  |   ✅    |   ◐   |
| Super Mariomon                 | 1.2.1-1.3, 1.5.1, 1.5.2    |  ✅   | ✅  |   ◐    | ✅  |   ✅    |   ◐   |
| Recharged Emerald              | 2.2.5, 2.2.8, Rebalanced   |  ✅   | ✅  |   ◐    | ✅  |   ✅    |   ◐   |
| Modern Emerald                 | 3.6                        |  ✅   | ✅  |   ◐    |  ◐  |    —    |   —   |
| Elite Redux                    | 2.65.3b, 2.65.4.1b         |  ✅   | ✅  |   ◐    | ✅  |   ✅    |   ◐   |
| Team Rocket Dragonsden         | 1.5                        |  ✅   | ✅  |   ◐    |  ◐  |    —    |   ◐   |
| Team Rocket Dragonsden         | 2026 3.0.9 (Spanish)       |  ✅   | ✅  |   ◐    | ✅  |   ✅    |   ◐   |
| Wishes of Tomorrow             | 1.2.6                      |  ✅   | ✅  |   ◐    | ✅  |   ✅    |   ◐   |
| Dreamstone Mysteries           | the one release            |  ✅   | ✅  |   ◐    | ✅  |   ✅    |   ◐   |
| Monomyth                       | 1.0, 1.1                   |  ✅   | ✅  |   ◐    | ✅  |   ✅    |   ◐   |
| Emerald Rogue                  | 2.2.1-EX                   |  ✅   | ✅  |   ✅   | ✅  |   ✅    |   —   |
| SoulGold                       | 1.1.4, 1.2 (3), 1.2.1 (2)  |  ✅   | ✅  |   ◐    | ✅  |   ✅    |   ◐   |
| R.O.W.E.                       | 2.1.9.1 Experimental       |  ✅   | ✅  |   ◐    | ✅  |    ◐    |   —   |

<details>
<summary><strong>Notes on the table</strong></summary>

For a version that isn't listed, the app tries to read it as a game it knows (BEST EFFORT) and asks you to pick
when it isn't sure. Map ◐ means place names only,
without the map picture. Guide ◐ means the live pages only (the wild encounters here and the next boss). Battle ◐
means the battle panes work but haven't been checked in every kind of battle. On the DS, HeartGold's and SoulSilver's
battles aren't read yet. Origin HeartGold's battle system is its own: the battle panes read it, but their buttons
can't press its menus, and it has no guide yet. Renegade Platinum reads as Platinum with its own types (Fairy among them),
moves and type chart; its trainers and wild Pokémon are its own, so it has no guide yet. Team Rocket Dragonsden is DragonsdenTV's Team Rocket Edition, not FireRed Rocket Edition.
FireRed (rev 0 and 1) and Emerald randomized with Universal Pokemon Randomizer ZX 4.6.1 work with any settings and
seed: the companion reads the randomized types, moves, teams, wild Pokémon and items from the ROM, and the guide leaves
out the gift and legendary Pokémon it can't know. Monomyth's natures are its own: the summary names them, and they change no stat.
With Wishes of Tomorrow's randomizer on, the guide and the Pokédex's AREA show the wild Pokémon your save meets.
The guides were written from each game's own data and may contain mistakes.

</details>

Want another game supported? Ask in [Game requests](https://github.com/lidor30/pokedaisy/discussions/categories/game-requests), and upvote the ones you want.


## Building

The Android app builds as PokeDaisy does (see PokeDaisy's own documentation in `docs/`), plus the
[.NET 10 SDK](https://dotnet.microsoft.com/download) for the save bridge in `src/`, which the app build compiles into
`libjourneys.so` automatically.
Node.js and npm are also required to build the offline Battle Dome. Gradle installs the pinned dependencies from
`tools/battle/package-lock.json` and bundles the simulator into the app; no Node runtime is installed on Android.

```bash
git submodule update --init
```

The `journeys` command-line tool (`dotnet run --project src/Journeys.Cli -- help`) runs the same save bridge on a PC.

## Credits and license

Based on PokeDaisy by Lidor Itzhari - https://github.com/lidor30/pokedaisy. See [CREDITS.md](CREDITS.md) and
[NOTICE](NOTICE) for everyone whose work PokeJourneys uses.

PokeJourneys is free software under the GNU General Public License 3.0 (see [LICENSE](LICENSE)) with PokeDaisy's
additional attribution term (see [NOTICE](NOTICE)).

Pokémon, the Pokémon logo and all related names are trademarks of Nintendo, Creatures Inc. and GAME FREAK inc.
PokeJourneys Online is an unofficial fan project with no connection to or endorsement from any of them.
