# Battle Dome

The phone runs Pokémon Showdown through the existing pinned `@pkmn/sim` packages in a WebView. The Dome's practice
desks keep their format selection, optional Vault teams, and rewards.

## Battles between players

Accepting a hub battle request opens a casual Random Singles battle on both phones. `battle_start` supplies the
battle ID, four-number seed, local side (0 is p1, 1 is p2), and both player names. `PvpBattle` uses the same Gen 7
Random Battle format as the Dome. The seed supplies both team generators as well as the simulator; neither side
chooses automatically. Playback shows the local side's private channel with its own Pokémon in front.

`PvpBattle.kt` uses the selected server and the signed-in session to post each local choice and long-poll events.
Each player's choice counter starts at 1 and includes forced switches. A failed network submission retries the
same turn before later submissions. Own echoes and duplicate remote events are ignored. Choice and result checks
use the same eight-character FNV-1a hash of the unfiltered simulator log on both phones. Incoming events wait for
current playback to finish. A server end displays its winner and reason; giving up posts a forfeit.

These battles do not select Vault Pokémon or change Rating, Experience, or Battle Points.

From this directory, run `npm test` for simulator, playback, perspective, and relay checks, and `npm run build` to
bundle the WebView assets. Two-phone HTTP and lifecycle behavior still needs device verification.

`node test/server-relay.mjs <server url>` plays a whole battle between two test players through a running server
started with `--dev-signin`, each with its own engine, exchanging only choices as two phones would, and prints the
result both report.
