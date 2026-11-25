// Minimal reader for Minecraft Bedrock worlds (LevelDB with Mojang's zlib compression), enough to read
// overworld block columns. Works on a copy of the world's db folder; never writes.
// Exports readWorld(dbDir) -> { blockAt(x, y, z), stateAt(x, y, z), chunks: [[cx, cz], ...] } (block names like
// "minecraft:grass_block"; states as stored, e.g. { weirdo_direction: 2 } for stairs).
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function varint(buf, pos) {
  let result = 0, shift = 0, b;
  do { b = buf[pos.p++]; result += (b & 0x7f) * 2 ** shift; shift += 7; } while (b & 0x80);
  return result;
}
function decompress(data, type) {
  if (type === 0) return data;
  if (type === 2) return zlib.inflateSync(data);
  if (type === 4) return zlib.inflateRawSync(data);
  throw new Error('Unsupported LevelDB block compression ' + type);
}
function blockEntries(block, out) {
  const restarts = block.readUInt32LE(block.length - 4);
  const end = block.length - 4 - restarts * 4;
  const pos = { p: 0 };
  let key = Buffer.alloc(0);
  while (pos.p < end) {
    const shared = varint(block, pos), unshared = varint(block, pos), vlen = varint(block, pos);
    key = Buffer.concat([key.subarray(0, shared), block.subarray(pos.p, pos.p + unshared)]); pos.p += unshared;
    out.push([key, block.subarray(pos.p, pos.p + vlen)]); pos.p += vlen;
  }
}
function readBlock(file, handle) {
  const pos = { p: 0 }, off = varint(handle, pos), size = varint(handle, pos);
  return decompress(file.subarray(off, off + size), file[off + size]);
}
function readTable(file, put) {
  const footer = file.subarray(file.length - 48), pos = { p: 0 };
  varint(footer, pos); varint(footer, pos); // metaindex handle
  const idxHandle = footer.subarray(pos.p);
  const index = []; blockEntries(readBlock(file, idxHandle), index);
  for (const [, handle] of index) {
    const entries = []; blockEntries(readBlock(file, handle), entries);
    for (const [ikey, value] of entries) {
      const tag = ikey.readBigUInt64LE(ikey.length - 8);
      put(ikey.subarray(0, ikey.length - 8), Number(tag >> 8n), Number(tag & 0xffn), value);
    }
  }
}
function readLog(file, put) {
  let record = [], pos = 0;
  while (pos + 7 <= file.length) {
    const blockLeft = 32768 - (pos % 32768);
    if (blockLeft < 7) { pos += blockLeft; continue; }
    const len = file.readUInt16LE(pos + 4), type = file[pos + 6];
    if (type === 0 && len === 0) { pos += blockLeft; continue; }
    const data = file.subarray(pos + 7, pos + 7 + len); pos += 7 + len;
    if (type === 1) record = [data]; else if (type === 2) record = [data]; else record.push(data);
    if (type !== 1 && type !== 4) continue;
    const batch = Buffer.concat(record), seq = Number(batch.readBigUInt64LE(0)), count = batch.readUInt32LE(8);
    const p = { p: 12 };
    for (let i = 0; i < count; i++) {
      const kind = batch[p.p++], klen = varint(batch, p), key = batch.subarray(p.p, p.p + klen); p.p += klen;
      let value = null;
      if (kind === 1) { const vlen = varint(batch, p); value = batch.subarray(p.p, p.p + vlen); p.p += vlen; }
      put(key, seq + i, kind, value);
    }
  }
}
// Little-endian NBT, enough for block palette entries.
function nbt(buf, pos) {
  const str = () => { const n = buf.readUInt16LE(pos.p); pos.p += 2; const s = buf.toString('utf8', pos.p, pos.p + n); pos.p += n; return s; };
  const payload = (t) => {
    switch (t) {
      case 1: return buf.readInt8(pos.p++);
      case 2: { const v = buf.readInt16LE(pos.p); pos.p += 2; return v; }
      case 3: { const v = buf.readInt32LE(pos.p); pos.p += 4; return v; }
      case 4: { const v = buf.readBigInt64LE(pos.p); pos.p += 8; return v; }
      case 5: { const v = buf.readFloatLE(pos.p); pos.p += 4; return v; }
      case 6: { const v = buf.readDoubleLE(pos.p); pos.p += 8; return v; }
      case 7: { const n = buf.readInt32LE(pos.p); pos.p += 4 + n; return null; }
      case 8: return str();
      case 9: { const et = buf[pos.p++], n = buf.readInt32LE(pos.p); pos.p += 4; const a = []; for (let i = 0; i < n; i++) a.push(payload(et)); return a; }
      case 10: { const o = {}; for (;;) { const ct = buf[pos.p++]; if (ct === 0) return o; const name = str(); o[name] = payload(ct); } }
      case 11: { const n = buf.readInt32LE(pos.p); pos.p += 4 + 4 * n; return null; }
      case 12: { const n = buf.readInt32LE(pos.p); pos.p += 4 + 8 * n; return null; }
      default: throw new Error('NBT tag ' + t);
    }
  };
  const t = buf[pos.p++]; str(); return payload(t);
}
function subChunk(value) {
  const version = value[0], pos = { p: 1 };
  if (version !== 8 && version !== 9) return null;
  const storages = value[pos.p++];
  if (version === 9) pos.p++; // y index
  const layers = [];
  for (let s = 0; s < storages; s++) {
    const bits = value[pos.p++] >> 1;
    const indices = new Uint16Array(4096);
    if (bits > 0) {
      const perWord = Math.floor(32 / bits), words = Math.ceil(4096 / perWord), mask = (1 << bits) - 1;
      for (let w = 0, i = 0; w < words; w++) {
        const word = value.readUInt32LE(pos.p + w * 4);
        for (let k = 0; k < perWord && i < 4096; k++, i++) indices[i] = (word >>> (k * bits)) & mask;
      }
      pos.p += words * 4;
    }
    const n = bits > 0 ? value.readInt32LE(pos.p) : 1; if (bits > 0) pos.p += 4;
    const palette = []; for (let i = 0; i < n; i++) palette.push(nbt(value, pos));
    layers.push({ indices, palette: palette.map((e) => e.name), states: palette.map((e) => e.states || {}) });
  }
  return layers;
}

function latestRecords(dbDir) {
  const latest = new Map(); // key hex -> {seq, kind, value}
  const put = (key, seq, kind, value) => {
    const k = key.toString('hex'), old = latest.get(k);
    if (!old || seq > old.seq) latest.set(k, { key: Buffer.from(key), seq, kind, value: value && Buffer.from(value) });
  };
  for (const f of fs.readdirSync(dbDir)) {
    const file = fs.readFileSync(path.join(dbDir, f));
    if (f.endsWith('.ldb')) readTable(file, put); else if (f.endsWith('.log')) readLog(file, put);
  }
  return latest;
}
// Signs anywhere in the overworld: { signs: [{ x, y, z, text }] } (front text).
function readWorldSigns(dbDir) {
  const signs = [];
  for (const { key, kind, value } of latestRecords(dbDir).values()) {
    if (kind !== 1 || key.length !== 9 || key[8] !== 49) continue; // block entities
    const pos = { p: 0 };
    while (pos.p < value.length) {
      const e = nbt(value, pos);
      if (/Sign/i.test(e.id)) signs.push({ x: e.x, y: e.y, z: e.z, text: String((e.FrontText ? e.FrontText.Text : e.Text) || '').trim() });
    }
  }
  return { signs };
}
function readWorld(dbDir) {
  const latest = latestRecords(dbDir);
  const subs = new Map(), chunks = new Set();
  for (const { key, kind, value } of latest.values()) {
    if (kind !== 1 || (key.length !== 10)) continue; // overworld sub-chunk keys: x, z, tag 47, y
    if (key[8] !== 47) continue;
    const cx = key.readInt32LE(0), cz = key.readInt32LE(4), cy = key.readInt8(9);
    const layers = subChunk(value);
    if (layers) { subs.set(`${cx},${cy},${cz}`, layers); chunks.add(`${cx},${cz}`); }
  }
  return {
    chunks: [...chunks].map((s) => s.split(',').map(Number)),
    blockAt(x, y, z) {
      const cx = Math.floor(x / 16), cy = Math.floor(y / 16), cz = Math.floor(z / 16);
      const layers = subs.get(`${cx},${cy},${cz}`); if (!layers) return 'minecraft:air';
      const i = ((x - cx * 16) * 16 + (z - cz * 16)) * 16 + (y - cy * 16);
      return layers[0].palette[layers[0].indices[i]] || 'minecraft:air';
    },
    stateAt(x, y, z) {
      const cx = Math.floor(x / 16), cy = Math.floor(y / 16), cz = Math.floor(z / 16);
      const layers = subs.get(`${cx},${cy},${cz}`); if (!layers) return {};
      const i = ((x - cx * 16) * 16 + (z - cz * 16)) * 16 + (y - cy * 16);
      return layers[0].states[layers[0].indices[i]] || {};
    },
    subChunkYs() { return [...new Set([...subs.keys()].map((k) => +k.split(',')[1]))].sort((a, b) => a - b); },
  };
}
module.exports = { readWorld, readWorldSigns };
