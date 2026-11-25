# PokeJourneys server

The game server for PokeJourneys Online. One codebase: anyone can run it for themselves and their friends, and the
official server is this same code with its own private settings, keys and database.

This first version holds the records the server decides (players, wallet and bag, Rating and Experience, Battle
Points, Vault Pokémon, trades and battles) and the admin console to view and change them. Players sign in with
Discord. When selected in the app, this server holds the wallet and Vault records; the phone keeps a working copy.

## Run it on your PC

```
dotnet run --project server/journeys-server -- --data "%LOCALAPPDATA%\PokeJourneysServer"
```

- It listens on `http://127.0.0.1:5280` only (this PC). `--urls http://0.0.0.0:5280` opens it to the network.
- The data folder holds `journeys.db` (SQLite) and `admin-key.txt`. The key is made on first start and printed once;
  the admin console asks for it. Delete the file to make a new key.
- `--seed-demo` adds a few test players (named `Test ...`) so the console has something to show. Run it on a fresh
  data folder only.
- Open `http://127.0.0.1:5280/admin/` for the admin console.
- `--admin-local-only` answers the admin console and admin API only for direct connections from the same machine
  (for example through an SSH tunnel); requests through a proxy, which carry `X-Forwarded-For`, `X-Real-IP` or
  `Forwarded`, get a 404. The Oracle service uses it; see SELF_HOSTING.md for deploying and managing from your PC.

## App releases

In the admin console's **Releases** page, upload the signed PokeJourneys APK, its version (for example `1.6.0`),
Android version code and release notes. The APK must be a ZIP starting with `PK`, under 200 MiB. Each version is
unique and its positive 32-bit version code must exceed every earlier upload, including unpublished releases.
Uploads start unpublished; choose **Publish** to offer one to players. Uploading and publishing each require a
reason and write an audit row. Files stay in `<data>/releases/<version>.apk`; back up this folder separately from
the database. The database stores their size and SHA-256, which the app verifies before installing.

To roll back an offer, choose **Unpublish** on the newest release and give a reason. The previous published
release becomes latest immediately. Installed apps are not downgraded: only versions newer than the installed
version are offered. Re-publish a release to make it available again.

Share `<server>/download` for a first install: this public HTML page shows the latest version, notes and APK
link without sign-in or external assets. Builds with an official server check that server for updates regardless
of the selected game server; builds without an official URL do not check for updates. GitHub is not queried.

**Updates are required.** The app sends its version code as `X-App-Version` on every call. When a release is
published, an app older than it (or one that sends no version) gets `426` "Update PokeJourneys to version X to keep
playing." from the game API, the Discord sign-in included, so it can't sign in or play online until it updates.
`/api/app/*`, `/api/status`, `/api/crash` and `/api/live` (the hub opens it only after `/api/me` passed) stay
open. The app checks for a newer release each time the hub connects and opens its update screen, which has no
LATER. Publishing takes effect at once; unpublishing also lifts the requirement. Bots are never refused.

| Method and path | Does |
| --- | --- |
| `GET /api/app/latest` | Newest published release by version code: `{ version, versionCode, notes, size, sha256, url }`, where `url` is `/api/app/download/<version>`; JSON 404 if none. |
| `GET /api/app/download/{version}` | Published APK, with Android APK content type and `PokeJourneys-<version>.apk` filename; 404 for unknown or unpublished versions. |
| `GET /api/admin/releases` | All releases, newest version code first, including unpublished ones. Requires the admin key. |
| `POST /api/admin/releases` | Multipart fields `apk` (file), `version`, `versionCode`, `notes`, `reason`; returns `{ auditId, before, after }`. Only this endpoint accepts the larger request body. |
| `PUT /api/admin/releases/{id}` | JSON `{ published: true/false, reason }`; returns `{ auditId, before, after }`. |

## Records

| Table | Holds |
| --- | --- |
| players | id, discord_id (nullable), name, created, last_seen, money, wallet_imported (0/1, default 0), battle_points, experience (shared Experience), status (`ok`, `flagged`, `muted`, `banned`), status_reason, notes |
| ratings | player_id, playlist (`random_singles`, `random_doubles`, `open_singles`, `open_doubles`), rating 1-50, highest_rating |
| bag | player_id, item (name), count |
| vault | id, player_id, species, nickname, level, shiny, ot_name, origin_game, fingerprint, legal (bool), hub_origin (text, nullable), data (base64 PKM, nullable), removed (bool), added |
| trades | id, at, from_player, to_player, summary |
| battles | id, at, playlist, player_a, player_b, winner (nullable), rated (bool), summary |
| chat | id, at, from_player (nullable = Server), to_player (nullable = global), text, notice (bool), deleted (bool, default false) |
| events | id, kind (`raid` or `event`), name, species (nullable), starts, ends, enabled, details (JSON text: rewards, cooldown hours, notes) |
| shop | item, label (nullable), price, stock (nullable = unlimited), enabled, max_owned (nullable = unlimited) |
| releases | id, version (unique), version_code, notes, size (bytes), sha256, published (0/1), created |
| audit | id, at, admin, action, target, before (JSON), after (JSON), reason, rolled_back (bool) |

Times are UTC ISO 8601 strings. Every admin change writes one audit row in the same transaction as the change.
Existing databases are migrated on start. Missing shop products are inserted from `TrainerEconomy.Catalog()` with
their shared label, price and carry limit. Existing rows keep all admin edits. Deleting a catalog row removes it
until the next start; disable it to keep it off the shop.

## Admin API

All under `/api/admin`, JSON in and out except the multipart release upload, header `X-Admin-Key: <key>` required (401 without it). Changes take a
`reason` field (required, shown in the audit log). Errors are `{ "error": "message" }` with status 400 or 404.

| Method and path | Does |
| --- | --- |
| `GET /overview` | `{ players, online24h, flagged, banned, vaultPokemon, activeEvents: [event], recentAudit: [audit] (10) }` |
| `GET /players?q=&status=&limit=50&offset=0` | `{ total, players: [player summary] }`; q matches name or discord id. Summary: id, name, discordId, status, money, experience, bestRating, bestPlaylist, lastSeen |
| `GET /players/{id}` | the player row (including `walletImported`) plus `ratings: [...]`, `bag: [...]`, `vault: [...]` (removed ones included, marked), `trades: [...]` and `battles: [...]` (last 50 each), `ledger: [...]` (last 100, including `source`), `audit: [...]` (entries targeting this player, last 50) |
| `PATCH /players/{id}` | any of `{ name, money, battlePoints, experience, notes }` + reason |
| `POST /players/{id}/status` | `{ status, reason }` (ok, flagged, muted, banned) |
| `PUT /players/{id}/ratings/{playlist}` | `{ rating, highestRating?, reason }` (highest defaults to max of old highest and rating) |
| `PUT /players/{id}/bag/{item}` | `{ count, reason }`; 0 deletes the row |
| `POST /players/{id}/vault/{vaultId}/remove` and `/restore` | `{ reason }` |
| `GET /events` / `POST /events` / `PUT /events/{id}` / `DELETE /events/{id}` | events; body fields as in the table, plus reason (DELETE takes `?reason=`) |
| `GET /shop` / `PUT /shop/{item}` / `DELETE /shop/{item}` | shop rows; PUT takes `{ price, stock?, enabled, label?, maxOwned?, reason }`. Omitted label and maxOwned keep their existing values; null clears them. |
| `GET /audit?target=&limit=100&offset=0` | `{ total, entries: [audit] }` |
| `GET /announcements` / `PUT /announcements` | `{ lines }`: what players see after the welcome on the island (up to 5 lines of 200 characters); PUT takes `{ lines, reason }`, audited as `announcements.put`. On the console Overview. |
| `GET /chat?player=&limit=100` | Recent global and direct messages, newest first, as `[chat]` with an extra `deleted` boolean. Optional player ID filters messages sent or received by that player; limit is 1-1000. Includes deleted messages for moderation. |
| `DELETE /chat/{id}?reason=...` | Marks the message deleted, broadcasts `chat_deleted` to everyone connected, and records `chat.delete` in the audit log. Returns `{ auditId, before, after }`. |
| `POST /chat/notice` | `{ text, reason }`: stores a global Server notice and broadcasts it to everyone connected; text uses the same 1-200 character rules as chat. Audited as `chat.notice`; returns `{ auditId, before, after, message: chat }`. |
| `POST /audit/{id}/rollback` | `{ reason }`: restores the `before` state of that change, writes its own audit row, marks the entry rolled back. Refused if already rolled back. |

JSON field names are camelCase versions of the column names.

## Game API (what the app uses)

All under `/api`, JSON in and out. Signed-in calls take `Authorization: Bearer <session token>`; 401 without a valid
session, 403 `{ "error": ... }` for a banned player (and signing in deletes nothing else). Errors as in the Admin API.

**Sign-in.** The app already holds a Discord access token (scope `identify`). It sends that token to this server once;
the server asks Discord who it belongs to (`GET https://discord.com/api/users/@me`, base URL set by
`--discord-api`, for tests) and keeps no Discord token. Each server signs players in by itself: the app never sends a
Discord token to a server the player didn't choose (see the app's server picker, later).

| Method and path | Does |
| --- | --- |
| `POST /auth/discord` `{ accessToken }` | Checks the token with Discord; creates the player on first sign-in (name = Discord global name or username), updates name and last_seen after. Returns `{ sessionToken, expires, player }`. Session tokens are 32 random bytes (hex); only their SHA-256 is stored (`sessions`: token_hash, player_id, created, expires, last_used), valid 30 days. |
| `POST /auth/dev` `{ name }` | Only with `--dev-signin` and only from a loopback address: signs in a local test player by name, for testing without Discord. |
| `POST /auth/signout` | Deletes this session. |
| `GET /me` | The player (id, name, status, money, battlePoints, experience, imported), ratings, bag, and Vault Pokémon that are `stored` or `withdrawing` (without `data`). |
| `GET /shop` | Enabled shop rows, including label and maxOwned. |
| `POST /shop/buy` `{ item, count, requestId }` | One transaction: item enabled, count 1-999, stock enough (null = unlimited), money enough, resulting count within maxOwned; takes money, lowers stock, adds to bag, writes a ledger row. Returns `{ money, count, wallet }`. Exceeding maxOwned returns 400 "You already have as many of that item as you can carry." |
| `POST /shop/sell` `{ item, count, requestId }` | Sells a `mart:` product, count 1-999, owned enough. Adds `(price / 2) * count` with integer division and writes a `sell` ledger row. Returns `{ money, count, wallet }`; 400 "Your wallet is full." if money would exceed 9,999,999. |
| `GET /wallet` | `{ money, items: { key: count }, imported }`, with only positive item counts. |
| `POST /wallet/report` `{ source, money, items, requestId }` | Reports signed money and item changes from the phone; source is `import` or a journey id (including `hub`), at most 64 characters. Returns the wallet. See wallet sync below. |
| `POST /bag/take` `{ item, count, journey, requestId }` | Moves items out of the shared bag into a journey (the app writes them into the save); ledger row. |
| `GET /status` | No sign-in needed: `{ online, players, announcements }` for the title screen (players connected to the live connection) and the island's welcome. |
| `GET /events` | Enabled events that are running or start within 14 days. |
| `POST /vault/deposit` `{ data, journey, requestId }` | `data` is the Pokémon's PKHeX entity bytes in base64 (any generation). The server reads it with PKHeX, refuses it if it fails `Journeys.Core.Legality.Check` (400 with the issue), computes its fingerprint, and refuses it if a Vault row with that fingerprint is `stored` or `withdrawing` (409 "This Pokémon is already in the Vault"). Otherwise stores it (`state` = `stored`) with species, nickname, level, shiny, OT, origin game from the data. Returns the Vault row. |
| `GET /vault/{id}` | The signed-in player's own stored Vault row, including data. Returns 404 for other owners, removed rows, or any state other than stored. |
| `POST /vault/{id}/withdraw` `{ journey, requestId }` | `stored` -> `withdrawing`; returns the row with `data`. The app writes it into the save, then confirms. |
| `POST /vault/{id}/withdraw/confirm` and `/withdraw/cancel` | `withdrawing` -> `withdrawn` (gone from the Vault) or back to `stored`. |

- `requestId` (client-made, up to 64 chars) makes a change safe to retry: the same player and requestId return the
  first result without doing it again (`requests` table: player_id, request_id, response, at).
- **Fingerprint:** SHA-256 of the values a Pokémon keeps across games and evolution: PID (DVs for Gen 1-2),
  trainer ID and secret ID, OT name and gender, and met date when the game has one. A Pokémon withdrawn and later
  deposited again matches its earlier `withdrawn` row and is allowed. The same Pokémon deposited twice from a
  restored save is refused.
- **Ledger** (`ledger`: id, at, player_id, kind (`buy`, `sell`, `take`, `admin`, `import`, `journey`), item, count, money_change, money_after,
  request_id, source (nullable)): every money or bag change from the game API. Admin edits of money or bag also write a ledger row of
  kind `admin`.
- Admin side: `vault` gets `state` (`stored`, `withdrawing`, `withdrawn`; the old `removed` flag stays as the admin's
  remove) and `legality_issue`; `GET /api/admin/players/{id}` adds `ledger` (last 100) and `sessions` (count and last
  used); banning a player deletes their sessions. The admin console shows walletImported, ledger sources and the Vault state.

## Wallet sync and bridge commands

Wallet keys are `mart:<JourneyBag.Key(name)>`, `tm:<move id>` and `costume:<id>`. The existing item normalizer
preserves spaces, for example `mart:poke ball`; use the catalog's exact key. TMs cost 3,000, ordinary items and TMs
have carry limit 999, and costumes have limit 1. Money is separate, from 0 to 9,999,999.

The first `POST /api/wallet/report` uses source `import` and the phone's money and items as changes from zero.
It sets walletImported once; another import returns 409 "This wallet was already brought to this server."
Other sources require import first, or return 409 "Bring your wallet to this server first." Reports accept up to
500 item keys, clamp money to 0..9,999,999 and counts to 0..999 (costumes 0..1), and delete zero counts. They write
one ledger row for money and one per changed key, recording actual changes after clamping, source and requestId.
Retries with the same requestId return the original answer, even after later wallet changes.

A report adding more than 200,000 money or more than 99 of one key, or an import bringing more than 999,999 money,
changes an `ok` player to `flagged`, with reason `Large wallet report from <source>` and an audit row by `server`.
The wallet change still applies; other statuses are kept.

The `journeys` bridge (also built for Android) supports:

```
journeys economy export
journeys economy import <file>
journeys vault list --json
journeys vault data <id>
journeys vault import <file> [--from <game>]
journeys vault drop <id>
```

Economy export prints one JSON line `{ "ready": true, "money": 0, "items": {} }`; ready is false until seeded,
with money 0 and only any existing TMs and costumes. Import accepts this shape or the server wallet shape,
replaces money, mart items, TMs and costumes, preserves save-read baselines, rejects unknown keys and prints `ok`.
Vault list prints `[{ "id", "species", "summary", "fromGame", "depositedUtc" }]`; data prints the stored bytes as
base64. Vault import reads a file containing base64 entity bytes, checks it, stores a new entry without touching a
save, and prints the entry as JSON. The default fromGame is the entity's origin version. Drop removes the entry
and its file and prints `ok`. Set `JOURNEYS_DATA` to select the bridge's working folder.

## Backups

On start and every 24 hours the server copies the database with SQLite's online backup into `<data>/backups/`
(`journeys-YYYYMMDD-HHMMSS.db`), keeping the newest 14. `POST /api/admin/backup` makes one now; `GET /api/admin/overview`
adds `lastBackup`. Restoring is stopping the server and copying a backup over `journeys.db`.

## Live connection (hub presence)

`GET /api/live` as a WebSocket, with the same `Authorization: Bearer <session token>` as the game API (Godot's
`WebSocketPeer` takes it in `handshake_headers`). One connection per player: a second one replaces the first.
Every 15 seconds the server checks the session again and closes the connection of a banned, signed-out or expired
player. Messages are JSON text, at most 4 KB, up to 20 a second (extra ones are dropped, except chat always gets
an error when throttled). Presence is kept in memory only; chat is stored in SQLite.

Rooms are named like the hub's: `island` for Victory Island and the interior's `room` from `layout.json`
(`pokemart`, `battlestadium`...); away from the hub use `journey-<id>` or `raid`. Positions are tiles (0-4095).

| Client sends | Does |
| --- | --- |
| `{ type: "move", room, x, y, facing }` | Where the player stands (`facing`: up, down, left, right). Changing room answers `room` and tells the new room `joined`. |
| `{ type: "profile", look, follower, card }` | What others see: each a JSON object or null, 2 KB in all. `look` is the creator look (a look with only `gender` and `seed` is drawn as a random look from the seed); `follower` `{ species, shiny }`; `card` the trainer card's story progress (`journeys: [{ id, name, badges, pokedex, hours, champion }]`, `current`, `story`). Send it on connecting and when it changes. |
| `{ type: "status", status }` | A short visible state, up to 48 characters: `""`, `afk`, `shopping`, `talking:<name>`, `away:<journey>`. |
| `{ type: "ping" }` | Answers `pong`. |
| `{ type: "request", to, kind, text? }` | To a player in the same room. `kind`: `friend`, `trade`, `battle` (answered within a minute) or `message` (`text`, 1-100 characters; refused for a muted player). At most 5 waiting per player and one per player and kind. Answers `sent`. |
| `{ type: "answer", id, accept }` | Accepts or declines a request sent to you. An accepted friend request is saved for both players. |
| `{ type: "chat", channel: "global", text }` | Sends global chat to everyone connected, in every room, including the sender. |
| `{ type: "chat", to: playerId, text }` | Stores a private message for one player, online or offline. Sends it to the sender and to the receiver if connected. |

| Server sends | Means |
| --- | --- |
| `{ type: "room", room, you, players: [player] }` | Everyone already in the room you entered. |
| `{ type: "joined", player }` / `{ type: "profile", player }` | Someone entered your room / changed their profile. |
| `{ type: "moved", player: { id, x, y, facing } }` | Someone moved. Dropped for a connection that can't keep up. |
| `{ type: "status", id, status }` / `{ type: "left", id }` | Someone's status changed / they left the room. |
| `{ type: "request", id, kind, text, from: { id, name } }` | Someone asks you (or says `text`). |
| `{ type: "answer", id, kind, accept, from }` / `{ type: "sent", id, kind, to }` | The answer to your request / your request was delivered. |
| `{ type: "friends", ids }` | Your friends, on connecting and when one is added. |
| `{ type: "chat", id, channel, from: { id, name }, to: { id, name } \| null, text, at, notice }` | A chat message: channel is `global` or `direct`, id is a 64-bit integer, and at is UTC ISO 8601. A global message has to = null. Server notices have channel = `global`, notice = true and from = `{ id: 0, name: "Server" }`; ordinary messages have notice = false. |
| `{ type: "chat_history", messages: [chat] }` | Immediately after `friends` on connecting: the last 50 global messages plus the last 50 direct messages you sent or received, combined oldest first. Deleted messages are excluded. |
| `{ type: "chat_deleted", id }` | An admin deleted a message; remove it from the chat display. Sent to everyone connected. |
| `{ type: "error", error }` | The message was refused. |

A full `player` is `{ id, name, x, y, facing, status, look, follower, card, stats }`. `stats` comes from the server's
records (`experience`, `battlePoints`, `bestRating`, `bestPlaylist`), so a trainer card can't claim a Rating it
doesn't have; `look`, `follower` and `card` are what the player's phone reports. `GET /api/friends` lists the
signed-in player's friends (`id`, `name`, `since`, `online`); friends are kept in the `friends` table. An accepted
trade request opens a trade (`Trades.cs`): the server sends both players `trade_open { trade, with, vault }` (their own
stored Vault entries), they send `trade_offer { trade, vault }` (one of their own stored entries, or null),
`trade_confirm { trade }` and `trade_cancel { trade }`, and get `trade_update { trade, mine, theirs, confirmed }`. A new
offer clears both confirmations. When both confirm, one transaction checks both entries are still stored and theirs,
swaps their owners, writes a `trades` row and a `vault.trade` audit row, and sends `trade_done { trade, gave, got }`;
otherwise `trade_closed { trade, reason }` (cancel, leaving, another trade, or ten minutes). Bots decline trades.

An accepted battle request starts a battle (`Battles.cs`): the server sends both players `battle_start { battle,
format, seed, side, players }` and both phones run the Battle Dome's engine from that seed (Random Singles: both teams
come from the seed), so the server only relays choices over HTTP: `POST /api/battles/{id}/choice { turn, choice,
check }`, `GET /api/battles/{id}/events?after=n` (a 25-second long poll), `POST /api/battles/{id}/result { winner,
check }` and `POST /api/battles/{id}/forfeit`. The result is kept in the `battles` table (casual, not rated) when
both phones report the same winner and log hash; if they disagree no winner is kept. A side that hasn't chosen for
three minutes while the other has loses. Bots decline battles. `GET /api/admin/live` lists who is
online, by room, and the admin console shows it under **Online now** on the overview.

Chat text is trimmed and must contain 1-200 characters with no control characters. Each player can send at most
one chat message per second, across global and direct messages and across reconnects; extras receive `error`.
A muted player receives `{ type: "error", error: "You can't chat right now." }`, including when muted while
already connected. Messages older than seven days are deleted on start and on the next new message each hour.
The console's **Chat** page posts notices, filters recent messages by player ID, and deletes messages with an
audit reason. Deleted messages never appear in connection history.

### Blocking and reports (Safety.cs)

- `{ type: "block", player }` / `{ type: "unblock", player }`: answered with `{ type: "blocks", ids }`, the players
  this one has blocked (also sent on connecting). Two players with a block either way don't see each other's chat
  or history, and can't send each other private messages or requests. They still see each other on the island.
- `{ type: "report", player, reason }`: saves a report with the reported player's last 20 messages and answers
  `{ type: "reported", player }`. At most 10 reports an hour per player.

The console's **Reports** page lists open (or closed) reports with what the reported player said. Mute or ban from
the player's page, then close the report with an audit reason.

### Crash logs

`POST /api/crash { version, device, android, trace }` (signed in) stores a crash log from the app: Kotlin crashes,
and native crashes and freezes from Android's exit records, sent at the next start. At most 10 an hour per player;
the newest 1000 are kept. The console's **Crashes** page lists them.

## Bot players (test servers only)

A server started with `--dev-signin` can run bot players: fake trainers named `Bot 01`, `Bot 02`... that sign in
through the development sign-in and use the game API and the live connection like the app and hub do. Each bot is
the same trainer every time (from its name): a personality, a look seed, a follower Pokémon and a trainer card with
its own journeys, badges, Pokédex and hours.

- **Shoppers** walk from shop to shop, go in, stand at the counter as `shopping` and buy or sell.
- **Travellers** walk to the pier, talk to the Journey captain (or the Raid captain), go `away:<journey>` for a few
  minutes while their journey reports prize money and spending, then come back at the pier.
- **Idlers** walk somewhere and stand `afk` for one to five minutes, turning now and then.
- **Wanderers** walk around the island and stop by the other islanders.
- Now and then a bot sends someone within sight (12 tiles across, 8 up or down) a friend request or a quick
  message, mostly other bots and sometimes a real player, or reads `/me` or `/events`. Bots answer requests after a
  few seconds: about 7 in 10 friend requests are accepted, trade and battle requests are always declined (bots have
  no Vault and can't battle yet), and messages sometimes get a reply.
- Each bot posts a friendly global chat line every three to six minutes, with a staggered first message. Direct
  chat gets a reply after two to six seconds about half the time, even across rooms. Existing nearby requests
  and answers continue as before.

The places (doors, interiors, clerks, captains) come from the repository's `hub/victory/data/layout.json`. Its
`botHangouts` (the hub ignores it) says where bots gather: `spawn` and `docks` are areas `[x0, y0, x1, y1]` where
AFK bots stand, spread out so their name tags don't overlap, and `lineup` is the boardwalk line (`from`, `to`,
`spacing`, `facing`): a show-off walks onto the tile behind a free place, steps forward and faces out, so its
follower stands behind it. Bot 01, 02... take turns at being a spawn idler, shopper, show-off, traveller or dock
idler (three in ten stand around the spawn).
`--hub-walk <walk.json>` adds the walkable tiles from a hub build so bots follow real paths around buildings and
water (the file is made when the hub is built and isn't in the repository); without it they walk straight lines.
Use a separate data folder so real data stays clean:

```
dotnet run --project server/journeys-server -c Release -- --data "%LOCALAPPDATA%\PokeJourneysServer-bots" --urls http://127.0.0.1:5281 --dev-signin --bots 20 --hub-walk "C:\Builds\PokeJourneys\app\generated\hubBuildAssets\hub-build\tools\hub\build\island\walk.json"
```

On a public server use `--bot-signin` in place of `--dev-signin`: the sign-in without Discord then takes only bot
names ("Bot 01" to "Bot 100") and only from the server's own machine, never through the HTTPS proxy (Caddy also
answers `/api/auth/dev` with a 404). `--hub-layout <layout.json>` gives the places when the server doesn't run from
the repository. `deploy.ps1` copies both hub files to the VM, and the service starts 30 bots this way.

`--bots N` (0-100) starts N bots when the server starts. The admin console's **Bot players** page turns them on
and off, sets how many (removing bots signs them out), and shows calls, refusals and latency per endpoint and the
recent bot activity; **Online now** on the overview shows where each one is and what they're doing. Bot players
show in **Players** like any other player, with their ledger. The API is `GET /api/admin/bots` and
`PUT /api/admin/bots { enabled, count }`. Without `--dev-signin` the page says the bots are off for this server.
A bot the server signs out (for example a ban) stops; turn bots off and on to start it again.

The on/off switch and count are saved, so they survive a restart; once the console has set them, `--bots` is ignored.

### Editing bots (BotSetup.cs)

The **Bot players** page lists each bot with an **Edit** button: name (up to 20 characters), personality, boy or
girl look, follower (National Pokédex number, shiny or not), whether it talks in global chat, and its trainer card
(which journeys, the current one, badges, Pokédex, hours, Champion). Saving restarts a running bot with its changes;
**Reset** puts it back to the defaults its number gives it. **What bots say** sets the replies bots send players and
the lines they say in global chat. Money and items are edited on the bot's player page as for anyone.

A bot is its number, not its name: it signs in as `Bot 01`... with the name to show, and the server keeps it as the
player `discord_id = bot:1`... (the first time, it takes over the player it was before, found by its old name). The
look seed also stays with the number, so a renamed bot looks the same.

API: `PUT /api/admin/bots/{n}` { name, personality, gender, species, shiny, chat, journeys: [{ id, badges, pokedex,
hours, champion }] } (the first journey is the current one), `DELETE /api/admin/bots/{n}`, and
`PUT /api/admin/bots/chat` { replies, global } (1 to 30 lines each). Saved in the `settings` table as `bots`,
`bot:<n>` and `bot-chat`.

## Not yet

Discord sign-in for admins (the admin key stands in), trades between players, battle requests and ranked battles,
raids, and drawing other players in the hub.
