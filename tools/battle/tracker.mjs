import {Dex} from '@pkmn/sim';

/**
 * What the player can see of the battle, rebuilt one protocol line at a time while a turn plays out. The screen is
 * drawn from this, never from the simulator's final state, so HP, faints and switches appear in their real order.
 * It also answers @pkmn/view's Tracker questions, so messages such as "CHARIZARD, come back!" can be written.
 */
export class Tracker {
  constructor() {
    this.gameType = 'singles';
    this.weather = '';
    this.sides = {p1: {name: '', slots: []}, p2: {name: '', slots: []}};
  }

  mon(ident) {
    const match = /^(p[12])([a-c])?: (.*)$/.exec(String(ident || ''));
    if (!match) return null;
    const side = this.sides[match[1]];
    if (match[2]) return side.slots[slotIndex(match[2])] || null;
    return side.slots.find(mon => mon?.name === match[3]) || null;
  }

  apply(args) {
    const [type] = args;
    switch (type) {
    case 'player': if (this.sides[args[1]] && args[2]) this.sides[args[1]].name = args[2]; break;
    case 'gametype': this.gameType = args[1]; break;
    case 'switch': case 'drag': case 'replace': this.enter(args[1], args[2], args[3]); break;
    case 'detailschange': case '-formechange': this.reform(args[1], args[2]); break;
    case '-damage': case '-heal': case '-sethp': this.health(args[1], args[2]); break;
    case '-status': { const mon = this.mon(args[1]); if (mon) mon.status = args[2]; break; }
    case '-curestatus': { const mon = this.mon(args[1]); if (mon) mon.status = ''; break; }
    case '-cureteam': for (const mon of this.sides[String(args[1]).slice(0, 2)]?.slots || []) if (mon) mon.status = ''; break;
    case 'faint': { const mon = this.mon(args[1]); if (mon) { mon.fainted = true; mon.hp = 0; } break; }
    case 'move': { const mon = this.mon(args[1]); if (mon) mon.lastMove = Dex.moves.get(args[2]).id; break; }
    case 'swap': this.swap(args[1], Number(args[2])); break;
    case '-transform': {
      const mon = this.mon(args[1]);
      const target = this.mon(args[2]);
      if (mon && target) mon.look = target.look;
      break;
    }
    case '-weather': this.weather = args[1] === 'none' ? '' : Dex.conditions.get(args[1]).id; break;
    }
  }

  enter(ident, details, hp) {
    const match = /^(p[12])([a-c]): (.*)$/.exec(ident);
    if (!match) return;
    const side = this.sides[match[1]];
    const slot = slotIndex(match[2]);
    const info = parseDetails(details);
    const mon = {ident: `${match[1]}: ${match[3]}`, side: match[1], slot, name: match[3], ...info, look: lookOf(info),
      status: '', fainted: false, lastMove: '', hp: 0, maxhp: 0};
    Object.assign(mon, parseHealth(hp));
    side.slots[slot] = mon;
  }

  reform(ident, details) {
    const mon = this.mon(ident);
    if (!mon) return;
    Object.assign(mon, parseDetails(details));
    mon.look = lookOf(mon);
  }

  health(ident, hp) {
    const mon = this.mon(ident);
    if (mon) Object.assign(mon, parseHealth(hp));
  }

  swap(ident, position) {
    const mon = this.mon(ident);
    if (!mon) return;
    const slots = this.sides[mon.side].slots;
    const other = slots[position];
    slots[position] = mon;
    slots[mon.slot] = other;
    if (other) other.slot = mon.slot;
    mon.slot = position;
  }

  // @pkmn/view Tracker interface.
  pokemonAt(side, slot) { return this.sides[side]?.slots[slot]?.ident; }
  damagePercentage() { return undefined; }
  currentWeather() { return this.weather || undefined; }
  getSwitchedOutPokemon(ident) {
    const match = /^(p[12])([a-c])/.exec(ident);
    const mon = match && this.sides[match[1]].slots[slotIndex(match[2])];
    return mon && !mon.fainted ? {ident: mon.ident, lastMove: mon.lastMove} : undefined;
  }
  getPokemonTypeList(ident) { const mon = this.mon(ident); return mon ? Dex.species.get(mon.species).types : undefined; }
  getPokemonSpeciesForme(ident) { return this.mon(ident)?.species; }
  get(type, name) { return type === 'moves' ? Dex.moves.get(name) : undefined; }
}

function slotIndex(letter) {
  return letter.charCodeAt(0) - 97;
}

export function parseDetails(details) {
  const parts = String(details || '').split(', ');
  const species = Dex.species.get(parts[0]);
  const info = {species: species.name, number: species.num, level: 100, gender: '', shiny: false};
  for (const part of parts.slice(1)) {
    if (/^L\d+$/.test(part)) info.level = Number(part.slice(1));
    else if (part === 'M' || part === 'F') info.gender = part;
    else if (part === 'shiny') info.shiny = true;
  }
  return info;
}

export function parseHealth(text) {
  const [amounts, status] = String(text || '').split(' ');
  // A Pokémon at 0 HP stays on the field until its own |faint| line plays.
  if (status === 'fnt' || amounts === '0') return {hp: 0};
  const [hp, maxhp] = amounts.split('/').map(Number);
  const result = {hp: hp || 0};
  if (maxhp) result.maxhp = maxhp;
  result.status = status && status !== 'fnt' ? status : '';
  return result;
}

/** The species picture a Pokémon shows: its base form's National Dex number, which the local art is indexed by. */
function lookOf(info) {
  return {number: info.number, species: info.species, shiny: info.shiny, female: info.gender === 'F'};
}
