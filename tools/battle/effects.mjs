import {ease, lerp} from './anim.mjs';

/**
 * Move, status and field animations built from FireRed's own battle animation sprites (exported per ANIM_TAG from
 * the player's cartridge). FireRed scripts every move by hand; here each move gets its type's sprites and a motion
 * that fits how it is used: a contact lunge and hit splat, a projectile, a beam, falling rocks, a quake, a cast on
 * the target or an aura on the user.
 */
const TYPE_FAMILY = {
  Normal: 'normal-hit', Fighting: 'fighting', Fire: 'fire', Water: 'water', Electric: 'electric', Grass: 'grass',
  Ice: 'ice', Poison: 'poison', Ground: 'ground', Rock: 'rock', Flying: 'flying', Psychic: 'psychic', Bug: 'bug',
  Ghost: 'ghost', Dragon: 'dragon', Dark: 'dark', Steel: 'steel', Fairy: 'fairy',
};

/** Sheets whose cells are different pieces rather than animation frames: each sprite keeps one random cell. */
const PIECES = new Set(['ANIM_TAG_SMALL_BUBBLES', 'ANIM_TAG_ICE_CRYSTALS', 'ANIM_TAG_ROCKS', 'ANIM_TAG_MUSIC_NOTES', 'ANIM_TAG_ORBS',
  'ANIM_TAG_HANDS_AND_FEET', 'ANIM_TAG_MUD_SAND']);

const TYPE_TINT = {
  Fire: '#f86830', Water: '#3878f8', Electric: '#f8e030', Grass: '#58c848', Ice: '#90e0f8', Poison: '#a048c0',
  Psychic: '#f870b0', Ghost: '#6848a0', Dragon: '#7038f8', Dark: '#403838', Steel: '#b8b8d0', Fairy: '#f8a0d0',
  Fighting: '#c03028', Ground: '#d8b058', Rock: '#b8a038', Bug: '#a8b820', Flying: '#a890f0', Normal: '#f8f8f8',
};

export class Effects {
  constructor({scene, clock, art}) {
    this.scene = scene;
    this.clock = clock;
    this.art = art;
    this.ui = art.ui;
  }

  sheet(tag) {
    const info = this.ui?.anims?.[tag];
    const image = info && this.art.get(info.composedFile || info.file);
    if (!image) return null;
    if (info.composedFile) return {image, w: info.composedWidth, h: info.composedHeight, frames: 1, tag};
    return {image, w: info.frameWidth, h: info.frameHeight, frames: info.frames || 1, tag};
  }

  family(name) {
    return (this.ui?.families?.[name] || []).map(tag => this.sheet(tag)).filter(Boolean);
  }

  sprite(sheet, x, y, extra = {}) {
    const frame = PIECES.has(sheet.tag) ? Math.floor(Math.random() * sheet.frames) : 0;
    const sprite = {image: sheet.image, w: sheet.w, h: sheet.h, frame, x, y, sheet, alpha: 1, ...extra};
    this.scene.sprites.add(sprite);
    return sprite;
  }

  remove(sprite) { this.scene.sprites.delete(sprite); }

  /** Animate a sprite's own frames over its life (piece sheets keep their cell). */
  animateFrames(sprite, progress, loops = 1) {
    if (PIECES.has(sprite.sheet.tag) || sprite.sheet.frames < 2) return;
    sprite.frame = Math.min(sprite.sheet.frames - 1, Math.floor(progress * loops * sprite.sheet.frames) % sprite.sheet.frames);
  }

  center(visual) { return this.scene.monCenter(visual); }

  // Moves -----------------------------------------------------------------------------------------------------------

  async move(move, user, targets) {
    if (!move?.exists) return;
    const sheets = this.sheetsFor(move);
    // Without the exported animation sprites the hit flicker and HP drain still play.
    if (!sheets.list.length) return;
    const others = targets.filter(target => target !== user);
    const kind = this.kindOf(move, others);
    switch (kind) {
    case 'explosion': return this.explosion(user, sheets);
    case 'contact': return this.contact(user, others, sheets, move);
    case 'quake': return this.quake(others, sheets);
    case 'rain': return this.rain(others, sheets);
    case 'beam': return this.beam(user, others, sheets);
    case 'projectile': return this.projectile(user, others, sheets);
    case 'cast': return this.cast(others, sheets, move);
    case 'sound': return this.sound(user, others.length ? others : [user], sheets);
    default: return this.aura(user, sheets, move);
    }
  }

  sheetsFor(move) {
    const id = move.id;
    let family = TYPE_FAMILY[move.type] || 'normal-hit';
    if (move.flags?.sound) family = 'sound';
    else if (/slash|cut|claw|scratch|fury swipes|leaf blade|night slash|x-scissor|psycho cut|air slash|cross poison|sacred sword|secret sword/i.test(move.name)) family = 'slash';
    else if (move.flags?.bite) family = 'dark';
    else if (move.flags?.punch) family = 'fighting';
    else if (['explosion', 'selfdestruct', 'mindblown'].includes(id)) family = 'explosion';
    else if (move.category === 'Status' && (move.heal || move.flags?.heal)) family = 'heal';
    else if (move.category === 'Status' && move.target === 'self') family = id === 'swordsdance' ? 'stat-up' : 'status-sparkle';
    else if (move.category === 'Status' && move.status === 'slp') family = 'sleep';
    else if (move.category === 'Status' && move.status === 'par') family = 'paralysis';
    else if (move.category === 'Status' && move.status === 'brn') family = 'burn';
    let sheets = this.family(family);
    if (!sheets.length) sheets = this.family('normal-hit');
    return {family, list: sheets, tint: TYPE_TINT[move.type] || '#f8f8f8'};
  }

  kindOf(move, targets) {
    if (['explosion', 'selfdestruct', 'mindblown'].includes(move.id)) return 'explosion';
    if (move.flags?.sound && move.category !== 'Physical') return 'sound';
    if (move.category === 'Status') return targets.length && !['self', 'allySide', 'allies', 'adjacentAllyOrSelf'].includes(move.target) ? 'cast' : 'aura';
    if (move.type === 'Ground' && targets.length > 1 || ['earthquake', 'magnitude', 'bulldoze', 'fissure'].includes(move.id)) return 'quake';
    if (move.type === 'Rock' && (targets.length > 1 || /slide|edge|stealth|tomb|smack|blast/i.test(move.name)) && !move.flags?.contact) return 'rain';
    if (move.flags?.contact) return 'contact';
    if (/beam|cannon|pump|thrower|blizzard|hurricane|thunder$|solar|dazzling|moonblast|psychic$|surf|scald|flash|signal|ray|wave|bolt|blast/i.test(move.name)) return 'beam';
    return 'projectile';
  }

  /** The user lunges at the target, which takes the type's hit splat (and a punch or bite sprite when it has one). */
  async contact(user, targets, sheets, move) {
    if (!targets.length) return this.aura(user, sheets, move);
    const direction = user.side === 'p1' ? 1 : -1;
    await this.clock.tween(120, progress => {
      user.dx = direction * 10 * ease.out(progress);
      user.dy = -direction * 5 * ease.out(progress);
    });
    const hits = targets.map(target => {
      const point = this.center(target);
      return sheets.list.slice(0, 2).map((sheet, index) => this.sprite(sheet, point.x + index * 4, point.y - index * 4));
    }).flat();
    this.shakeTarget(targets, 300);
    await this.clock.tween(300, progress => {
      for (const hit of hits) {
        this.animateFrames(hit, progress);
        hit.alpha = progress < .7 ? 1 : 1 - (progress - .7) / .3;
      }
    });
    for (const hit of hits) this.remove(hit);
    await this.clock.tween(140, progress => {
      user.dx = direction * 10 * (1 - progress);
      user.dy = -direction * 5 * (1 - progress);
    });
    user.dx = 0;
    user.dy = 0;
  }

  shakeTarget(targets, duration) {
    this.clock.tween(duration, progress => {
      for (const target of targets) target.dx = progress < 1 ? (Math.floor(progress * 12) % 2 ? 2 : -2) : 0;
    });
  }

  /** A few of the type's sprites fly from the user to each target and burst there. */
  async projectile(user, targets, sheets) {
    if (!targets.length) return this.aura(user, sheets);
    const from = this.center(user);
    const shots = [];
    for (const target of targets) {
      const to = this.center(target);
      for (let i = 0; i < 3; i++) shots.push({sprite: this.sprite(sheets.list[0], from.x, from.y, {alpha: 0}), from, to, delay: i * .15});
    }
    await this.clock.tween(520, progress => {
      for (const shot of shots) {
        const local = Math.max(0, Math.min(1, (progress - shot.delay) / (1 - .3)));
        shot.sprite.alpha = local > 0 ? 1 : 0;
        shot.sprite.x = lerp(shot.from.x, shot.to.x, local);
        shot.sprite.y = lerp(shot.from.y, shot.to.y, local) - Math.sin(local * Math.PI) * 10;
        this.animateFrames(shot.sprite, local, 2);
      }
    });
    for (const shot of shots) this.remove(shot.sprite);
    await this.splash(targets, sheets.list[1] || sheets.list[0]);
  }

  /** A stream of the type's sprites from the user to each target, then a burst. */
  async beam(user, targets, sheets) {
    if (!targets.length) return this.aura(user, sheets);
    const from = this.center(user);
    const live = new Set();
    const count = 14;
    const duration = 700;
    await this.clock.tween(duration, progress => {
      const spawned = Math.floor(progress * count);
      while (live.size < spawned * targets.length && live.size < count * targets.length) {
        for (const target of targets) {
          const to = this.center(target);
          live.add({sprite: this.sprite(sheets.list[0], from.x, from.y), from, to, born: progress});
        }
      }
      for (const particle of live) {
        const local = Math.min(1, (progress - particle.born) / .35);
        particle.sprite.x = lerp(particle.from.x, particle.to.x, local);
        particle.sprite.y = lerp(particle.from.y, particle.to.y, local) + Math.sin(local * 9 + particle.born * 20) * 3;
        this.animateFrames(particle.sprite, local, 2);
        particle.sprite.alpha = local >= 1 ? 0 : 1;
      }
    });
    for (const particle of live) this.remove(particle.sprite);
    await this.splash(targets, sheets.list[1] || sheets.list[0]);
  }

  /** Sprites bursting outward on each target. */
  async splash(targets, sheet) {
    if (!sheet) return;
    const pieces = [];
    for (const target of targets) {
      const point = this.center(target);
      for (let i = 0; i < 5; i++) {
        const angle = Math.PI * 2 * i / 5 + Math.random();
        pieces.push({sprite: this.sprite(sheet, point.x, point.y), point, angle});
      }
    }
    this.shakeTarget(targets, 260);
    await this.clock.tween(320, progress => {
      for (const piece of pieces) {
        piece.sprite.x = piece.point.x + Math.cos(piece.angle) * progress * 18;
        piece.sprite.y = piece.point.y + Math.sin(piece.angle) * progress * 14;
        piece.sprite.alpha = 1 - ease.in(progress);
        this.animateFrames(piece.sprite, progress);
      }
    });
    for (const piece of pieces) this.remove(piece.sprite);
  }

  /** Rocks (or the type's sprites) drop onto every target. */
  async rain(targets, sheets) {
    const drops = [];
    for (const target of targets) {
      const point = this.center(target);
      for (let i = 0; i < 4; i++) drops.push({sprite: this.sprite(sheets.list[0], point.x - 18 + i * 12, -16), point, delay: i * .12, x: point.x - 18 + i * 12});
    }
    await this.clock.tween(650, progress => {
      for (const drop of drops) {
        const local = Math.max(0, Math.min(1, (progress - drop.delay) / .55));
        drop.sprite.y = lerp(-16, drop.point.y + 6, ease.in(local));
        drop.sprite.alpha = local >= 1 ? 0 : 1;
      }
    });
    for (const drop of drops) this.remove(drop.sprite);
    await this.screenShake(4, 260);
  }

  /** The whole field shakes, with the type's sprites kicked up around each target. */
  async quake(targets, sheets) {
    const dust = [];
    for (const target of targets) {
      const point = this.center(target);
      for (let i = 0; i < 4; i++) dust.push(this.sprite(sheets.list[0], point.x - 18 + i * 12, (point.ground || point.y + 16) - 4));
    }
    await this.screenShake(5, 720, () => {
      for (const sprite of dust) sprite.y -= .25;
    });
    for (const sprite of dust) this.remove(sprite);
  }

  async screenShake(amount, duration, step = () => {}) {
    await this.clock.tween(duration, progress => {
      const strength = amount * (1 - progress);
      this.scene.shake.x = Math.floor(progress * 24) % 2 ? strength : -strength;
      this.scene.shake.y = Math.floor(progress * 18) % 3 === 0 ? strength / 2 : 0;
      step(progress);
    });
    this.scene.shake.x = 0;
    this.scene.shake.y = 0;
  }

  /** A status move landing on its target: the type's sprites drift down over it. */
  async cast(targets, sheets, move) {
    const pieces = [];
    for (const target of targets) {
      const point = this.center(target);
      for (let i = 0; i < 6; i++) pieces.push({sprite: this.sprite(sheets.list[i % sheets.list.length], point.x - 20 + (i % 3) * 20, point.y - 30), point, i});
    }
    await this.clock.tween(800, progress => {
      for (const piece of pieces) {
        piece.sprite.y = piece.point.y - 30 + progress * 34 + (piece.i > 2 ? 10 : 0);
        piece.sprite.x += Math.sin(progress * 12 + piece.i) * .4;
        piece.sprite.alpha = progress > .8 ? (1 - progress) / .2 : 1;
        this.animateFrames(piece.sprite, progress, 2);
      }
    });
    for (const piece of pieces) this.remove(piece.sprite);
    await this.pulse(targets, sheets.tint || TYPE_TINT[move?.type] || '#ffffff', 2);
  }

  /** A move on the user itself: sparkles rise around it while it glows. */
  async aura(user, sheets) {
    const point = this.center(user);
    const pieces = [];
    for (let i = 0; i < 6; i++) {
      const angle = Math.PI * 2 * i / 6;
      pieces.push({sprite: this.sprite(sheets.list[0], point.x, point.y), angle});
    }
    const glow = this.pulse([user], sheets.tint || '#ffffff', 2);
    await this.clock.tween(700, progress => {
      for (const piece of pieces) {
        piece.sprite.x = point.x + Math.cos(piece.angle + progress * 3) * 22;
        piece.sprite.y = point.y + Math.sin(piece.angle + progress * 3) * 10 - progress * 14;
        piece.sprite.alpha = 1 - ease.in(progress);
        this.animateFrames(piece.sprite, progress, 2);
      }
    });
    for (const piece of pieces) this.remove(piece.sprite);
    await glow;
  }

  async sound(user, targets, sheets) {
    const from = this.center(user);
    const notes = [];
    for (const target of targets) {
      const to = this.center(target);
      for (let i = 0; i < 4; i++) notes.push({sprite: this.sprite(sheets.list[i % sheets.list.length], from.x, from.y), to, delay: i * .12});
    }
    await this.clock.tween(700, progress => {
      for (const note of notes) {
        const local = Math.max(0, Math.min(1, (progress - note.delay) / .6));
        note.sprite.x = lerp(from.x, note.to.x, local);
        note.sprite.y = lerp(from.y, note.to.y, local) + Math.sin(local * 10) * 6;
        note.sprite.alpha = local >= 1 ? 0 : 1;
      }
    });
    for (const note of notes) this.remove(note.sprite);
  }

  async explosion(user, sheets) {
    const point = this.center(user);
    const blasts = [];
    for (let i = 0; i < 5; i++) blasts.push({sprite: this.sprite(sheets.list[0], point.x + (i - 2) * 22, point.y + (i % 2 ? -10 : 8), {alpha: 0}), delay: i * .1});
    this.scene.flash = {color: '#ffffff', alpha: 0};
    await this.clock.tween(800, progress => {
      for (const blast of blasts) {
        const local = Math.max(0, Math.min(1, (progress - blast.delay) / .5));
        blast.sprite.alpha = local > 0 && local < 1 ? 1 : 0;
        this.animateFrames(blast.sprite, local);
      }
      this.scene.flash.alpha = progress < .3 ? progress / .3 * .7 : .7 * (1 - (progress - .3) / .7);
      this.scene.shake.x = Math.floor(progress * 30) % 2 ? 3 : -3;
    });
    for (const blast of blasts) this.remove(blast.sprite);
    this.scene.flash = null;
    this.scene.shake.x = 0;
  }

  /** The next strike of a multi-hit move: just the hit splat on each target. */
  async impact(targets) {
    const sheet = this.sheet('ANIM_TAG_IMPACT');
    if (!sheet) return;
    const hits = targets.map(target => {
      const point = this.center(target);
      return this.sprite(sheet, point.x + (Math.random() * 10 - 5), point.y + (Math.random() * 10 - 5));
    });
    await this.clock.wait(160);
    for (const hit of hits) this.remove(hit);
  }

  // Status and field --------------------------------------------------------------------------------------------------

  async pulse(targets, color, times) {
    await this.clock.tween(times * 260, progress => {
      const amount = Math.sin(progress * times * Math.PI) ** 2 * .6;
      for (const target of targets) target.tint = progress < 1 ? {color, amount} : null;
    });
    for (const target of targets) target.tint = null;
  }

  async status(kind, visual) {
    const id = String(kind).toLowerCase();
    const families = {slp: 'sleep', par: 'paralysis', brn: 'burn', frz: 'freeze', psn: 'poison', tox: 'poison', confusion: 'confusion'};
    const tints = {slp: '#a8a8c8', par: '#f8e030', brn: '#f86830', frz: '#90e0f8', psn: '#a048c0', tox: '#a048c0', confusion: '#f8f8f8'};
    const family = families[id];
    if (!family) return;
    const point = this.center(visual);
    if (id === 'frz') {
      const cube = this.sheet('ANIM_TAG_ICE_CUBE');
      if (cube) {
        const sprite = this.sprite(cube, point.x, point.y, {alpha: 0});
        await this.clock.tween(600, progress => { sprite.alpha = progress < .3 ? progress / .3 : progress > .8 ? (1 - progress) / .2 : 1; });
        this.remove(sprite);
        return;
      }
    }
    if (id === 'slp') {
      const z = this.sheet('ANIM_TAG_LETTER_Z');
      if (z) {
        const letters = [0, 1, 2].map(i => ({sprite: this.sprite(z, point.x + 12, (point.top ?? point.y - 16) + 4, {alpha: 0}), delay: i * .25}));
        await this.clock.tween(900, progress => {
          for (const letter of letters) {
            const local = Math.max(0, Math.min(1, (progress - letter.delay) / .5));
            letter.sprite.alpha = local > 0 && local < 1 ? 1 : 0;
            letter.sprite.x = point.x + 12 + local * 10;
            letter.sprite.y = (point.top ?? point.y - 16) + 4 - local * 16;
          }
        });
        for (const letter of letters) this.remove(letter.sprite);
        return;
      }
    }
    const sheets = this.family(family === 'poison' ? 'poison' : family);
    const sparks = sheets.length ? [0, 1, 2, 3].map(i => this.sprite(sheets[i % sheets.length], point.x - 12 + (i % 2) * 24, point.y - 8 + Math.floor(i / 2) * 16)) : [];
    const glow = this.pulse([visual], tints[id], 2);
    await this.clock.tween(520, progress => {
      for (const spark of sparks) {
        this.animateFrames(spark, progress, 2);
        spark.y -= family === 'poison' ? .3 : 0;
        spark.alpha = progress > .75 ? (1 - progress) / .25 : 1;
      }
      visual.dx = family === 'paralysis' || family === 'poison' ? (Math.floor(progress * 16) % 2 ? 1 : -1) : 0;
    });
    visual.dx = 0;
    for (const spark of sparks) this.remove(spark);
    await glow;
  }

  async heal(visual) {
    const sheets = this.family('heal');
    const point = this.center(visual);
    const sparkles = sheets.length ? [0, 1, 2, 3, 4].map(i => ({sprite: this.sprite(sheets[i % sheets.length], point.x - 16 + i * 8, point.y + 12), i})) : [];
    await this.clock.tween(600, progress => {
      for (const sparkle of sparkles) {
        sparkle.sprite.y = point.y + 12 - progress * 28 - (sparkle.i % 2) * 6;
        sparkle.sprite.alpha = 1 - ease.in(progress);
        this.animateFrames(sparkle.sprite, progress, 2);
      }
    });
    for (const sparkle of sparkles) this.remove(sparkle.sprite);
  }

  /** FireRed's stat change: the Pokémon glows warm and rises for a raise, cool and sinks for a drop. */
  async stat(visual, up) {
    const color = up ? '#f89048' : '#4878f8';
    const glow = this.pulse([visual], color, 3);
    await this.clock.tween(780, progress => { visual.dy = Math.sin(progress * Math.PI * 3) * (up ? -2 : 2); });
    visual.dy = 0;
    await glow;
  }

  async weather(id) {
    const tint = {raindance: '#3060c0', primordialsea: '#3060c0', sunnyday: '#f8e090', desolateland: '#f8a060', sandstorm: '#c8a060',
      hail: '#e0f0f8', deltastream: '#c0d0f0'}[id];
    if (!tint) return;
    this.scene.flash = {color: tint, alpha: 0};
    await this.clock.tween(900, progress => { this.scene.flash.alpha = Math.sin(progress * Math.PI) * .35; });
    this.scene.flash = null;
  }

  /** Mega Evolution, Ultra Burst, Primal Reversion and Transform: a bright flash over the Pokémon. */
  async transform(visual) {
    await this.clock.tween(500, progress => { visual.tint = {color: '#ffffff', amount: Math.sin(progress * Math.PI)}; });
    visual.tint = null;
  }
}
