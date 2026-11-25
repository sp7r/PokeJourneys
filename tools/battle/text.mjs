import {LogFormatter} from '@pkmn/view';
import {Dex} from '@pkmn/sim';

/**
 * Battle messages in FireRed's voice. Showdown's own text templates (through @pkmn/view) cover every move, ability,
 * item and field effect; this only restyles the result the way FireRed prints it: "Foe PIDGEY used GUST!".
 */
export class BattleText {
  constructor(tracker, names) {
    this.formatter = new LogFormatter('p1', tracker);
    this.names = names;
    this.seen = new Set(STATS);
  }

  /** Messages for one protocol line, in order. Call this before the tracker applies the same line. */
  messages(args, kwArgs) {
    if (['switch', 'drag', 'replace', 'poke'].includes(args[0])) this.seen.add(String(args[1]).replace(/^p\d[a-c]?: /, ''));
    const special = this.special(args);
    const raw = this.formatter.formatText(args, kwArgs);
    if (special) return special;
    const words = this.loudWords(args, kwArgs);
    return raw.split('\n').map(line => line.trim()).filter(line => line && !hidden(line)).map(line => this.restyle(line, words));
  }

  special(args) {
    const {player, foe} = this.names;
    switch (args[0]) {
    case 'start': return [`${foe.toUpperCase()} would like to battle!`];
    case 'win':
      return args[1] === player ? [`${player} defeated ${foe.toUpperCase()}!`]
        : [`${player} is out of usable POKéMON!`, `${player} lost against ${foe.toUpperCase()}!`];
    case 'tie': return ['The battle ended in a draw!'];
    default: return null;
    }
  }

  /** Pokémon, moves, items and abilities named by this line, which FireRed prints in capitals. */
  loudWords(args, kwArgs) {
    const words = new Set([this.names.foe, ...this.seen]);
    const add = value => {
      if (!value || typeof value !== 'string') return;
      const name = value.replace(/^p\d[a-c]?: /, '').replace(/^(item|ability|move): /, '');
      if (name.length > 1) words.add(name);
      const species = Dex.species.get(name);
      if (species.exists) words.add(species.name);
    };
    for (const arg of args.slice(1)) {
      if (typeof arg !== 'string') continue;
      add(arg.split(',')[0]);
    }
    for (const value of Object.values(kwArgs)) add(value);
    for (const arg of args.slice(1)) {
      if (typeof arg !== 'string') continue;
      for (const lookup of [Dex.moves, Dex.items, Dex.abilities]) {
        const effect = lookup.get(arg.replace(/^(item|ability|move): /, ''));
        if (effect.exists) words.add(effect.name);
      }
    }
    return [...words].sort((a, b) => b.length - a.length);
  }

  restyle(line, words) {
    let text = line
      .replace(/ \(\*\*[^*]+\*\*\)/g, '')
      .replace(/\*\*/g, '')
      .replace(/\bthe opposing team\b/g, 'the foe’s team')
      .replace(/\bThe opposing team\b/g, 'The foe’s team')
      .replace(/\b[Tt]he opposing /g, 'Foe ')
      .replace(/'/g, '’')
      .replace(/\.\.\./g, '…');
    for (const word of words) text = text.replace(new RegExp(`(^|[^A-Za-z])${escape(word)}(?![a-z])`, 'g'), (match, before) => before + word.toUpperCase());
    return text.replace(/Pokémon/g, 'POKéMON');
  }
}

const STATS = ['Attack', 'Defense', 'Sp. Atk', 'Sp. Def', 'Speed'];

/** Log-only lines: turn headers, ability pop-up labels and the parenthesised notes Showdown keeps out of the battle text. */
function hidden(line) {
  return /^==/.test(line) || /^\[.*\]$/.test(line) || /^\(.*\)$/.test(line) || /^Battle started between/.test(line);
}

function escape(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
