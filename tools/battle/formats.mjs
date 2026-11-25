import {Dex} from '@pkmn/sim';

const groups = {
  practice: ['gen7randombattle', 'gen7opensingles', 'gen7ou', 'gen7uu', 'gen7ru', 'gen7nu', 'gen7pu', 'gen7zu', 'gen7lc'],
  practice_doubles: ['gen7randomdoubles', 'gen7opendoubles', 'gen7doublesou', 'gen7doublesuu'],
  practice_triples: ['gen6randomtriples', 'gen6battlespottriples'],
};

/**
 * Random Doubles and Triples: this simulator has no Gen 6-7 random doubles format, so these play Showdown's own Random
 * Battle sets (with its species-balanced levels) in the matching custom game, with the opposing team kept hidden.
 */
/** Open: bring your own team. Every Pokémon is allowed; the standard clauses and the few abusive bans stay. */
const OPEN = {
  gen7opensingles: {name: '[Gen 7] Open Singles', battleFormat: 'gen7ubers'},
  gen7opendoubles: {name: '[Gen 7] Open Doubles', battleFormat: 'gen7doublesou@@@+DUber'},
};

const RANDOM = {
  gen7randomdoubles: {name: '[Gen 7] Random Doubles', battleFormat: 'gen7doublescustomgame@@@!Team Preview', generator: 'gen7randombattle'},
  gen6randomtriples: {name: '[Gen 6] Random Triples', battleFormat: 'gen6triplescustomgame@@@!Team Preview', generator: 'gen6randombattle'},
};

export function formatsFor(mode) {
  if (!groups[mode]) throw new Error('Choose Single, Double, or Triple Battles.');
  return groups[mode].map(id => {
    if (RANDOM[id]) {
      const base = Dex.formats.get(RANDOM[id].battleFormat);
      if (!base.exists) throw new Error(`Unavailable format: ${id}`);
      return {id, ...RANDOM[id], gameType: base.gameType, random: true, level: null, rules: [...base.ruleset], bans: [],
        generation: id.startsWith('gen6') ? 6 : 7};
    }
    if (OPEN[id]) {
      const base = Dex.formats.get(OPEN[id].battleFormat);
      return {id, ...OPEN[id], gameType: base.gameType, random: false, level: 100, rules: [...base.ruleset], bans: [...base.banlist],
        generation: 7};
    }
    const format = Dex.formats.get(id);
    if (!format.exists) throw new Error(`Unavailable format: ${id}`);
    return {id, name: format.name, gameType: format.gameType, random: format.team === 'random',
      level: format.team === 'random' ? null : id === 'gen7lc' ? 5 : id.startsWith('gen6') ? 50 : 100,
      rules: [...format.ruleset], bans: [...format.banlist], generation: format.mod === 'gen6' ? 6 : 7};
  });
}

export function formatFor(mode, id) {
  const format = formatsFor(mode).find(format => format.id === id);
  if (!format) throw new Error('That format is not available at this desk.');
  return format;
}
