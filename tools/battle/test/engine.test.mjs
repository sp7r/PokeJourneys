import test from 'node:test';
import assert from 'node:assert/strict';
import {DomeBattle, randomBattle, formatsFor, validateTeam} from '../engine.mjs';
import {opponentTeam} from '../opponent.mjs';
import {TeamValidator} from '@pkmn/sim';

const seed = [12, 34, 56, 78];
for (const mode of ['practice', 'practice_doubles', 'practice_triples']) {
  for (const format of formatsFor(mode)) test(`${format.name}: legal teams finish a full battle`, () => {
    const session = randomBattle(mode, format.id, 'Riley', seed);
    const team = session.battle.sides[0].pokemon;
    assert.equal(team.length, 6);
    if (!format.random) assert.equal(new TeamValidator(format.battleFormat || format.id).validateTeam(team.map(mon => structuredClone(mon.set))), null);
    let count = 0;
    while (!session.battle.ended && count++ < 1500) session.choose('default', session.sequence);
    assert.equal(session.battle.ended, true);
    assert.ok(session.battle.turn > 0);
    assert.ok(session.state().opponent.active.filter(Boolean).every(mon => !('moves' in mon) && !('evs' in mon)));
  });
}

test('official tier, species, move, and Species Clause validation are enforced', () => {
  const mewtwo = {species: 'Mewtwo', ability: 'Pressure', moves: ['Psychic'], nature: 'Timid'};
  assert.ok(validateTeam('practice', 'gen7ou', [mewtwo]).errors.some(error => error.includes('Mewtwo')));
  assert.deepEqual(validateTeam('practice', 'gen7opensingles', [mewtwo]).errors, []);
  const impossible = {species: 'Magikarp', ability: 'Swift Swim', moves: ['Flamethrower']};
  assert.ok(validateTeam('practice', 'gen7ou', [impossible]).errors.length);
  assert.ok(validateTeam('practice', 'gen7opensingles', [mewtwo, mewtwo]).errors.some(error => /species|Pokémon/i.test(error)));
  assert.ok(validateTeam('practice', 'gen7opensingles', [{...mewtwo, species: 'Meltan'}]).errors.length);
});

test('battle projection applies standard levels without editing the supplied team', () => {
  const team = [{species: 'Charmander', ability: 'Blaze', level: 12, moves: ['Ember'], evs: {hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0}}];
  const original = structuredClone(team);
  const ou = validateTeam('practice', 'gen7ou', team);
  assert.deepEqual(ou.errors, []);
  assert.equal(ou.team[0].level, 100);
  const lc = validateTeam('practice', 'gen7lc', team);
  assert.deepEqual(lc.errors, []);
  assert.equal(lc.team[0].level, 5);
  assert.deepEqual(team, original);
});

test('desks restrict formats and old turn submissions do not advance a battle', () => {
  assert.throws(() => validateTeam('practice_doubles', 'gen7ou', []));
  const format = formatsFor('practice').find(format => format.id === 'gen7ou');
  const session = new DomeBattle('practice', format.id, opponentTeam(format, seed), 'Riley', seed);
  const old = session.sequence;
  session.choose('default', old);
  const turn = session.battle.turn;
  assert.throws(() => session.choose('default', old), /advanced/);
  assert.equal(session.battle.turn, turn);
  const result = session.forfeit();
  assert.equal(result.ended, true);
  assert.equal(result.won, false);
});

test('a trainer sharing the default opponent name cannot receive Experience for a loss', () => {
  const format = formatsFor('practice').find(format => format.id === 'gen7ou');
  const session = new DomeBattle('practice', format.id, opponentTeam(format, seed), 'Dome Trainer', seed);
  assert.notEqual(session.battle.sides[0].name, session.battle.sides[1].name);
  assert.equal(session.forfeit().won, false);
});

test('Showdown Random Battles need no Vault and use its balanced levels without team preview', () => {
  const session = randomBattle('practice', 'gen7randombattle', 'Riley', seed);
  assert.equal(session.state().preview, false);
  for (const side of session.battle.sides) {
    assert.equal(side.pokemon.length, 6);
    assert.ok(side.pokemon.every(mon => mon.species.num >= 1 && mon.species.num <= 807));
    assert.ok(side.pokemon.some(mon => mon.level < 100));
  }
  assert.ok(validateTeam('practice', 'gen7randombattle', []).errors.length);
});
