import {Screen} from './screen.mjs';
import {loadArt, frame} from './gfx.mjs';

/**
 * The lower screen during a battle: the battle log in FireRed's windows and font, every message so far grouped by
 * turn, newest at the bottom. Commands are given on the top screen (keys or touch); this screen only offers to give
 * up, or to return to the hub once the battle is over. Drag the log to scroll back.
 */
const TEXT = {fg: [72, 72, 72], shadow: [208, 208, 200]};
const TURN = {fg: [56, 88, 176], shadow: [184, 200, 232]};
const LINE = 16;

export class Panel {
  constructor({send}) {
    this.send = send;
    this.state = null;
    this.art = null;
    this.scroll = 0;
    this.seen = 0;
    loadArt(() => '').then(art => { this.art = art; });
    this.screen = new Screen({
      size: (pixelsWide, pixelsHigh) => {
        const scale = Math.max(2, Math.floor(Math.min(pixelsWide / 256, pixelsHigh / 192)));
        return [Math.floor(pixelsWide / scale), Math.floor(pixelsHigh / scale)];
      },
      draw: (context, regions) => this.draw(context, regions),
      onTap: target => { if (target === 'quit') this.send({type: 'quit'}); },
      onDrag: rows => { this.scroll = Math.max(0, Math.min(this.maxScroll || 0, this.scroll + rows / LINE)); },
    });
  }

  mount(parent) { this.screen.mount(parent); }

  show(state) {
    this.state = state;
    const count = state.log?.length || 0;
    // Stay on the newest line unless the player has scrolled back.
    if (count !== this.seen && this.scroll < 1) this.scroll = 0;
    this.seen = count;
  }

  draw(context, regions) {
    const {width, height} = context.canvas;
    context.fillStyle = '#284858';
    context.fillRect(0, 0, width, height);
    if (!this.state || !this.art) return;
    const font = this.art.font('normal');
    const ended = this.state.ui?.mode === 'ended';
    const battle = this.state.battle;
    frame(context, this.art.menu, 4, 4, width - 8, 26);
    const title = battle ? `${battle.format.name.replace(/^\[Gen \d\] /, '').toUpperCase()}` : 'BATTLE DOME';
    this.text(context, font, title, 14, 9, TEXT);
    const turn = this.state.turn ? `TURN ${this.state.turn}` : '';
    if (turn) this.text(context, font, turn, width - 14 - this.measure(font, turn), 9, TEXT);
    const buttonHeight = 24;
    const logTop = 34;
    const logHeight = height - logTop - buttonHeight - 8;
    frame(context, this.art.menu, 4, logTop, width - 8, logHeight);
    if (this.state.ui?.mode === 'preview') this.drawFoes(context, font, 14, logTop + 6);
    else this.drawLog(context, font, 14, logTop + 6, width - 28, logHeight - 12);
    if (ended) this.button(context, font, regions, 4, height - buttonHeight - 4, width - 8, buttonHeight, 'RETURN TO HUB');
    else this.button(context, font, regions, width - 96, height - buttonHeight - 4, 92, buttonHeight, 'GIVE UP');
  }

  /** Team preview: the opposing team, so the top screen has room for the player's whole team. */
  drawFoes(context, font, x, y) {
    this.text(context, font, 'FOE TEAM', x, y, TURN);
    (this.state.battle?.previewTeam || []).forEach((mon, index) => this.text(context, font, mon.name.toUpperCase(), x, y + (index + 1) * LINE + 4, TEXT));
  }

  /** The log as wrapped lines, rebuilt only when a message arrives. */
  rows(font, width) {
    const log = this.state.log || [];
    const key = `${log.length}/${log.at(-1)?.text || log.at(-1)?.turn || ''}/${width}`;
    if (this.rowsKey === key) return this.rowsCache;
    const rows = [];
    for (const entry of log) {
      if (entry.turn) rows.push({text: `TURN ${entry.turn}`, colors: TURN});
      else for (const line of this.wrap(font, entry.text, width)) rows.push({text: line, colors: TEXT});
    }
    this.rowsKey = key;
    this.rowsCache = rows;
    return rows;
  }

  drawLog(context, font, x, y, width, height) {
    const rows = this.rows(font, width);
    const visible = Math.max(1, Math.floor(height / LINE));
    this.maxScroll = Math.max(0, rows.length - visible);
    const first = Math.max(0, rows.length - visible - Math.round(this.scroll));
    context.save();
    context.beginPath();
    context.rect(x - 4, y - 2, width + 8, height + 4);
    context.clip();
    rows.slice(first, first + visible).forEach((row, index) => this.text(context, font, row.text, x, y + index * LINE, row.colors));
    context.restore();
  }

  wrap(font, text, width) {
    const lines = [];
    let line = '';
    for (const word of String(text).split(' ')) {
      const next = line ? `${line} ${word}` : word;
      if (line && this.measure(font, next) > width) {
        lines.push(line);
        line = word;
      } else line = next;
    }
    if (line) lines.push(line);
    return lines;
  }

  measure(font, text) { return font ? font.measure(text) : text.length * 6; }

  text(context, font, text, x, y, colors) {
    if (font) return font.draw(context, text, x, y, colors);
    context.fillStyle = `rgb(${colors.fg.join(',')})`;
    context.font = '12px Pixel, monospace';
    context.textBaseline = 'top';
    context.fillText(text, x, y + 2);
    return context.measureText(text).width;
  }

  button(context, font, regions, x, y, w, h, label) {
    frame(context, this.art.menu, x, y, w, h);
    this.text(context, font, label, x + Math.floor((w - this.measure(font, label)) / 2), y + 5, TEXT);
    regions.push({x, y, w, h, target: 'quit'});
  }
}
