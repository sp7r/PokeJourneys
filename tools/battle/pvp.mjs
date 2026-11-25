/** Choice counters belong to each player, including mid-turn replacements. Echoes and retries are harmless. */
export class PvpSession {
  constructor(battle, native) {
    this.battle = battle;
    this.native = native;
    this.turns = [0, 0];
    this.end = null;
    this.failure = '';
    this.reported = false;
  }

  choose(choice) {
    if (this.end || this.failure) throw new Error(this.failure || 'This battle has finished.');
    const check = this.battle.checkHash();
    this.battle.choose(this.battle.me, choice);
    this.native.pvpChoice(++this.turns[this.battle.me], choice, check);
  }

  receive(event) {
    if (event.type === 'end') { this.end = event; return true; }
    if (event.type === 'error') { this.failure = event.message; return true; }
    if (event.type !== 'choice' || event.side === this.battle.me || this.end || this.failure) return false;
    if (![0, 1].includes(event.side)) throw new Error('Invalid battle side.');
    if (event.turn <= this.turns[event.side]) return false;
    if (event.turn !== this.turns[event.side] + 1) throw new Error('A battle choice is missing.');
    if (event.check !== this.battle.checkHash()) throw new Error('The two phones are out of sync. Please return to the hub.');
    this.battle.choose(event.side, event.choice);
    this.turns[event.side] = event.turn;
    return true;
  }

  report() {
    if (this.reported || this.end || this.failure || !this.battle.battle.ended) return;
    this.reported = true;
    this.native.pvpResult(this.battle.winner ?? -1, this.battle.checkHash());
  }
}

/** The scene always puts the local player at p1; only displayed protocol identifiers are swapped. */
export function localLines(lines, me) {
  if (me === 0) return lines;
  return lines.map(line => {
    const fields = line.split('|');
    return fields.map((field, i) => {
      if (i < 2 || fields[1] === 'win') return field;
      if (i === 2 && ['player', 'teamsize', 'poke'].includes(fields[1])) return field.replace(/^p([12])$/, (_, n) => `p${3 - Number(n)}`);
      return field.replace(/^(\[of\] )?p([12])(?=[a-c]?: )/, (_, prefix, n) => `${prefix || ''}p${3 - Number(n)}`);
    }).join('|');
  });
}
