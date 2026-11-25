/**
 * FireRed's battle command flow: FIGHT / BAG / POKéMON / RUN, the four-move list, target choice, the party list and
 * YES/NO prompts. Keys, taps on the top screen and taps on the lower screen all drive this one state, which builds a
 * Showdown choice per active Pokémon and submits them together.
 */
const ACTIONS = ['FIGHT', 'BAG', 'POKéMON', 'RUN'];

export class Commands {
  constructor({choose, forfeit, quit, changed}) {
    this.choose = choose;
    this.forfeit = forfeit;
    this.quit = quit;
    this.changed = changed;
    this.mode = 'wait';
    this.actionCursor = [];
    this.moveCursor = [];
  }

  /** A new request is ready (the previous turn has finished playing). */
  start(battle) {
    this.battle = battle;
    this.choices = [];
    this.leads = [];
    this.notice = null;
    this.prompt = null;
    if (battle.ended) return this.set('ended');
    if (battle.wait) return this.set('wait');
    if (battle.preview) return this.set('preview', {cursor: 0});
    this.slot = -1;
    this.next();
  }

  stop() { this.set('wait'); }

  finish(text) {
    this.endText = text;
    this.set('ended');
  }

  set(mode, extra = {}) {
    this.mode = mode;
    Object.assign(this, {cursor: 0, ...extra});
    this.changed();
  }

  get slotInfo() { return this.battle.slots[this.slot]; }

  /** Move on to the next Pokémon that needs a command, or submit the turn. */
  next() {
    const slots = this.battle.slots;
    let slot = this.slot + 1;
    while (slot < slots.length && slots[slot].pass) {
      this.choices[slot] = {choice: 'pass'};
      slot++;
    }
    if (slot >= slots.length) {
      this.set('wait');
      this.choose(this.choices.map(entry => entry.choice).join(', '), this.battle.sequence);
      return;
    }
    this.slot = slot;
    if (slots[slot].forceSwitch) this.openParty(false);
    else this.set('action', {cursor: this.actionCursor[slot] || 0});
  }

  /** B on the first Pokémon's menu offers to leave; on a later Pokémon it returns to the previous one's command. */
  previous() {
    let slot = this.slot - 1;
    while (slot >= 0 && this.battle.slots[slot].pass) slot--;
    if (slot < 0) return this.askForfeit();
    this.choices.length = slot;
    this.slot = slot;
    if (this.battle.slots[slot].forceSwitch) this.openParty(false);
    else this.set('action', {cursor: this.actionCursor[slot] || 0});
  }

  pick(choice, flags = {}) {
    this.choices[this.slot] = {choice, ...flags};
    this.next();
  }

  used(kind) { return this.choices.some(entry => entry?.[kind]); }

  view() {
    const battle = this.battle;
    const base = {mode: this.mode, cursor: this.cursor};
    switch (this.mode) {
    case 'action': {
      const info = this.slotInfo;
      const options = [...ACTIONS];
      if (info.shift) options[1] = 'SHIFT';
      return {...base, slot: this.slot, prompt: ['What will', `${info.name.toUpperCase()} do?`], options};
    }
    case 'moves': {
      const known = this.slotInfo.known;
      const moves = [0, 1, 2, 3].map(i => known[i] || null);
      return {...base, slot: this.slot, moves, selected: moves[this.cursor]};
    }
    case 'target': return {...base, slot: this.slot, targets: this.targets.map(target => target.target), move: this.targets[0].name};
    case 'party': case 'preview': return {...base, ...this.partyView()};
    case 'yesno': return {...base, prompt: this.prompt.lines};
    case 'notice': return {...base, text: this.notice.text};
    case 'ended': return {...base, text: this.endText || ''};
    default: return base;
    }
  }

  // Party list ---------------------------------------------------------------------------------------------------

  openParty(cancel) {
    this.set('party', {cursor: 0, cancel});
  }

  partyView() {
    const team = this.battle.player.team;
    const preview = this.mode === 'preview';
    const taken = new Set(this.choices.map(entry => entry?.switchTo).filter(Boolean));
    const rows = team.map(mon => ({
      ...mon,
      enabled: preview ? true : !mon.active && !mon.fainted && !taken.has(mon.slot),
      lead: preview ? this.leads.indexOf(mon.slot) + 1 : 0,
    }));
    const count = this.battle.player.active.length || 1;
    const title = preview ? (count > 1 ? `Choose lead POKéMON ${this.leads.length + 1} of ${count}.` : 'Choose the POKéMON to lead.')
      : 'Choose a POKéMON.';
    // Team preview ends with CONFIRM, usable once every lead is picked.
    const ready = preview && this.leads.length >= this.leadCount();
    return {rows, title: ready ? 'Ready to battle?' : title, cancel: preview ? true : !!this.cancel, confirm: preview, ready};
  }

  partyAccept() {
    const {rows, cancel} = this.partyView();
    if (cancel && this.cursor === rows.length) return this.mode === 'preview' ? this.confirmLeads() : this.partyBack();
    const row = rows[this.cursor];
    if (!row) return;
    if (this.mode === 'preview') return this.addLead(row);
    if (row.fainted) return this.say(`${row.name.toUpperCase()} has no energy left to battle!`);
    if (!row.enabled) return this.say(`${row.name.toUpperCase()} is already in battle!`);
    if (this.slotInfo.trapped && !this.slotInfo.forceSwitch) return this.say(`${this.slotInfo.name.toUpperCase()} can’t be switched out!`);
    this.pick(`switch ${row.slot}`, {switchTo: row.slot});
  }

  leadCount() {
    return Math.min(this.battle.player.active.length || 1, this.battle.player.team.length);
  }

  /** Picking a lead toggles it; once every lead is picked the cursor moves to CONFIRM. */
  addLead(row) {
    const at = this.leads.indexOf(row.slot);
    if (at >= 0) this.leads.splice(at, 1);
    else if (this.leads.length < this.leadCount()) this.leads.push(row.slot);
    const done = this.leads.length >= this.leadCount();
    this.set('preview', {cursor: done ? this.battle.player.team.length : this.cursor});
  }

  confirmLeads() {
    if (this.leads.length < this.leadCount()) return;
    const order = [...this.leads, ...this.battle.player.team.map(mon => mon.slot).filter(slot => !this.leads.includes(slot))];
    this.set('wait');
    this.choose(`team ${order.join('')}`, this.battle.sequence);
  }

  partyBack() {
    if (this.mode === 'preview') {
      if (this.leads.length) this.leads.pop();
      return this.set('preview', {cursor: 0});
    }
    if (this.cancel) this.set('action', {cursor: 2});
    // A forced switch has no CANCEL; B offers to give up instead, so the controller can always leave.
    else this.askForfeit();
  }

  // Moves and targets ---------------------------------------------------------------------------------------------

  pickMove(index) {
    const info = this.slotInfo;
    const known = info.known[index];
    if (!known) return;
    if (known.disabled) {
      return this.say(known.pp === 0 ? 'There’s no PP left for this move!' : `${info.name.toUpperCase()}’s ${known.name.toUpperCase()} is disabled!`);
    }
    const normal = info.moves.filter(move => move.slot === known.slot && move.modifier === '');
    const zmove = info.moves.filter(move => move.slot === known.slot && move.modifier === 'zmove');
    if (zmove.length && !this.used('z')) {
      return this.ask(['Use the Z-Power', `${zmove[0].name.toUpperCase()}?`], yes => this.targetsFor(yes ? zmove : normal, yes),
        'moves');
    }
    if (!normal.length) return this.say('This move can’t be used now!');
    this.targetsFor(normal, false);
  }

  targetsFor(options, z) {
    if (!options.length) return this.set('moves', {cursor: this.moveCursor[this.slot] || 0});
    if (options.length === 1) return this.afterMove(options[0], z);
    const ordered = [...options].sort((a, b) => order(a) - order(b));
    this.targets = ordered.map(option => ({...option, target: targetOf(option)}));
    this.zTarget = z;
    this.set('target', {cursor: 0});
  }

  afterMove(option, z) {
    const info = this.slotInfo;
    if (z) return this.pick(option.choice, {z: true});
    for (const [kind, flag, question] of [['mega', 'mega', 'Mega Evolve'], ['ultra', 'ultra', 'Ultra Burst']]) {
      if (info[flag] && !this.used(kind)) {
        return this.ask([`${question}`, `${info.name.toUpperCase()}?`], yes => this.pick(yes ? `${option.choice} ${kind}` : option.choice,
          yes ? {[kind]: true} : {}), 'moves');
      }
    }
    this.pick(option.choice);
  }

  // Prompts -------------------------------------------------------------------------------------------------------

  say(text) {
    this.notice = {text, back: this.mode, cursor: this.cursor};
    this.set('notice');
  }

  ask(lines, answer, back, cursor = 0) {
    this.prompt = {lines, answer, back, cursor: this.cursor};
    this.set('yesno', {cursor});
  }

  askForfeit() {
    const back = this.mode === 'party' ? 'party' : this.mode === 'wait' ? 'wait' : 'action';
    this.ask(['Give up this battle and', 'return to the hub?'], yes => {
      if (yes) this.forfeit();
      else if (back === 'wait') this.set('wait');
      else if (back === 'party') this.set('party', {cursor: 0, cancel: false});
      else this.set('action', {cursor: this.actionCursor[this.slot] || 0});
    }, back, 1);
  }

  answer(yes) {
    const {answer, back, cursor} = this.prompt;
    if (yes === null) {
      if (back === 'action') return this.set('action', {cursor: this.actionCursor[this.slot] || 3});
      return this.set(back, {cursor});
    }
    answer(yes);
  }

  // Input ---------------------------------------------------------------------------------------------------------

  act(index) {
    this.actionCursor[this.slot] = index;
    const info = this.slotInfo;
    if (index === 0) return this.set('moves', {cursor: Math.min(this.moveCursor[this.slot] || 0, Math.max(0, info.known.length - 1))});
    if (index === 1) return info.shift ? this.pick('shift') : this.say('Items can’t be used in the BATTLE DOME.');
    if (index === 2) return this.openParty(true);
    return this.askForfeit();
  }

  /** A tap on an option the screen drew: select it, then accept it. */
  tap(index) {
    if (this.mode === 'notice' || this.mode === 'ended') return this.key('accept');
    if (index === 'back') return this.key('back');
    if (typeof index !== 'number') return;
    this.cursor = index;
    this.key('accept');
  }

  key(name) {
    const handler = {
      action: () => this.grid(name, 4, () => this.act(this.cursor), () => this.previous()),
      // FireRed keeps each Pokémon's move cursor, also after backing out with B.
      moves: () => this.grid(name, Math.max(1, this.slotInfo.known.length), () => {
        this.moveCursor[this.slot] = this.cursor;
        this.pickMove(this.cursor);
      }, () => {
        this.moveCursor[this.slot] = this.cursor;
        this.set('action', {cursor: 0});
      }),
      target: () => this.list(name, this.targets.length, () => this.afterMove(this.targets[this.cursor], this.zTarget),
        () => this.set('moves', {cursor: this.moveCursor[this.slot] || 0}), true),
      party: () => this.partyGrid(name, this.partyView().rows.length, this.cancel),
      preview: () => this.partyGrid(name, this.partyView().rows.length, true),
      yesno: () => this.list(name, 2, () => this.answer(this.cursor === 0), () => this.answer(null)),
      notice: () => {
        if (name !== 'accept' && name !== 'back') return;
        const {back, cursor} = this.notice;
        this.set(back, {cursor});
      },
      ended: () => { if (name === 'accept' || name === 'back') this.quit(); },
      wait: () => { if (name === 'back' && this.battle) this.askForfeit(); },
    }[this.mode];
    handler?.();
  }

  /** The 2x2 grids: FIGHT/BAG/POKéMON/RUN and the four moves. */
  grid(name, count, accept, back) {
    if (name === 'accept') return accept();
    if (name === 'back') return back();
    const column = this.cursor % 2;
    const row = Math.floor(this.cursor / 2);
    const moved = {left: row * 2, right: row * 2 + 1, up: column, down: 2 + column}[name];
    if (moved !== undefined && moved < count) {
      this.cursor = moved;
      this.changed();
    }
  }

  /** The party's two columns: left/right within a row, up/down between rows, CANCEL after the last row. */
  partyGrid(name, rows, cancel) {
    if (name === 'accept') return this.partyAccept();
    if (name === 'back') return this.partyBack();
    const last = rows - 1 + (cancel ? 1 : 0);
    let next = this.cursor;
    if (this.cursor === rows) next = name === 'up' ? rows - 1 : name === 'down' ? 0 : this.cursor;
    else if (name === 'left') next = this.cursor % 2 ? this.cursor - 1 : this.cursor;
    else if (name === 'right') next = this.cursor % 2 === 0 && this.cursor + 1 < rows ? this.cursor + 1 : this.cursor;
    else if (name === 'up') next = this.cursor - 2 >= 0 ? this.cursor - 2 : this.cursor;
    else if (name === 'down') next = this.cursor + 2 < rows ? this.cursor + 2 : cancel ? rows : this.cursor;
    if (next !== this.cursor && next >= 0 && next <= last) {
      this.cursor = next;
      this.changed();
    }
  }

  list(name, count, accept, back, sideways = false) {
    if (name === 'accept') return accept();
    if (name === 'back') return back();
    const step = {up: -1, down: 1, ...(sideways ? {left: -1, right: 1} : {})}[name];
    if (!step || count < 2) return;
    this.cursor = (this.cursor + step + count) % count;
    this.changed();
  }
}

/** A move's target as a screen position: foe slots are shown mirrored, so the order runs left to right on screen. */
function targetOf(option) {
  return option.location > 0 ? {side: 'p2', slot: option.location - 1, name: option.targetName}
    : {side: 'p1', slot: -option.location - 1, name: option.targetName};
}

function order(option) {
  return option.location > 0 ? -option.location : 10 - option.location;
}
