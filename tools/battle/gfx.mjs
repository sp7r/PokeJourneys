/**
 * The player's own FireRed art, read at runtime from the hub data the app exported from their cartridge
 * (`ui/firered-battle`, served at /theme/battle/). Nothing here ships in the app. When the export is missing, the
 * battle still draws with plain shapes and the bundled pixel font.
 */
const ROOT = '/theme/battle/';

function image(src) {
  return new Promise(resolve => {
    const element = new Image();
    element.onload = () => resolve(element);
    element.onerror = () => resolve(null);
    element.src = src;
  });
}

async function json(src) {
  try {
    const response = await fetch(src);
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
}

export async function loadArt(spriteName) {
  const ui = await json(`${ROOT}battle-ui.json`);
  const art = new Art(ui, spriteName);
  if (ui) await art.preload();
  return art;
}

export class Art {
  constructor(ui, spriteName) {
    this.ui = ui;
    this.spriteName = spriteName;
    this.images = {};
    this.fonts = {};
    this.mons = new Map();
    this.menu = null;
  }

  async preload() {
    const files = new Set(['textbox.png', 'cursor.png', 'cursor-blank.png', 'status.png', 'ball-poke.png', 'ball-poke-particles.png',
      'font-normal.png', 'font-small.png']);
    for (const box of Object.values(this.ui.healthboxes || {})) if (box.file) files.add(box.file);
    for (const anim of Object.values(this.ui.anims || {})) if (anim.file) files.add(anim.file);
    for (const name of ['trainer-back-red.png', 'trainer-back-leaf.png', 'trainer-front-cooltrainer-m.png', 'trainer-front-cooltrainer-f.png']) files.add(name);
    for (const terrain of Object.values(this.ui.terrains || {})) if (terrain.file) files.add(terrain.file);
    const loaded = await Promise.all([...files].map(async name => [name, await image(ROOT + name)]));
    for (const [name, element] of loaded) if (element) this.images[name] = element;
    this.menu = await image('/theme/menu.png');
    for (const name of ['normal', 'small']) {
      const info = this.ui.fonts?.[name];
      const atlas = this.images[`font-${name}.png`];
      if (info && atlas) this.fonts[name] = new Font(atlas, info);
    }
  }

  get(name) { return this.images[name] || null; }

  /** A Pokémon picture from the app's local art (front, or back for the player's side), loaded on first use. */
  mon(look, back) {
    const key = `${look.number}/${back}/${look.shiny}`;
    let entry = this.mons.get(key);
    if (!entry) {
      entry = {image: null, bounds: null, failed: false};
      const name = encodeURIComponent(this.spriteName(look.number) || '');
      image(`/sprite/${look.number}?back=${back ? 1 : 0}&shiny=${look.shiny ? 1 : 0}&name=${name}`).then(element => {
        if (!element) {
          entry.failed = true;
          return;
        }
        entry.image = element;
        entry.bounds = opaqueBounds(element);
      });
      this.mons.set(key, entry);
    }
    return entry;
  }

  font(name = 'normal') { return this.fonts[name] || this.fonts.normal || null; }
}

/** The rows and columns that hold visible pixels, so pictures of any size stand on the platform. */
function opaqueBounds(element) {
  const canvas = document.createElement('canvas');
  canvas.width = element.width;
  canvas.height = element.height;
  const context = canvas.getContext('2d');
  context.drawImage(element, 0, 0);
  const {data} = context.getImageData(0, 0, canvas.width, canvas.height);
  let top = canvas.height, bottom = -1, left = canvas.width, right = -1;
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      if (data[(y * canvas.width + x) * 4 + 3] === 0) continue;
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
      left = Math.min(left, x);
      right = Math.max(right, x);
    }
  }
  if (bottom < 0) return {top: 0, bottom: element.height - 1, left: 0, right: element.width - 1};
  return {top, bottom, left, right};
}

/**
 * FireRed's bitmap font. The atlas stores the game's 2-bit glyph values as pure red, green and blue; each colour set
 * the game prints with is made once by swapping those for the real palette colours.
 */
export class Font {
  constructor(atlas, info) {
    this.atlas = atlas;
    this.info = info;
    this.chars = info.glyphs || info.chars;
    this.lineHeight = info.lineHeight || 16;
    this.cache = new Map();
  }

  glyph(character) {
    return this.chars[character] || this.chars[FALLBACK[character]] || this.chars['?'];
  }

  measure(text, spacing = 0) {
    let width = 0;
    for (const character of text) width += (this.glyph(character)?.advance || 0) + spacing;
    return width;
  }

  /** colors: {fg, shadow} as [r, g, b]; glyph values map to them as the game's text printer does. */
  colored(colors) {
    const key = JSON.stringify(colors);
    let sheet = this.cache.get(key);
    if (sheet) return sheet;
    sheet = document.createElement('canvas');
    sheet.width = this.atlas.width;
    sheet.height = this.atlas.height;
    const context = sheet.getContext('2d');
    context.drawImage(this.atlas, 0, 0);
    const pixels = context.getImageData(0, 0, sheet.width, sheet.height);
    // The game prints glyph value 1 as the foreground and 2 as the shadow; 0 and 3 stay the window's background.
    const byValue = {[this.info.foregroundValue ?? 1]: colors.fg, [this.info.shadowValue ?? 2]: colors.shadow};
    const data = pixels.data;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 128) {
        data[i + 3] = 0;
        continue;
      }
      // The strongest channel tells the glyph value; Android decodes the atlas with colour conversion, so the stored
      // pure red, green and blue arrive slightly mixed.
      const [red, green, blue] = [data[i], data[i + 1], data[i + 2]];
      const value = red >= green && red >= blue ? 1 : green >= blue ? 2 : 3;
      const color = byValue[value];
      if (!color) {
        data[i + 3] = 0;
        continue;
      }
      [data[i], data[i + 1], data[i + 2]] = color;
      data[i + 3] = 255;
    }
    context.putImageData(pixels, 0, 0);
    this.cache.set(key, sheet);
    return sheet;
  }

  /** One named glyph, such as the healthbox's "Lv" (FireRed's LV_2 character), drawn whole. */
  drawGlyph(context, key, x, y, colors) {
    const glyph = this.chars[key];
    if (!glyph) return this.draw(context, key, x, y, colors);
    context.drawImage(this.colored(colors), glyph.x, glyph.y, glyph.w, glyph.h, x, y, glyph.w, glyph.h);
    return glyph.advance;
  }

  draw(context, text, x, y, colors, spacing = 0, limit = Infinity) {
    const sheet = this.colored(colors);
    let left = x;
    let count = 0;
    for (const character of text) {
      if (count++ >= limit) break;
      const glyph = this.glyph(character);
      if (!glyph) continue;
      if (glyph.w && glyph.h) context.drawImage(sheet, glyph.x, glyph.y, glyph.w, glyph.h, left, y, glyph.w, glyph.h);
      left += glyph.advance + spacing;
    }
    return left - x;
  }
}

const FALLBACK = {'\'': '’', '"': '”', '—': '-', '–': '-', 'Á': 'A', 'á': 'a', 'í': 'i', 'ó': 'o', 'ú': 'u', 'ñ': 'n', '•': '.'};

/** FireRed's menu window frame (8×8 corner, edge and fill tiles), tiled, never stretched. */
export function frame(context, menu, x, y, w, h) {
  if (!menu) {
    context.fillStyle = '#f8f8f8';
    context.fillRect(x, y, w, h);
    context.strokeStyle = '#506070';
    context.strokeRect(x + .5, y + .5, w - 1, h - 1);
    return;
  }
  const tile = 8;
  for (let row = 0; row < h; row += tile) {
    for (let column = 0; column < w; column += tile) {
      const sourceX = column === 0 ? 0 : column + tile >= w ? 2 : 1;
      const sourceY = row === 0 ? 0 : row + tile >= h ? 2 : 1;
      const drawX = column + tile >= w ? x + w - tile : x + column;
      const drawY = row + tile >= h ? y + h - tile : y + row;
      context.drawImage(menu, sourceX * tile, sourceY * tile, tile, tile, drawX, drawY, tile, tile);
    }
  }
}

/** A copy of a picture recoloured toward one colour, for the send-out glow, recall and stat-change flashes. */
export function tinted(element, color, amount) {
  const canvas = document.createElement('canvas');
  canvas.width = element.width;
  canvas.height = element.height;
  const context = canvas.getContext('2d');
  context.drawImage(element, 0, 0);
  context.globalCompositeOperation = 'source-atop';
  context.globalAlpha = amount;
  context.fillStyle = color;
  context.fillRect(0, 0, canvas.width, canvas.height);
  return canvas;
}
