import {Dex, Teams, TeamValidator} from '@pkmn/sim';
import {TeamGenerators} from '@pkmn/randoms';

Teams.setGeneratorFactory(TeamGenerators);

const littleCup = [
  ['Mienfoo', 'Regenerator', 'Eviolite', ['Drain Punch', 'Knock Off', 'U-turn', 'Fake Out']],
  ['Pawniard', 'Defiant', 'Eviolite', ['Knock Off', 'Iron Head', 'Sucker Punch', 'Stealth Rock']],
  ['Staryu', 'Natural Cure', 'Eviolite', ['Scald', 'Psychic', 'Recover', 'Rapid Spin']],
  ['Foongus', 'Regenerator', 'Eviolite', ['Spore', 'Giga Drain', 'Sludge Bomb', 'Synthesis']],
  ['Abra', 'Magic Guard', 'Focus Sash', ['Psychic', 'Dazzling Gleam', 'Shadow Ball', 'Protect']],
  ['Mudbray', 'Stamina', 'Eviolite', ['Earthquake', 'Heavy Slam', 'Rock Slide', 'Close Combat']],
].map(([species, ability, item, moves]) => ({species, name: species, ability, item, moves, level: 5, nature: 'Serious',
  evs: {hp: 76, atk: Dex.species.get(species).baseStats.atk > Dex.species.get(species).baseStats.spa ? 196 : 0,
    def: 0, spa: Dex.species.get(species).baseStats.atk > Dex.species.get(species).baseStats.spa ? 0 : 196, spd: 0, spe: 236}}));

/** Build opponents from Showdown's competitive random sets, then enforce the chosen format on the whole team. */
export function opponentTeam(format, seed) {
  const validator = new TeamValidator(format.battleFormat || format.id);
  if (format.id === 'gen7lc') {
    const team = structuredClone(littleCup);
    const errors = validator.validateTeam(team);
    if (errors) throw new Error(errors.join('\n'));
    return team;
  }
  const team = [];
  const species = new Set();
  const items = new Set();
  const source = format.generation === 6 ? 'gen6randombattle' : 'gen7randombattle';
  const generator = Teams.getGenerator(source, seed);
  for (let attempt = 0; attempt < 160 && team.length < 6; attempt++) {
    for (const set of generator.getTeam()) {
      const mon = structuredClone(set);
      mon.level = format.level;
      const base = Dex.species.get(mon.species).baseSpecies;
      if (species.has(base) || (format.generation === 6 && mon.item && items.has(mon.item))) continue;
      if (validator.validateSet(mon, {})) continue;
      team.push(mon);
      species.add(base);
      if (mon.item) items.add(mon.item);
      if (team.length === 6) {
        if (!validator.validateTeam(structuredClone(team))) return team;
        team.pop();
        species.delete(base);
        items.delete(mon.item);
      }
    }
  }
  throw new Error('Could not prepare a legal opponent. Please try again.');
}

export function moveOptions(battle, side, index, request) {
  const active = request.active?.[index];
  const pokemon = side.active[index];
  if (!active || !pokemon || pokemon.fainted) return [];
  const options = [];
  for (const [i, move] of active.moves.entries()) {
    if (move.disabled || move.pp === 0) continue;
    const variants = [{name: move.move, suffix: '', target: move.target}];
    const z = active.canZMove?.[i];
    if (z) variants.push({name: z.move, suffix: ' zmove', target: z.target});
    for (const variant of variants) {
      let targets = [{location: 0, name: ''}];
      if (side.active.length > 1 && ['normal', 'any', 'adjacentAlly', 'adjacentAllyOrSelf', 'adjacentFoe'].includes(variant.target)) {
        targets = [];
        for (const targetSide of [side.foe, side]) for (const [slot, target] of targetSide.active.entries()) {
          if (!target || target.fainted) continue;
          const location = targetSide === side ? -(slot + 1) : slot + 1;
          if (battle.validTargetLoc(location, pokemon, variant.target)) targets.push({location, name: (targetSide === side ? target : target.illusion || target).name});
        }
      }
      for (const target of targets) options.push({name: variant.name, type: battle.dex.moves.get(variant.name).type,
        pp: move.pp, maxpp: move.maxpp, slot: i + 1, target: variant.target,
        targetName: target.name, location: target.location, modifier: variant.suffix.trim(),
        choice: `move ${i + 1}${target.location ? ` ${target.location}` : ''}${variant.suffix}`});
    }
  }
  return options;
}

function effectiveness(battle, move, target) {
  if (!target) return 1;
  const types = target.illusion ? target.illusion.species.types : target.getTypes();
  if (!battle.dex.getImmunity(move, types)) return 0;
  return 2 ** battle.dex.getEffectiveness(move, types);
}

/** Evaluate damage and support against visible species, HP, and status; opponent moves and private stats are unused. */
function scoreMove(battle, pokemon, option) {
  const move = battle.dex.moves.get(option.name);
  const foe = option.location < 0 ? pokemon.side.active[-option.location - 1] : pokemon.side.foe.active[(option.location || 1) - 1];
  const hp = pokemon.hp / pokemon.maxhp;
  if (move.category === 'Status') {
    if (move.heal || ['rest', 'roost', 'recover', 'synthesis', 'softboiled', 'slackoff'].includes(move.id)) return hp < .55 ? 90 : -10;
    if (move.status) return foe && !foe.status && battle.dex.getImmunity(move, foe) ? 35 : -10;
    if (move.boosts) return battle.turn < 4 && Math.max(...Object.values(pokemon.boosts)) < 1 ? 30 : 0;
    return 4;
  }
  const attack = move.category === 'Physical' ? pokemon.storedStats.atk : pokemon.storedStats.spa;
  const species = foe?.illusion?.species || foe?.species;
  const defense = species ? (move.category === 'Physical' ? species.baseStats.def : species.baseStats.spd) : 100;
  let power = move.basePower || (move.damage ? 70 : 40);
  if (move.id === 'return' || move.id === 'frustration') power = 102;
  const accuracy = typeof move.accuracy === 'number' ? move.accuracy / 100 : 1;
  const stab = pokemon.hasType(move.type) ? 1.5 : 1;
  const damage = power * attack / Math.max(30, defense) * stab * effectiveness(battle, move, foe) * accuracy;
  const friendly = foe?.side === pokemon.side ? -2 : 1;
  return damage * friendly + (move.priority > 0 && foe && foe.hp / foe.maxhp < .25 ? 25 : 0);
}

export function opponentChoice(battle) {
  const side = battle.sides[1];
  const request = side.activeRequest;
  if (!request || request.wait) return null;
  if (request.teamPreview) return 'default';
  const chosen = new Set();
  let special = false;
  const available = () => side.pokemon.map((pokemon, i) => ({pokemon, slot: i + 1})).filter(({pokemon, slot}) =>
    !pokemon.fainted && !pokemon.isActive && !chosen.has(slot));
  const slots = request.forceSwitch || request.active;
  return slots.map((active, i) => {
    if (request.forceSwitch) {
      if (!active) return 'pass';
      const next = available().sort((a, b) => b.pokemon.hp / b.pokemon.maxhp - a.pokemon.hp / a.pokemon.maxhp)[0];
      if (!next) return 'pass';
      chosen.add(next.slot);
      return `switch ${next.slot}`;
    }
    if (!active || !side.active[i] || side.active[i].fainted) return 'pass';
    const pokemon = side.active[i];
    const moves = moveOptions(battle, side, i, request).filter(option => !special || option.modifier !== 'zmove');
    moves.sort((a, b) => scoreMove(battle, pokemon, b) - scoreMove(battle, pokemon, a));
    if (!moves.length) return 'default';
    let choice = moves[0].choice;
    if (moves[0].modifier === 'zmove') special = true;
    else if (!special && active.canMegaEvo) { choice += ' mega'; special = true; }
    else if (!special && active.canUltraBurst) { choice += ' ultra'; special = true; }
    return choice;
  }).join(', ');
}
