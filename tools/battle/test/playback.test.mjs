import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBattle, formatsFor} from '../engine.mjs';
import {Tracker} from '../tracker.mjs';
import {BattleText} from '../text.mjs';
import {Clock} from '../anim.mjs';
import {Playback} from '../playback.mjs';

/** The scene and effects without a canvas: every animation finishes at once, the visible state is kept. */
function stubScene() {
  const visuals = {p1: [], p2: []};
  const done = async () => {};
  return {
    visuals,
    message: {lines: [], chars: 0},
    trainers: {p1: {shown: false}, p2: {shown: false}},
    wrap: text => [text],
    visual(side, slot) {
      visuals[side][slot] ||= {side, slot, mon: null, shown: false, box: false, hp: 0};
      return visuals[side][slot];
    },
    introSlide: done,
    trainerLeaves: async side => { visuals[side].trainer = false; },
    trainerReturns: done,
    async sendOut(visual) { visual.shown = true; visual.box = true; visual.hp = visual.mon.hp; },
    async recall(visual) { visual.shown = false; visual.box = false; },
    async faint(visual) { visual.shown = false; visual.box = false; },
    flicker: done,
    monCenter: () => ({x: 0, y: 0}),
  };
}

const effects = new Proxy({}, {get: () => async () => {}});

function play(mode, formatId, seed) {
  const session = randomBattle(mode, formatId, 'Riley', seed);
  const tracker = new Tracker();
  const clock = new Clock();
  clock.instant = true;
  const scene = stubScene();
  const messages = [];
  const playback = new Playback({scene, clock, tracker, effects, text: new BattleText(tracker, {player: 'Riley', foe: 'Dome Trainer'}),
    onMessage: text => messages.push(text)});
  return {session, tracker, scene, messages, playback, cursor: 0};
}

async function playNew(game) {
  const {lines, total} = game.session.lines(game.cursor);
  game.cursor = total;
  await game.playback.run(lines);
}

for (const mode of ['practice', 'practice_doubles', 'practice_triples']) {
  for (const format of formatsFor(mode)) test(`${format.name}: every event plays in order and the screen ends on the true state`, async () => {
    const game = play(mode, format.id, [3, 1, 4, 1]);
    await playNew(game);
    let count = 0;
    while (!game.session.battle.ended && count++ < 1500) {
      game.session.choose('default', game.session.sequence);
      await playNew(game);
    }
    assert.equal(game.session.battle.ended, true);
    assert.ok(game.messages[0].endsWith('would like to battle!'));
    assert.ok(/defeated|lost against|draw/.test(game.messages.at(-1)), game.messages.at(-1));
    const state = game.session.state();
    for (const [slot, mon] of state.player.active.entries()) {
      if (!mon) continue;
      const shown = game.tracker.sides.p1.slots[slot];
      assert.equal(shown.hp, mon.hp, `${mon.name} HP`);
      assert.equal(shown.fainted, mon.fainted, `${mon.name} fainted`);
      if (!mon.fainted) assert.equal(game.scene.visuals.p1[slot].mon, shown, `${mon.name} is the Pokémon on screen`);
    }
    for (const [slot, mon] of state.opponent.active.entries()) {
      if (mon) assert.equal(game.tracker.sides.p2.slots[slot].fainted, mon.fainted);
    }
  });
}

test('the foe is sent out before the player and messages follow FireRed', async () => {
  const game = play('practice', 'gen7randombattle', [9, 9, 9, 9]);
  await playNew(game);
  const sentOut = game.messages.findIndex(text => text.startsWith('DOME TRAINER sent out'));
  const go = game.messages.findIndex(text => text.startsWith('Go! '));
  assert.ok(sentOut > 0 && go > sentOut, game.messages.slice(0, 4).join(' | '));
  game.session.choose('default', game.session.sequence);
  await playNew(game);
  assert.ok(game.messages.some(text => / used [A-Z0-9 .’-]+!$/.test(text)), game.messages.join(' | '));
  assert.ok(!game.messages.some(text => /The opposing|\*\*|^\(/.test(text)), game.messages.join(' | '));
});
