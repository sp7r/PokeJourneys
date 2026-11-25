import {Protocol} from '@pkmn/protocol';
import {Dex} from '@pkmn/sim';

/**
 * Plays Showdown's protocol for one turn (or the battle's opening) the way FireRed shows a battle: one message at a
 * time, the move's animation, the hit flicker, HP bars draining, faints, recalls and send-outs, in protocol order.
 * The tracker is updated line by line, so the screen never shows a result before its event has played.
 */
export class Playback {
  constructor({scene, clock, tracker, text, effects, onMessage, onTurn}) {
    this.scene = scene;
    this.clock = clock;
    this.tracker = tracker;
    this.text = text;
    this.effects = effects;
    this.onMessage = onMessage || (() => {});
    this.onTurn = onTurn || (() => {});
    this.lastMessage = '';
  }

  /** Parse, then play every line in order. Resolves when the last message has been read. */
  async run(lines) {
    const entries = foeFirst(lines.map(line => ({line, ...Protocol.parseBattleLine(line)})));
    for (let i = 0; i < entries.length;) i = await this.major(entries, i);
  }

  /** Format and apply one line: messages first (they describe the state before the line), then the tracker. */
  read(entry) {
    const messages = this.text.messages(entry.args, entry.kwArgs);
    this.tracker.apply(entry.args, entry.kwArgs);
    return messages;
  }

  async say(messages) {
    for (const message of messages) await this.message(message);
  }

  /** Print one message in the textbox, two lines at a time, then hold it for about a second (A or B hurries it). */
  async message(text) {
    if (!text || text === this.lastMessage) return;
    this.lastMessage = text;
    this.onMessage(text);
    const lines = this.scene.wrap(text);
    const box = this.scene.message;
    for (let start = 0; start < lines.length; start += 2) {
      box.lines = lines.slice(start, start + 2);
      box.chars = 0;
      const total = box.lines.join('').length;
      this.clock.skipped = false;
      await this.clock.tween(total * 16, progress => {
        box.chars = this.clock.skipped ? total : Math.ceil(total * progress);
        if (this.clock.skipped) this.clock.skipped = false;
      });
      box.chars = total;
      await this.clock.wait(start + 2 < lines.length ? 500 : 1000, true);
    }
  }

  clearMessage() {
    this.scene.message.lines = [];
    this.lastMessage = '';
  }

  /** Play the major line at `index` with its minor lines; returns the index of the next major line. */
  async major(entries, index) {
    const entry = entries[index];
    const [type] = entry.args;
    let end = index + 1;
    while (end < entries.length && isMinor(entries[end].args[0])) end++;
    const minors = entries.slice(index + 1, end);
    switch (type) {
    case 'move': await this.move(entry, minors); return end;
    case 'switch': case 'drag': await this.switchIn(entry); break;
    case 'replace': await this.replace(entry); break;
    case 'faint': await this.faint(entry); break;
    case 'start': await this.opening(entry); break;
    case 'turn': this.read(entry); this.onTurn(Number(entry.args[1])); break;
    case 'win': case 'tie': await this.ending(entry); break;
    case 'detailschange': {
      const visual = this.visualOf(entry.args[1]);
      await this.say(this.read(entry));
      if (visual) await this.effects.transform(visual);
      break;
    }
    case 'cant': {
      const messages = this.read(entry);
      const visual = this.visualOf(entry.args[1]);
      const reason = Dex.conditions.get(entry.args[2]).id;
      if (visual && ['slp', 'par', 'frz'].includes(reason)) await this.effects.status(reason, visual);
      await this.say(messages);
      break;
    }
    default: await this.say(this.read(entry));
    }
    await this.minors(minors, null);
    return end;
  }

  async move(entry, minors) {
    const {args, kwArgs} = entry;
    const messages = this.read(entry);
    this.hitBefore = false;
    await this.say(messages);
    const user = this.visualOf(args[1]);
    const first = minors[0]?.args[0];
    const blocked = kwArgs.still || kwArgs.notarget || kwArgs.miss || ['-fail', '-immune', '-miss', '-notarget'].includes(first) ||
      (first === '-activate' && /protect|detect|king's shield|spiky shield|baneful bunker|wide guard|quick guard/i.test(minors[0].args[2] || ''));
    if (user && !blocked) {
      const targets = this.moveTargets(args, kwArgs, minors).map(ident => this.visualOf(ident)).filter(Boolean);
      await this.effects.move(Dex.moves.get(args[2]), user, targets);
    }
    await this.minors(minors, user);
  }

  /** Targets for the animation: the spread list, the named target, or whoever the move damaged. */
  moveTargets(args, kwArgs, minors) {
    if (kwArgs.spread) return String(kwArgs.spread).split(',').map(position => `${position.trim()}: `);
    const damaged = minors.filter(minor => minor.args[0] === '-damage' && !minor.kwArgs.from).map(minor => minor.args[1]);
    if (damaged.length) return [...new Set(damaged)];
    return args[3] ? [args[3]] : [];
  }

  /**
   * Minor lines after a major one. Runs of direct hits are grouped so a spread move hits every target together, and
   * FireRed's order is kept: the hit and HP drain first, then "A critical hit!" and "It's super effective!".
   */
  async minors(minors, user) {
    for (let i = 0; i < minors.length;) {
      const type = minors[i].args[0];
      if (user && isHitPart(minors[i])) {
        i = await this.hits(minors, i);
        continue;
      }
      if ((type === '-boost' || type === '-unboost')) {
        i = await this.boosts(minors, i);
        continue;
      }
      await this.minor(minors[i]);
      i++;
    }
  }

  async hits(minors, start) {
    const group = [];
    const later = [];
    const struck = new Set();
    let i = start;
    for (; i < minors.length && isHitPart(minors[i]); i++) {
      const minor = minors[i];
      const ident = minor.args[1];
      if (minor.args[0] === '-damage') {
        if (struck.has(ident)) break;
        struck.add(ident);
        const visual = this.visualOf(ident);
        later.push(...this.read(minor));
        if (visual) group.push(visual);
      } else {
        later.push(...this.read(minor));
      }
    }
    if (group.length) {
      if (this.hitBefore) await this.effects.impact(group);
      await Promise.all(group.map(visual => this.scene.flicker(visual)));
      await Promise.all(group.map(visual => this.drain(visual)));
    }
    this.hitBefore = true;
    await this.say(later);
    return i;
  }

  async boosts(minors, start) {
    const first = minors[start];
    const messages = [];
    let i = start;
    while (i < minors.length && minors[i].args[0] === first.args[0] && minors[i].args[1] === first.args[1]) {
      messages.push(...this.read(minors[i]));
      i++;
    }
    const visual = this.visualOf(first.args[1]);
    if (visual && Number(first.args[3]) !== 0) await this.effects.stat(visual, first.args[0] === '-boost');
    await this.say(messages);
    return i;
  }

  async minor(entry) {
    const {args, kwArgs} = entry;
    const [type] = args;
    const visual = this.visualOf(args[1]);
    const messages = this.read(entry);
    switch (type) {
    case '-damage': case '-heal': case '-sethp': {
      const from = Dex.conditions.get(String(kwArgs.from || '').replace(/^(item|ability|move): /, '')).id;
      if (visual && type === '-damage' && ['psn', 'tox', 'brn'].includes(from)) await this.effects.status(from, visual);
      if (visual && type === '-heal') await this.effects.heal(visual);
      if (visual) await this.drain(visual);
      await this.say(messages);
      return;
    }
    case '-status':
      if (visual) await this.effects.status(args[2], visual);
      await this.say(messages);
      return;
    case '-weather':
      if (args[1] !== 'none') await this.effects.weather(Dex.conditions.get(args[1]).id);
      await this.say(messages);
      return;
    case '-transform':
      await this.say(messages);
      if (visual) await this.effects.transform(visual);
      return;
    case '-mega': case '-primal': case '-burst':
      if (visual) await this.effects.transform(visual);
      await this.say(messages);
      return;
    case '-zpower':
      if (visual) await this.effects.stat(visual, true);
      await this.say(messages);
      return;
    case '-hitcount':
      this.hitBefore = false;
      await this.say(messages);
      return;
    default:
      await this.say(messages);
    }
  }

  // Field events ----------------------------------------------------------------------------------------------------

  async opening(entry) {
    this.scene.trainers.p1.shown = true;
    this.scene.trainers.p2.shown = true;
    await this.scene.introSlide();
    await this.say(this.read(entry));
  }

  async switchIn(entry) {
    const [, ident] = entry.args;
    const side = ident.slice(0, 2);
    const slot = ident.charCodeAt(2) - 97;
    const visual = this.scene.visual(side, slot);
    const messages = this.read(entry);
    const current = visual.mon;
    const incoming = this.tracker.sides[side].slots[slot];
    if (current && visual.shown && !current.fainted && messages.length > 1) {
      await this.message(messages.shift());
      await this.scene.recall(visual);
    }
    if (entry.args[0] === 'drag') {
      if (visual.shown) await this.scene.recall(visual);
      visual.mon = incoming;
      await this.scene.sendOut(visual, false);
      await this.say(messages);
      return;
    }
    const trainer = this.scene.trainers[side];
    if (trainer.shown) await this.scene.trainerLeaves(side);
    visual.mon = incoming;
    visual.hp = incoming.hp;
    await this.message(messages.shift());
    await this.scene.sendOut(visual, true);
    await this.say(messages);
  }

  async replace(entry) {
    const [, ident] = entry.args;
    const visual = this.visualOf(ident);
    const messages = this.read(entry);
    if (visual) visual.mon = this.tracker.mon(ident) || visual.mon;
    await this.say(messages);
  }

  async faint(entry) {
    const visual = this.visualOf(entry.args[1]);
    const messages = this.read(entry);
    if (visual) await this.scene.faint(visual);
    await this.say(messages);
  }

  async ending(entry) {
    const messages = this.read(entry);
    const won = entry.args[0] === 'win' && entry.args[1] === this.tracker.sides.p1.name;
    if (won) await this.scene.trainerReturns('p2');
    await this.say(messages);
  }

  async drain(visual) {
    const target = visual.mon.hp;
    const from = visual.hp ?? target;
    if (from === target) return;
    const max = visual.mon.maxhp || 100;
    const pixels = Math.abs(target - from) / max * 48;
    await this.clock.tween(Math.max(250, Math.min(1400, pixels * 28)), progress => {
      visual.hp = from + (target - from) * progress;
    });
    visual.hp = target;
  }

  visualOf(ident) {
    const match = /^(p[12])([a-c])/.exec(String(ident || ''));
    if (match) return this.scene.visual(match[1], match[2].charCodeAt(0) - 97);
    const mon = this.tracker.mon(ident);
    return mon ? this.scene.visual(mon.side, mon.slot) : null;
  }
}

/** FireRed sends the foe out first at the start of a battle ("DOME TRAINER sent out…", then "Go!…"). */
function foeFirst(entries) {
  const start = entries.findIndex(entry => entry.args[0] === 'start');
  if (start < 0) return entries;
  let end = start + 1;
  while (end < entries.length && entries[end].args[0] === 'switch') end++;
  const block = entries.slice(start + 1, end);
  const ordered = [...block.filter(entry => entry.args[1].startsWith('p2')), ...block.filter(entry => !entry.args[1].startsWith('p2'))];
  return [...entries.slice(0, start + 1), ...ordered, ...entries.slice(end)];
}

const MINOR = /^-/;

function isMinor(type) {
  return MINOR.test(type);
}

function isHitPart(entry) {
  const [type] = entry.args;
  if (type === '-damage') return !entry.kwArgs.from;
  return type === '-crit' || type === '-supereffective' || type === '-resisted';
}
