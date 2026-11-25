import test from 'node:test';
import assert from 'node:assert/strict';
import {PvpBattle, randomBattle} from '../engine.mjs';
import {moveOptions} from '../opponent.mjs';
import {PvpSession, localLines} from '../pvp.mjs';
import {Tracker} from '../tracker.mjs';
import {Protocol} from '@pkmn/protocol';
import {Commands} from '../menu.mjs';

const invitation = seed => ({format: 'random_singles', seed, players: [{id: 1, name: 'Riley'}, {id: 2, name: 'Sam'}]});

for (const seed of [[12, 34, 56, 78], [65535, 0, 32768, 1], [99, 230, 450, 71]]) {
  test(`both perspectives finish identical battles with reversed choice arrival: ${seed}`, () => {
    const config = invitation(seed);
    const phones = [0, 1].map(side => new PvpBattle({...config, side}));
    const dome = randomBattle('practice', 'gen7randombattle', 'Riley', seed);
    assert.deepEqual(phones[0].battle.sides.map(side => side.pokemon.map(mon => mon.set)),
      dome.battle.sides.map(side => side.pokemon.map(mon => mon.set)));
    assert.equal(phones[1].state().player.name, 'Sam');
    assert.equal(phones[1].state().opponent.name, 'Riley');
    let random = 12345;
    const pick = values => values[((random = (Math.imul(random, 1664525) + 1013904223) >>> 0) % values.length)];
    let choices = 0;
    while (!phones[0].battle.ended && choices++ < 1800) {
      const batch = phones[0].battle.sides.flatMap((side, index) => {
        const request = side.activeRequest;
        if (!request || request.wait || side.isChoiceDone()) return [];
        const switches = side.pokemon.flatMap((mon, i) => !mon.isActive && !mon.fainted ? [`switch ${i + 1}`] : []);
        const moves = request.forceSwitch ? [] : moveOptions(phones[0].battle, side, 0, request).map(move => move.choice);
        const options = request.forceSwitch ? switches : [...moves, ...(!request.active?.[0]?.trapped ? switches : [])];
        return [{side: index, choice: pick(options.length ? options : ['default'])}];
      });
      assert.ok(batch.length, 'at least one player has a request');
      for (const [phone, entries] of [[phones[0], batch], [phones[1], [...batch].reverse()]]) {
        for (const entry of entries) phone.choose(entry.side, entry.choice);
      }
      const untimed = phone => phone.battle.log.filter(line => !line.startsWith('|t:|'));
      assert.deepEqual(untimed(phones[0]), untimed(phones[1]));
      assert.equal(phones[0].checkHash(), phones[1].checkHash());
    }
    assert.ok(phones[0].battle.ended, 'random legal choices finish the battle');
    assert.equal(phones[0].winner, phones[1].winner);
    const view = phones[1].lines().lines;
    const own = phones[1].battle.sides[1].active[0];
    assert.ok(view.some(line => line.includes(`|switch|p2a: `) && line.includes(`|${own.maxhp}/${own.maxhp}`)) || own.fainted);
  });
}

test('a submitted choice cannot be replaced while waiting', () => {
  const battle = new PvpBattle({...invitation([12, 34, 56, 78]), side: 1});
  const before = battle.checkHash();
  battle.choose(1, 'default');
  assert.equal(battle.state().wait, true);
  assert.equal(battle.checkHash(), before);
  assert.throws(() => battle.choose(1, 'default'), /waiting/);
  assert.equal(battle.battle.turn, 1);
});

test('identical display names still have an unambiguous winner', () => {
  const config = invitation([12, 34, 56, 78]);
  config.players[1].name = config.players[0].name;
  const battle = new PvpBattle({...config, side: 1});
  battle.battle.win(battle.battle.sides[0]);
  assert.equal(battle.winner, 0);
  assert.equal(battle.state().won, false);
});

test('the relay ignores echoes and duplicates, counts replacement choices, and reports once', () => {
  const events = [];
  const results = [];
  const phones = [0, 1].map(side => new PvpSession(new PvpBattle({...invitation([12, 34, 56, 78]), side}), {
    pvpChoice(turn, choice, check) { events.push({type: 'choice', side, turn, choice, check}); },
    pvpResult(winner, check) { results.push({side, winner, check}); },
  }));
  let count = 0;
  while (!phones[0].battle.battle.ended && count++ < 1500) {
    for (const phone of phones) if (!phone.battle.state().wait) phone.choose('default');
    for (const event of events.splice(0).reverse()) for (const phone of phones) {
      phone.receive(event);
      phone.receive(event);
    }
    const untimed = phone => phone.battle.battle.log.filter(line => !line.startsWith('|t:|'));
    assert.deepEqual(untimed(phones[0]), untimed(phones[1]));
  }
  assert.ok(phones[0].battle.battle.ended);
  assert.ok(Math.max(...phones[0].turns) > phones[0].battle.battle.turn, 'forced replacements count as choices');
  for (const phone of phones) { phone.report(); phone.report(); }
  assert.equal(results.length, 2);
  assert.equal(results[0].winner, results[1].winner);
  assert.equal(results[0].check, results[1].check);
});

test('side 1 playback puts its own private health on the player side', () => {
  const battle = new PvpBattle({...invitation([12, 34, 56, 78]), side: 1});
  const tracker = new Tracker();
  for (const line of localLines(battle.lines().lines, 1)) tracker.apply(Protocol.parseBattleLine(line).args);
  assert.equal(tracker.sides.p1.name, 'Sam');
  assert.equal(tracker.sides.p2.name, 'Riley');
  const own = battle.battle.sides[1].active[0];
  assert.equal(tracker.sides.p1.slots[0].maxhp, own.maxhp);
  assert.equal(tracker.sides.p1.slots[0].name, own.name);
  assert.notEqual(tracker.sides.p2.slots[0].maxhp, battle.battle.sides[0].active[0].maxhp);
  assert.deepEqual(localLines(['|win|p1', '|-activate|p1a: Mon|ability: X|[of] p2a: Foe'], 1),
    ['|win|p1', '|-activate|p2a: Mon|ability: X|[of] p1a: Foe']);
});

test('server endings override play, while mismatched or missing choices stop play', () => {
  const phone = new PvpSession(new PvpBattle({...invitation([12, 34, 56, 78]), side: 0}), {
    pvpResult() { assert.fail('server endings must not report a simulated result'); },
  });
  assert.throws(() => phone.receive({type: 'choice', side: 1, turn: 2}), /missing/);
  assert.throws(() => phone.receive({type: 'choice', side: 1, turn: 1, choice: 'default', check: 'wrong'}), /out of sync/);
  const end = {type: 'end', winner: 0, reason: 'Sam ran out of time.'};
  phone.receive(end);
  phone.report();
  assert.equal(phone.end, end);
  assert.throws(() => phone.choose('default'), /finished/);
});

test('back from waiting offers a forfeit and cancel returns to waiting', () => {
  let forfeits = 0;
  const commands = new Commands({changed() {}, choose() { assert.fail('waiting cannot choose'); }, forfeit() { forfeits++; }});
  commands.start({wait: true, slots: []});
  commands.key('back');
  assert.equal(commands.mode, 'yesno');
  commands.key('accept');
  assert.equal(commands.mode, 'wait');
  commands.key('back');
  commands.key('up');
  commands.key('accept');
  assert.equal(forfeits, 1);
});
