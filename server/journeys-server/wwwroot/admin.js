const API = '/api/admin';
const KEY_STORAGE = 'journeys-admin-key';
const PAGE_SIZE = 50;
const AUDIT_PAGE_SIZE = 100;
const PLAYLISTS = ['random_singles', 'random_doubles', 'open_singles', 'open_doubles'];
const PLAYLIST_NAMES = {
  random_singles: 'Random singles', random_doubles: 'Random doubles',
  open_singles: 'Open singles', open_doubles: 'Open doubles'
};
const STATUS_NAMES = { ok: 'OK', flagged: 'Flagged', muted: 'Muted', banned: 'Banned' };
const PAGES = {
  overview: ['Overview', 'A snapshot of your server.'],
  players: ['Players', 'Manage player records, inventories and ratings.'],
  events: ['Events and raids', 'Schedule encounters and manage live events.'],
  shop: ['Shop', 'Set prices, availability and stock.'],
  chat: ['Chat', 'Post server notices and moderate recent messages.'],
  reports: ['Reports', 'Players reported by other players, with what the reported player said recently.'],
  crashes: ['Crashes', 'Crash logs the app sends the next time it starts after a crash.'],
  releases: ['Releases', 'Upload app updates and choose which versions players can download.'],
  audit: ['Audit log', 'Review changes and restore earlier records.'],
  bots: ['Bot players', 'Fake trainers that use the game API, for testing the server under load.']
};

const $ = (selector, root = document) => root.querySelector(selector);
const view = $('#view');
const keyDialog = $('#key-dialog');
const reasonDialog = $('#reason-dialog');
const state = {
  route: { page: 'overview', id: null },
  players: { q: '', status: '', offset: 0 },
  audit: { target: '', offset: 0 },
  chat: { player: '' },
  reports: { state: 'open' },
  player: null, events: [], shop: [], editingEvent: null,
  loading: false, changing: false
};
let requestVersion = 0;
let key = '';
let keyPromise = null;
let resolveKey = null;
let resolveReason = null;

try { key = sessionStorage.getItem(KEY_STORAGE) || ''; } catch { /* Storage may be unavailable. */ }

// All server values used in HTML pass through this function, including attributes.
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);
}
const h = escapeHtml;
const segment = value => encodeURIComponent(String(value));
const number = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)) ? Number(value).toLocaleString() : '—';
const playlistName = value => PLAYLIST_NAMES[value] || value || '—';
const isTrue = value => value === true || value === 1;
const checked = value => isTrue(value) ? ' checked' : '';

function time(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

function badge(value, type = '') {
  const safeType = ['ok', 'flagged', 'muted', 'banned', 'legal', 'illegal'].includes(type) ? type : '';
  return `<span class="badge ${safeType}">${h(value)}</span>`;
}

function statusBadge(status) { return badge(STATUS_NAMES[status] || status || 'Unknown', status); }

function message(text, error = false) {
  const element = $(error ? '#error' : '#notice');
  element.textContent = text;
  element.hidden = !text;
  if (error && text) element.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function clearMessages() { message(''); message('', true); }

function rememberKey(value) {
  key = value;
  try {
    if (value) sessionStorage.setItem(KEY_STORAGE, value);
    else sessionStorage.removeItem(KEY_STORAGE);
  } catch { /* Keep the key in memory if sessionStorage is blocked. */ }
}

function askForKey(error = '') {
  if (keyPromise) return keyPromise;
  $('#key-error').textContent = error;
  $('#key-error').hidden = !error;
  $('#admin-key').value = '';
  keyPromise = new Promise(resolve => { resolveKey = resolve; });
  keyDialog.showModal();
  return keyPromise;
}

$('#key-form').addEventListener('submit', event => {
  event.preventDefault();
  const input = $('#admin-key');
  const value = input.value.trim();
  input.setCustomValidity(value ? '' : 'Enter an admin key.');
  if (!input.reportValidity()) return;
  rememberKey(value);
  input.value = '';
  keyDialog.close();
  const resolve = resolveKey;
  keyPromise = null;
  resolveKey = null;
  resolve(value);
});
$('#admin-key').addEventListener('input', event => event.target.setCustomValidity(''));
keyDialog.addEventListener('cancel', event => event.preventDefault());

async function api(path, { method = 'GET', body } = {}) {
  for (;;) {
    if (keyPromise) await keyPromise;
    if (!key) await askForKey();
    const sentKey = key;
    let response;
    try {
      response = await fetch(`${API}${path}`, {
        method, cache: 'no-store', credentials: 'same-origin',
        headers: { 'X-Admin-Key': sentKey, ...(body === undefined || body instanceof FormData ? {} : { 'Content-Type': 'application/json' }) },
        ...(body === undefined ? {} : { body: body instanceof FormData ? body : JSON.stringify(body) })
      });
    } catch {
      throw new Error('Could not reach the server. Check the connection and try again.');
    }
    if (response.status === 401) {
      if (key === sentKey) {
        rememberKey('');
        await askForKey('The server rejected this key. Enter a valid admin key to continue.');
      }
      continue;
    }
    const text = await response.text();
    let data = null;
    if (text) {
      try { data = JSON.parse(text); }
      catch {
        if (response.ok) throw new Error('The server returned an invalid JSON response.');
      }
    }
    if (!response.ok) throw new Error(data?.error || `Request failed (${response.status} ${response.statusText}).`);
    return data;
  }
}

function askReason(description) {
  $('#reason-help').textContent = description;
  const input = $('#change-reason');
  input.value = '';
  input.setCustomValidity('');
  return new Promise(resolve => {
    resolveReason = resolve;
    reasonDialog.showModal();
  });
}

function finishReason(value) {
  reasonDialog.close();
  const resolve = resolveReason;
  resolveReason = null;
  resolve?.(value);
}

$('#reason-form').addEventListener('submit', event => {
  event.preventDefault();
  const input = $('#change-reason');
  const reason = input.value.trim();
  input.setCustomValidity(reason ? '' : 'A reason is required.');
  if (input.reportValidity()) finishReason(reason);
});
$('#change-reason').addEventListener('input', event => event.target.setCustomValidity(''));
$('#cancel-reason').addEventListener('click', () => finishReason(null));
reasonDialog.addEventListener('cancel', event => { event.preventDefault(); finishReason(null); });

async function change(method, path, body, description) {
  if (state.changing) return;
  state.changing = true;
  const routeBefore = location.hash;
  let cancelled = false;
  try {
    const reason = await askReason(description);
    if (reason === null) { cancelled = true; return; }
    clearMessages();
    view.inert = true;
    $('#refresh').disabled = true;
    $('#change-key').disabled = true;
    if (method === 'DELETE') {
      await api(`${path}?${new URLSearchParams({ reason })}`, { method });
    } else if (body instanceof FormData) {
      body.set('reason', reason);
      await api(path, { method, body });
    } else {
      await api(path, { method, body: { ...body, reason } });
    }
    if (path.startsWith('/events')) state.editingEvent = null;
    message('Change saved and recorded in the audit log.');
    await loadView();
  } catch (error) {
    message(error.message, true);
    // If navigation occurred during a write, load that destination after a failure too.
    if (location.hash !== routeBefore) await loadView();
  } finally {
    state.changing = false;
    view.inert = false;
    $('#refresh').disabled = state.loading;
    $('#change-key').disabled = false;
    if (cancelled && location.hash !== routeBefore) await loadView();
  }
}

function panel(title, description, content, action = '') {
  return `<section class="panel"><div class="panel-head"><div><h2>${h(title)}</h2>${description ? `<p>${h(description)}</p>` : ''}</div>${action}</div>${content}</section>`;
}

function table(headers, rows, emptyText = 'No records found.') {
  if (!rows.length) return `<p class="empty">${h(emptyText)}</p>`;
  return `<div class="table-wrap" role="region" aria-label="${h(headers.join(', '))}" tabindex="0"><table><thead><tr>${headers.map(header => `<th scope="col">${h(header)}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
}

function pager(kind, total, offset, limit) {
  return `<div class="pagination"><span>${h(total ? `${number(offset + 1)}–${number(Math.min(offset + limit, total))} of ${number(total)}` : '0 results')}</span><div class="actions"><button type="button" class="small" data-action="page" data-kind="${kind}" data-offset="${Math.max(0, offset - limit)}"${offset === 0 ? ' disabled' : ''}>Previous</button><button type="button" class="small" data-action="page" data-kind="${kind}" data-offset="${offset + limit}"${offset + limit >= total ? ' disabled' : ''}>Next</button></div></div>`;
}

function snapshot(value) {
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return value; }
}

function pretty(value) {
  if (value === undefined) return '— (absent)';
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
}

function jsonText(value) {
  if (typeof value === 'string') {
    try { return JSON.stringify(JSON.parse(value), null, 2); } catch { return value; }
  }
  return JSON.stringify(value, null, 2);
}

function diff(beforeValue, afterValue) {
  const before = snapshot(beforeValue);
  const after = snapshot(afterValue);
  const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const beforeRecord = isRecord(before) ? before : before == null ? {} : { value: before };
  const afterRecord = isRecord(after) ? after : after == null ? {} : { value: after };
  const fields = [...new Set([...Object.keys(beforeRecord), ...Object.keys(afterRecord)])].sort();
  const rows = fields.map(field => {
    const oldValue = Object.hasOwn(beforeRecord, field) ? beforeRecord[field] : undefined;
    const newValue = Object.hasOwn(afterRecord, field) ? afterRecord[field] : undefined;
    const changed = JSON.stringify(oldValue) !== JSON.stringify(newValue);
    return `<tr${changed ? ' class="changed"' : ''}><td>${h(field)}${changed ? '<span class="subline">Changed</span>' : ''}</td><td><pre>${h(pretty(oldValue))}</pre></td><td><pre>${h(pretty(newValue))}</pre></td></tr>`;
  });
  return `<details><summary>Before / after</summary><div class="diff">${table(['Field', 'Before', 'After'], rows, 'No fields recorded.')}<details><summary>Full snapshots</summary><div class="diff-state"><strong>Before</strong><pre>${h(pretty(before))}</pre></div><div class="diff-state"><strong>After</strong><pre>${h(pretty(after))}</pre></div></details></div></details>`;
}

function auditTable(entries) {
  return table(['Time', 'Admin', 'Action', 'Target', 'Reason', 'Changes', ''], entries.map(entry => `<tr>
    <td>${h(time(entry.at))}</td><td>${h(entry.admin)}</td><td>${h(entry.action)}</td><td>${h(entry.target)}</td><td class="wide">${h(entry.reason)}</td>
    <td>${diff(entry.before, entry.after)}</td><td>${String(entry.action).startsWith('release.') ? '<a href="#releases">Manage release</a>' : `<button type="button" class="small" data-action="rollback" data-id="${h(entry.id)}"${isTrue(entry.rolledBack) ? ' disabled' : ''}>${isTrue(entry.rolledBack) ? 'Rolled back' : 'Roll back'}</button>`}</td>
  </tr>`), 'No audit entries yet.');
}

function renderOverview(data) {
  const live = data.live || { online: 0, rooms: [], players: [] };
  const rooms = live.rooms.map(room => `${h(room.room)}: ${h(number(room.players))}`).join(' · ');
  const online = live.players.map(player => `<tr class="clickable" data-player="${h(player.id)}"><td>${h(player.name)}</td><td>${h(player.room || '—')}</td><td>${player.room ? `${h(player.x)}, ${h(player.y)} ${h(player.facing)}` : '—'}</td><td>${h(player.status || '—')}</td><td>${h(player.follower ? `#${player.follower.species}${player.follower.shiny ? ' ✦' : ''}` : '—')}</td><td>${h(time(player.since))}</td></tr>`);
  const counts = [['Online now', live.online, ''], ['Players', data.players, ''],['Seen in 24 hours', data.online24h, ''], ['Flagged', data.flagged, 'flagged'], ['Banned', data.banned, 'banned'], ['Vault Pokémon', data.vaultPokemon, '']];
  const events = (data.activeEvents || []).map(event => `<article class="event-card">${badge(event.kind)}<h3>${h(event.name)}</h3><p>${h(event.species || 'All species')}</p><p><strong>Starts</strong> ${h(time(event.starts))}</p><p><strong>Ends</strong> ${h(time(event.ends))}</p></article>`).join('');
  view.innerHTML = `<div class="stats">${counts.map(([label, count, type]) => `<article class="stat ${type}"><span>${h(label)}</span><strong>${h(number(count))}</strong></article>`).join('')}</div>
    ${panel('Announcements', 'Shown to every player after they arrive on the island, after the welcome: maintenance, downtime, updates, greetings. One per line, up to 5 lines of 200 characters; empty clears them.', `<form class="panel-body" data-form="announcements"><textarea name="lines" rows="4" maxlength="1100" aria-label="Announcements, one per line">${h((data.announcements || []).join('\n'))}</textarea><div class="actions"><button type="submit" class="primary">Save announcements</button></div></form>`)}
    ${panel('Online now', rooms ? `Players connected to the hub, by room: ${rooms}` : 'Players connected to the hub.', table(['Name', 'Room', 'Position', 'Status', 'Follower', 'Connected'], online, 'Nobody is connected right now.'))}
    ${panel('Active events','Current events and raids on this server.', `<div class="panel-body">${events ? `<div class="event-grid">${events}</div>` : '<p class="muted">No active events.</p>'}</div>`, '<a href="#events">Manage events →</a>')}
    ${panel('Backups', 'Automatic backups run every 24 hours; the newest 14 are kept.', `<div class="panel-body"><p><strong>Last backup</strong> ${h(time(data.lastBackup))}</p><p><strong>Active sessions</strong> ${h(number(data.sessions))}</p></div>`, '<button type="button" data-action="backup">Back up now</button>')}
    ${panel('Recent activity', 'The last 10 admin changes.', auditTable((data.recentAudit || []).slice(0, 10)), '<a href="#audit">Full audit log →</a>')}`;
}

function renderPlayers(data) {
  const { q, status, offset } = state.players;
  const filters = `<form class="filters" data-form="players-filter"><div class="search"><label for="player-search">Find a player</label><input id="player-search" name="q" type="search" placeholder="Name or Discord id" value="${h(q)}"></div><div><label for="player-status">Status</label><select id="player-status" name="status"><option value="">All statuses</option>${Object.entries(STATUS_NAMES).map(([value, label]) => `<option value="${value}"${status === value ? ' selected' : ''}>${label}</option>`).join('')}</select></div><button type="submit" class="primary">Search</button></form>`;
  const rows = (data.players || []).map(player => `<tr class="clickable" data-player="${h(player.id)}">
    <td class="wide"><a class="player-link" href="#players/${h(segment(player.id))}">${h(player.name)}</a></td><td>${h(player.discordId || '—')}</td><td>${statusBadge(player.status)}</td><td class="numeric">${h(number(player.money))}</td><td class="numeric">${h(number(player.experience))}</td><td class="numeric">${h(number(player.bestRating))}<span class="subline">${h(playlistName(player.bestPlaylist))}</span></td><td>${h(time(player.lastSeen))}</td>
  </tr>`);
  view.innerHTML = panel('Player directory', 'Select a player to view and edit their records.', filters + table(['Name', 'Discord id', 'Status', 'Money', 'Experience', 'Best Rating / playlist', 'Last seen'], rows, 'No players match your search.') + pager('players', data.total, offset, PAGE_SIZE));
}

function playerProfile(player) {
  const field = (label, name, value, type = 'number') => `<div><label for="profile-${name}">${h(label)}</label><input id="profile-${name}" name="${name}" type="${type}" value="${h(value)}"${type === 'number' ? ' min="0" step="1"' : ''} required></div>`;
  return `<div class="panel-body"><div class="detail-heading"><h2>${h(player.name)}</h2>${statusBadge(player.status)}</div>
    <dl class="metadata"><div><dt>Player id</dt><dd>${h(player.id)}</dd></div><div><dt>Discord id</dt><dd>${h(player.discordId || '—')}</dd></div><div><dt>Wallet imported</dt><dd>${isTrue(player.walletImported) ? 'Yes' : 'No'}</dd></div><div><dt>Created</dt><dd>${h(time(player.created))}</dd></div><div><dt>Last seen</dt><dd>${h(time(player.lastSeen))}</dd></div><div><dt>Active sessions</dt><dd>${h(number(player.sessions?.count))}</dd></div><div><dt>Session last used</dt><dd>${h(time(player.sessions?.lastUsed))}</dd></div></dl>
    <form data-form="player-profile" class="profile-form"><div class="form-grid">
      ${field('Name', 'name', player.name, 'text')}${field('Money', 'money', player.money)}${field('Battle Points', 'battlePoints', player.battlePoints)}${field('Experience', 'experience', player.experience)}
      <div class="full"><label for="profile-notes">Notes</label><textarea id="profile-notes" name="notes" rows="3">${h(player.notes)}</textarea></div>
    </div><div class="form-actions"><button class="primary" type="submit">Save player</button></div></form>
    <div class="status-controls"><p><strong>Status</strong>${player.statusReason ? ` · ${h(player.statusReason)}` : ''}</p><div class="actions">${[['ok', 'OK'], ['flagged', 'Flag'], ['muted', 'Mute'], ['banned', 'Ban']].map(([value, label]) => `<button type="button" data-action="status" data-status="${value}" class="${value === 'banned' ? 'danger ' : ''}${player.status === value ? 'current' : ''}" aria-pressed="${player.status === value}">${label}</button>`).join('')}</div></div>
  </div>`;
}

function ratingTable(player) {
  const rows = PLAYLISTS.map((playlist, index) => {
    const rating = (player.ratings || []).find(row => row.playlist === playlist);
    const form = `rating-${index}`;
    return `<tr><td class="wide">${h(playlistName(playlist))}</td><td><input aria-label="${h(playlistName(playlist))} Rating" form="${form}" name="rating" type="number" min="1" max="50" step="1" value="${h(rating?.rating ?? 1)}" required></td><td><input aria-label="${h(playlistName(playlist))} highest Rating" form="${form}" name="highestRating" type="number" min="1" max="50" step="1" value="${h(rating?.highestRating ?? '')}" placeholder="Automatic"></td><td><form id="${form}" data-form="rating" data-playlist="${playlist}"><button type="submit" class="small">Save</button></form></td></tr>`;
  });
  return table(['Playlist', 'Rating (1–50)', 'Highest Rating', ''], rows);
}

function bagTable(player) {
  const rows = (player.bag || []).map((row, index) => `<tr><td class="wide">${h(row.item)}</td><td><input aria-label="${h(row.item)} count" form="bag-${index}" name="count" type="number" min="0" step="1" value="${h(row.count)}" required></td><td><form id="bag-${index}" data-form="bag" data-item="${h(row.item)}"><button type="submit" class="small">Save</button></form></td></tr>`);
  rows.push('<tr><td><input aria-label="New bag item" form="bag-add" name="item" type="text" placeholder="Item name" required></td><td><input aria-label="New item count" form="bag-add" name="count" type="number" min="1" step="1" value="1" required></td><td><form id="bag-add" data-form="bag-add"><button type="submit" class="small">Add item</button></form></td></tr>');
  return table(['Item', 'Count (0 removes)', ''], rows);
}

function vaultTable(player) {
  const rows = (player.vault || []).map(pokemon => `<tr${isTrue(pokemon.removed) ? ' class="removed"' : ''}>
    <td><span class="pokemon-data">${h(pokemon.species)}</span><span class="subline">#${h(pokemon.id)}${isTrue(pokemon.removed) ? ' · Removed' : ''}</span></td>
    <td class="pokemon-data">${h(pokemon.nickname || '—')}</td><td class="pokemon-data">${h(pokemon.level)}</td><td class="pokemon-data">${isTrue(pokemon.shiny) ? 'Yes ✦' : 'No'}</td><td class="pokemon-data">${h(pokemon.otName || '—')}</td><td class="pokemon-data">${h(pokemon.originGame || '—')}</td>
    <td>${h(pokemon.state)}</td><td>${isTrue(pokemon.legal) ? badge('Legal', 'legal') : '<span class="badge illegal illegal-text">NOT LEGAL</span>'}${pokemon.legalityIssue ? `<span class="subline">${h(pokemon.legalityIssue)}</span>` : ''}</td><td class="pokemon-data">${h(pokemon.hubOrigin || '—')}</td>
    <td><button class="small ${isTrue(pokemon.removed) ? '' : 'danger'}" type="button" data-action="vault" data-id="${h(pokemon.id)}" data-operation="${isTrue(pokemon.removed) ? 'restore' : 'remove'}">${isTrue(pokemon.removed) ? 'Restore' : 'Remove'}</button></td>
  </tr>`);
  return table(['Species', 'Nickname', 'Level', 'Shiny', 'OT', 'Origin game', 'State', 'Legality', 'Hub origin', ''], rows, 'No Pokémon in this Vault.');
}

function ledgerTable(entries) {
  return table(['Time', 'Kind', 'Source', 'Item', 'Count change', 'Money change', 'Money after', 'Request id'], entries.map(entry => `<tr>
    <td>${h(time(entry.at))}</td><td>${h(entry.kind)}</td><td>${h(entry.source || '')}</td><td>${h(entry.item || '—')}</td><td class="numeric">${h(number(entry.count))}</td><td class="numeric">${h(number(entry.moneyChange))}</td><td class="numeric">${h(number(entry.moneyAfter))}</td><td>${h(entry.requestId || '—')}</td>
  </tr>`), 'No ledger entries yet.');
}

function renderPlayer(player) {
  state.player = player;
  $('#page-title').textContent = player.name || 'Player detail';
  document.title = `${player.name || 'Player detail'} · PokeJourneys Admin`;
  const trades = table(['Time', 'From', 'To', 'Summary'], (player.trades || []).map(trade => `<tr><td>${h(time(trade.at))}</td><td>${h(trade.fromPlayer)}</td><td>${h(trade.toPlayer)}</td><td class="wide">${h(trade.summary)}</td></tr>`), 'No recent trades.');
  const battles = table(['Time', 'Playlist', 'Players', 'Winner', 'Rated', 'Summary'], (player.battles || []).map(battle => `<tr><td>${h(time(battle.at))}</td><td>${h(playlistName(battle.playlist))}</td><td>${h(battle.playerA)} / ${h(battle.playerB)}</td><td>${h(battle.winner ?? 'Draw / no winner')}</td><td>${isTrue(battle.rated) ? 'Yes' : 'No'}</td><td class="wide">${h(battle.summary)}</td></tr>`), 'No recent battles.');
  view.innerHTML = `<a href="#players" class="back-link">← Back to players</a><section class="panel">${playerProfile(player)}</section>
    <div class="split">${panel('Playlist ratings', 'Leave highest Rating blank to keep the higher of its old value and the new Rating.', ratingTable(player))}${panel('Bag', 'Set a count to 0 to remove an item.', bagTable(player))}</div>
    ${panel('Vault', 'Removed Pokémon stay visible and can be restored. Legality is the recorded server value.', vaultTable(player))}
    ${panel('Ledger', 'The last 100 money and bag changes.', ledgerTable(player.ledger || []))}
    ${panel('Recent trades', 'Up to the last 50 trades.', trades)}${panel('Recent battles', 'Up to the last 50 battles.', battles)}
    ${panel('Player audit entries', 'Up to the last 50 changes targeting this player.', auditTable(player.audit || []))}`;
}

function toLocalInput(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, -1);
}

function eventForm(event = null) {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'local time';
  return `<form id="event-form" class="panel-body" data-form="event"><div class="form-grid">
    <div><label for="event-kind">Kind</label><select id="event-kind" name="kind"><option value="event"${event?.kind === 'event' ? ' selected' : ''}>Event</option><option value="raid"${event?.kind === 'raid' ? ' selected' : ''}>Raid</option></select></div>
    <div><label for="event-name">Name</label><input id="event-name" name="name" type="text" value="${h(event?.name || '')}" required></div>
    <div><label for="event-species">Species <span class="muted">(optional)</span></label><input id="event-species" name="species" type="text" value="${h(event?.species ?? '')}"></div>
    <div><label class="check" for="event-enabled"><input id="event-enabled" name="enabled" type="checkbox"${checked(event ? event.enabled : true)}>Enabled</label></div>
    <div><label for="event-starts">Starts (${h(timezone)})</label><input id="event-starts" name="starts" type="datetime-local" step="any" value="${h(toLocalInput(event?.starts))}" required></div>
    <div><label for="event-ends">Ends (${h(timezone)})</label><input id="event-ends" name="ends" type="datetime-local" step="any" value="${h(toLocalInput(event?.ends))}" required></div>
    <div class="full"><label for="event-details">Details (JSON)</label><textarea id="event-details" class="json-input" name="details" rows="6" spellcheck="false" required>${h(event?.details == null ? '{}' : jsonText(event.details))}</textarea><span class="hint">Valid JSON, for example {"rewards": [], "cooldownHours": 24, "notes": ""}. Local dates are sent as UTC.</span></div>
    </div><div class="form-actions"><button class="primary" type="submit">${event ? 'Save event' : 'Create event'}</button>${event ? '<button type="button" data-action="cancel-event">Cancel editing</button>' : ''}</div></form>`;
}

function renderEvents(events) {
  state.events = events;
  const editing = events.find(event => String(event.id) === String(state.editingEvent));
  const rows = events.map(event => `<tr><td>${badge(event.kind)}</td><td class="wide">${h(event.name)}</td><td>${h(event.species || '—')}</td><td>${h(time(event.starts))}</td><td>${h(time(event.ends))}</td><td>${isTrue(event.enabled) ? badge('Enabled', 'ok') : badge('Disabled')}</td><td><details><summary>JSON details</summary><pre>${h(jsonText(event.details))}</pre></details></td><td><div class="actions"><button type="button" class="small" data-action="edit-event" data-id="${h(event.id)}">Edit</button><button type="button" class="small danger" data-action="delete-event" data-id="${h(event.id)}">Delete</button></div></td></tr>`);
  view.innerHTML = panel('Event schedule', 'Enabled events run between their start and end times.', table(['Kind', 'Name', 'Species', 'Starts', 'Ends', 'Status', 'Details', ''], rows, 'No events or raids scheduled.')) + panel(editing ? `Edit event: ${editing.name}` : 'Create an event', 'Schedule times in your local time zone.', eventForm(editing));
}

function renderShop(items) {
  state.shop = items;
  const rows = items.map((item, index) => `<tr><td class="wide">${h(item.item)}</td><td><input aria-label="${h(item.item)} price" form="shop-${index}" name="price" type="number" min="0" step="1" value="${h(item.price)}" required></td><td><input aria-label="${h(item.item)} stock, blank for unlimited" form="shop-${index}" name="stock" type="number" min="0" step="1" value="${h(item.stock ?? '')}" placeholder="Unlimited"></td><td><label class="check"><input form="shop-${index}" name="enabled" type="checkbox"${checked(item.enabled)}>Enabled</label></td><td><div class="actions"><form id="shop-${index}" data-form="shop" data-item="${h(item.item)}"><button type="submit" class="small">Save</button></form><button type="button" class="small danger" data-action="delete-shop" data-item="${h(item.item)}">Delete</button></div></td></tr>`);
  rows.push('<tr><td><input aria-label="New shop item" form="shop-add" name="item" type="text" placeholder="Item name" required></td><td><input aria-label="New item price" form="shop-add" name="price" type="number" min="0" step="1" required></td><td><input aria-label="New item stock, blank for unlimited" form="shop-add" name="stock" type="number" min="0" step="1" placeholder="Unlimited"></td><td><label class="check"><input form="shop-add" name="enabled" type="checkbox" checked>Enabled</label></td><td><form id="shop-add" data-form="shop-add"><button type="submit" class="small">Add item</button></form></td></tr>');
  view.innerHTML = panel('Shop inventory', 'Blank stock means unlimited. A stock of 0 means sold out.', table(['Item', 'Price', 'Stock', 'Availability', ''], rows));
}

function renderChat(messages) {
  const notice = `<form class="panel-body chat-notice" data-form="chat-notice"><label for="chat-notice">Server notice</label><textarea id="chat-notice" name="text" rows="3" maxlength="200" required placeholder="Maintenance, downtime or updates"></textarea><span class="hint">Up to 200 characters. Everyone online receives the notice, and it appears in recent global history.</span><div class="form-actions"><button class="primary" type="submit">Post notice</button></div></form>`;
  const filters = `<form class="filters" data-form="chat-filter"><div class="search"><label for="chat-player">Player ID</label><input id="chat-player" name="player" type="number" min="1" step="1" value="${h(state.chat.player)}" placeholder="Blank for all players"></div><button class="primary" type="submit">Filter</button></form>`;
  const player = person => person.id ? `<a href="#players/${segment(person.id)}">${h(person.name)}</a><span class="subline">#${h(person.id)}</span>` : h(person.name);
  const rows = messages.map(row => `<tr${isTrue(row.deleted) ? ' class="removed"' : ''}><td>${h(time(row.at))}</td><td>${player(row.from)}${row.notice ? `<span class="subline">${badge('Server notice')}</span>` : ''}</td><td>${row.to ? player(row.to) : 'Everyone'}</td><td class="chat-text">${h(row.text)}${isTrue(row.deleted) ? '<span class="subline">Deleted</span>' : ''}</td><td><button type="button" class="small danger" data-action="delete-chat" data-id="${h(row.id)}"${isTrue(row.deleted) ? ' disabled' : ''}>Delete</button></td></tr>`);
  view.innerHTML = panel('Post a server notice', 'Share an update with everyone online.', notice) + panel('Recent messages', 'The newest 100 global and private messages. Deleted messages remain visible here for review.', filters + table(['Time', 'From', 'To', 'Text', ''], rows, 'No chat messages found.'));
}

function renderReports(reports) {
  const filters = `<form class="filters" data-form="reports-filter"><div class="search"><label for="reports-state">Show</label><select id="reports-state" name="state">${['open', 'closed', 'all'].map(s => `<option value="${s}"${state.reports.state === s ? ' selected' : ''}>${s === 'open' ? 'Open reports' : s === 'closed' ? 'Closed reports' : 'All reports'}</option>`).join('')}</select></div><button class="primary" type="submit">Show</button></form>`;
  const player = person => `<a href="#players/${segment(person.id)}">${h(person.name)}</a><span class="subline">#${h(person.id)}</span>`;
  const said = row => row.chat.length ? `<details><summary>${h(number(row.chat.length))} recent messages</summary>${row.chat.map(m => `<div class="subline">${h(time(m.at))} · ${h(m.channel)}: ${h(m.text)}</div>`).join('')}</details>` : '<span class="subline">No recent messages</span>';
  const rows = reports.map(row => `<tr><td>${h(time(row.at))}</td><td>${player(row.reported)}<span class="subline">${statusBadge(row.reported.status)} ${h(number(row.reported.openReports))} open</span></td><td>${player(row.reporter)}</td><td class="chat-text">${h(row.reason)}${row.resolution ? `<span class="subline">Closed: ${h(row.resolution)}</span>` : ''}</td><td>${said(row)}</td><td>${row.state === 'open' ? `<button type="button" class="small" data-action="close-report" data-id="${h(row.id)}" data-name="${h(row.reported.name)}">Close</button>` : badge('Closed')}</td></tr>`);
  view.innerHTML = panel('Reports', 'Open a player to mute or ban them, then close the report.', filters + table(['Time', 'Reported', 'By', 'Reason', 'What they said', ''], rows, 'No reports.'));
}

function renderCrashes(crashes) {
  const rows = crashes.map(row => `<tr><td>${h(time(row.at))}</td><td>${row.playerId ? `<a href="#players/${segment(row.playerId)}">${h(row.playerName)}</a>` : '-'}</td><td>${h(row.version)}<span class="subline">${h(row.device)} · Android ${h(row.android)}</span></td><td><details><summary>${h(String(row.trace).split('\n')[0].slice(0, 120))}</summary><pre class="crash-trace">${h(row.trace)}</pre></details></td><td><button type="button" class="small danger" data-action="delete-crash" data-id="${h(row.id)}">Delete</button></td></tr>`);
  view.innerHTML = panel('Crash logs', 'The newest 200. The first line is the error; open it for the whole log.', table(['Time', 'Player', 'Version and device', 'Error', ''], rows, 'No crashes reported.'));
}

function renderReleases(releases) {
  const upload = `<form class="panel-body release-upload" data-form="release-upload" enctype="multipart/form-data"><div class="form-grid">
    <div class="full"><label for="release-apk">APK file</label><input id="release-apk" name="apk" type="file" accept=".apk,application/vnd.android.package-archive,application/zip" required><span class="hint">Under 200 MB. Uploads start unpublished.</span></div>
    <div><label for="release-version">Version</label><input id="release-version" name="version" type="text" maxlength="64" placeholder="1.6.0" required></div>
    <div><label for="release-code">Version code</label><input id="release-code" name="versionCode" type="number" min="1" max="2147483647" step="1" required><span class="hint">Must be higher than every earlier upload.</span></div>
    <div class="full"><label for="release-notes">Release notes</label><textarea id="release-notes" name="notes" rows="5" maxlength="65536"></textarea></div>
    </div><div class="form-actions"><button type="submit" class="primary">Upload APK</button></div></form>`;
  const rows = releases.map(row => `<tr><td>${h(row.version)}</td><td>${h(number(row.versionCode))}</td><td>${h(number(row.size))} bytes</td><td>${h(time(row.created))}</td><td>${isTrue(row.published) ? badge('Published', 'ok') : badge('Unpublished')}</td><td><button type="button" class="small" data-action="publish-release" data-id="${h(row.id)}" data-version="${h(row.version)}" data-published="${!isTrue(row.published)}">${isTrue(row.published) ? 'Unpublish' : 'Publish'}</button></td></tr>`);
  view.innerHTML = panel('Upload a release', 'Use the signed PokeJourneys APK with the version and version code from its build.', upload) +
    panel('All releases', 'The published release with the highest version code is offered to players. Unpublish it to offer the previous published version.', table(['Version', 'Code', 'Size', 'Date', 'State', ''], rows, 'No releases uploaded yet.'));
}

function renderAudit(data) {
  const { target, offset } = state.audit;
  const filters = `<form class="filters" data-form="audit-filter"><div class="search"><label for="audit-target">Target</label><input id="audit-target" name="target" type="search" value="${h(target)}" placeholder="Target from an audit entry, or blank for all"></div><button class="primary" type="submit">Filter</button></form>`;
  view.innerHTML = panel('Change history', 'Expand a change to compare its before and after values. Highlighted fields changed.', filters + auditTable(data.entries || []) + pager('audit', data.total, offset, AUDIT_PAGE_SIZE));
}

function botsLive(data) {
  const rows = (data.stats || []).map(row => `<tr><td class="wide">${h(row.endpoint)}</td><td>${h(number(row.calls))}</td><td>${h(number(row.ok))}</td><td>${h(number(row.refused))}</td><td>${h(row.avgMs)}</td><td>${h(row.p95Ms)}</td></tr>`);
  const missing = (data.missing || []).length ? `<p class="muted">Not on this server yet: ${h(data.missing.join(', '))}</p>` : '';
  return `<p><strong>Running</strong> ${h(number(data.running))} of ${h(number(data.enabled ? data.count : 0))}</p>${missing}
    ${table(['Endpoint', 'Calls', 'OK', 'Refused', 'Avg ms', 'p95 ms'], rows, 'No bot calls yet.')}
    <h3>Recent bot activity</h3><pre class="bot-log">${h((data.log || []).join('\n') || 'Nothing yet.')}</pre>`;
}

function renderBots(data) {
  if (!data.available) {
    view.innerHTML = panel('Bot players', 'Only on a test server.', '<div class="panel-body"><p>Start the server with <code>--dev-signin</code> to use bot players. They sign in as "Bot 01", "Bot 02" and so on.</p></div>');
    return;
  }
  const controls = `<form class="filters" data-form="bots"><div><label class="check"><input name="enabled" type="checkbox"${checked(data.enabled)}>Bots on</label></div>
    <div><label for="bot-count">How many</label><input id="bot-count" name="count" type="number" min="0" max="${h(data.max)}" step="1" value="${h(data.count)}" required></div>
    <button type="button" data-action="bots-step" data-step="-1">−1</button><button type="button" data-action="bots-step" data-step="1">+1</button>
    <button type="submit" class="primary">Apply</button></form>`;
  state.botData = data;
  const editing = state.botSlot && (data.bots || []).find(bot => bot.slot === state.botSlot);
  view.innerHTML = panel('Bot controls', `Up to ${data.max} bots. Each bot walks the hub, shops, reports journey money, and asks other bots to trade and battle. The switch and count are kept when the server restarts.`, controls)
    + panel('Bots', 'Edit a bot to change its name, personality, look, follower and trainer card. Money and items are on its player page. A running bot restarts with its changes.', botList(data) + (editing ? botForm(data, editing) : ''))
    + panel('What bots say', 'One line per row. Replies go to players who message a bot; global lines are said in global chat now and then.', botChatForm(data))
    + panel('Activity', 'Refreshes every 3 seconds.', `<div id="bots-live" class="panel-body">${botsLive(data)}</div>`);
}

const PERSONALITY_NAMES = { shopper: 'Shopper', traveller: 'Traveller', idler: 'Idler (AFK anywhere)', wanderer: 'Wanderer', 'spawn-idler': 'Hangs out at the spawn', 'dock-idler': 'Hangs out at the docks', 'show-off': 'Show-off (boardwalk line)' };

function botList(data) {
  const rows = (data.bots || []).map(bot => {
    const card = bot.setup.journeys.map(j => `${(data.journeys.find(known => known.id === j.id) || {}).name || j.id}: ${j.badges} badges${j.champion ? ', Champion' : ''}`).join(' · ');
    return `<tr><td>${h(bot.slot)}</td><td class="wide">${bot.playerId ? `<a href="#players/${segment(bot.playerId)}">${h(bot.setup.name)}</a>` : h(bot.setup.name)}${bot.custom ? `<span class="subline">${badge('Edited')}</span>` : ''}</td><td>${h(PERSONALITY_NAMES[bot.setup.personality] || bot.setup.personality)}</td><td>#${h(bot.setup.species)}${bot.setup.shiny ? ' (shiny)' : ''}</td><td>${h(card)}</td><td>${bot.playerId ? badge('Running', 'ok') : badge('Off')}</td>
      <td><div class="actions"><button type="button" class="small" data-action="edit-bot" data-slot="${h(bot.slot)}">Edit</button>${bot.custom ? `<button type="button" class="small" data-action="reset-bot" data-slot="${h(bot.slot)}">Reset</button>` : ''}</div></td></tr>`;
  });
  return table(['#', 'Name', 'Personality', 'Follower', 'Trainer card', 'State', ''], rows, 'No bots yet.');
}

function botForm(data, bot) {
  const s = bot.setup;
  const journeyRows = data.journeys.map(known => {
    const j = s.journeys.find(entry => entry.id === known.id);
    return `<tr><td><label class="check"><input type="checkbox" name="on-${known.id}"${checked(!!j)}>${h(known.name)}</label></td>
      <td><input type="radio" name="current" value="${known.id}" aria-label="${h(known.name)} is the current journey"${s.journeys[0]?.id === known.id ? ' checked' : ''}></td>
      <td><input name="badges-${known.id}" type="number" min="0" max="${known.badges}" value="${h(j?.badges ?? 0)}" aria-label="${h(known.name)} badges"></td>
      <td><input name="pokedex-${known.id}" type="number" min="0" max="1025" value="${h(j?.pokedex ?? 0)}" aria-label="${h(known.name)} Pokédex"></td>
      <td><input name="hours-${known.id}" type="number" min="0" max="9999" value="${h(j?.hours ?? 0)}" aria-label="${h(known.name)} hours"></td>
      <td><label class="check"><input type="checkbox" name="champion-${known.id}"${checked(!!j?.champion)}>Champion</label></td></tr>`;
  });
  return `<form class="panel-body" data-form="bot" data-slot="${h(bot.slot)}"><h3>Edit bot ${h(bot.slot)}</h3><div class="form-grid">
    <div><label for="bot-name">Name</label><input id="bot-name" name="name" type="text" maxlength="20" value="${h(s.name)}" required></div>
    <div><label for="bot-personality">Personality</label><select id="bot-personality" name="personality">${data.personalities.map(p => `<option value="${p}"${s.personality === p ? ' selected' : ''}>${h(PERSONALITY_NAMES[p] || p)}</option>`).join('')}</select></div>
    <div><label for="bot-gender">Look</label><select id="bot-gender" name="gender"><option value="m"${s.gender === 'm' ? ' selected' : ''}>Boy</option><option value="f"${s.gender === 'f' ? ' selected' : ''}>Girl</option></select></div>
    <div><label for="bot-species">Follower (National Pokédex number)</label><input id="bot-species" name="species" type="number" min="1" max="898" value="${h(s.species)}" required></div>
    <div><label class="check"><input name="shiny" type="checkbox"${checked(s.shiny)}>Shiny follower</label></div>
    <div><label class="check"><input name="chat" type="checkbox"${checked(s.chat)}>Talks in global chat</label></div>
    <div class="full"><label>Trainer card</label>${table(['Journey', 'Current', 'Badges', 'Pokédex', 'Hours', ''], journeyRows)}</div>
    </div><div class="form-actions"><button class="primary" type="submit">Save bot</button><button type="button" data-action="cancel-bot">Cancel</button></div></form>`;
}

function botChatForm(data) {
  return `<form class="panel-body" data-form="bot-chat"><div class="form-grid">
    <div><label for="bot-replies">Replies</label><textarea id="bot-replies" name="replies" rows="7">${h((data.chat?.replies || []).join('\n'))}</textarea></div>
    <div><label for="bot-global">Global chat lines</label><textarea id="bot-global" name="global" rows="7">${h((data.chat?.global || []).join('\n'))}</textarea></div>
    </div><div class="form-actions"><button class="primary" type="submit">Save lines</button></div></form>`;
}

async function botChange(method, path, body, done) {
  clearMessages();
  try {
    const data = await api(path, { method, body });
    renderBots(data);
    message(done);
  } catch (error) { message(error.message, true); }
}

async function setBots(enabled, count) {
  clearMessages();
  try {
    const data = await api('/bots', { method: 'PUT', body: { enabled, count } });
    renderBots(data);
    message(enabled ? `Bots on: ${count}.` : 'Bots off.');
  } catch (error) { message(error.message, true); }
}

// The bot page refreshes its numbers and log every 3 seconds; the controls stay as typed.
setInterval(async () => {
  const live = $('#bots-live');
  if (state.route.page !== 'bots' || !live || state.loading || document.hidden) return;
  try { live.innerHTML = botsLive(await api('/bots')); } catch { /* The next refresh tries again. */ }
}, 3000);

function readRoute() {
  const [requested, encodedId] = location.hash.slice(1).split('/');
  const page = Object.hasOwn(PAGES, requested) ? requested : 'overview';
  let id = null;
  if (page === 'players' && encodedId) {
    try { id = decodeURIComponent(encodedId); } catch { /* Show the player list for an invalid link. */ }
  }
  return { page, id };
}

async function loadView() {
  const version = ++requestVersion;
  const route = readRoute();
  state.route = route;
  state.loading = true;
  state.player = null;
  view.setAttribute('aria-busy', 'true');
  $('#refresh').disabled = true;
  $('#page-title').textContent = route.id ? 'Player detail' : PAGES[route.page][0];
  $('#page-description').textContent = PAGES[route.page][1];
  document.title = `${PAGES[route.page][0]} · PokeJourneys Admin`;
  document.querySelectorAll('[data-nav]').forEach(link => {
    if (link.dataset.nav === route.page) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  view.innerHTML = '<p class="loading" role="status">Loading…</p>';
  try {
    let data;
    switch (route.page) {
      case 'overview': data = await api('/overview'); data.live = await api('/live'); data.announcements = (await api('/announcements')).lines || []; break;
      case 'players':
        data = route.id ? await api(`/players/${segment(route.id)}`) : await api(`/players?${new URLSearchParams({ ...state.players, limit: PAGE_SIZE })}`);
        break;
      case 'events': data = await api('/events'); break;
      case 'shop': data = await api('/shop'); break;
      case 'chat': data = await api(`/chat?${new URLSearchParams({ ...state.chat, limit: 100 })}`); break;
      case 'releases': data = await api('/releases'); break;
      case 'reports': data = await api(`/reports?${new URLSearchParams(state.reports)}`); break;
      case 'crashes': data = await api('/crashes'); break;
      case 'audit': data = await api(`/audit?${new URLSearchParams({ ...state.audit, limit: AUDIT_PAGE_SIZE })}`); break;
      case 'bots': data = await api('/bots'); break;
    }
    if (version !== requestVersion) return;
    // A deletion or rollback can shrink the last page; return to the last valid page.
    const pagination = route.page === 'players' && !route.id ? state.players : route.page === 'audit' ? state.audit : null;
    if (pagination && pagination.offset > 0 && pagination.offset >= data.total) {
      const size = route.page === 'audit' ? AUDIT_PAGE_SIZE : PAGE_SIZE;
      pagination.offset = Math.max(0, Math.ceil(data.total / size) - 1) * size;
      await loadView();
      return;
    }
    switch (route.page) {
      case 'overview': renderOverview(data); break;
      case 'players': if (route.id) renderPlayer(data); else renderPlayers(data); break;
      case 'events': renderEvents(Array.isArray(data) ? data : data.events || []); break;
      case 'shop': renderShop(Array.isArray(data) ? data : data.items || data.shop || []); break;
      case 'chat': renderChat(data); break;
      case 'releases': renderReleases(data); break;
      case 'reports': renderReports(data); break;
      case 'crashes': renderCrashes(data); break;
      case 'audit': renderAudit(data); break;
      case 'bots': renderBots(data); break;
    }
  } catch (error) {
    if (version !== requestVersion) return;
    message(error.message, true);
    view.innerHTML = '<div class="panel panel-body"><p>Unable to load this view.</p><button type="button" data-action="retry">Try again</button></div>';
  } finally {
    if (version === requestVersion) {
      state.loading = false;
      view.setAttribute('aria-busy', 'false');
      $('#refresh').disabled = state.changing;
    }
  }
}

function integer(data, name, min = 0, max = Number.MAX_SAFE_INTEGER, optional = false) {
  const raw = String(data.get(name) ?? '').trim();
  if (!raw && optional) return null;
  const value = Number(raw);
  if (!raw || !Number.isSafeInteger(value) || value < min || value > max) throw new Error(`${name} must be a whole number from ${min} to ${max}.`);
  return value;
}

function requiredText(data, name) {
  const value = String(data.get(name) ?? '').trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

view.addEventListener('submit', async event => {
  const form = event.target.closest('form[data-form]');
  if (!form) return;
  event.preventDefault();
  if (state.changing || !form.reportValidity()) return;
  const data = new FormData(form);
  const playerPath = state.route.id ? `/players/${segment(state.route.id)}` : '';
  try {
    switch (form.dataset.form) {
      case 'release-upload': {
        const version = requiredText(data, 'version');
        integer(data, 'versionCode', 1, 2147483647);
        const apk = data.get('apk');
        if (!(apk instanceof File) || apk.size < 2 || apk.size >= 200 * 1024 * 1024) throw new Error('Choose an APK under 200 MB.');
        await change('POST', '/releases', data, `Upload PokeJourneys ${version} as an unpublished release.`);
        break;
      }
      case 'announcements': {
        const lines = String(data.get('lines') || '').split('\n').map(line => line.trim()).filter(Boolean);
        if (lines.length > 5 || lines.some(line => line.length > 200)) throw new Error('Up to 5 lines of up to 200 characters.');
        await change('PUT', '/announcements', { lines }, lines.length ? `Show ${lines.length} announcement line(s) to players.` : 'Clear the announcements.');
        break;
      }
      case 'bots':
        await setBots(data.has('enabled'), integer(data, 'count', 0, 100));
        break;
      case 'bot': {
        const known = state.botData.journeys;
        const current = data.get('current');
        const journeys = known.filter(j => data.has(`on-${j.id}`)).map(j => ({
          id: j.id, badges: integer(data, `badges-${j.id}`, 0, j.badges), pokedex: integer(data, `pokedex-${j.id}`, 0, 1025),
          hours: integer(data, `hours-${j.id}`, 0, 9999), champion: data.has(`champion-${j.id}`)
        })).sort((a, b) => (b.id === current) - (a.id === current));
        if (!journeys.length) throw new Error('Tick at least one journey for the trainer card.');
        const slot = Number(form.dataset.slot);
        state.botSlot = null;
        await botChange('PUT', `/bots/${slot}`, {
          name: requiredText(data, 'name'), personality: data.get('personality'), gender: data.get('gender'),
          species: integer(data, 'species', 1, 898), shiny: data.has('shiny'), chat: data.has('chat'), journeys
        }, `Bot ${slot} saved.`);
        break;
      }
      case 'bot-chat': {
        const lines = name => String(data.get(name) || '').split('\n').map(line => line.trim()).filter(Boolean);
        await botChange('PUT', '/bots/chat', { replies: lines('replies'), global: lines('global') }, 'Bot lines saved.');
        break;
      }
      case 'chat-notice': {
        const text = requiredText(data, 'text');
        if (text.length > 200 || /[\u0000-\u001f\u007f-\u009f]/.test(text)) throw new Error('Use 1 to 200 characters without control characters.');
        await change('POST', '/chat/notice', { text }, `Post this server notice to everyone online: ${text}`);
        break;
      }
      case 'chat-filter': {
        const player = integer(data, 'player', 1, Number.MAX_SAFE_INTEGER, true);
        state.chat.player = player === null ? '' : String(player);
        clearMessages(); await loadView(); break;
      }
      case 'reports-filter':
        state.reports = { state: String(data.get('state') || 'open') };
        clearMessages(); await loadView(); break;
      case 'players-filter':
        state.players = { q: String(data.get('q') || '').trim(), status: String(data.get('status') || ''), offset: 0 };
        clearMessages(); await loadView(); break;
      case 'audit-filter':
        state.audit = { target: String(data.get('target') || '').trim(), offset: 0 };
        clearMessages(); await loadView(); break;
      case 'player-profile': {
        const body = { name: requiredText(data, 'name'), money: integer(data, 'money'), battlePoints: integer(data, 'battlePoints'), experience: integer(data, 'experience'), notes: String(data.get('notes') || '') };
        await change('PATCH', playerPath, body, `Update the profile and balances for ${state.player.name}.`);
        break;
      }
      case 'rating': {
        const rating = integer(data, 'rating', 1, 50);
        const highestRating = integer(data, 'highestRating', 1, 50, true);
        if (highestRating !== null && highestRating < rating) throw new Error('Highest Rating must be at least the current Rating, or left blank for automatic.');
        await change('PUT', `${playerPath}/ratings/${segment(form.dataset.playlist)}`, { rating, ...(highestRating === null ? {} : { highestRating }) }, `Update ${playlistName(form.dataset.playlist)} Rating for ${state.player.name}.`);
        break;
      }
      case 'bag':
      case 'bag-add': {
        const item = form.dataset.form === 'bag-add' ? requiredText(data, 'item') : form.dataset.item;
        if (form.dataset.form === 'bag-add' && (state.player.bag || []).some(row => row.item === item)) throw new Error('This item is already in the bag. Edit its existing count.');
        const count = integer(data, 'count', form.dataset.form === 'bag-add' ? 1 : 0);
        await change('PUT', `${playerPath}/bag/${segment(item)}`, { count }, `Set ${item} count to ${count} for ${state.player.name}${count === 0 ? ' (remove item)' : ''}.`);
        break;
      }
      case 'event': {
        const details = requiredText(data, 'details');
        try { JSON.parse(details); } catch (error) { throw new Error(`Details must be valid JSON: ${error.message}`); }
        const starts = new Date(requiredText(data, 'starts'));
        const ends = new Date(requiredText(data, 'ends'));
        if (Number.isNaN(starts.getTime()) || Number.isNaN(ends.getTime())) throw new Error('Enter valid start and end dates.');
        if (ends <= starts) throw new Error('The end must be later than the start.');
        const body = { kind: data.get('kind'), name: requiredText(data, 'name'), species: String(data.get('species') || '').trim() || null, starts: starts.toISOString(), ends: ends.toISOString(), enabled: data.has('enabled'), details };
        const editing = state.events.find(row => String(row.id) === String(state.editingEvent));
        await change(editing ? 'PUT' : 'POST', editing ? `/events/${segment(editing.id)}` : '/events', body, `${editing ? 'Update' : 'Create'} ${body.kind}: ${body.name}.`);
        break;
      }
      case 'shop':
      case 'shop-add': {
        const item = form.dataset.form === 'shop-add' ? requiredText(data, 'item') : form.dataset.item;
        if (form.dataset.form === 'shop-add' && state.shop.some(row => row.item === item)) throw new Error('This item is already in the shop. Edit its existing row.');
        const body = { price: integer(data, 'price'), stock: integer(data, 'stock', 0, Number.MAX_SAFE_INTEGER, true), enabled: data.has('enabled') };
        await change('PUT', `/shop/${segment(item)}`, body, `Save shop item: ${item}.`);
        break;
      }
    }
  } catch (error) { message(error.message, true); }
});

view.addEventListener('click', async event => {
  const button = event.target.closest('button[data-action]');
  if (!button) {
    const row = event.target.closest('[data-player]');
    if (row && !event.target.closest('a, button, input, select, textarea')) location.hash = `players/${segment(row.dataset.player)}`;
    return;
  }
  if (state.changing || button.disabled) return;
  const playerPath = state.route.id ? `/players/${segment(state.route.id)}` : '';
  switch (button.dataset.action) {
    case 'publish-release': {
      const published = button.dataset.published === 'true';
      await change('PUT', `/releases/${segment(button.dataset.id)}`, { published }, `${published ? 'Publish' : 'Unpublish'} PokeJourneys ${button.dataset.version}. This changes which releases players can download.`);
      break;
    }
    case 'backup':
      state.changing = true;
      button.disabled = true;
      clearMessages();
      try {
        await api('/backup', { method: 'POST' });
        message('Backup created.');
        await loadView();
      } catch (error) { message(error.message, true); }
      finally { state.changing = false; button.disabled = false; $('#refresh').disabled = state.loading; }
      break;
    case 'retry': clearMessages(); await loadView(); break;
    case 'edit-bot':
      state.botSlot = Number(button.dataset.slot);
      renderBots(state.botData);
      document.querySelector('form[data-form="bot"]')?.scrollIntoView({ block: 'start' });
      break;
    case 'cancel-bot': state.botSlot = null; renderBots(state.botData); break;
    case 'reset-bot':
      if (confirm(`Put bot ${button.dataset.slot} back to its defaults?`)) await botChange('DELETE', `/bots/${button.dataset.slot}`, undefined, `Bot ${button.dataset.slot} reset.`);
      break;
    case 'bots-step': {
      const input = $('#bot-count');
      const count = Math.min(Number(input.max), Math.max(0, Number(input.value || 0) + Number(button.dataset.step)));
      await setBots(true, count);
      break;
    }
    case 'page':
      state[button.dataset.kind].offset = Number(button.dataset.offset);
      clearMessages(); await loadView(); break;
    case 'status':
      await change('POST', `${playerPath}/status`, { status: button.dataset.status }, `Set ${state.player.name}'s status to ${STATUS_NAMES[button.dataset.status]}.`);
      break;
    case 'vault':
      await change('POST', `${playerPath}/vault/${segment(button.dataset.id)}/${button.dataset.operation}`, {}, `${button.dataset.operation === 'restore' ? 'Restore' : 'Remove'} Vault Pokémon #${button.dataset.id} for ${state.player.name}.`);
      break;
    case 'rollback':
      await change('POST', `/audit/${segment(button.dataset.id)}/rollback`, {}, `Roll back audit entry #${button.dataset.id}. This restores its before state and can overwrite later changes.`);
      break;
    case 'edit-event':
      state.editingEvent = button.dataset.id;
      renderEvents(state.events);
      $('#event-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
      $('#event-name').focus({ preventScroll: true });
      break;
    case 'cancel-event': state.editingEvent = null; renderEvents(state.events); break;
    case 'delete-event': {
      const target = state.events.find(row => String(row.id) === button.dataset.id);
      await change('DELETE', `/events/${segment(button.dataset.id)}`, null, `Delete event: ${target?.name || button.dataset.id}.`);
      break;
    }
    case 'delete-shop':
      await change('DELETE', `/shop/${segment(button.dataset.item)}`, null, `Delete shop item: ${button.dataset.item}.`);
      break;
    case 'close-report': {
      const resolution = (prompt(`How was the report about ${button.dataset.name} handled? (optional)`) || '').trim();
      await change('POST', `/reports/${segment(button.dataset.id)}/close`, { resolution }, `Close the report about ${button.dataset.name}.`);
      break;
    }
    case 'delete-crash':
      await change('DELETE', `/crashes/${segment(button.dataset.id)}`, null, `Delete crash log #${button.dataset.id}.`);
      break;
    case 'delete-chat':
      await change('DELETE', `/chat/${segment(button.dataset.id)}`, null, `Delete chat message #${button.dataset.id}. It will be removed from connected players' chat and future history.`);
      break;
  }
});

window.addEventListener('hashchange', () => {
  clearMessages();
  if (!state.changing) loadView();
});
$('#refresh').addEventListener('click', () => { if (!state.changing) { clearMessages(); loadView(); } });
$('#change-key').addEventListener('click', async () => {
  if (state.changing) return;
  clearMessages();
  rememberKey('');
  await askForKey();
  await loadView();
});

loadView();
