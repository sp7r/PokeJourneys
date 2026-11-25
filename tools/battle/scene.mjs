import {frame, tinted} from './gfx.mjs';
import {ease, lerp} from './anim.mjs';

/**
 * FireRed's battle screen at its native 240x160, drawn from the player's exported cartridge art: the terrain, the
 * Pokémon on their platforms, the healthboxes, and BG0's textbox in its message, command and move views. Positions,
 * fonts and colours are the game's own (see battle-ui.json). Triple Battles, which FireRed never had, use a wider
 * field with a third position on each side.
 */
/** FireRed's own screen: a 112-pixel field above the 48-pixel textbox. */
const FIELD = 112;
const MESSAGE_WIDTH = 224;

/** Battle screen positions per format. Foe slot 0 stands on the right, as Showdown's adjacency expects. */
const LAYOUTS = {
  singles: {
    width: 240,
    p1: [{x: 72, y: 80, box: 'singles-player', at: [126, 72]}],
    p2: [{x: 176, y: 40, box: 'singles-opponent', at: [12, 14]}],
  },
  doubles: {
    width: 240,
    p1: [{x: 32, y: 80, box: 'doubles-player', at: [127, 59]}, {x: 90, y: 88, box: 'doubles-player', at: [139, 84]}],
    p2: [{x: 200, y: 40, box: 'doubles-opponent', at: [12, 3]}, {x: 152, y: 32, box: 'doubles-opponent', at: [0, 28]}],
  },
  triples: {
    width: 304,
    field: 128,
    p1: [{x: 28, y: 96, box: 'doubles-player', at: [200, 58]}, {x: 76, y: 100, box: 'doubles-player', at: [200, 80]},
      {x: 124, y: 104, box: 'doubles-player', at: [200, 102]}],
    p2: [{x: 276, y: 40, box: 'doubles-opponent', at: [0, 0]}, {x: 232, y: 34, box: 'doubles-opponent', at: [12, 22]},
      {x: 188, y: 28, box: 'doubles-opponent', at: [0, 44]}],
  },
};

const TRAINER = {p1: {x: 80, y: 80}, p2: {x: 176, y: 40}};

export class Scene {
  constructor({art, tracker, clock, gameType, gender}) {
    this.art = art;
    this.ui = art.ui;
    this.tracker = tracker;
    this.clock = clock;
    this.layout = LAYOUTS[gameType] || LAYOUTS.singles;
    this.width = this.layout.width;
    this.fieldHeight = this.layout.field || FIELD;
    this.height = this.fieldHeight + 48;
    // How far the player's side sits below FireRed's own positions (triples only).
    this.drop = this.fieldHeight - FIELD;
    this.gender = gender === 'f' ? 'f' : 'm';
    this.visuals = {p1: [], p2: []};
    this.message = {lines: [], chars: 0};
    this.sprites = new Set();
    this.shake = {x: 0, y: 0};
    this.flash = null;
    this.trainers = {p1: {shown: false, dx: 0, frame: 0}, p2: {shown: false, dx: 0, frame: 0}};
    this.terrain = this.pickTerrain();
    this.field = this.makeField();
    this.tints = new WeakMap();
  }

  size() { return [this.width, this.height]; }

  /** The Battle Dome is indoors: FireRed's link-battle room, falling back to its plain building floor. */
  pickTerrain() {
    for (const name of ['link', 'building', 'indoor_1']) {
      const file = this.ui?.terrains?.[name];
      const image = file && this.art.get(typeof file === 'string' ? file : file.file);
      if (image) return image;
    }
    return null;
  }

  /**
   * The terrain as drawn: native for 240x112. For triples the rows are widened with each row's own colour, the foe's
   * platform moves right, and rows between the platforms repeat so the player's platform sits lower.
   */
  makeField() {
    if (!this.terrain || (this.width === 240 && this.fieldHeight === FIELD)) return this.terrain;
    const source = document.createElement('canvas');
    source.width = 240;
    source.height = FIELD;
    const input = source.getContext('2d');
    input.drawImage(this.terrain, 0, 0);
    const pixels = input.getImageData(0, 0, 240, FIELD);
    const canvas = document.createElement('canvas');
    canvas.width = this.width;
    canvas.height = this.fieldHeight;
    const output = canvas.getContext('2d');
    const result = output.createImageData(this.width, this.fieldHeight);
    const shift = this.width - 240;
    const gap = 88;
    for (let y = 0; y < this.fieldHeight; y++) {
      const from = y < gap ? y : Math.max(gap, y - this.drop);
      const counts = new Map();
      for (let x = 0; x < 240; x++) {
        const value = pixel(pixels, x, from);
        counts.set(value, (counts.get(value) || 0) + 1);
      }
      const common = [...counts].sort((a, b) => b[1] - a[1])[0][0];
      for (let x = 0; x < this.width; x++) setPixel(result, x, y, common);
      if (y >= gap && y < gap + this.drop) continue;
      for (let x = 0; x < 240; x++) {
        const value = pixel(pixels, x, from);
        if (value === common) continue;
        const foe = x >= 112 && from < 84;
        setPixel(result, foe ? x + shift : x, y, value);
      }
    }
    output.putImageData(result, 0, 0);
    return canvas;
  }

  visual(side, slot) {
    let visual = this.visuals[side][slot];
    if (!visual) {
      visual = {side, slot, mon: null, shown: false, box: false, hp: 0, dx: 0, dy: 0, scale: 1, alpha: 1, hidden: false,
        tint: null, drop: 0, blink: false};
      this.visuals[side][slot] = visual;
    }
    return visual;
  }

  place(side, slot) {
    return this.layout[side][slot] || this.layout[side][0];
  }

  // Text ------------------------------------------------------------------------------------------------------------

  messageWidth() { return MESSAGE_WIDTH + (this.width - 240) - 4; }

  wrap(text) {
    const font = this.art.font('normal');
    const width = this.messageWidth();
    const measure = value => (font ? font.measure(value) : value.length * 6);
    const lines = [];
    for (const paragraph of String(text).split('\n')) {
      let line = '';
      for (const word of paragraph.split(' ')) {
        const next = line ? `${line} ${word}` : word;
        if (line && measure(next) > width) {
          lines.push(line);
          line = word;
        } else line = next;
      }
      if (line) lines.push(line);
    }
    return lines;
  }

  window(name) { return this.ui?.textbox?.windows?.[name] || null; }

  /** A BG0 window's pixel rectangle on screen; windows right of centre move with the wider triples box. */
  windowRect(name) {
    const info = this.window(name);
    if (!info) return null;
    const scroll = {B_WIN_MSG: 0}[name] ?? (info.tilemapTop >= 40 ? 320 : info.tilemapTop >= 20 ? 160 : 0);
    let x = info.tilemapLeft * 8;
    const y = info.tilemapTop * 8 - scroll + this.drop;
    let w = info.width * 8;
    if (this.width > 240) {
      if (name === 'B_WIN_MSG') w += this.width - 240;
      else if (x >= 120) x += this.width - 240;
    }
    return {x, y, w, h: info.height * 8, info};
  }

  print(name, text, dx = 0, dy = 0, limit = Infinity, colors = null) {
    const rect = this.windowRect(name);
    if (!rect) return;
    const font = this.art.font(rect.info.font === 'FONT_SMALL' ? 'small' : 'normal');
    colors ||= rect.info.colors;
    this.text(text, rect.x + rect.info.x + dx, rect.y + rect.info.y + dy, colors, font, limit);
  }

  text(text, x, y, colors, font, limit = Infinity) {
    if (font) return font.draw(this.context, text, x, y, colors, 0, limit);
    const context = this.context;
    context.font = '11px Pixel, monospace';
    context.textBaseline = 'top';
    context.fillStyle = `rgb(${(colors?.fg || [64, 64, 64]).join(',')})`;
    context.fillText(String(text).slice(0, limit), x, y + 1);
    return context.measureText(text).width;
  }

  fill(name) {
    const rect = this.windowRect(name);
    if (!rect) return;
    this.context.fillStyle = `rgb(${rect.info.fillRgb.join(',')})`;
    this.context.fillRect(rect.x, rect.y, rect.w, rect.h);
  }

  // Drawing ---------------------------------------------------------------------------------------------------------

  draw(context, view, regions) {
    this.context = context;
    this.regions = regions;
    this.now = this.clock.now;
    // Anywhere not covered by an option: hurries the text while a turn plays.
    regions.push({x: 0, y: 0, w: this.width, h: this.height, target: null});
    context.save();
    context.clearRect(0, 0, this.width, this.height);
    context.translate(Math.round(this.shake.x), Math.round(this.shake.y));
    this.drawField();
    this.drawTrainers();
    this.drawMons(view);
    context.restore();
    this.drawSprites();
    this.drawHealthboxes();
    if (this.flash) {
      context.globalAlpha = this.flash.alpha;
      context.fillStyle = this.flash.color;
      context.fillRect(0, 0, this.width, this.fieldHeight);
      context.globalAlpha = 1;
    }
    this.drawTextbox(view);
    if (view.mode === 'party' || view.mode === 'preview') this.drawParty(view);
    if (view.mode === 'yesno') this.drawYesNo(view);
  }

  drawField() {
    const context = this.context;
    if (this.field) context.drawImage(this.field, 0, 0);
    else {
      context.fillStyle = '#f0f0e0';
      context.fillRect(0, 0, this.width, this.fieldHeight);
    }
  }

  drawTrainers() {
    for (const side of ['p2', 'p1']) {
      const trainer = this.trainers[side];
      if (!trainer.shown) continue;
      const info = this.trainerArt(side);
      const image = info && this.art.get(info.file);
      const spot = TRAINER[side];
      const x = Math.round((side === 'p2' ? spot.x + (this.width - 240) : spot.x) + trainer.dx - 32);
      if (!image) continue;
      const y = side === 'p1' ? spot.y + this.drop + (info.yOffset || 0) + 8 - 32 : spot.y - 32;
      this.context.drawImage(image, (trainer.frame || 0) * 64, 0, 64, 64, x, Math.min(y, 104 + this.drop - 32), 64, 64);
    }
  }

  trainerArt(side) {
    const trainers = this.ui?.trainers || {};
    if (side === 'p1') return trainers[this.gender === 'f' ? 'back-leaf' : 'back-red'];
    return trainers['front-cooltrainer-m'];
  }

  /** Where a Pokémon's picture goes: centred on its position, standing on the platform (FireRed's offsets for #1-386). */
  monBox(visual) {
    const mon = visual.mon;
    const back = visual.side === 'p1';
    const entry = this.art.mon(mon.look, back);
    if (!entry.image) return null;
    const place = this.place(visual.side, visual.slot);
    const coords = this.ui?.monCoords?.[mon.look.number];
    const height = entry.image.height;
    const width = entry.image.width;
    let bottom;
    if (back) bottom = Math.min(104 + this.drop, place.y + 8) + 32 - 1;
    else bottom = place.y + 32 - 1 - (coords?.enemyElevation || 0);
    const emptyBelow = height - 1 - entry.bounds.bottom;
    const top = bottom - (height - 1) + emptyBelow;
    return {entry, x: Math.round(place.x - width / 2), y: Math.round(top), width, height, ground: bottom};
  }

  drawMons(view) {
    const targets = view.mode === 'target' ? view.targets : [];
    const chosen = targets[view.cursor];
    const order = [...this.visuals.p2, ...this.visuals.p1].filter(Boolean).sort((a, b) => this.place(a.side, a.slot).y - this.place(b.side, b.slot).y);
    for (const visual of order) {
      if (!visual.shown || !visual.mon || visual.hidden) continue;
      if (chosen && chosen.side === visual.side && chosen.slot === visual.slot && Math.floor(this.now / 133) % 2) continue;
      const box = this.monBox(visual);
      if (!box) continue;
      this.drawMon(visual, box);
      if (targets.length) this.targetRegion(visual, box, targets);
    }
  }

  drawMon(visual, box) {
    const context = this.context;
    let image = box.entry.image;
    if (visual.tint && visual.tint.amount > 0) image = this.tinted(image, visual.tint.color, visual.tint.amount);
    context.save();
    context.globalAlpha = visual.alpha;
    if (visual.drop > 0) {
      // Fainting: the picture sinks below its own ground line and is cut off there.
      context.beginPath();
      context.rect(box.x - 8, 0, box.width + 16, box.ground + 1);
      context.clip();
    }
    const scale = visual.scale;
    const w = box.width * scale;
    const h = box.height * scale;
    const x = box.x + visual.dx + (box.width - w) / 2;
    const y = box.y + visual.dy + (box.height - h) + visual.drop * box.height;
    context.drawImage(image, Math.round(x), Math.round(y), Math.round(w), Math.round(h));
    context.restore();
  }

  targetRegion(visual, box, targets) {
    const index = targets.findIndex(target => target.side === visual.side && target.slot === visual.slot);
    if (index >= 0) this.regions.push({x: box.x, y: box.y, w: box.width, h: box.height, target: index});
  }

  tinted(image, color, amount) {
    let byColor = this.tints.get(image);
    if (!byColor) this.tints.set(image, byColor = new Map());
    const key = `${color}/${Math.round(amount * 8)}`;
    if (!byColor.has(key)) byColor.set(key, tinted(image, color, Math.round(amount * 8) / 8));
    return byColor.get(key);
  }

  drawSprites() {
    const context = this.context;
    for (const sprite of this.sprites) {
      const image = sprite.image;
      if (!image) continue;
      context.save();
      context.globalAlpha = sprite.alpha ?? 1;
      const w = sprite.w;
      const h = sprite.h;
      const scale = sprite.scale ?? 1;
      context.translate(Math.round(sprite.x), Math.round(sprite.y));
      if (sprite.flip) context.scale(-1, 1);
      if (sprite.rotate) context.rotate(sprite.rotate);
      context.drawImage(image, (sprite.frame || 0) * w, 0, w, h, Math.round(-w * scale / 2), Math.round(-h * scale / 2), Math.round(w * scale), Math.round(h * scale));
      context.restore();
    }
  }

  // Healthboxes -----------------------------------------------------------------------------------------------------

  drawHealthboxes() {
    for (const side of ['p2', 'p1']) {
      for (const visual of this.visuals[side]) if (visual?.box && visual.mon) this.drawHealthbox(visual);
    }
  }

  drawHealthbox(visual) {
    const place = this.place(visual.side, visual.slot);
    const info = this.ui?.healthboxes?.[place.box];
    const [left, top] = place.at;
    const x = left + (visual.boxDx || 0);
    const y = top;
    const context = this.context;
    const image = info && this.art.get(info.file);
    const mon = visual.mon;
    if (!image) return this.plainHealthbox(visual, x, y);
    context.drawImage(image, x, y);
    const small = this.art.font('small');
    // The name is printed into a window that covers the box art up to the level field (UpdateNickInHealthbox).
    context.fillStyle = `rgb(${info.nickname.colors.bg.join(',')})`;
    context.fillRect(x + info.nickname.x, y + 5, info.level.x - info.nickname.x, 11);
    const name = this.fit(mon.name.toUpperCase(), info.level.x - info.nickname.x - 8, small);
    let nameEnd = x + info.nickname.x + this.text(name, x + info.nickname.x, y + info.nickname.y, info.nickname.colors, small);
    if (mon.gender && info.gender) {
      const sign = mon.gender === 'F' ? info.gender.female : info.gender.male;
      this.text(sign.glyph, nameEnd, y + info.gender.y, sign, small);
    }
    const digits = String(mon.level);
    const levelX = x + info.level.x + 5 * (3 - digits.length);
    if (small) small.drawGlyph(context, 'Lv', levelX, y + info.level.y, info.level.colors);
    else this.text('Lv', levelX, y + info.level.y, info.level.colors, small);
    this.text(digits, levelX + (info.level.labelAdvance || 8), y + info.level.y, info.level.colors, small);
    this.drawHpBar(x + info.hpBar.x, y + info.hpBar.rows[0], visual.hp, mon.maxhp || 100);
    if (info.hpNumbers) {
      const numbers = info.hpNumbers;
      const current = String(Math.max(0, Math.ceil(visual.hp))).padStart(3, ' ');
      this.text(`${current}/`, x + numbers.current.x, y + numbers.current.y, numbers.colors, small);
      this.text(String(mon.maxhp).padStart(3, ' '), x + numbers.maximum.x, y + numbers.maximum.y, numbers.colors, small);
    }
    const status = this.statusIcon(mon.status);
    if (status && info.status) context.drawImage(this.art.get('status.png'), status.x, status.y, status.width, status.height, x + info.status.x, y + info.status.y, status.width, status.height);
  }

  fit(text, width, font) {
    if (!font) return text.slice(0, 10);
    let fitted = text;
    while (fitted.length > 1 && font.measure(fitted) > width) fitted = fitted.slice(0, -1);
    return fitted;
  }

  statusIcon(status) {
    const icons = this.ui?.status?.icons;
    if (!status || !icons || !this.art.get('status.png')) return null;
    const name = status === 'tox' ? 'PSN' : status.toUpperCase();
    return icons[name] || null;
  }

  /** FireRed's HP bar: whole pixels of 48, coloured by how many are filled (over 24 green, over 9 yellow, else red). */
  drawHpBar(x, y, hp, maxhp) {
    const bars = this.ui?.bars?.hp;
    const length = bars?.length || 48;
    let pixels = Math.floor(Math.max(0, hp) * length / maxhp);
    if (hp > 0) pixels = Math.max(1, pixels);
    const color = pixels > (bars?.thresholds?.greenAbovePixels ?? 24) ? 'green' : pixels > (bars?.thresholds?.yellowAbovePixels ?? 9) ? 'yellow' : 'red';
    const rows = bars?.[color] || [{fill: [112, 248, 168], empty: [80, 104, 88]}];
    const context = this.context;
    rows.forEach((row, index) => {
      context.fillStyle = `rgb(${row.empty.join(',')})`;
      context.fillRect(x, y + index, length, 1);
      context.fillStyle = `rgb(${row.fill.join(',')})`;
      context.fillRect(x, y + index, pixels, 1);
    });
  }

  plainHealthbox(visual, x, y) {
    const context = this.context;
    frame(context, this.art.menu, x, y, 104, 30);
    this.text(`${visual.mon.name.toUpperCase()}  Lv${visual.mon.level}`, x + 8, y + 5, {fg: [64, 64, 64], shadow: [216, 216, 216]}, this.art.font('small'));
    this.drawHpBar(x + 40, y + 20, visual.hp, visual.mon.maxhp || 100);
  }

  // Textbox and menus -----------------------------------------------------------------------------------------------

  /** BG0 at its scroll for the current mode (message 0, commands 160, moves 320), widened for triples. */
  drawBox(view) {
    const image = this.art.get('textbox.png');
    const scroll = this.ui?.textbox?.scrollY || {message: 0, action: 160, move: 320};
    const y = view === 'action' ? scroll.action : view === 'moves' ? scroll.move : scroll.message;
    const context = this.context;
    if (!image) {
      context.fillStyle = '#28506b';
      context.fillRect(0, this.fieldHeight, this.width, this.height - this.fieldHeight);
      return;
    }
    // The textbox is BG0's bottom 48 rows (FIELD..160 of the view), drawn under the field.
    const top = y + FIELD;
    const rows = 160 - FIELD;
    const at = this.fieldHeight;
    if (this.width === 240) {
      context.drawImage(image, 0, top, 240, rows, 0, at, 240, rows);
      return;
    }
    const extra = this.width - 240;
    context.drawImage(image, 0, top, 120, rows, 0, at, 120, rows);
    for (let column = 0; column < extra; column++) context.drawImage(image, 119, top, 1, rows, 120 + column, at, 1, rows);
    context.drawImage(image, 120, top, 120, rows, 120 + extra, at, 120, rows);
  }

  drawTextbox(view) {
    const mode = view.mode;
    if (mode === 'action') return this.drawActions(view);
    if (mode === 'moves' || mode === 'target') return this.drawMoves(view);
    this.drawBox('message');
    let lines = this.message.lines;
    let chars = this.message.chars;
    if (['notice', 'yesno', 'ended', 'party', 'preview'].includes(mode)) {
      const text = mode === 'yesno' ? view.prompt.join(' ') : mode === 'party' || mode === 'preview' ? view.title : view.text;
      lines = this.wrap(text).slice(0, 2);
      chars = Infinity;
      this.regions.push({x: 0, y: this.fieldHeight, w: this.width, h: this.height - this.fieldHeight, target: mode === 'notice' || mode === 'ended' ? 'accept' : null});
    }
    let remaining = chars;
    lines.forEach((line, index) => {
      this.print('B_WIN_MSG', line, 0, index * 16, remaining);
      remaining -= line.length;
    });
  }

  drawActions(view) {
    this.drawBox('action');
    this.print('B_WIN_ACTION_PROMPT', view.prompt[0]);
    this.print('B_WIN_ACTION_PROMPT', view.prompt[1], 0, 16);
    // Touch: the prompt box steps back to the previous Pokémon's command in Double and Triple Battles.
    const prompt = this.windowRect('B_WIN_ACTION_PROMPT');
    if (prompt && view.slot > 0) this.regions.push({x: prompt.x, y: prompt.y, w: prompt.w, h: prompt.h, target: 'back'});
    this.fill('B_WIN_ACTION_MENU');
    const rect = this.windowRect('B_WIN_ACTION_MENU');
    if (!rect) return;
    for (let index = 0; index < 4; index++) this.cursor(rect.x - 8 + (index % 2) * 56, rect.y + Math.floor(index / 2) * 16, true);
    view.options.forEach((label, index) => {
      const dx = (index % 2) * 56;
      const dy = Math.floor(index / 2) * 16;
      this.print('B_WIN_ACTION_MENU', label, dx, dy);
      this.regions.push({x: rect.x + dx - 8, y: rect.y + dy, w: 56, h: 16, target: index});
    });
    this.cursor(rect.x - 8 + (view.cursor % 2) * 56, rect.y + Math.floor(view.cursor / 2) * 16);
  }

  drawMoves(view) {
    this.drawBox('moves');
    const names = ['B_WIN_MOVE_NAME_1', 'B_WIN_MOVE_NAME_2', 'B_WIN_MOVE_NAME_3', 'B_WIN_MOVE_NAME_4'];
    const moves = view.moves || this.lastMoves || [];
    if (view.moves) this.lastMoves = view.moves;
    names.forEach((name, index) => {
      this.fill(name);
      const move = moves[index];
      this.print(name, move ? move.name.toUpperCase() : '-');
      const rect = this.windowRect(name);
      if (rect && move && view.mode === 'moves') this.regions.push({x: rect.x - 8, y: rect.y, w: rect.w + 8, h: 16, target: index});
    });
    for (const name of names) {
      const rect = this.windowRect(name);
      if (rect) this.cursor(rect.x - 8, rect.y, true);
    }
    const cursor = view.mode === 'moves' ? view.cursor : this.lastMoveCursor || 0;
    if (view.mode === 'moves') this.lastMoveCursor = view.cursor;
    const first = this.windowRect(names[cursor]);
    if (first) this.cursor(first.x - 8, first.y);
    const selected = moves[cursor];
    for (const name of ['B_WIN_PP', 'B_WIN_PP_REMAINING', 'B_WIN_MOVE_TYPE']) this.fill(name);
    // Touch: the PP and type box goes back to FIGHT / BAG / POKéMON / RUN, as B does.
    const info = this.windowRect('B_WIN_PP');
    if (info && view.mode === 'moves') this.regions.push({x: info.x - 4, y: info.y - 4, w: this.width - info.x, h: 40, target: 'back'});
    if (!selected) return;
    const ppColors = this.ppColors(selected.pp, selected.maxpp);
    this.print('B_WIN_PP', 'PP', 0, 0, Infinity, ppColors);
    const pp = `${String(selected.pp ?? '--').padStart(2, ' ')}/${String(selected.maxpp ?? '--').padStart(2, ' ')}`;
    this.print('B_WIN_PP_REMAINING', pp, 0, 0, Infinity, ppColors);
    this.print('B_WIN_MOVE_TYPE', `TYPE/${selected.type.toUpperCase()}`);
    if (view.mode === 'target') this.regions.push({x: 0, y: this.fieldHeight, w: this.width, h: this.height - this.fieldHeight, target: 'back'});
  }

  /** FireRed's PP colours (GetCurrentPpToMaxPpState): normal, then yellow, orange and red as PP runs out. */
  ppColors(current, max) {
    const states = this.ui?.textbox?.palettes?.ppStates;
    if (!states || current === undefined || !max) return null;
    let state;
    if (current === max) state = 3;
    else if (max <= 2) state = current > 1 ? 3 : 2 - current;
    else if (max <= 7) state = current > 2 ? 3 : 2 - current;
    else if (current === 0) state = 2;
    else if (current <= Math.floor(max / 4)) state = 1;
    else if (current > Math.floor(max / 2)) state = 3;
    else state = 0;
    return states.find(entry => entry.state === state) || null;
  }

  /** The battle menu cursor: FireRed's own textbox tiles when exported, otherwise the font's arrow. */
  cursor(x, y, blank = false) {
    const image = this.art.get(blank ? 'cursor-blank.png' : 'cursor.png');
    if (blank) {
      if (image) this.context.drawImage(image, x, y);
      return;
    }
    if (image) {
      this.context.drawImage(image, x, y);
      return;
    }
    const menu = this.window('B_WIN_ACTION_MENU');
    this.text('▶', x, y + 2, menu?.colors || {fg: [74, 74, 74], shadow: [214, 214, 206]}, this.art.font('normal'));
  }

  /** The party list for switching and team preview, in FireRed menu windows over the field. */
  drawParty(view) {
    const context = this.context;
    const small = this.art.font('small');
    const normal = this.art.font('normal');
    const dark = {fg: [74, 74, 74], shadow: [214, 214, 206]};
    const dim = {fg: [160, 160, 160], shadow: [224, 224, 216]};
    const left = 0;
    const columns = 2;
    const width = Math.floor((this.width - left) / columns);
    const height = Math.floor(this.fieldHeight / 3);
    view.rows.forEach((mon, index) => {
      const x = left + (index % columns) * width;
      const y = Math.floor(index / columns) * height;
      frame(context, this.art.menu, x, y, width, height);
      const colors = mon.enabled || view.mode === 'preview' ? dark : dim;
      if (index === view.cursor) this.text('▶', x + 4, y + 5, dark, normal);
      this.text(this.fit(mon.name.toUpperCase(), width - 60, small), x + 14, y + 4, colors, small);
      this.text(`Lv${mon.level}`, x + width - 34, y + 4, colors, small);
      this.drawHpBar(x + 14, y + 22, mon.hp, mon.maxhp || 1);
      const status = mon.fainted ? 'FNT' : (mon.status || '').toUpperCase();
      this.text(`${mon.hp}/${mon.maxhp} ${status}`, x + 66, y + 17, colors, small);
      if (mon.lead) this.text(String(mon.lead), x + width - 12, y + 18, dark, small);
      this.regions.push({x, y, w: width, h: height, target: index});
    });
    if (view.cancel) {
      const x = this.width - 64;
      frame(context, this.art.menu, x - 8, this.fieldHeight + 8, 68, 32);
      const label = view.mode === 'preview' ? 'CONFIRM' : 'CANCEL';
      if (view.cursor === view.rows.length) this.text('▶', x - 3, this.fieldHeight + 17, dark, normal);
      this.text(label, x + 6, this.fieldHeight + 17, view.mode === 'preview' && !view.ready ? dim : dark, normal);
      this.regions.push({x, y: this.fieldHeight + 8, w: 60, h: 32, target: view.rows.length});
    }
  }

  drawYesNo(view) {
    const x = this.width - 56;
    const y = this.fieldHeight - 44;
    const dark = {fg: [74, 74, 74], shadow: [214, 214, 206]};
    const normal = this.art.font('normal');
    frame(this.context, this.art.menu, x, y, 48, 40);
    ['YES', 'NO'].forEach((label, index) => {
      if (index === view.cursor) this.text('▶', x + 6, y + 6 + index * 15, dark, normal);
      this.text(label, x + 16, y + 6 + index * 15, dark, normal);
      this.regions.push({x, y: y + 4 + index * 15, w: 48, h: 15, target: index});
    });
  }

  // Animations used by playback --------------------------------------------------------------------------------------

  async introSlide() {
    const travel = this.width;
    await this.clock.tween(900, progress => {
      const offset = (1 - ease.out(progress)) * travel;
      this.trainers.p1.dx = offset;
      this.trainers.p2.dx = -offset;
    });
  }

  async trainerLeaves(side) {
    const trainer = this.trainers[side];
    if (side === 'p1') {
      for (let step = 1; step < 5; step++) {
        trainer.frame = step;
        await this.clock.wait(70);
      }
    }
    await this.clock.tween(350, progress => { trainer.dx = (side === 'p1' ? -1 : 1) * progress * 120; });
    trainer.shown = false;
    trainer.frame = 0;
    trainer.dx = 0;
  }

  async trainerReturns(side) {
    const trainer = this.trainers[side];
    trainer.shown = true;
    trainer.frame = 0;
    await this.clock.tween(450, progress => { trainer.dx = (1 - ease.out(progress)) * 120 * (side === 'p1' ? -1 : 1); });
  }

  ballSprite(frameIndex = 0) {
    const info = this.ui?.ball;
    const image = info && this.art.get(info.file);
    if (!image) return null;
    return {image, w: info.frameWidth, h: info.frameHeight, frame: frameIndex, x: 0, y: 0};
  }

  /** Throw a Poké Ball (or let it appear at the spot for the foe), burst it open and grow the Pokémon out of it. */
  async sendOut(visual, thrown) {
    const place = this.place(visual.side, visual.slot);
    visual.hp = visual.mon.hp;
    visual.drop = 0;
    visual.dx = 0;
    visual.dy = 0;
    const ball = this.ballSprite(0);
    const landX = place.x;
    const landY = place.y + 12;
    if (ball) {
      this.sprites.add(ball);
      const startX = visual.side === 'p1' ? -8 : this.width + 8;
      const startY = visual.side === 'p1' ? 96 : 20;
      if (thrown) {
        await this.clock.tween(420, progress => {
          ball.x = lerp(startX, landX, progress);
          ball.y = lerp(startY, landY, progress) - Math.sin(progress * Math.PI) * 36;
          ball.frame = Math.floor(progress * 6) % 2;
        });
      } else {
        ball.x = landX;
        ball.y = landY;
      }
      ball.frame = 2;
      this.burst(landX, landY);
      await this.clock.wait(60);
      this.sprites.delete(ball);
    }
    visual.shown = true;
    visual.tint = {color: '#ffffff', amount: 1};
    await this.clock.tween(320, progress => {
      visual.scale = Math.max(.05, ease.out(progress));
      visual.tint.amount = 1 - progress * .5;
    });
    visual.scale = 1;
    await this.clock.tween(160, progress => { visual.tint.amount = .5 * (1 - progress); });
    visual.tint = null;
    visual.box = true;
  }

  /** The Poké Ball's opening sparks (sAnim_RegularBall) spreading out from where it opened. */
  burst(x, y) {
    const info = this.ui?.ball?.particles;
    const image = info && this.art.get(info.file);
    if (!image) return;
    const pieces = Array.from({length: 8}, (_, index) => ({image, w: info.frameWidth, h: info.frameHeight, frame: 0, x, y, angle: index * Math.PI / 4}));
    for (const piece of pieces) this.sprites.add(piece);
    this.clock.tween(360, progress => {
      for (const piece of pieces) {
        piece.x = x + Math.cos(piece.angle) * progress * 22;
        piece.y = y + Math.sin(piece.angle) * progress * 16;
        piece.frame = [0, 1, 2, 0, 2, 1][Math.min(5, Math.floor(progress * 6))];
        piece.alpha = 1 - progress * .6;
      }
    }).then(() => { for (const piece of pieces) this.sprites.delete(piece); });
  }

  async recall(visual) {
    visual.box = false;
    visual.tint = {color: '#f83030', amount: 0};
    await this.clock.tween(320, progress => {
      visual.tint.amount = Math.min(1, progress * 2);
      visual.scale = Math.max(.05, 1 - ease.in(progress));
    });
    visual.shown = false;
    visual.scale = 1;
    visual.tint = null;
  }

  async faint(visual) {
    visual.box = false;
    await this.clock.wait(150);
    await this.clock.tween(380, progress => { visual.drop = ease.in(progress); });
    visual.shown = false;
    visual.drop = 0;
  }

  /** FireRed's damage flicker: the Pokémon blinks off and on for about half a second. */
  async flicker(visual) {
    await this.clock.tween(480, progress => { visual.hidden = Math.floor(progress * 8) % 2 === 1 && progress < 1; });
    visual.hidden = false;
  }

  monCenter(visual) {
    const box = visual.mon && this.monBox(visual);
    const place = this.place(visual.side, visual.slot);
    if (!box) return {x: place.x, y: place.y};
    const bounds = box.entry.bounds;
    return {x: box.x + (bounds.left + bounds.right) / 2, y: box.y + (bounds.top + bounds.bottom) / 2, top: box.y + bounds.top, ground: box.ground};
  }
}

function pixel(image, x, y) {
  const index = (y * image.width + x) * 4;
  const data = image.data;
  return (data[index] << 24 | data[index + 1] << 16 | data[index + 2] << 8 | data[index + 3]) >>> 0;
}

function setPixel(image, x, y, value) {
  if (x < 0 || x >= image.width) return;
  const index = (y * image.width + x) * 4;
  image.data[index] = value >>> 24 & 255;
  image.data[index + 1] = value >>> 16 & 255;
  image.data[index + 2] = value >>> 8 & 255;
  image.data[index + 3] = value & 255;
}
