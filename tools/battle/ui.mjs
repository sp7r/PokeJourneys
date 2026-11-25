let dispatch = () => {};
let search = '';

const node = (tag, text, className = '') => {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
};
const button = (text, action, disabled = false, className = '') => {
  const element = node('button', text, className);
  element.disabled = disabled;
  element.addEventListener('click', action);
  return element;
};
const send = (type, data = {}) => dispatch({type, ...data});

function sprite(mon, back = false) {
  const wrap = node('div', undefined, 'sprite');
  const image = node('img');
  image.alt = mon.species || mon.name;
  const name = mon.sprite || String(mon.species || mon.name).replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  image.src = `/sprite/${mon.number || mon.species}?back=${back ? 1 : 0}&shiny=${mon.shiny ? 1 : 0}&name=${encodeURIComponent(name)}`;
  image.addEventListener('error', () => { image.hidden = true; wrap.append(node('span', `#${mon.number || mon.species}`, 'no-art')); });
  wrap.append(image);
  return wrap;
}

function scene(state) {
  const container = node('div', undefined, 'scene-shell');
  const title = node('header');
  title.append(node('h1', 'BATTLE DOME'), node('span', 'Practice against a trainer'));
  container.append(title);
  const field = node('div', undefined, 'field');
  const welcome = node('div', undefined, 'welcome');
  welcome.append(node('h2', 'Welcome to the BATTLE DOME!'), node('p', 'Try a random team, or bring your own Pokémon from the Vault.'),
    node('p', 'Choose your rules on the lower screen.'), node('p', 'Win: +1 Experience · Rating stays unchanged'));
  field.append(welcome);
  container.append(field);
  return container;
}

function setup(state) {
  const pane = node('section', undefined, 'controls setup');
  const bar = node('div', undefined, 'toolbar');
  bar.append(node('h2', 'BATTLE DOME'), button('Return to hub', () => send('quit')));
  pane.append(bar);
  const sources = node('div', undefined, 'team-sources');
  for (const [source, label] of [['random', 'RANDOM TEAM'], ['vault', 'VAULT TEAM']]) sources.append(button(label,
    () => send('source', {source}), false, state.teamSource === source ? 'chosen' : ''));
  pane.append(sources, node('h3', 'BATTLE RULES', 'section-label'));
  const formats = node('div', undefined, 'formats');
  for (const format of state.formats) formats.append(button(format.name.replace(/^\[Gen \d\] /, ''), () => send('format', {id: format.id}), false,
    format.id === state.format.id ? 'chosen' : ''));
  pane.append(formats, node('p', `${state.format.name} · ${state.format.random ? 'Showdown’s balanced levels' : `Level ${state.format.level}`}`, 'subtitle'));
  if (state.format.generation === 6) pane.append(node('p', 'Triple Battles use Gen 6 Battle Spot rules; Gen 7 removed this battle type.', 'note'));
  const details = node('details');
  details.append(node('summary', 'Format rules and bans'), node('p', state.format.rules.join(' · ')),
    node('p', state.format.bans.length ? `Banned: ${state.format.bans.join(', ')}` : 'Standard format restrictions apply.'));
  pane.append(details);
  if (state.teamSource === 'random') {
    const info = node('section', undefined, 'rental-info');
    info.append(node('h2', 'A new team. A new challenge!'), node('p', 'You and your opponent each receive six random Pokémon, complete with moves, abilities, and held items.'),
      node('p', state.format.random ? 'Showdown’s Random Battle rules balance each Pokémon’s level. The opposing team stays hidden until it battles.' : 'Both teams follow the selected tier’s rules and use its standard battle level.'),
      node('p', 'No Vault Pokémon required.'));
    pane.append(info);
    if (state.error) pane.append(node('p', state.error, 'error'));
    pane.append(button(state.busy ? 'Preparing your teams…' : 'START RANDOM BATTLE', () => send('start'), state.busy, 'primary'));
    return pane;
  }
  if (state.rosterError) pane.append(node('p', state.rosterError, 'error'));
  const filter = node('input');
  filter.type = 'search'; filter.placeholder = 'Search your Vault'; filter.value = search;
  filter.addEventListener('input', () => {
    search = filter.value;
    for (const card of pane.querySelectorAll('[data-pokemon]')) card.hidden = !card.dataset.pokemon.includes(search.toLowerCase());
  });
  pane.append(filter);
  const roster = node('div', undefined, 'roster');
  for (const mon of state.roster) {
    const chosen = state.selected.includes(mon.id);
    const card = button('', () => send('select', {id: mon.id}), !!mon.problem || (!chosen && state.selected.length >= 6), `roster-card${chosen ? ' chosen' : ''}`);
    card.dataset.focusId = `mon-${mon.id}`;
    card.dataset.pokemon = `${mon.name} ${mon.speciesName || ''} ${mon.species}`.toLowerCase();
    card.hidden = !card.dataset.pokemon.includes(search.toLowerCase());
    card.append(sprite(mon), node('strong', mon.name), node('small', mon.speciesName || ''), node('small', mon.problem || `Saved Lv.${mon.level} → Battle Lv.${state.format.level}`));
    if (chosen) card.append(node('span', String(state.selected.indexOf(mon.id) + 1), 'order'));
    roster.append(card);
  }
  if (!state.roster.length) roster.append(node('p', 'Your Vault is empty. Store Pokémon with the PokeVault clerk to bring them here.'));
  pane.append(roster);
  if (state.error) pane.append(node('p', state.error, 'error'));
  pane.append(button(state.busy ? 'Preparing opponent…' : `START BATTLE · ${state.selected.length}/6 selected`, () => send('start'), state.busy || !state.selected.length, 'primary'));
  return pane;
}

export function render(state, action, display = 'all') {
  dispatch = action;
  const app = document.getElementById('app');
  const focused = document.activeElement?.textContent;
  const focusId = document.activeElement?.dataset.focusId;
  app.replaceChildren();
  app.className = display === 'controls' ? 'control-screen' : display;
  if (state.pvp) {
    app.append(node('h1', 'PLAYER BATTLE'), node('p', state.error || 'Preparing your battle...'),
      button('Return to hub', () => send('quit')));
    return;
  }
  if (display !== 'controls') app.append(scene(state));
  if (display !== 'scene') app.append(setup(state));
  const focusRoot = app.querySelector('.modal') || app;
  const candidates = [...focusRoot.querySelectorAll('button')].filter(button => !button.disabled && button.offsetParent !== null);
  (candidates.find(button => focusId ? button.dataset.focusId === focusId : button.textContent === focused) ||
    focusRoot.querySelector('.formats .chosen,.moves button') || candidates[0])?.focus({preventScroll: true});
}

export function key(key) {
  if (key === 'back') { send('quit'); return; }
  const root = document.querySelector('.modal') || document.getElementById('app');
  const buttons = [...root.querySelectorAll('button,input,summary')].filter(button => !button.disabled && button.offsetParent !== null);
  if (key === 'accept') { document.activeElement?.click(); return; }
  if (!buttons.length) return;
  const origin = document.activeElement;
  const at = Math.max(0, buttons.indexOf(origin));
  const a = (origin || buttons[0]).getBoundingClientRect();
  const x = a.x + a.width / 2, y = a.y + a.height / 2;
  const direction = {left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1]}[key];
  if (!direction) return;
  let best, score = Infinity;
  for (const button of buttons) {
    if (button === origin) continue;
    const b = button.getBoundingClientRect();
    const dx = b.x + b.width / 2 - x, dy = b.y + b.height / 2 - y;
    const forward = dx * direction[0] + dy * direction[1];
    const sideways = Math.abs(dx * direction[1] + dy * direction[0]);
    const distance = forward + sideways * 3;
    if (forward > 4 && distance < score) { best = button; score = distance; }
  }
  (best || buttons[(at + (key === 'up' || key === 'left' ? -1 : 1) + buttons.length) % buttons.length]).focus();
  document.activeElement?.scrollIntoView({block: 'nearest'});
}

document.addEventListener('keydown', event => {
  const mapped = {ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', Enter: 'accept', Escape: 'back'}[event.key];
  if (mapped && event.target.tagName !== 'INPUT') { event.preventDefault(); window.DomeKey(mapped); }
});
