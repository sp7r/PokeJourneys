import {Battle, Dex, Teams, TeamValidator, extractChannelMessages} from '@pkmn/sim';
import {formatFor, formatsFor} from './formats.mjs';
import {moveOptions, opponentChoice, opponentTeam} from './opponent.mjs';

export {formatsFor};

export function validateTeam(mode, formatId, sets) {
  const format = formatFor(mode, formatId);
  if (format.random) return {errors: ['Random Battles assign both teams automatically.'], format};
  const team = structuredClone(sets);
  for (const set of team) {
    set.level = format.level;
    // Showdown's zero-EV safeguard accepts one unused point; it leaves every battle stat unchanged.
    if (!set.evs || Object.values(set.evs).every(value => value === 0)) set.evs = {hp: 1, atk: 0, def: 0, spa: 0, spd: 0, spe: 0};
    const species = Dex.species.get(set.species);
    if (!species.exists || species.num < 1 || species.num > 807) return {errors: ['Choose Pokémon from the Gen 1–7 Pokédex.']};
  }
  const errors = new TeamValidator(format.battleFormat || format.id).validateTeam(team);
  return {errors: errors || [], team, format};
}

export function importSet(text) {
  const team = Teams.import(text);
  if (!team?.length) throw new Error('This Pokémon could not be prepared for battle.');
  return team[0];
}

export function randomBattle(mode, formatId, name, seed) {
  const format = formatFor(mode, formatId);
  const playerSeed = seed?.map((value, i) => (value ^ (0x3d73 + i)) & 0xffff);
  const team = format.random ? null : opponentTeam(format, playerSeed);
  return new DomeBattle(mode, formatId, team, name, seed);
}

export class DomeBattle {
  constructor(mode, formatId, team, name, seed, people) {
    this.me = people?.me ?? 0;
    this.people = !!people;
    this.format = formatFor(mode, formatId);
    const checked = this.format.random ? null : validateTeam(mode, formatId, team);
    if (checked?.errors.length) throw new Error(checked.errors.join('\n'));
    if (this.format.random && team) throw new Error('Random Battles assign both teams automatically.');
    this.sequence = 0;
    this.error = '';
    const opponentName = name.trim().toLowerCase() === 'dome trainer' ? 'Dome Challenger' : 'Dome Trainer';
    // Random Doubles / Triples: both teams from Showdown's Random Battle generator, with its balanced levels.
    const generated = this.format.generator ? [0, 1].map(side => Teams.getGenerator(this.format.generator,
      seed && seed.map((value, i) => (value ^ (side ? 0x51f2 + i : 0x1a77 + i)) & 0xffff)).getTeam()) : null;
    this.battle = new Battle({formatid: this.format.battleFormat || formatId, seed,
      p1: {name: people?.names[0] ?? name, seed: seed?.map((value, i) => (value ^ (0x1a77 + i)) & 0xffff),
        ...(checked ? {team: checked.team} : generated ? {team: generated[0]} : {})},
      p2: {name: people?.names[1] ?? opponentName, seed: seed?.map((value, i) => (value ^ (0x51f2 + i)) & 0xffff),
        ...(checked ? {team: opponentTeam(this.format, seed)} : generated ? {team: generated[1]} : {})},
      send: (type, data) => { if (type === 'sideupdate' && String(data).includes('|error|')) this.error = String(data).split('|error|').pop(); },
    });
    if (!this.people) this.advance();
  }

  choose(choice, sequence) {
    if (this.battle.ended) throw new Error('This battle has finished.');
    if (sequence !== this.sequence) throw new Error('The battle has advanced. Choose your turn again.');
    this.error = '';
    if (!this.battle.choose('p1', choice)) throw new Error(this.error || 'That choice is unavailable. Try another move or switch.');
    this.advance();
    return this.state();
  }

  advance() {
    let count = 0;
    while (!this.battle.ended && count++ < 32) {
      const side = this.battle.sides[1];
      if (!side.activeRequest || side.activeRequest.wait || side.isChoiceDone()) break;
      const choice = opponentChoice(this.battle);
      if (!choice || !this.battle.choose('p2', choice)) {
        if (!this.battle.choose('p2', 'default')) throw new Error('The opposing trainer could not choose a legal action.');
      }
      const request = this.battle.sides[0].activeRequest;
      if (request && !request.wait && !this.battle.sides[0].isChoiceDone()) break;
    }
    this.sequence++;
  }

  forfeit() { if (!this.battle.ended) this.battle.win(this.battle.sides[1 - this.me]); return this.state(); }

  /** The player's view of the protocol from line `from` on, so every event can be played back in order. */
  lines(from = 0) {
    const channel = this.me + 1;
    const all = extractChannelMessages(this.battle.log.join('\n'), [channel])[channel];
    return {lines: all.slice(from), total: all.length};
  }

  state() {
    const battle = this.battle;
    const side = battle.sides[this.me];
    const foe = battle.sides[1 - this.me];
    const request = side.activeRequest || {};
    const describe = (pokemon, own) => pokemon ? {
      name: (own ? pokemon : pokemon.illusion || pokemon).name,
      species: (own ? pokemon : pokemon.illusion || pokemon).species.name,
      number: (own ? pokemon : pokemon.illusion || pokemon).species.num, level: pokemon.level,
      hp: own ? pokemon.hp : Math.ceil(pokemon.hp / pokemon.maxhp * 100), maxhp: own ? pokemon.maxhp : 100,
      status: pokemon.status, fainted: pokemon.fainted, shiny: (own ? pokemon : pokemon.illusion || pokemon).set.shiny || false,
      female: (own ? pokemon : pokemon.illusion || pokemon).gender === 'F',
    } : null;
    const slots = (request.forceSwitch || request.active || []).map((active, i) => ({
      name: side.active[i]?.name || `Pokémon ${i + 1}`, pass: request.forceSwitch ? !active : !active || side.active[i]?.fainted,
      forceSwitch: !!request.forceSwitch, trapped: !!active?.trapped,
      moves: request.forceSwitch ? [] : moveOptions(battle, side, i, request),
      // Every known move in its slot, usable or not, for the four-move list.
      known: request.forceSwitch ? [] : (active?.moves || []).map((move, index) => ({slot: index + 1, name: move.move,
        type: battle.dex.moves.get(move.move).type, pp: move.pp, maxpp: move.maxpp, disabled: !!move.disabled || move.pp === 0})),
      mega: !!active?.canMegaEvo, ultra: !!active?.canUltraBurst, shift: side.active.length === 3 && i !== 1 && !request.forceSwitch,
    }));
    return {sequence: this.sequence, format: this.format, turn: battle.turn, ended: battle.ended,
      won: battle.ended && battle.winner === side.name, drawn: battle.ended && !battle.winner, preview: !!request.teamPreview,
      wait: !!request.wait || (this.people && side.isChoiceDone()), slots,
      player: {name: side.name, active: side.active.map(mon => describe(mon, true)),
        team: side.pokemon.map((mon, i) => ({...describe(mon, true), slot: i + 1, active: mon.isActive}))},
      opponent: {name: foe.name, active: foe.active.map(mon => describe(mon, false))},
      previewTeam: battle.log.filter(line => line.startsWith(`|poke|${foe.id}|`)).map(line => {
        const details = line.split('|')[3];
        const species = battle.dex.species.get(details.split(',')[0]);
        return {name: species.name, species: species.name, number: species.num, shiny: details.includes('shiny')};
      }),
    };
  }

  checkHash() {
    let hash = 0x811c9dc5;
    // Time stamps (|t:|) come from each phone's clock, so they're left out; everything else must match.
    for (const char of this.battle.log.filter(line => !line.startsWith('|t:|')).join('\n')) {
      hash = Math.imul(hash ^ char.codePointAt(0), 0x01000193) >>> 0;
    }
    return hash.toString(16).padStart(8, '0');
  }
}

/** Both phones create the same Random Singles battle; only their view and input side differ. */
export class PvpBattle extends DomeBattle {
  constructor({format, seed, side, players}) {
    if (format !== 'random_singles' || ![0, 1].includes(side) || !Array.isArray(seed) || seed.length !== 4 ||
      !seed.every(value => Number.isInteger(value) && value >= 0 && value <= 0xffff) ||
      !Array.isArray(players) || players.length !== 2 || players.some(player => typeof player.name !== 'string' || !player.name.trim())) {
      throw new Error('This battle invitation is invalid.');
    }
    const names = players.map(player => player.name);
    if (names[0] === names[1]) names.forEach((name, i) => { names[i] = `${name} (p${i + 1})`; });
    super('practice', 'gen7randombattle', null, names[0], [...seed], {me: side, names});
  }

  choose(side, choice) {
    if (this.battle.ended) throw new Error('This battle has finished.');
    const player = this.battle.sides[side];
    if (!player || !player.activeRequest || player.activeRequest.wait || player.isChoiceDone()) {
      throw new Error('That player is waiting for the next turn.');
    }
    this.error = '';
    if (!this.battle.choose(player.id, choice)) throw new Error(this.error || 'That choice is unavailable. Try another move or switch.');
    this.sequence++;
    return this.state();
  }

  get winner() { return this.battle.winner ? this.battle.sides.findIndex(side => side.name === this.battle.winner) : null; }
}
