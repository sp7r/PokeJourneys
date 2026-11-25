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

## Devices

| Device                     | Status                                                              |
| -------------------------- | ------------------------------------------------------------------- |
| AYN Thor                   | Tested, made for it                                                 |
| Retroid Pocket Duo Lite    | Supported, with its own 4:3 layout                                  |
| Retroid Pocket Duo         | Works, played on by players                                         |
| AYANEO Pocket DS           | Works since v1.5.0, checked by players                              |
| Anbernic RG DS             | Works with SWAP SCREENS on; DS games are heavy for its chip         |
| Retroid Pocket 6           | Single screen: tested                                               |
| Other one-screen handhelds | Work held sideways like the Pocket 6 (players use the Retroid Pocket 5 and AYN Odin 2 / 3) |
| Android phones             | Tested on a Samsung Galaxy S9, upright or sideways                  |
| Tablets                    | Tested on a Samsung Galaxy Tab A                                    |
| Folding phones             | Should work with FOLD LAYOUT, not yet tried by us                   |
| A phone cast to a TV       | Should work: the game on the TV, the companion on the phone         |

Any Android 8.0+ device runs the games. PokeDaisy also runs on Linux (Steam Deck and Linux handhelds), Windows and the Nintendo 3DS: see below.

## Download and install

<p align="center">
  <a href="#android"><img src="https://img.shields.io/badge/Android-APK-3DDC84?style=for-the-badge&logo=android&logoColor=white" alt="Android"></a>
  <a href="#linux"><img src="https://img.shields.io/badge/Linux-Steam%20Deck%20%C2%B7%20handhelds-FCC624?style=for-the-badge&logo=linux&logoColor=black" alt="Linux"></a>
  <a href="#nintendo-3ds"><img src="https://img.shields.io/badge/Nintendo%203DS-preview-D12228?style=for-the-badge&logo=nintendo3ds&logoColor=white" alt="Nintendo 3DS"></a>
  <a href="#windows"><img src="https://img.shields.io/badge/Windows-beta-0078D6?style=for-the-badge&logo=windows&logoColor=white" alt="Windows"></a>
  <img src="https://img.shields.io/badge/iOS-soon-8a8a98?style=for-the-badge&logo=apple&logoColor=white" alt="iOS: coming soon">
</p>

Every file is on the [latest release](https://github.com/lidor30/pokedaisy/releases/latest). **No games are included:**
use your own legally dumped ROMs.

### Android

Android 8.0 or newer: dual-screen handhelds, one-screen handhelds and phones.
[**Download the APK**](https://github.com/lidor30/pokedaisy/releases/latest) (`PokeDaisy-<version>.apk`) on the
device and open it. A short setup links your ROMs folders, picks where saves go and can add cover art. The app then
offers each new version by itself. Guide: [Install and first setup](https://pokedaisy.com/docs/install/).

### Linux

| For | Download |
| --- | --- |
| Steam Deck and Linux PCs | [`pokedaisy-linux-x86_64.zip`](https://github.com/lidor30/pokedaisy/releases/latest/download/pokedaisy-linux-x86_64.zip) |
| TrimUI handhelds (CrossMix, NextUI) | [`pokedaisy-linux-aarch64.zip`](https://github.com/lidor30/pokedaisy/releases/latest/download/pokedaisy-linux-aarch64.zip) |
| PortMaster handhelds (ROCKNIX, Knulli, muOS) | [`pokedaisy-portmaster-aarch64.zip`](https://github.com/lidor30/pokedaisy/releases/latest/download/pokedaisy-portmaster-aarch64.zip) |
| TrimUI Brick on NXRedux | [`PokeDaisy-NXRedux.zip`](https://github.com/lidor30/pokedaisy/releases/latest/download/PokeDaisy-NXRedux.zip) |
| Cores for RetroArch, on a PC | [`pokedaisy-libretro-x86_64.zip`](https://github.com/lidor30/pokedaisy/releases/latest/download/pokedaisy-libretro-x86_64.zip) |
| Cores for RetroArch, on an ARM handheld | [`pokedaisy-libretro-aarch64.zip`](https://github.com/lidor30/pokedaisy/releases/latest/download/pokedaisy-libretro-aarch64.zip) |

Guide: [Install on Linux, Steam Deck and handhelds](https://pokedaisy.com/docs/linux-install/).

### Nintendo 3DS

An early preview, for a 3DS with custom firmware and the Homebrew Launcher:
[`pokedaisy.3dsx`](https://github.com/lidor30/pokedaisy/releases/latest/download/pokedaisy.3dsx). Guide: [Install on a Nintendo 3DS](https://pokedaisy.com/docs/3ds/).

### Windows

Windows 10 or 11, on a 64-bit PC, in the betas for now: `PokeDaisy-<version>-windows-x86_64.zip` on the
[releases page](https://github.com/lidor30/pokedaisy/releases). Extract it and start `PokeDaisy.exe`. Guide:
[Install on Windows](docs/manual/windows-install.md).

### iOS

In the works.

## Supported games

The emulators, companion and game support come from PokeDaisy. Its table of supported games:

Any Game Boy, Game Boy Color, GBA or DS game plays. The companion needs one of the games below, **in the exact
version listed** (ROM hacks are recognized by their file, so another version
shows a "not supported" notice).

<details>
<summary><strong>The full list, game by game</strong> (✅ works · ◐ partly · — not yet)</summary>

| Game                           | Version                    | Party | Bag | Battle | Map |   Dex   | Guide |
| ------------------------------ | -------------------------- | :---: | :-: | :----: | :-: | :-----: | :---: |
| Red / Blue (GB)                | USA/Europe                 |  ✅   | ✅  |   ◐    | ✅  |   ✅    |  ✅   |
| Red / Blue (GB)                | DE (Rote Edition / Blaue Edition) |  ✅   | ✅  |   ◐    | ✅  |   ✅    |  ✅   |
| PureRed / PureBlue (GB)        | 2.7.6                      |  ✅   | ✅  |   ◐    | ✅  |   ✅    |   —   |
| Yellow (GB)                    | USA/Europe                 |  ✅   | ✅  |   ◐    | ✅  |   ✅    |  ✅   |
| Yellow (GB)                    | DE / FR / IT / ES          |  ✅   | ✅  |   ◐    | ✅  |   ✅    |  ✅   |
| Yellow Legacy (GB)             | 1.0.10                     |  ✅   | ✅  |   ◐    | ✅  |   ✅    |   ✅   |
| Red Gen II Graphics (GB)       | 2.0                        |  ✅   | ✅  |   ◐    | ✅  |   ✅    |   ✅   |
| Yellow Gen II Graphics (GB)    | 1.1                        |  ✅   | ✅  |   ◐    | ✅  |   ✅    |   ✅   |
| Brown (GB)                     | 6.0.1, 6.1.2               |  ✅   | ✅  |   ◐    | ✅  |   ✅    |   —   |
| Gold / Silver (GBC)            | USA/Europe                 |  ✅   | ✅  |   ◐    | ✅  |   ✅    |   —   |
| Gold / Silver (GBC)            | DE (Goldene Edition, Silberne Edition) |  ✅   | ✅  |   ◐    | ✅  |   ✅    |   —   |
| Crystal (GBC)                  | USA, USA/Europe rev 1, AU  |  ✅   | ✅  |   ◐    | ✅  |   ✅    |  ✅   |
| Crystal (GBC)                  | DE (Kristall)              |  ✅   | ✅  |   ◐    | ✅  |   ✅    |  ✅   |
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
| Platinum (DS)                  | USA rev 1, FR/ES/DE rev 0  |  ✅   | ✅  |   ◐    | ✅  |   ✅    |  ✅   |
| HeartGold (DS)                 | USA, EU, every language    |  ✅   | ✅  |   —    | ✅  |   ✅    |  ✅   |
| SoulSilver (DS)                | USA, EU, every language    |  ✅   | ✅  |   —    | ✅  |   ✅    |  ✅   |
| Black (DS)                     | USA/Europe, every language |  ✅   | ✅  |   ◐    | ✅  |   ✅    |  ✅   |
| White (DS)                     | USA/Europe, every language |  ✅   | ✅  |   ◐    | ✅  |   ✅    |  ✅   |
| Black 2 (DS)                   | USA/Europe, every language |  ✅   | ✅  |   ◐    | ✅  |   ✅    |  ✅   |
| White 2 (DS)                   | USA/Europe, every language |  ✅   | ✅  |   ◐    | ✅  |   ✅    |  ✅   |
| Origin HeartGold (DS)          | 4.0.3 English 1.0.0        |  ✅   | ✅  |   ◐    | ✅  |   ✅    |   —   |
| Heartfelt Gold (DS)            | 1.0.15 (+ Zoomed In)       |  ✅   | ✅  |   ◐    | ✅  |   ✅    |   —   |
| Sacred Gold (DS)               | 1.05 (+ Classic)           |  ✅   | ✅  |   —    | ✅  |   ✅    |   —   |
| Storm Silver (DS)              | 1.05                       |  ✅   | ✅  |   —    | ✅  |   ✅    |   —   |
| Renegade Platinum (DS)         | 1.2.0, 1.3.0 (+ patches)   |  ✅   | ✅  |   ◐    | ✅  |   ✅    |   —   |
| Blaze Black 2 Redux (DS)       | 1.4.1 (+ Classic, EVless)  |  ✅   | ✅  |   ◐    | ✅  |   ✅    |   —   |
| Volt White 2 Redux (DS)        | 1.4.1 (+ Classic, EVless)  |  ✅   | ✅  |   ◐    | ✅  |   ✅    |   —   |
| Unbound                        | 2.1.1.1                    |  ✅   | ✅  |   ◐    | ✅  |   ✅    |  ✅   |
| Unbound                        | 2.1.1.1 French             |  ✅   | ✅  |   ◐    | ✅  |   ✅    |  ✅   |
| Unbound                        | 2.1.1.1 Italian (patch v7) |  ✅   | ✅  |   ◐    | ✅  |   ✅    |  ✅   |
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
| Let's Go Pikachu / Eevee       | English (4 builds)         |  ✅   | ✅  |   ◐    | ✅  |   ✅    |  ✅   |
| Clover                         | 1.3.3                      |  ✅   | ✅  |   ◐    | ✅  |   ✅    |   ◐   |
| Elysium (Part A)               | 2.5.0                      |  ✅   | ✅  |   ◐    | ✅  |   ✅    |   ◐   |
| Elysium (Part B)               | 2.5.0                      |  ✅   | ✅  |   ◐    | ✅  |   ✅    |   ◐   |
| Sword and Shield Ultimate Plus | 1.2.1.2 + its 3 patches    |  ✅   | ✅  |   ◐    | ✅  |   ✅    |  ✅   |
| GS Chronicles                  | 2.7.6                      |  ✅   | ✅  |   ◐    | ✅  |   ✅    |  ✅   |
| Rhythm                         | 1.4.0                      |  ✅   | ✅  |   ◐    | ✅  |   —    |   —   |
| Oops All Eevees!               | 1.3.2                      |  ✅   | ✅  |   ◐    | ✅  |   —    |   —   |
| Ceruleum                       | 1.1.1                      |  ✅   | ✅  |   ◐    | ◐  |   —    |   —   |
| RecordKeepers                  | 1.2.1                      |  ✅   | ✅  |   ◐    | ◐  |   —    |   —   |
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
| Epsilon Emerald                | 1.0.0                      |  ✅   | ✅  |   ◐    |  ◐  |   ✅    |   ◐   |
| Elite Redux                    | 2.65.3b, 2.65.4.1b         |  ✅   | ✅  |   ◐    | ✅  |   ✅    |   ◐   |
| Team Rocket Dragonsden         | 1.5                        |  ✅   | ✅  |   ◐    |  ◐  |    —    |   ◐   |
| Team Rocket Dragonsden         | 2026 3.0.9, 3.1 (Spanish)  |  ✅   | ✅  |   ◐    | ✅  |   ✅    |   ◐   |
| Wishes of Tomorrow             | 1.2.6                      |  ✅   | ✅  |   ◐    | ✅  |   ✅    |   ◐   |
| Dreamstone Mysteries           | the one release            |  ✅   | ✅  |   ◐    | ✅  |   ✅    |   ◐   |
| Monomyth                       | 1.0, 1.1, 1.2              |  ✅   | ✅  |   ◐    | ✅  |   ✅    |   ◐   |
| Emerald Rogue                  | 2.2.1-EX                   |  ✅   | ✅  |   ✅   | ✅  |   ✅    |   —   |
| SoulGold                       | 1.1.4, 1.2 (3), 1.2.1 (2)  |  ✅   | ✅  |   ◐    | ✅  |   ✅    |   ◐   |
| R.O.W.E.                       | 2.1.9.1 Experimental       |  ✅   | ✅  |   ◐    | ✅  |    ◐    |   —   |

</details>

<details>
<summary><strong>Notes on the table</strong></summary>

For a version that isn't listed, the app tries to read it as a game it knows (BEST EFFORT) and asks you to pick
when it isn't sure. Map ◐ means place names only,
without the map picture. Guide ◐ means the live pages only (the wild encounters here and the next boss). Battle ◐
means the battle panes work but haven't been checked in every kind of battle. On the DS, HeartGold's and SoulSilver's
battles aren't read yet. Origin HeartGold's battle system is its own: the battle panes read it and the battle buttons
press its commands and moves, but POKéMON opens the game's own party (no switch), and it has no guide yet. Heartfelt Gold reads as HeartGold with its own species, moves, items and type chart, and has no guide yet. Sacred Gold and Storm Silver read as HeartGold and SoulSilver with their own species' types and moves, and no guide yet. Renegade Platinum reads as Platinum with its own types (Fairy among them),
moves and type chart; its trainers and wild Pokémon are its own, so it has no guide yet. Blaze Black 2 Redux and Volt White 2 Redux read the same way, as Black 2 and White 2 with their own types, moves, type chart and machines, and no guide yet. Team Rocket Dragonsden is DragonsdenTV's Team Rocket Edition, not FireRed Rocket Edition.
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
