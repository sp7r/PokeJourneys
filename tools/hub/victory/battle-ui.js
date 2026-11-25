'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const gba = require('./gba2d');
const drawing = require('./ds2d');

const ROM_BASE = 0x08000000;
const PREVIEW_ROOT = 'C:/Builds/PokeJourneys/firered-battle/preview';

// File offsets from firered-rev1.sym. Pointer table contents are read from the cartridge.
const OFFSETS = {
  textboxTiles: 0xd00000,
  textboxPalette: 0xd004d8,
  textboxMap: 0xd0051c,
  windows: 0x2483a0,
  windowText: 0x3febd4,
  userFrames: 0x471eec,
  textWindowPalettes: 0x471e4c,
  standardMenuPalette: 0x41f478,
  levelUpPalette: 0x250740,
  ppPalette: 0xd2fbb4,
  healthboxPalette: 0xd11b84,
  healthbarPalette: 0xd11ba4,
  interfaceTiles: 0xd11bc4,
  healthboxOam: 0x2602e0,
  statusColors: 0x2605ca,
  normalGlyphs: 0x1ff370,
  normalWidths: 0x207370,
  smallGlyphs: 0x1eaf70,
  smallWidths: 0x1eef70,
  fontInfo: 0x41f4b4,
  ballSheets: 0x2605dc,
  ballPalettes: 0x26063c,
  ballTemplates: 0x260764,
  openBallTiles: 0xd022e8,
  ballParticleSheets: 0x40bfb8,
  ballParticlePalettes: 0x40c018,
  ballParticleTemplates: 0x40c114,
  trainerBackCoords: 0x239ffc,
  trainerBackSheets: 0x23a014,
  trainerBackPalettes: 0x23a044,
  trainerFrontSheets: 0x2395ec,
  trainerFrontPalettes: 0x239a8c,
  terrains: 0x24eea4,
  battlerCoords: 0x3ae08c,
  frontCoords: 0x234a3c,
  backCoords: 0x235edc,
  elevation: 0x23a074,
  nationalDex: 0x25205e,
  castformFront: 0x3ae0ac,
  castformElevation: 0x3ae0bc,
  castformBack: 0x3ae0c0,
  animSheets: 0x3acc78,
  animPalettes: 0x3ad580,
  frozenPieces: 0x3bf5b4,
  partySummary: 0xe7bb04
};

const WINDOW_NAMES = [
  'MSG', 'ACTION_PROMPT', 'ACTION_MENU',
  'MOVE_NAME_1', 'MOVE_NAME_2', 'MOVE_NAME_3', 'MOVE_NAME_4',
  'PP', 'MOVE_TYPE', 'PP_REMAINING', 'DUMMY', 'SWITCH_PROMPT',
  'LEVEL_UP_BOX', 'LEVEL_UP_BANNER', 'YESNO', 'VS_PLAYER', 'VS_OPPONENT',
  'VS_MULTI_PLAYER_1', 'VS_MULTI_PLAYER_2', 'VS_MULTI_PLAYER_3', 'VS_MULTI_PLAYER_4',
  'VS_OUTCOME_DRAW', 'VS_OUTCOME_LEFT', 'VS_OUTCOME_RIGHT', 'OAK_OLD_MAN'
];

const TERRAIN_NAMES = [
  'GRASS', 'LONG_GRASS', 'SAND', 'UNDERWATER', 'WATER', 'POND', 'MOUNTAIN',
  'CAVE', 'BUILDING', 'PLAIN', 'LINK', 'GYM', 'LEADER', 'INDOOR_2', 'INDOOR_1',
  'LORELEI', 'BRUNO', 'AGATHA', 'LANCE', 'CHAMPION'
];

const BATTLER_NAMES = ['player-left', 'opponent-left', 'player-right', 'opponent-right'];
const FONT_NAMES = ['FONT_SMALL', 'FONT_NORMAL_COPY_1', 'FONT_NORMAL', 'FONT_NORMAL_COPY_2', 'FONT_MALE'];
const OBJECT_SIZES = [
  [[8, 8], [16, 16], [32, 32], [64, 64]],
  [[16, 8], [32, 8], [32, 16], [64, 32]],
  [[8, 16], [8, 32], [16, 32], [32, 64]]
];

function requireFact(condition, message) {
  if (!condition) {
    throw new Error(message + '; nothing written.');
  }
}

function hex(value) {
  return '0x' + value.toString(16).toUpperCase();
}

function pointer(rom, offset) {
  const result = rom.readUInt32LE(offset) - ROM_BASE;
  requireFact(result >= 0 && result < rom.length, 'Invalid ROM pointer at ' + hex(offset));
  return result;
}

function externalPath(destination, repository) {
  let ancestor = destination;
  while (!fs.existsSync(ancestor)) {
    const parent = path.dirname(ancestor);
    requireFact(parent !== ancestor, 'No existing output ancestor');
    ancestor = parent;
  }
  const resolved = path.resolve(fs.realpathSync(ancestor), path.relative(ancestor, destination));
  const relative = path.relative(repository.toLowerCase(), resolved.toLowerCase());
  requireFact(relative !== '' && (relative.startsWith('..' + path.sep) || path.isAbsolute(relative)),
    'Export destination must be outside the repository');
  return resolved;
}

function color(red, green, blue) {
  return [red, green, blue].map(channel => Math.round(channel * 255 / 31));
}

function blit(destination, source, left, top) {
  for (let y = 0; y < source.h; y += 1) {
    for (let x = 0; x < source.w; x += 1) {
      const offset = (y * source.w + x) * 4;
      const alpha = source.data[offset + 3];
      if (alpha !== 0) {
        drawing.put(destination, left + x, top + y, source.data.subarray(offset, offset + 3), alpha);
      }
    }
  }
}

function crop(source, left, top, width, height) {
  const result = drawing.image(width, height);
  for (let y = 0; y < height; y += 1) {
    const start = ((top + y) * source.w + left) * 4;
    source.data.copy(result.data, y * width * 4, start, start + width * 4);
  }
  return result;
}

function fill(destination, left, top, width, height, rgb) {
  for (let y = top; y < top + height; y += 1) {
    for (let x = left; x < left + width; x += 1) {
      drawing.put(destination, x, y, rgb);
    }
  }
}

function scale(source, factor) {
  const result = drawing.image(source.w * factor, source.h * factor);
  for (let y = 0; y < result.h; y += 1) {
    for (let x = 0; x < result.w; x += 1) {
      const offset = (Math.floor(y / factor) * source.w + Math.floor(x / factor)) * 4;
      drawing.put(result, x, y, source.data.subarray(offset, offset + 3), source.data[offset + 3]);
    }
  }
  return result;
}

function bounds(image) {
  let left = image.w;
  let top = image.h;
  let right = 0;
  let bottom = 0;
  for (let y = 0; y < image.h; y += 1) {
    for (let x = 0; x < image.w; x += 1) {
      if (image.data[(y * image.w + x) * 4 + 3] !== 0) {
        left = Math.min(left, x);
        top = Math.min(top, y);
        right = Math.max(right, x + 1);
        bottom = Math.max(bottom, y + 1);
      }
    }
  }
  return right === 0 ? [0, 0, 0, 0] : [left, top, right - left, bottom - top];
}

function addImage(context, name, image) {
  requireFact(!context.images.has(name), 'Duplicate image ' + name);
  context.images.set(name, image);
  return name;
}

function objectSize(rom, offset) {
  const shape = rom.readUInt16LE(offset) >>> 14;
  const size = rom.readUInt16LE(offset + 2) >>> 14;
  requireFact(shape < OBJECT_SIZES.length, 'Unsupported object shape');
  return OBJECT_SIZES[shape][size];
}

function frameStrip(bytes, palette, width, height, tileOffsets) {
  const frameBytes = width * height / 2;
  const offsets = tileOffsets || Array.from({length: bytes.length / frameBytes}, (_, i) => i * frameBytes / 32);
  requireFact(offsets.length > 0 && (tileOffsets || bytes.length % frameBytes === 0), 'Partial sprite frame');
  const result = drawing.image(width * offsets.length, height);
  for (let i = 0; i < offsets.length; i += 1) {
    const start = offsets[i] * 32;
    requireFact(start + frameBytes <= bytes.length, 'Sprite frame exceeds its sheet');
    blit(result, gba.tiles(bytes.subarray(start, start + frameBytes), palette, width / 8, true), i * width, 0);
  }
  return result;
}

function buildPalettes(rom) {
  const palette = Array.from({length: 128}, () => [0, 0, 0]);
  const textbox = gba.pal(gba.lz(rom, OFFSETS.textboxPalette).data, 0, 32);
  palette.splice(0, textbox.length, ...textbox);
  const framePalettes = [];
  for (let index = 0; index < 10; index += 1) {
    framePalettes.push(gba.pal(rom, pointer(rom, OFFSETS.userFrames + index * 8 + 4)));
  }
  palette.splice(16, 16, ...framePalettes[0]);
  palette[5 * 16 + 12] = color(9, 9, 9);
  palette[5 * 16 + 13] = color(9, 9, 9);
  palette[5 * 16 + 14] = color(31, 31, 31);
  palette[5 * 16 + 15] = color(26, 26, 25);
  const pp = gba.pal(rom, OFFSETS.ppPalette, 8);
  palette[5 * 16 + 12] = pp[6];
  palette[5 * 16 + 11] = pp[7];
  palette.splice(6 * 16, 16, ...gba.pal(rom, OFFSETS.levelUpPalette));
  palette.splice(7 * 16, 10, ...gba.pal(rom, OFFSETS.standardMenuPalette, 10));
  palette.splice(7 * 16, 16, ...gba.pal(rom, OFFSETS.textWindowPalettes));
  palette[7 * 16 + 6] = color(0, 0, 0);
  return {palette, framePalettes, pp};
}

/**
 * The battle menu cursor: ActionSelectionCreateCursorAt / MoveSelectionCreateCursorAt write BG0 tiles 1 and 2 over
 * the cell and keep that cell's palette (palette argument 0x11); the Destroy functions write tile 32 instead.
 */
function cursorTiles(tilemap, tiles, palette, column, row, top, bottom) {
  const keep = tilemap.readUInt16LE((row * 32 + column) * 2) & 0xf000;
  const map = Buffer.alloc(32 * 2 * 2);
  map.writeUInt16LE(keep | top, 0);
  map.writeUInt16LE(keep | bottom, 64);
  return gba.map(map, tiles, palette, 8, 16, true);
}

function exportCursor(context, tilemap, tiles, palette) {
  addImage(context, 'cursor.png', cursorTiles(tilemap, tiles, palette, 16, 35, 1, 2));
  addImage(context, 'cursor-blank.png', cursorTiles(tilemap, tiles, palette, 16, 35, 32, 32));
}

function exportTextbox(context) {
  const rom = context.rom;
  const tiles = Buffer.from(gba.lz(rom, OFFSETS.textboxTiles).data);
  const tilemap = gba.lz(rom, OFFSETS.textboxMap).data;
  requireFact(tiles.length === 0x2000 && tilemap.length === 0x1000, 'Unexpected textbox dimensions');
  const frameTiles = pointer(rom, OFFSETS.userFrames);
  rom.copy(tiles, 0x12 * 32, frameTiles, frameTiles + 0x120);
  rom.copy(tiles, 0x22 * 32, frameTiles, frameTiles + 0x120);
  const palettes = buildPalettes(rom);
  context.bgPalette = palettes.palette;
  context.textboxTiles = tiles;
  const image = gba.map(tilemap, tiles, palettes.palette, 256, 512, true);
  addImage(context, 'textbox.png', image);
  exportCursor(context, tilemap, tiles, palettes.palette);
  const windows = {};
  for (let index = 0; index < WINDOW_NAMES.length; index += 1) {
    const offset = OFFSETS.windows + index * 8;
    const text = OFFSETS.windowText + index * 12;
    const paletteNum = rom[offset + 5];
    const bank = palettes.palette.slice(paletteNum * 16, paletteNum * 16 + 16);
    const foreground = rom[text + 7];
    const background = rom[text + 8];
    const shadow = rom[text + 9];
    windows['B_WIN_' + WINDOW_NAMES[index]] = {
      source: 'sStandardBattleWindowTemplates; sTextOnWindowsInfo_Normal; BattlePutTextOnWindow',
      id: index,
      bg: rom[offset],
      tilemapLeft: rom[offset + 1],
      tilemapTop: rom[offset + 2],
      width: rom[offset + 3],
      height: rom[offset + 4],
      paletteNum,
      baseBlock: rom.readUInt16LE(offset + 6),
      fontId: rom[text + 1],
      font: FONT_NAMES[rom[text + 1]],
      x: rom[text + 2],
      y: rom[text + 3],
      letterSpacing: rom[text + 4],
      lineSpacing: rom[text + 5],
      speed: rom[text + 6],
      colorIndices: {fg: foreground, bg: background, shadow},
      colors: {fg: bank[foreground], bg: bank[background], shadow: bank[shadow]},
      fillValue: rom[text],
      fillIndex: rom[text] & 15,
      fillRgb: bank[rom[text] & 15],
      fillAlpha: (rom[text] & 15) === 0 ? 0 : 255
    };
  }
  context.facts.textbox = {
    source: 'gBattleInterface_Textbox_*; gBattleBgTemplates; InitBattleBgsVideo; LoadBattleTextboxAndBackground; LoadBattleMenuWindowGfx',
    file: 'textbox.png',
    width: image.w,
    height: image.h,
    transparentIndex: 0,
    scrollY: {
      source: 'PlayerHandlePrintString; HandleChooseActionAfterDma3; HandleChooseMoveAfterDma3',
      message: 0,
      action: 160,
      move: 320
    },
    palettes: {
      source: 'LoadBattleTextboxAndBackground; LoadBattleMenuWindowGfx; LoadUserWindowGfx; SetPpNumbersPaletteInMoveSelection; InitLevelUpBanner',
      bg: palettes.palette,
      userFrame: 0,
      userFramePalettes: palettes.framePalettes,
      note: 'Bank 1 uses the default user frame. All ten ROM palettes are supplied because the saved frame selection is not in the ROM. Bank 6 is the level-up banner context; bank 7 is the Oak/old-man context. PP colors use the full-PP state.',
      ppStates: palettes.pp.reduce((states, rgb, index) => {
        if (index % 2 === 0) {
          states.push({state: index / 2, fg: rgb, shadow: palettes.pp[index + 1]});
        }
        return states;
      }, []),
      ppStateRule: 'GetCurrentPpToMaxPpState: full -> 3; max <= 2: current > 1 -> 3, else 2-current; max <= 7: current > 2 -> 3, else 2-current; otherwise zero -> 2, <= floor(max/4) -> 1, > floor(max/2) -> 3, else 0.'
    },
    windows,
    actionItems: {
      source: 'gText_BattleMenu: CLEAR_TO 56; sTextOnWindowsInfo_Normal[B_WIN_ACTION_MENU]',
      items: [{text: 'FIGHT', x: 0, y: 2}, {text: 'BAG', x: 56, y: 2}, {text: 'POKéMON', x: 0, y: 18}, {text: 'RUN', x: 56, y: 18}]
    },
    cursor: {
      source: 'ActionSelectionCreateCursorAt; MoveSelectionCreateCursorAt; CopyTileMapEntry',
      tiles: [1, 2],
      blankTile: 32,
      file: 'cursor.png',
      blankFile: 'cursor-blank.png',
      paletteNum: 0,
      action: {tileX: 16, tileY: 35, columnStride: 7, rowStride: 2},
      move: {tileX: 1, tileY: 55, columnStride: 9, rowStride: 2}
    },
    tileReplacements: {
      source: 'LoadBattleMenuWindowGfx; LoadUserWindowGfx; LoadUserWindowGfxByFrame; gUserFrames[0]',
      firstTiles: [0x12, 0x22],
      bytesPerCopy: 0x120,
      note: 'Window 2 belongs to BG0. The default user-frame graphics replace the placeholder tiles in both locations before rendering.'
    },
    textPlacementNote: 'Window tile coordinates are in the full map; screen y = tilemapTop * 8 + text y - scrollY. VS names/outcomes override x with centered text; message speed follows the saved text-speed option.'
  };
}

function glyphBytes(rom, base, code, small) {
  if (!small) {
    return rom.subarray(base + code * 64, base + (code + 1) * 64);
  }
  // Half-width glyphs have two vertical tiles; glyph() expects four tile slots.
  const result = Buffer.alloc(64);
  rom.copy(result, 0, base + code * 32, base + code * 32 + 16);
  rom.copy(result, 32, base + code * 32 + 16, base + code * 32 + 32);
  return result;
}

function exportFont(context, name, fontId, base, widths) {
  const small = name === 'small';
  const cellWidth = small ? 8 : 16;
  const cellHeight = 16;
  const glyphHeight = small ? 13 : 14;
  const codes = {...gba.CODES, '"': 0xb2, '\u00d7': 0xb9, '\u2191': 0x79, '\u2193': 0x7a, 'Lv': 0x105};
  const entries = Object.entries(codes);
  const image = drawing.image(cellWidth * 16, Math.ceil(entries.length / 16) * cellHeight);
  const glyphs = {};
  const encodedColors = [[0, 0, 0], [255, 0, 0], [0, 255, 0], [0, 0, 255]];
  for (let index = 0; index < entries.length; index += 1) {
    const [character, code] = entries[index];
    const x = index % 16 * cellWidth;
    const y = Math.floor(index / 16) * cellHeight;
    const bytes = glyphBytes(context.rom, base, code, small);
    for (let row = 0; row < cellHeight; row += 1) {
      for (let column = 0; column < cellWidth; column += 1) {
        const value = gba.glyph(bytes, 0, 0, column, row);
        drawing.put(image, x + column, y + row, encodedColors[value], value === 0 ? 0 : 255);
      }
    }
    glyphs[character] = {x, y, w: context.rom[widths + code], h: glyphHeight, advance: context.rom[widths + code], code};
  }
  const capital = glyphs.H;
  let baseline = 0;
  for (let y = 0; y < glyphHeight; y += 1) {
    for (let x = 0; x < capital.w; x += 1) {
      const offset = ((capital.y + y) * image.w + capital.x + x) * 4;
      if (image.data[offset] === 255 && image.data[offset + 3] !== 0) {
        baseline = y + 1;
      }
    }
  }
  addImage(context, 'font-' + name + '.png', image);
  context.facts.fonts[name] = {
    source: 'sFont' + (small ? 'Small' : 'Normal') + 'LatinGlyphs; sFont' + (small ? 'Small' : 'Normal') + 'LatinGlyphWidths; gFontInfos; DecompressGlyph_' + (small ? 'Small' : 'Normal') + '; GenerateFontHalfRowLookupTable; sFontHalfRowOffsets',
    file: 'font-' + name + '.png',
    fontId,
    cellWidth,
    cellHeight,
    lineHeight: context.rom[OFFSETS.fontInfo + fontId * 12 + 5],
    glyphHeight,
    baseline,
    baselineNote: 'Measured at the bottom edge of foreground pixels in capital H. The game positions glyphs by their top-left and has no stored baseline.',
    foregroundValue: 1,
    shadowValue: 2,
    backgroundValues: [0, 3],
    encoding: {'0': 'transparent', '1': '#FF0000', '2': '#00FF00', '3': '#0000FF'},
    aliases: {'"': 'Right double quote (0xB2)', 'Lv': 'LV_2 (extended glyph 0x105)'},
    glyphs
  };
}

function exportFonts(context) {
  context.facts.fonts = {
    source: 'sTextOnWindowsInfo_Normal; AddTextPrinterAndCreateWindowOnHealthbox; DecompressGlyph_NormalCopy1',
    uses: {
      messages: 'normal (FONT_NORMAL)',
      actionMenu: 'normal (FONT_NORMAL_COPY_1; identical Latin data)',
      moveNames: 'small (FONT_SMALL)',
      ppLabelAndType: 'small (FONT_SMALL)',
      ppNumbers: 'normal (FONT_NORMAL_COPY_1)',
      healthboxNamesLevelAndHp: 'small (FONT_SMALL)'
    }
  };
  requireFact(context.rom.subarray(0x1f3170, 0x1fb370).equals(context.rom.subarray(0x1ff370, 0x207570)),
    'Normal and menu Latin fonts differ');
  exportFont(context, 'normal', 2, OFFSETS.normalGlyphs, OFFSETS.normalWidths);
  exportFont(context, 'small', 0, OFFSETS.smallGlyphs, OFFSETS.smallWidths);
}

function drawText(context, image, text, left, top, fontName, colors, letterSpacing = 0, lineSpacing = 0) {
  const font = context.facts.fonts[fontName];
  const atlas = context.images.get(font.file);
  let x = left;
  let y = top;
  for (const character of text) {
    if (character === '\n') {
      x = left;
      y += font.lineHeight + lineSpacing;
      continue;
    }
    const glyph = font.glyphs[character];
    requireFact(Boolean(glyph), 'Missing preview character ' + character);
    drawGlyph(image, atlas, glyph, x, y, colors);
    x += glyph.advance + letterSpacing;
  }
  return x;
}

function drawGlyph(image, atlas, glyph, left, top, colors) {
  for (let y = 0; y < glyph.h; y += 1) {
    for (let x = 0; x < glyph.w; x += 1) {
      const offset = ((glyph.y + y) * atlas.w + glyph.x + x) * 4;
      if (atlas.data[offset + 3] === 0) {
        continue;
      }
      if (atlas.data[offset] === 255) {
        drawing.put(image, left + x, top + y, colors.fg);
      } else if (atlas.data[offset + 1] === 255) {
        drawing.put(image, left + x, top + y, colors.shadow);
      }
    }
  }
}

function tilePosition(tile, playerSingle) {
  const pieceTiles = playerSingle ? 64 : 32;
  const piece = Math.floor(tile / pieceTiles);
  const local = tile % pieceTiles;
  return [piece * 64 + local % 8 * 8, Math.floor(local / 8) * 8];
}

function interfaceTile(context, index, palette) {
  const start = OFFSETS.interfaceTiles + index * 32;
  return gba.tiles(context.rom.subarray(start, start + 32), palette, 1, true);
}

function barRows(context, base, palette) {
  const full = interfaceTile(context, base + 8, palette);
  const empty = interfaceTile(context, base, palette);
  const rows = [];
  for (let y = 0; y < 8; y += 1) {
    const offset = y * 8 * 4;
    if (!full.data.subarray(offset, offset + 4).equals(empty.data.subarray(offset, offset + 4))) {
      rows.push({row: y, fill: [...full.data.subarray(offset, offset + 3)], empty: [...empty.data.subarray(offset, offset + 3)]});
    }
  }
  return rows;
}

function exportBars(context) {
  const boxPalette = gba.pal(context.rom, OFFSETS.healthboxPalette);
  const barPalette = gba.pal(context.rom, OFFSETS.healthbarPalette);
  context.boxPalette = boxPalette;
  context.barPalette = barPalette;
  const raw = context.rom.subarray(OFFSETS.interfaceTiles, OFFSETS.interfaceTiles + 0xf00);
  const barSheet = gba.tiles(raw, barPalette, 16, true);
  const boxSheet = gba.tiles(raw, boxPalette, 16, true);
  const sheet = drawing.image(barSheet.w, barSheet.h + boxSheet.h);
  blit(sheet, barSheet, 0, 0);
  blit(sheet, boxSheet, 0, barSheet.h);
  addImage(context, 'interface.png', sheet);
  context.facts.interface = {
    source: 'gBattleInterface_Gfx; gBattleInterface_Healthbox_Pal; gBattleInterface_Healthbar_Pal; GetBattleInterfaceGfxPtr',
    file: 'interface.png',
    tileCount: raw.length / 32,
    columns: 16,
    views: [
      {x: 0, y: 0, width: barSheet.w, height: barSheet.h, palette: 'healthbar'},
      {x: 0, y: barSheet.h, width: boxSheet.w, height: boxSheet.h, palette: 'healthbox'}
    ],
    palettes: {healthbox: boxPalette, healthbar: barPalette},
    note: 'The same raw tiles are shown under both OBJ palettes. Status colors in healthbox slots 12-15 are replaced at runtime; status.png includes those replacements.'
  };
  context.facts.bars = {
    source: 'MoveBattleBarGraphically; CalcBarFilledPixels; GetScaledHPFraction; GetHPBarLevel; B_HEALTHBAR_NUM_PIXELS; B_EXPBAR_NUM_PIXELS; gBattleInterface_Gfx',
    hp: {
      length: 48,
      green: barRows(context, 3, barPalette),
      yellow: barRows(context, 47, barPalette),
      red: barRows(context, 56, barPalette),
      thresholds: {greenAbovePixels: 24, yellowAbovePixels: 9, redThroughPixels: 9},
      rule: 'For settled HP, pixels = floor(hp * 48 / maxHp), with a minimum of one pixel when hp > 0. Color selection uses filled pixels, so 50% and 20% are quantized to 24 and 9. Zero HP is empty.'
    },
    exp: {length: 64, rows: barRows(context, 12, boxPalette), levelCap: 100},
    note: 'Each row records the RGB of the full and empty tile at the same pixel. Rows are relative to the 8-pixel bar sprite/tile; healthbox metadata also supplies composed-image coordinates.'
  };
  const status = drawing.image(5 * 24, 8);
  const icons = {};
  for (const [index, name] of ['PSN', 'PAR', 'SLP', 'FRZ', 'BRN'].entries()) {
    const palette = boxPalette.map(rgb => [...rgb]);
    palette[12] = gba.pal(context.rom, OFFSETS.statusColors + index * 2, 1)[0];
    const start = OFFSETS.interfaceTiles + (21 + index * 3) * 32;
    blit(status, gba.tiles(context.rom.subarray(start, start + 96), palette, 3, true), index * 24, 0);
    icons[name] = {x: index * 24, y: 0, width: 24, height: 8, color: palette[12]};
  }
  addImage(context, 'status.png', status);
  context.facts.status = {
    source: 'UpdateStatusIconInHealthbox; GetStatusIconForBattlerId; sStatusIconColors; STATUS1_PSN_ANY',
    file: 'status.png',
    icons,
    aliases: {TOX: 'PSN'},
    priority: ['SLP', 'PSN/TOX', 'BRN', 'FRZ', 'PAR'],
    note: 'Battler-specific graphics use separate palette indices for the same icon. These resolved colors are shared by all battlers.'
  };
  addImage(context, 'party-summary-bar.png', gba.tiles(gba.lz(context.rom, OFFSETS.partySummary).data, boxPalette, 16, true));
  context.facts.interface.partySummary = {
    source: 'sPartySummaryBarSpriteSheets; sPartySummaryBarSpritePals',
    file: 'party-summary-bar.png',
    note: 'Raw tile sheet using the healthbox palette; the on-screen summary uses subsprites.'
  };
}

function exportHealthboxes(context) {
  const healthboxes = {};
  const kinds = [
    ['singles-player', 0xd1f340, true, true],
    ['singles-opponent', 0xd1f604, false, false],
    ['doubles-player', 0xd1f794, true, false],
    ['doubles-opponent', 0xd1f928, false, false]
  ];
  for (const [kind, offset, player, playerSingle] of kinds) {
    const bytes = Buffer.from(gba.lz(context.rom, offset).data);
    const pieceHeight = playerSingle ? 64 : 32;
    const pieceBytes = 64 * pieceHeight / 2;
    requireFact(bytes.length === pieceBytes * 2, 'Unexpected healthbox size');
    if (playerSingle) {
      for (let index = 0; index < 8; index += 1) {
        const tile = index < 4 ? 36 + index : 92 + index;
        context.rom.copy(bytes, tile * 32, OFFSETS.interfaceTiles + 12 * 32, OFFSETS.interfaceTiles + 13 * 32);
      }
    }
    const statusTile = playerSingle ? 26 : player ? 18 : 17;
    for (let index = 0; index < 3; index += 1) {
      context.rom.copy(bytes, (statusTile + index) * 32, OFFSETS.interfaceTiles + 39 * 32, OFFSETS.interfaceTiles + 40 * 32);
    }
    const image = drawing.image(128, pieceHeight);
    blit(image, gba.tiles(bytes.subarray(0, pieceBytes), context.boxPalette, 8, true), 0, 0);
    blit(image, gba.tiles(bytes.subarray(pieceBytes), context.boxPalette, 8, true), 64, 0);
    const barLeft = player ? 32 : 24;
    const barTop = 16;
    blit(image, interfaceTile(context, 1, context.barPalette), barLeft, barTop);
    blit(image, interfaceTile(context, 2, context.barPalette), barLeft + 8, barTop);
    for (let tile = 0; tile < 6; tile += 1) {
      blit(image, interfaceTile(context, 3, context.barPalette), barLeft + 16 + tile * 8, barTop);
    }
    const nameOrigin = tilePosition(player ? 2 : 1, playerSingle);
    const levelOrigin = tilePosition(playerSingle ? 65 : player ? 33 : 32, playerSingle);
    const statusOrigin = tilePosition(statusTile, playerSingle);
    const colors = {fg: context.boxPalette[1], bg: context.boxPalette[2], shadow: context.boxPalette[3]};
    const file = addImage(context, 'healthbox-' + kind + '.png', image);
    healthboxes[kind] = {
      source: 'CreateBattlerHealthboxSprites; SpriteCB_HealthBoxOther; SpriteCB_HealthBar; UpdateNickInHealthbox; UpdateLvlInHealthbox; UpdateHpTextInHealthbox; TextIntoHealthboxObject; UpdateStatusIconInHealthbox; MoveBattleBarGraphically',
      file,
      width: image.w,
      height: image.h,
      visibleBounds: bounds(image),
      pieces: [
        {x: 0, y: 0, width: 64, height: pieceHeight, tile: 0},
        {x: 64, y: 0, width: 64, height: pieceHeight, tile: pieceBytes / 32}
      ],
      nickname: {x: nameOrigin[0], y: nameOrigin[1] + 3, font: 'small', colors},
      gender: {
        x: 'nickname.x + sum of nickname glyph advances',
        y: nameOrigin[1] + 3,
        font: 'small',
        male: {glyph: '\u2642', fg: context.boxPalette[11], bg: colors.bg, shadow: colors.shadow},
        female: {glyph: '\u2640', fg: context.boxPalette[10], bg: colors.bg, shadow: colors.shadow},
        note: 'Appended to the nickname, with no fixed x. Omitted for genderless species, ghosts, and default Nidoran names.'
      },
      level: {
        x: levelOrigin[0],
        y: levelOrigin[1] + 3,
        font: 'small',
        colors,
        labelGlyph: 0x105,
        labelAdvance: context.rom[OFFSETS.smallWidths + 0x105],
        digitAdvance: context.rom[OFFSETS.smallWidths + 0xa1],
        alignment: 'Lv x = x + 5 * (3 - digit count); digits follow the LV_2 font glyph. Both label and digits use FONT_SMALL.'
      },
      hpBar: {
        x: barLeft + 16,
        y: barTop + context.facts.bars.hp.green[0].row,
        length: 48,
        rows: context.facts.bars.hp.green.map(row => barTop + row.row),
        tileOrigin: [barLeft + 16, barTop]
      },
      hpNumbers: playerSingle ? {
        source: 'UpdateHpTextInHealthbox; TextIntoHealthboxObject; ConvertIntToDecimalStringN',
        font: 'small',
        colors,
        current: {x: 60, y: 21, digits: 3, alignment: 'right', slashFollows: true},
        maximum: {x: 80, y: 21, digits: 3, alignment: 'right'},
        note: 'Current uses x=4 in a temporary window copied across the two OAM pieces; maximum uses x=0. Coordinates are three-digit field origins, including leading spaces.'
      } : null,
      expBar: playerSingle ? {
        x: 32,
        y: 32 + context.facts.bars.exp.rows[0].row,
        length: 64,
        rows: context.facts.bars.exp.rows.map(row => 32 + row.row),
        tileOrigin: [32, 32]
      } : null,
      status: {
        x: statusOrigin[0],
        y: statusOrigin[1],
        width: 24,
        height: 8,
        hideHpLabel: !playerSingle,
        barBorderTile: playerSingle ? null : 65,
        note: 'For opponents and doubles, a status clears healthbar tile 0 and replaces tile 1 with B_INTERFACE_GFX_HP_BAR_LEFT_BORDER. The icon is drawn into the healthbox beneath that separate sprite.'
      },
      textCopy: {
        firstCopiedTopRow: 5,
        lowerRowsStart: 8,
        lowerRowsCount: 8,
        fillIndex: 2,
        note: 'Clear and repaint these rows in the temporary field, including its background, before copying. This also replaces the Lv placeholder baked into the base graphic.'
      },
      note: playerSingle ? 'The player singles objects change shape to 64x64 after creation; their original 64x32 center-to-corner vector is retained. Transparent lower rows are preserved.' : 'Two consecutive 64x32 objects, with an independent healthbar drawn over them.'
    };
  }
  context.facts.healthboxes = healthboxes;
  const singles = {player: [158, 88], opponent: [44, 30]};
  const doubles = [[159, 75], [44, 19], [171, 100], [32, 44]];
  const positions = {source: 'InitBattlerHealthboxCoords; CreateSprite; CalcCenterToCornerVec; sOamData_Healthbox; SpriteCB_HealthBoxOther', singles: {}, doubles: {}};
  const size = objectSize(context.rom, OFFSETS.healthboxOam);
  for (const [side, center] of Object.entries(singles)) {
    positions.singles[side] = {center, topLeft: [center[0] - size[0] / 2, center[1] - size[1] / 2]};
  }
  for (let index = 0; index < doubles.length; index += 1) {
    positions.doubles[BATTLER_NAMES[index]] = {
      position: index,
      center: doubles[index],
      topLeft: [doubles[index][0] - size[0] / 2, doubles[index][1] - size[1] / 2]
    };
  }
  context.facts.healthboxPositions = positions;
}

function exportBall(context) {
  const rom = context.rom;
  const palette = gba.pal(gba.lz(rom, pointer(rom, OFFSETS.ballPalettes)).data, 0);
  const bytes = Buffer.from(gba.lz(rom, pointer(rom, OFFSETS.ballSheets)).data);
  requireFact(bytes.length === rom.readUInt16LE(OFFSETS.ballSheets + 4), 'Unexpected Poké Ball sheet');
  // LoadBallGfx replaces the last frame with the shared opening graphic.
  const opening = gba.lz(rom, OFFSETS.openBallTiles).data;
  requireFact(opening.length + 0x100 === bytes.length, 'Unexpected shared opening frame');
  opening.copy(bytes, 0x100);
  const size = objectSize(rom, pointer(rom, OFFSETS.ballTemplates + 4));
  const image = frameStrip(bytes, palette, size[0], size[1]);
  addImage(context, 'ball-poke.png', image);
  const particleBytes = gba.lz(rom, pointer(rom, OFFSETS.ballParticleSheets)).data;
  const particlePalette = gba.pal(gba.lz(rom, pointer(rom, OFFSETS.ballParticlePalettes)).data, 0);
  const particleSize = objectSize(rom, pointer(rom, OFFSETS.ballParticleTemplates + 4));
  const particles = frameStrip(particleBytes, particlePalette, particleSize[0], particleSize[1]);
  addImage(context, 'ball-poke-particles.png', particles);
  context.facts.ball = {
    source: 'gBallSpriteSheets[BALL_POKE]; gBallSpritePalettes; gBallSpriteTemplates; LoadBallGfx; gOpenPokeballGfx; sBallAnimSequences',
    file: 'ball-poke.png',
    frameWidth: size[0],
    frameHeight: size[1],
    frames: image.w / size[0],
    note: 'The shared opening frame has been copied at tile 8, exactly as LoadBallGfx does.',
    particles: {
      source: 'AnimateBallOpenParticles; gBallParticleSpritesheets[BALL_POKE]; gBallParticlePalettes; sBallParticlesSpriteTemplates; sAnim_RegularBall',
      file: 'ball-poke-particles.png',
      frameWidth: particleSize[0],
      frameHeight: particleSize[1],
      frames: particles.w / particleSize[0],
      usedFrames: [0, 1, 2],
      sequence: [{frame: 0}, {frame: 1}, {frame: 2}, {frame: 0, hFlip: true}, {frame: 2}, {frame: 1}],
      durationPerFrame: 1,
      note: 'The full shared sheet is exported; the Poké Ball uses sAnim_RegularBall.'
    }
  };
}

function exportTrainers(context) {
  const rom = context.rom;
  const trainers = {};
  for (const [index, name] of ['red', 'leaf'].entries()) {
    const entry = OFFSETS.trainerBackSheets + index * 8;
    const offset = pointer(rom, entry);
    const size = rom.readUInt16LE(entry + 4);
    const bytes = rom.subarray(offset, offset + size);
    const palette = gba.pal(gba.lz(rom, pointer(rom, OFFSETS.trainerBackPalettes + index * 8)).data, 0);
    const image = frameStrip(bytes, palette, 64, 64);
    const file = addImage(context, 'trainer-back-' + name + '.png', image);
    trainers['back-' + name] = {
      source: 'gTrainerBackPicTable; gTrainerBackPicPaletteTable; gTrainerBackPicCoords',
      file,
      frameWidth: 64,
      frameHeight: 64,
      frames: image.w / 64,
      yOffset: rom[OFFSETS.trainerBackCoords + index * 4 + 1],
      coordsSize: rom[OFFSETS.trainerBackCoords + index * 4]
    };
  }
  for (const [index, name] of [[110, 'cooltrainer-m'], [111, 'cooltrainer-f']]) {
    const bytes = gba.lz(rom, pointer(rom, OFFSETS.trainerFrontSheets + index * 8)).data;
    const palette = gba.pal(gba.lz(rom, pointer(rom, OFFSETS.trainerFrontPalettes + index * 8)).data, 0);
    const image = frameStrip(bytes, palette, 64, 64);
    requireFact(image.w === 64, 'Unexpected trainer front frame count');
    const file = addImage(context, 'trainer-front-' + name + '.png', image);
    trainers['front-' + name] = {
      source: 'gTrainerFrontPicTable; gTrainerFrontPicPaletteTable; TRAINER_PIC_COOLTRAINER_M; TRAINER_PIC_COOLTRAINER_F',
      file,
      trainerPicId: index,
      frameWidth: 64,
      frameHeight: 64,
      frames: image.w / 64
    };
  }
  context.facts.trainers = trainers;
}

function exportTerrains(context) {
  const terrains = {};
  for (let index = 0; index < TERRAIN_NAMES.length; index += 1) {
    const name = TERRAIN_NAMES[index].toLowerCase();
    const offsets = Array.from({length: 5}, (_, field) => pointer(context.rom, OFFSETS.terrains + index * 20 + field * 4));
    const tiles = gba.lz(context.rom, offsets[0]).data;
    const tilemap = gba.lz(context.rom, offsets[1]).data;
    const rawPalette = gba.lz(context.rom, offsets[4]).data;
    requireFact(rawPalette.length === 96, 'Unexpected terrain palette');
    const palette = Array.from({length: 32}, () => [0, 0, 0]).concat(gba.pal(rawPalette, 0, 48));
    const image = gba.map(tilemap, tiles, palette, 240, 112, false);
    const file = addImage(context, 'bg-' + name + '.png', image);
    terrains[name] = {
      source: 'sBattleTerrainTable; BATTLE_TERRAIN_' + TERRAIN_NAMES[index] + '; LoadBattleTerrainGfx; backdrops.js battle.png',
      file,
      terrain: index,
      width: image.w,
      height: image.h,
      romOffsets: Object.fromEntries(['tiles', 'map', 'entryTiles', 'entryMap', 'palette'].map((key, field) => [key, hex(offsets[field])])),
      platforms: null,
      note: 'Both platforms are baked into the BG3 tilemap. No independent platform-position table is defined; the full background is opaque, as in backdrops.js.'
    };
  }
  context.facts.terrains = terrains;
}

function exportBattlerCoords(context) {
  const rom = context.rom;
  const coords = {
    source: 'sBattlerCoords; GetBattlerSpriteCoord; GetBattlerSpriteFinal_Y; GetBattlerYDelta; GetBattlerElevation',
    singles: {},
    doubles: {},
    placement: 'Sprite center x = base x. Center y = base y + back y offset for players; base y + front y offset - enemy elevation for opponents. The ordinary battle-sprite call adds 8 to player y and clamps the result to 104 (GetBattlerSpriteFinal_Y with a3=TRUE). The default coordinate mode omits that addition and clamp.',
    forms: {
      source: 'gCastformFrontSpriteCoords; sCastformBackSpriteYCoords; sCastformElevations; GetBattlerYDelta',
      castform: {}
    }
  };
  for (const [modeIndex, mode] of ['singles', 'doubles'].entries()) {
    for (let index = 0; index < BATTLER_NAMES.length; index += 1) {
      const offset = OFFSETS.battlerCoords + (modeIndex * 4 + index) * 4;
      coords[mode][BATTLER_NAMES[index]] = {position: index, x: rom[offset], y: rom[offset + 1]};
    }
  }
  for (const [index, name] of ['normal', 'fire', 'water', 'ice'].entries()) {
    coords.forms.castform[name] = {
      frontYOffset: rom[OFFSETS.castformFront + index * 4 + 1],
      backYOffset: rom[OFFSETS.castformBack + index],
      enemyElevation: rom[OFFSETS.castformElevation + index]
    };
  }
  context.facts.battlerCoords = coords;
  const monCoords = {source: 'sSpeciesToNationalPokedexNum[species - 1]; gMonFrontPicCoords; gMonBackPicCoords; gEnemyMonElevation; SpeciesToNationalPokedexNum'};
  // Slots 252-276 are old Unown placeholders, not National Dex species.
  for (let species = 1; species <= 411; species += 1) {
    if (species >= 252 && species <= 276) {
      continue;
    }
    const national = rom.readUInt16LE(OFFSETS.nationalDex + (species - 1) * 2);
    requireFact(national >= 1 && national <= 386 && !monCoords[national], 'Invalid National Dex mapping');
    monCoords[national] = {
      internalSpecies: species,
      frontYOffset: rom[OFFSETS.frontCoords + species * 4 + 1],
      backYOffset: rom[OFFSETS.backCoords + species * 4 + 1],
      enemyElevation: rom[OFFSETS.elevation + species]
    };
  }
  requireFact(Object.keys(monCoords).length === 387, 'Incomplete National Dex mapping');
  context.facts.monCoords = monCoords;
  coords.forms.unown = {
    source: 'GetBattlerYDelta; GET_UNOWN_LETTER; SPECIES_UNOWN_B; gMonFrontPicCoords; gMonBackPicCoords',
    note: 'monCoords[201] is form A. Personality selects the other forms.',
    forms: {}
  };
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ!?';
  for (let form = 0; form < letters.length; form += 1) {
    const species = form === 0 ? 201 : 412 + form;
    coords.forms.unown.forms[letters[form]] = {
      internalSpecies: species,
      frontYOffset: rom[OFFSETS.frontCoords + species * 4 + 1],
      backYOffset: rom[OFFSETS.backCoords + species * 4 + 1]
    };
  }
}

// Each entry names a real template used by the referenced scripts or by a task they call.
const ANIM_SELECTIONS = [
  ['IMPACT', 0x3e7c78, 'gBasicHitSplatSpriteTemplate', ['Tackle', 'Karate Chop', 'Poison Sting', 'Pin Missile', 'Gust', 'Wing Attack', 'Bite', 'Crunch', 'Steel Wing']],
  ['HANDS_AND_FEET', 0x3e6750, 'gKarateChopSpriteTemplate', ['Karate Chop']],
  ['SMALL_EMBER', 0x3e5dbc, 'gEmberSpriteTemplate', ['Ember', 'Flamethrower', 'Dragon Rage', 'Status_Burn']],
  ['SMALL_BUBBLES', 0x3e5b38, 'gSmallDriftingBubblesSpriteTemplate', ['Water Gun', 'Bubble']],
  ['WATER_IMPACT', 0x3e7ca8, 'gWaterHitSplatSpriteTemplate', ['Water Gun']],
  ['BUBBLE', 0x3e5950, 'gWaterBubbleProjectileSpriteTemplate', ['Bubble']],
  ['SPARK', 0x3e6110, 'sElectricBoltSegmentSpriteTemplate', ['Thunder Shock', 'Thunderbolt', 'Thunder Wave']],
  ['SHOCK_3', 0x3e60c8, 'gThunderboltOrbSpriteTemplate', ['Thunderbolt']],
  ['SPARK_2', 0x3e60f8, 'gElectricitySpriteTemplate', ['Thunder Shock', 'Thunderbolt', 'Thunder Wave', 'Status_Paralysis']],
  ['LEAF', 0x3e2c78, 'gRazorLeafParticleSpriteTemplate', ['Razor Leaf']],
  ['RAZOR_LEAF', 0x3e2cc0, 'gRazorLeafCutterSpriteTemplate', ['Razor Leaf']],
  ['WHIP_HIT', 0x3e31d0, 'gVineWhipSpriteTemplate', ['Vine Whip']],
  ['ICE_CRYSTALS', 0x3e6414, 'gIceBeamOuterCrystalSpriteTemplate', ['Ice Beam']],
  ['NEEDLE', 0x3e7364, 'gLinearStingerSpriteTemplate', ['Poison Sting', 'Pin Missile']],
  ['POISON_BUBBLE', 0x3e6b28, 'gPoisonBubbleSpriteTemplate', ['Poison Sting', 'Sludge', 'Toxic']],
  ['MUD_SAND', 0x3e7ac8, 'gSandAttackDirtSpriteTemplate', ['Mud-Slap', 'Sand Attack']],
  ['ROCKS', 0x3e7424, 'gFallingRockSpriteTemplate', ['Rock Throw']],
  ['GUST', 0x3e6b58, 'gEllipticalGustSpriteTemplate', ['Gust', 'Wing Attack', 'Steel Wing']],
  ['GOLD_RING', 0x3e6f5c, 'gGoldRingSpriteTemplate', ['Psybeam']],
  ['STRING', 0x3e7318, 'gStringWrapSpriteTemplate', ['String Shot']],
  ['WEB_THREAD', 0x3e7300, 'gWebThreadSpriteTemplate', ['String Shot']],
  ['SHADOW_BALL', 0x3e7678, 'gShadowBallSpriteTemplate', ['Shadow Ball']],
  ['LICK', 0x3e76ac, 'gLickSpriteTemplate', ['Lick']],
  ['FIRE_PLUME', 0x3e7848, 'gDragonRageFirePlumeSpriteTemplate', ['Dragon Rage']],
  ['SHARP_TEETH', 0x3e79a0, 'gSharpTeethSpriteTemplate', ['Bite', 'Crunch']],
  ['CLAW_SLASH', 0x3e7a58, 'gClawSlashSpriteTemplate', ['Metal Claw']],
  ['RED_HEART', 0x3e42a0, 'gRedHeartBurstSpriteTemplate', ['Sweet Kiss']],
  ['ANGEL', 0x3e4390, 'gAngelSpriteTemplate', ['Sweet Kiss']],
  ['NOISE_LINE', 0x3ff624, 'gRoarNoiseLineSpriteTemplate', ['Growl']],
  ['MUSIC_NOTES', 0x3e38f0, 'gWavyMusicNotesSpriteTemplate', ['Sing']],
  ['TOXIC_BUBBLE', 0x3e6a1c, 'gToxicBubbleSpriteTemplate', ['Toxic']],
  ['SLEEP_POWDER', 0x3e2a00, 'gSleepPowderParticleSpriteTemplate', ['Sleep Powder']],
  ['SPARK_H', 0x3e6128, 'gThunderWaveSpriteTemplate', ['Thunder Wave']],
  ['WISP_FIRE', 0x3e5f54, 'gWillOWispFireSpriteTemplate', ['Will-O-Wisp']],
  ['WISP_ORB', 0x3e5f24, 'gWillOWispOrbSpriteTemplate', ['Will-O-Wisp']],
  ['ORBS', 0x3e2ac8, 'gPowerAbsorptionOrbSpriteTemplate', ['Recover']],
  ['BLUE_STAR', 0x3e3814, 'gHealingBlueStarSpriteTemplate', ['Recover']],
  ['SWORD', 0x3e3c68, 'gSwordsDanceBladeSpriteTemplate', ['Swords Dance']],
  ['EXPLOSION', 0x3e4004, 'gExplosionSpriteTemplate', ['Explosion']],
  ['SLASH', 0x3e3614, 'gSlashSliceSpriteTemplate', ['Slash']],
  ['CUT', 0x3e3304, 'gCuttingSliceSpriteTemplate', ['Cut']],
  ['DUCK', 0x3e7b7c, 'gConfusionDuckSpriteTemplate', ['Status_Confusion']],
  ['LETTER_Z', 0x3e3570, 'gSleepLetterZSpriteTemplate', ['Status_Sleep']],
  ['ICE_CUBE', 0x3bf5cc, 'sFrozenIceCubeSpriteTemplate', ['Status_Freeze']],
  ['SPARKLE_2', 0x3e3464, 'gGrantingStarsSpriteTemplate', ['Refresh', 'Synthesis', 'Cosmic Power']],
  ['SPARKLE_4', 0x3bf4f0, 'gSpinningSparkleSpriteTemplate', ['Detect', 'Disable']]
];

function findTaggedEntry(rom, table, tag, palette) {
  // Both symbol sizes are 0x908, comprising 289 eight-byte records.
  for (let index = 0; index < 0x908 / 8; index += 1) {
    const offset = table + index * 8;
    const tagOffset = palette ? 4 : 6;
    if (rom.readUInt16LE(offset + tagOffset) === tag) {
      return offset;
    }
  }
  throw new Error('Missing sprite tag ' + tag + '; nothing written.');
}

function readSubsprites(rom, offset, count) {
  const pieces = [];
  for (let index = 0; index < count; index += 1) {
    const entry = offset + index * 4;
    const packed = rom.readUInt16LE(entry + 2);
    const shape = packed & 3;
    const size = packed >>> 2 & 3;
    const dimensions = OBJECT_SIZES[shape][size];
    pieces.push({x: rom.readInt8(entry), y: rom.readInt8(entry + 1), width: dimensions[0], height: dimensions[1], tile: packed >>> 4 & 1023});
  }
  return pieces;
}

function exportFrozenPieces(context, bytes, palette, width, height) {
  const pieces = readSubsprites(context.rom, OFFSETS.frozenPieces, 4);
  const strip = drawing.image(width * pieces.length, height);
  const left = Math.min(...pieces.map(piece => piece.x));
  const top = Math.min(...pieces.map(piece => piece.y));
  const right = Math.max(...pieces.map(piece => piece.x + piece.width));
  const bottom = Math.max(...pieces.map(piece => piece.y + piece.height));
  const composite = drawing.image(right - left, bottom - top);
  for (let index = 0; index < pieces.length; index += 1) {
    const piece = pieces[index];
    const image = frameStrip(bytes, palette, piece.width, piece.height, [piece.tile]);
    blit(strip, image, index * width, 0);
    blit(composite, image, piece.x - left, piece.y - top);
  }
  addImage(context, 'anim-ice_cube-composed.png', composite);
  return {
    image: strip,
    details: {
      source: 'sFrozenIceCubeSpriteTemplate; sFrozenIceCubeSubsprites; AnimTask_FrozenIceCube',
      kind: 'subsprite-pieces',
      pieces,
      composedFile: 'anim-ice_cube-composed.png',
      composedWidth: composite.w,
      composedHeight: composite.h,
      origin: [left, top],
      note: 'This tag is one assembled ice cube, not a sequence of temporal frames. Each OAM piece occupies a template-sized cell with transparent padding. The additional composed file is the complete on-screen object before palette cycling and blending.'
    }
  };
}

function exportAnimVariant(context, tag, bytes, palette, offset, template, tileOffsets) {
  const size = objectSize(context.rom, pointer(context.rom, offset + 4));
  const file = 'anim-' + tag.toLowerCase() + '-' + size[0] + 'x' + size[1] + '.png';
  const image = frameStrip(bytes, palette, size[0], size[1], tileOffsets);
  addImage(context, file, image);
  return {source: template + '; its AnimCmd frame offsets', file, template, frameWidth: size[0], frameHeight: size[1], frames: tileOffsets.length, tileOffsets};
}

function oamName(rom, offset, size) {
  const attributes = rom.readUInt16LE(offset);
  const affine = ['Off', 'Normal', 'Off', 'Double'][attributes >>> 8 & 3];
  const mode = ['Normal', 'Blend', 'Window'][attributes >>> 10 & 3];
  return 'gOamData_Affine' + affine + '_Obj' + mode + '_' + size[0] + 'x' + size[1];
}

function exportAnims(context) {
  const anims = {};
  for (const [shortName, templateOffset, template, usedBy] of ANIM_SELECTIONS) {
    const tag = context.rom.readUInt16LE(templateOffset);
    const paletteTag = context.rom.readUInt16LE(templateOffset + 2);
    const sheetEntry = findTaggedEntry(context.rom, OFFSETS.animSheets, tag, false);
    const paletteEntry = findTaggedEntry(context.rom, OFFSETS.animPalettes, paletteTag, true);
    const bytes = gba.lz(context.rom, pointer(context.rom, sheetEntry)).data;
    const palette = gba.pal(gba.lz(context.rom, pointer(context.rom, paletteEntry)).data, 0);
    requireFact(bytes.length === context.rom.readUInt16LE(sheetEntry + 4), 'Unexpected animation sheet size');
    const oamOffset = pointer(context.rom, templateOffset + 4);
    const size = objectSize(context.rom, oamOffset);
    const result = shortName === 'ICE_CUBE' ? exportFrozenPieces(context, bytes, palette, size[0], size[1]) : {
      image: frameStrip(bytes, palette, size[0], size[1]),
      details: {}
    };
    const file = addImage(context, 'anim-' + shortName.toLowerCase() + '.png', result.image);
    const entry = {
      source: 'gBattleAnimPicTable; gBattleAnimPaletteTable; ' + template + '; data/battle_anim_scripts.s',
      file,
      tag,
      paletteTag,
      frameWidth: size[0],
      frameHeight: size[1],
      frames: result.image.w / size[0],
      template,
      templateOffset: hex(templateOffset),
      oamOffset: hex(oamOffset),
      oam: oamName(context.rom, oamOffset, size),
      objectMode: context.rom.readUInt16LE(oamOffset) >>> 10 & 3,
      usedBy,
      ...result.details
    };
    if (shortName === 'SMALL_BUBBLES') {
      entry.variants = [exportAnimVariant(context, shortName, bytes, palette, 0x3e5af0, 'gWaterGunProjectileSpriteTemplate / gWaterGunDropletSpriteTemplate', [0, 4])];
      entry.note = 'The shared sheet mixes 8x8 and 16x16 graphics. The primary strip preserves every 8x8 tile; the variant contains the Water Gun projectile and droplet at their actual size.';
    }
    if (shortName === 'MUD_SAND') {
      entry.variants = [exportAnimVariant(context, shortName, bytes, palette, 0x3e7aec, 'gMudSlapMudSpriteTemplate', [1])];
      entry.note = 'The shared sheet contains an 8x8 grain followed by a 16x16 mud sprite. The variant begins at tile 1, as sAnim_MudSlapMud specifies.';
    }
    anims['ANIM_TAG_' + shortName] = entry;
  }
  context.facts.anims = anims;
  const families = {
    'normal-hit': ['IMPACT'],
    fighting: ['HANDS_AND_FEET', 'IMPACT'],
    fire: ['SMALL_EMBER', 'WISP_FIRE'],
    water: ['SMALL_BUBBLES', 'WATER_IMPACT', 'BUBBLE'],
    electric: ['SPARK', 'SHOCK_3', 'SPARK_2'],
    grass: ['LEAF', 'RAZOR_LEAF', 'WHIP_HIT'],
    ice: ['ICE_CRYSTALS'],
    poison: ['NEEDLE', 'POISON_BUBBLE', 'TOXIC_BUBBLE'],
    ground: ['MUD_SAND'],
    rock: ['ROCKS'],
    flying: ['GUST', 'IMPACT'],
    psychic: ['GOLD_RING'],
    bug: ['STRING', 'WEB_THREAD', 'NEEDLE'],
    ghost: ['SHADOW_BALL', 'LICK'],
    dragon: ['SMALL_EMBER', 'FIRE_PLUME'],
    dark: ['SHARP_TEETH', 'IMPACT'],
    steel: ['CLAW_SLASH', 'GUST', 'IMPACT'],
    fairy: ['RED_HEART', 'ANGEL'],
    sound: ['NOISE_LINE', 'MUSIC_NOTES'],
    'status-sparkle': ['SPARKLE_2', 'SPARKLE_4'],
    heal: ['ORBS', 'BLUE_STAR'],
    'stat-up': ['SWORD'],
    'stat-down': ['NOISE_LINE'],
    sleep: ['LETTER_Z', 'SLEEP_POWDER'],
    'poison-status': [],
    paralysis: ['SPARK_2', 'SPARK_H'],
    burn: ['SMALL_EMBER', 'WISP_FIRE', 'WISP_ORB'],
    freeze: ['ICE_CUBE'],
    confusion: ['DUCK'],
    explosion: ['EXPLOSION'],
    slash: ['SLASH', 'CUT', 'CLAW_SLASH']
  };
  context.facts.families = Object.fromEntries(Object.entries(families).map(([family, tags]) => [family, tags.map(tag => 'ANIM_TAG_' + tag)]));
  context.facts.familyNotes = {
    source: 'data/battle_anim_scripts.s: Move_CONFUSION, Move_HARDEN, General_StatsChange, Status_Poison, Move_SWORDS_DANCE, Move_TAIL_WHIP; AnimTask_StatsChange; InitStatsChangeAnimation',
    psychic: 'Psybeam uses GOLD_RING. Confusion uses background distortion, palette cycling, and battler transforms; it has no tagged animation sprite.',
    fairy: 'A visual family for Sweet Kiss; FireRed has no Fairy battle type.',
    'stat-up': 'SWORD is the move-specific Swords Dance sprite. Generic positive stat changes use a scrolling background mask; Harden uses AnimTask_MetallicShine and has no tagged sprite.',
    'stat-down': 'NOISE_LINE is the move-specific Growl sprite. Generic negative stat changes use InitStatsChangeAnimation background scrolling and masking; Tail Whip moves the battler. Those effects have no tagged sprite to export.',
    'poison-status': 'Status_Poison shakes and palette-cycles the battler. It has no tagged sprite; Toxic and Sludge bubbles are listed under poison.',
    'status-sparkle': 'SPARKLE_2 is used by Refresh and Cosmic Power; SPARKLE_4 by Detect and Disable.',
    frameNote: 'Primary strips preserve all stored cells at the chosen template size. They are source graphics, not complete rendered move animations; transforms, timing, blending, dynamic palettes, and background effects remain runtime behavior.'
  };
}

function previewHealthbox(context, kind, nickname, level, hp, maximum, gender) {
  const info = context.facts.healthboxes[kind];
  const result = crop(context.images.get(info.file), 0, 0, info.width, info.height);
  const colors = info.nickname.colors;
  const nameField = drawing.image(64, 16);
  fill(nameField, 0, 0, nameField.w, nameField.h, colors.bg);
  const nameEnd = drawText(context, nameField, nickname, 0, 3, 'small', colors);
  if (gender) {
    const genderInfo = info.gender[gender];
    drawText(context, nameField, genderInfo.glyph, nameEnd, 3, 'small', genderInfo);
  }
  blit(result, crop(nameField, 0, 5, 56, 11), info.nickname.x, 5);
  const font = context.facts.fonts.small;
  const digits = String(level);
  const levelField = drawing.image(64, 16);
  fill(levelField, 0, 0, levelField.w, levelField.h, colors.bg);
  const labelX = 5 * (3 - digits.length);
  drawGlyph(levelField, context.images.get(font.file), font.glyphs.Lv, labelX, 3, colors);
  drawText(context, levelField, digits, labelX + info.level.labelAdvance, 3, 'small', colors);
  blit(result, crop(levelField, 0, 5, 24, 11), info.level.x, 5);
  const pixels = Math.max(hp > 0 ? 1 : 0, Math.floor(hp * 48 / maximum));
  const base = pixels > 24 ? 3 : pixels > 9 ? 47 : 56;
  if (info.hpNumbers) {
    const current = info.hpNumbers.current;
    const max = info.hpNumbers.maximum;
    const currentField = drawing.image(64, 16);
    fill(currentField, 0, 0, currentField.w, currentField.h, colors.bg);
    drawText(context, currentField, String(hp).padStart(3, ' ') + '/', 4, 5, 'small', colors);
    blit(result, crop(currentField, 0, 5, 24, 11), current.x - 4, 21);
    const maxField = drawing.image(64, 16);
    fill(maxField, 0, 0, maxField.w, maxField.h, colors.bg);
    drawText(context, maxField, String(maximum).padStart(3, ' '), 0, 5, 'small', colors);
    blit(result, crop(maxField, 0, 5, 16, 11), max.x, 21);
  }
  if (info.expBar) {
    for (let tile = 0; tile < 8; tile += 1) {
      blit(result, interfaceTile(context, 12 + (tile < 4 ? 8 : 0), context.boxPalette), info.expBar.tileOrigin[0] + tile * 8, info.expBar.tileOrigin[1]);
    }
  }
  for (let tile = 0; tile < 6; tile += 1) {
    const filled = Math.max(0, Math.min(8, pixels - tile * 8));
    blit(result, interfaceTile(context, base + filled, context.barPalette), info.hpBar.tileOrigin[0] + tile * 8, info.hpBar.tileOrigin[1]);
  }
  return result;
}

function previewWindow(context, screen, name, scroll, text) {
  const window = context.facts.textbox.windows['B_WIN_' + name];
  const x = window.tilemapLeft * 8;
  const y = window.tilemapTop * 8 - scroll;
  fill(screen, x, y, window.width * 8, window.height * 8, window.fillRgb);
  const fontName = window.fontId === 0 ? 'small' : 'normal';
  drawText(context, screen, text, x + window.x, y + window.y, fontName, window.colors, window.letterSpacing, window.lineSpacing);
}

function previewCursor(context, screen, move) {
  const tilemap = Buffer.alloc(32 * 2 * 2);
  tilemap.writeUInt16LE(1, 0);
  tilemap.writeUInt16LE(2, 64);
  const image = gba.map(tilemap, context.textboxTiles, context.bgPalette, 8, 16, true);
  blit(screen, image, move ? 8 : 128, 120);
}

function previewMon(context, screen, national, position, doubleBattle) {
  const coordinates = context.facts.monCoords[national];
  const player = position % 2 === 0;
  const species = coordinates.internalSpecies;
  const pictureTable = player ? 0x2365bc : 0x23511c;
  const bytes = gba.lz(context.rom, pointer(context.rom, pictureTable + species * 8)).data;
  const palette = gba.pal(gba.lz(context.rom, pointer(context.rom, 0x23737c + species * 8)).data, 0);
  const image = frameStrip(bytes, palette, 64, 64, [0]);
  const base = context.facts.battlerCoords[doubleBattle ? 'doubles' : 'singles'][BATTLER_NAMES[position]];
  let y = base.y + (player ? coordinates.backYOffset + 8 : coordinates.frontYOffset - coordinates.enemyElevation);
  y = Math.min(y, 104);
  blit(screen, image, base.x - 32, y - 32);
}

function previewScreen(context, doubleBattle, view) {
  const screen = drawing.image(240, 160);
  blit(screen, context.images.get('bg-grass.png'), 0, 0);
  const mode = doubleBattle ? 'doubles' : 'singles';
  const samples = [
    {dex: 1, name: 'BULBASAUR', level: 15, hp: 39, max: 45, gender: 'male'},
    {dex: 4, name: 'CHARMANDER', level: 16, hp: 24, max: 40, gender: 'female'},
    {dex: 7, name: 'SQUIRTLE', level: 15, hp: 12, max: 44, gender: 'male'},
    {dex: 25, name: 'PIKACHU', level: 16, hp: 5, max: 38, gender: 'female'}
  ];
  const count = doubleBattle ? 4 : 2;
  for (const position of doubleBattle ? [3, 1, 0, 2] : [1, 0]) {
    previewMon(context, screen, samples[position].dex, position, doubleBattle);
  }
  for (let position = 0; position < count; position += 1) {
    const player = position % 2 === 0;
    const side = player ? 'player' : 'opponent';
    const kind = mode + '-' + side;
    const sample = samples[position];
    const box = previewHealthbox(context, kind, sample.name, sample.level, sample.hp, sample.max, sample.gender);
    const coords = doubleBattle ? context.facts.healthboxPositions.doubles[BATTLER_NAMES[position]] : context.facts.healthboxPositions.singles[side];
    blit(screen, box, coords.topLeft[0], coords.topLeft[1]);
  }
  const scroll = context.facts.textbox.scrollY[view];
  blit(screen, crop(context.images.get('textbox.png'), 0, scroll, 240, 160), 0, 0);
  if (view === 'message') {
    previewWindow(context, screen, 'MSG', scroll, 'BULBASAUR used\nRAZOR LEAF!');
  } else if (view === 'action') {
    previewWindow(context, screen, 'ACTION_PROMPT', scroll, 'What will\nBULBASAUR do?');
    previewWindow(context, screen, 'ACTION_MENU', scroll, '');
    const window = context.facts.textbox.windows.B_WIN_ACTION_MENU;
    for (const item of context.facts.textbox.actionItems.items) {
      drawText(context, screen, item.text, window.tilemapLeft * 8 + item.x, window.tilemapTop * 8 - scroll + item.y, 'normal', window.colors);
    }
    previewCursor(context, screen, false);
  } else {
    for (const [index, text] of ['TACKLE', 'GROWL', 'LEECH SEED', 'VINE WHIP'].entries()) {
      previewWindow(context, screen, 'MOVE_NAME_' + (index + 1), scroll, text);
    }
    previewWindow(context, screen, 'PP', scroll, 'PP');
    previewWindow(context, screen, 'PP_REMAINING', scroll, '35/35');
    previewWindow(context, screen, 'MOVE_TYPE', scroll, 'TYPE/NORMAL');
    previewCursor(context, screen, true);
  }
  return screen;
}

function previewSheet(context) {
  const placements = [];
  const width = 768;
  let x = 8;
  let y = 8;
  let rowHeight = 0;
  for (const [file, image] of context.images) {
    const labelWidth = file.length * 6;
    const cellWidth = Math.max(image.w, labelWidth) + 16;
    if (x + cellWidth > width) {
      x = 8;
      y += rowHeight + 16;
      rowHeight = 0;
    }
    placements.push({file, image, x, y});
    x += cellWidth;
    rowHeight = Math.max(rowHeight, image.h + 20);
  }
  const result = drawing.image(width, y + rowHeight + 8);
  for (let row = 0; row < result.h; row += 1) {
    for (let column = 0; column < result.w; column += 1) {
      const shade = ((Math.floor(column / 8) + Math.floor(row / 8)) % 2) === 0 ? 48 : 60;
      drawing.put(result, column, row, [shade, shade, shade]);
    }
  }
  for (const placement of placements) {
    const label = placement.file.replace(/_/g, '-');
    drawText(context, result, label, placement.x, placement.y, 'small', {fg: [255, 255, 255], shadow: [0, 0, 0]});
    blit(result, placement.image, placement.x, placement.y + 16);
  }
  return result;
}

function buildPreviews(context) {
  const previews = new Map();
  for (const doubleBattle of [false, true]) {
    const name = doubleBattle ? 'doubles' : 'singles';
    for (const view of ['message', 'action', 'move']) {
      const suffix = view === 'message' ? '' : '-' + view;
      previews.set(name + suffix + '.png', scale(previewScreen(context, doubleBattle, view), 3));
    }
  }
  previews.set('sheet.png', scale(previewSheet(context), 3));
  context.facts.previews = {
    source: 'Preview composition using exported art, font atlases, sBattlerCoords, InitBattlerHealthboxCoords, sStandardBattleWindowTemplates, and BG0 scroll values',
    folder: PREVIEW_ROOT,
    files: [...previews.keys()],
    scale: 3,
    nativeScreen: [240, 160],
    note: 'Nearest-neighbor check images. Names, levels, HP, EXP, move choices, and messages are illustrative sample state, not additional ROM facts. Pokémon pictures are decoded directly into preview memory.'
  };
  return previews;
}

function prepareWrites(context, output, previewRoot, previews, repository) {
  const writes = [];
  for (const [name, image] of context.images) {
    writes.push({file: path.join(output, name), data: drawing.png(image)});
  }
  for (const [name, image] of previews) {
    writes.push({file: path.join(previewRoot, name), data: drawing.png(image)});
  }
  writes.push({file: path.join(output, 'battle-ui.json'), data: JSON.stringify(context.facts, null, 2) + '\n'});
  for (const write of writes) {
    externalPath(write.file, repository);
    requireFact(!fs.existsSync(write.file) || !fs.lstatSync(write.file).isSymbolicLink(), 'Refusing to overwrite a linked output file');
  }
  return writes;
}

function run() {
  const [romFile, dataRoot, ...extra] = process.argv.slice(2);
  requireFact(Boolean(romFile && dataRoot) && extra.length === 0, 'Usage: node tools/hub/victory/battle-ui.js <FireRed Rev 1.gba> <external hub data>');
  const rom = fs.readFileSync(romFile);
  const code = rom.toString('ascii', 0xac, 0xb0);
  const revision = rom[0xbc];
  requireFact(code === 'BPRE' && revision === 1, 'Unsupported cartridge: ' + code + ', revision ' + revision + '. Only BPRE revision 1 is supported');
  requireFact(rom.length >= 0xe99118, 'Truncated FireRed Rev 1 cartridge');
  const repository = fs.realpathSync(path.resolve(__dirname, '../../..'));
  const output = externalPath(path.resolve(dataRoot, 'ui/firered-battle'), repository);
  // Preview sheets are for checking on a PC; the phone's build skips them.
  const withPreviews = process.platform !== 'android';
  const previewRoot = withPreviews ? externalPath(path.resolve(PREVIEW_ROOT), repository) : null;
  const context = {
    rom,
    images: new Map(),
    facts: {
      cartridge: {
        source: 'GBA cartridge header; firered-rev1.sym',
        code,
        revision,
        bytes: rom.length,
        sha256: crypto.createHash('sha256').update(rom).digest('hex'),
        addressRule: 'ROM file offset = GBA address - 0x08000000',
        colorRule: 'BGR555 channels expanded by round(channel * 255 / 31), matching gba2d.pal.'
      }
    }
  };
  exportTextbox(context);
  exportFonts(context);
  exportBars(context);
  exportHealthboxes(context);
  exportBall(context);
  exportTrainers(context);
  exportTerrains(context);
  exportBattlerCoords(context);
  exportAnims(context);
  const previews = withPreviews ? buildPreviews(context) : new Map();
  // Decode, render, encode, and validate every destination before creating any output.
  const writes = prepareWrites(context, output, previewRoot, previews, repository);
  fs.mkdirSync(output, {recursive: true});
  if (withPreviews) fs.mkdirSync(previewRoot, {recursive: true});
  for (const write of writes) {
    fs.writeFileSync(write.file, write.data);
    console.log(write.file);
  }
  console.log('Exported ' + context.images.size + ' native images, battle-ui.json, and ' + previews.size + ' previews.');
}

if (require.main === module) {
  try {
    run();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = {run};
