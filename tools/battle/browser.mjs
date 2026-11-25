import {DomeBattle, PvpBattle, randomBattle, formatsFor, importSet, validateTeam} from './engine.mjs';
import {PvpSession, localLines} from './pvp.mjs';
import {Dex} from '@pkmn/sim';
import {render, key as setupKey} from './ui.mjs';
import {Tracker} from './tracker.mjs';
import {BattleText} from './text.mjs';
import {Clock} from './anim.mjs';
import {Playback} from './playback.mjs';
import {Commands} from './menu.mjs';
import {Scene} from './scene.mjs';
import {Effects} from './effects.mjs';
import {Screen} from './screen.mjs';
import {loadArt} from './gfx.mjs';

let config;
let battle;
let state;
let game;
let pvp;
const pendingEvents = [];
const native = window.DomeNative || {ready() {}, frame() {}, close() {}};

function spriteName(number) {
  const special = {29: 'NIDORANfE', 32: 'NIDORANmA', 669: 'FLABEBE'};
  return special[number] || Dex.species.all().find(species => species.num === number && species.baseSpecies === species.name)?.name.replace(/[^A-Za-z0-9]/g, '').toUpperCase() || '';
}

/** Send the current state to the lower screen and the app; the battle part is only what has finished playing. */
function emit() {
  if (game) {
    state.playing = game.playing;
    state.ui = game.commands.view();
    state.message = game.message;
    state.turn = game.turn;
    // The lower screen's battle log: only what has already played on the top screen.
    state.log = game.log.slice(-300);
  }
  if (!game) render(state, action, config.dual ? 'scene' : 'all');
  native.frame(JSON.stringify(state));
}

function snapshot() {
  const shown = battle.state();
  if (pvp?.end) {
    shown.ended = true;
    shown.won = pvp.end.winner === battle.me;
    shown.drawn = pvp.end.winner === null;
  }
  if (pvp?.failure) shown.wait = true;
  for (const side of [shown.player, shown.opponent]) for (const mon of side.active.filter(Boolean)) mon.sprite = spriteName(mon.number);
  for (const mon of shown.player.team) mon.sprite = spriteName(mon.number);
  for (const mon of shown.previewTeam) mon.sprite = spriteName(mon.number);
  return shown;
}

/** Everything that draws and plays a battle; made once the simulator has created it. */
async function beginGame() {
  const clock = new Clock();
  const tracker = new Tracker();
  const art = await loadArt(spriteName);
  const scene = new Scene({art, tracker, clock, gameType: battle.format.gameType, gender: config.gender});
  const commands = new Commands({
    choose: (choice, sequence) => choose(choice, sequence),
    forfeit: () => {
      if (pvp) { native.pvpForfeit(); return; }
      if (!battle.battle.ended) battle.forfeit();
      native.close();
    },
    quit: () => leave(),
    changed: () => { if (game) emit(); },
  });
  game = {clock, tracker, scene, commands, cursor: 0, playing: false, message: '', quit: false, log: [], turn: 0};
  const names = battle.state();
  game.playback = new Playback({scene, clock, tracker, text: new BattleText(tracker, {player: names.player.name, foe: names.opponent.name}),
    effects: new Effects({scene, clock, art}),
    onMessage: text => {
      game.message = text;
      game.log.push({text});
      emit();
    },
    onTurn: turn => {
      game.turn = turn;
      game.log.push({turn});
    }});
  game.screen = new Screen({
    size: () => scene.size(),
    draw: (context, regions) => scene.draw(context, commands.view(), regions),
    tick: now => clock.tick(now),
    onTap: target => tap(target),
  });
  game.screen.mount(document.getElementById('app'));
  await playNew();
}

/** Play every protocol line the player hasn't seen yet, then open the next command menu. */
async function playNew() {
  if (game.playing) return;
  const {lines, total} = battle.lines(game.cursor);
  game.cursor = total;
  game.playing = true;
  game.commands.stop();
  emit();
  try { await game.playback.run(pvp ? localLines(lines, battle.me) : lines); }
  catch (error) { console.error(error); game.clock.finish(); }
  game.playback.clearMessage();
  game.clock.instant = false;
  game.playing = false;
  game.message = '';
  state.battle = snapshot();
  game.scene.previewTeam = state.battle.preview ? state.battle.previewTeam : [];
  if (!pvp && state.battle.ended && state.battle.won && !state.reward) state.rewardPending = true;
  pvp?.report();
  if (state.battle.ended) game.commands.finish(endText());
  else game.commands.start(state.battle);
  showWaiting();
  if (game.quit) {
    game.quit = false;
    if (state.battle.ended) leave();
    else game.commands.askForfeit();
  }
  emit();
  drainEvents();
}

function endText() {
  if (pvp) {
    const winner = pvp.end ? pvp.end.winner : battle.winner;
    const result = winner === null ? 'The battle ended in a draw.' : `${battle.battle.sides[winner].name} won!`;
    return pvp.end?.reason ? `${result} ${pvp.end.reason}` : result;
  }
  if (state.reward) return state.reward;
  const shown = state.battle;
  if (shown.won) return 'Recording your Experience…';
  return shown.drawn ? 'The battle ended in a draw.' : 'Your Rating and Experience are unchanged.';
}

function choose(choice, sequence) {
  try {
    if (pvp) pvp.choose(choice);
    else battle.choose(choice, sequence);
  } catch (error) {
    game.commands.start(state.battle);
    game.commands.say(error.message.split('\n')[0]);
    return;
  }
  playNew();
}

/** Leave once the battle is over; a recorded win must finish saving first. */
function leave() {
  if (pvp && !state.battle?.ended) { native.pvpForfeit(); return; }
  if (state.rewardPending) { game.closeAfterReward = true; return; }
  native.close();
}

function tap(target) {
  if (!game) return;
  if (game.playing) { game.clock.skip(); return; }
  game.commands.tap(target);
}

function battleKey(name) {
  if (game.playing) {
    if (name === 'accept' || name === 'back') game.clock.skip();
    return;
  }
  game.commands.key(name);
}

function action(message) {
  const data = typeof message === 'string' ? JSON.parse(message) : message;
  if (!state) return;
  if (game) {
    if (data.type === 'key') battleKey(data.key);
    else if (data.type === 'tap') tap(data.target);
    else if (data.type === 'quit') quitBattle();
    return;
  }
  if (state.busy && ['format', 'source', 'select'].includes(data.type)) return;
  state.error = '';
  try {
    switch (data.type) {
    case 'format':
      if (!battle) state.format = state.formats.find(format => format.id === data.id) || state.format;
      if (state.format.random) state.teamSource = 'random';
      break;
    case 'source':
      if (!battle && ['random', 'vault'].includes(data.source)) {
        state.teamSource = data.source;
        if (data.source === 'vault' && state.format.random) state.format = state.formats.find(format => !format.random);
      }
      break;
    case 'select':
      if (!battle && state.roster.some(mon => mon.id === data.id && !mon.problem)) {
        if (state.selected.includes(data.id)) state.selected = state.selected.filter(id => id !== data.id);
        else if (state.selected.length < 6) state.selected.push(data.id);
      }
      break;
    case 'start': {
      if (battle || state.busy) return;
      const team = state.teamSource === 'vault' ? state.selected.map(id => importSet(config.roster.pokemon.find(mon => mon.id === id).set)) : null;
      if (team) {
        const checked = validateTeam(config.mode, state.format.id, team);
        if (checked.errors.length) throw new Error(checked.errors.join('\n'));
      }
      state.busy = true; emit();
      setTimeout(() => {
        try { battle = team ? new DomeBattle(config.mode, state.format.id, team, config.trainer) : randomBattle(config.mode, state.format.id, config.trainer); }
        catch (error) { state.error = error.message; }
        state.busy = false;
        if (battle) beginGame().catch(error => { state.error = error.message; emit(); });
        else emit();
      }, 30);
      return;
    }
    case 'key': setupKey(data.key); return;
    case 'quit': if (pvp || config.mode === 'pvp') native.pvpForfeit(); else native.close(); return;
    }
  } catch (error) { state.error = error.message; }
  emit();
}

/** Return to hub during a battle: finish the turn on screen at once, then ask (or leave if the battle is over). */
function quitBattle() {
  if (game.playing) {
    game.quit = true;
    game.clock.finish();
    return;
  }
  if (state.battle?.ended) leave();
  else game.commands.askForfeit();
}

function showWaiting() {
  if (!pvp || !game || state.battle.ended || !state.battle.wait) return;
  const text = pvp.failure || `Waiting for ${state.battle.opponent.name}...`;
  game.message = text;
  game.scene.message = {lines: game.scene.wrap(text).slice(0, 2), chars: Infinity};
}

/** Network events wait for playback, so one playback owns the cursor and menus at a time. */
function drainEvents() {
  if (!pvp || !game || game.playing || !pendingEvents.length) return;
  let changed = false;
  try {
    while (pendingEvents.length) changed = pvp.receive(pendingEvents.shift()) || changed;
  } catch (error) { pvp.failure = error.message; changed = true; }
  if (!changed) return;
  if (battle.lines().total > game.cursor) { playNew(); return; }
  state.battle = snapshot();
  if (state.battle.ended) game.commands.finish(endText());
  else if (state.battle.wait) game.commands.start(state.battle);
  else game.commands.battle = state.battle;
  showWaiting();
  emit();
}

window.DomePvp = {
  receive(event) { pendingEvents.push(event); drainEvents(); },
};

window.DomeApp = {
  boot(value) {
    if (config) return;
    config = value;
    if (config.mode === 'pvp') {
      state = {pvp: true, error: '', battle: null, reward: '', rewardPending: false};
      emit();
      try {
        battle = new PvpBattle(config);
        pvp = new PvpSession(battle, native);
        beginGame().catch(error => { state.error = error.message; emit(); });
      } catch (error) { state.error = error.message; emit(); }
      return;
    }
    const formats = formatsFor(config.mode);
    state = {formats, format: formats[0], roster: config.roster.pokemon.map(({set, ...mon}) => mon), selected: [], teamSource: 'random',
      rosterError: config.roster.error || '', error: '', battle: null, reward: '', rewardPending: false};
    emit();
  },
  action,
  reward(message) {
    state.reward = message;
    state.rewardPending = false;
    game?.log.push({text: message});
    if (game) game.commands.finish(message);
    emit();
    if (game?.closeAfterReward) native.close();
  },
  display(dual) {
    if (!config) return;
    config.dual = dual;
    emit();
  },
};
window.DomeKey = name => (game ? battleKey(name) : setupKey(name));
native.ready();
