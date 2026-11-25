// Converts a converted Black 2 / HGSS model (.glb with sidecar PNGs) into an OBJ + MTL that DS Map Studio can import
// as a tile. Units: tiles (hubUnits / tile), DS Map Studio axes: x east, y north, z up. The model is centred on its
// footprint and moved so its footprint starts at (0, 0); the footprint size in whole tiles is returned.
// Skinned meshes are posed with their joints (as the hub draws them). Textures are copied next to the OBJ.
const fs = require('fs');
const path = require('path');

const COMP = { 5120: [Int8Array, 1], 5121: [Uint8Array, 1], 5122: [Int16Array, 2], 5123: [Uint16Array, 2], 5125: [Uint32Array, 4], 5126: [Float32Array, 4] };
const SIZE = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

function readAccessor(gltf, bin, index) {
  const a = gltf.accessors[index], bv = gltf.bufferViews[a.bufferView], [Type, bytes] = COMP[a.componentType], n = SIZE[a.type];
  const stride = bv.byteStride || bytes * n, base = (bv.byteOffset || 0) + (a.byteOffset || 0), out = [];
  const view = new DataView(bin.buffer, bin.byteOffset);
  for (let i = 0; i < a.count; i++) {
    const v = [];
    for (let k = 0; k < n; k++) {
      const o = base + i * stride + k * bytes;
      let x = Type === Float32Array ? view.getFloat32(o, true) : Type === Uint16Array ? view.getUint16(o, true) : Type === Uint32Array ? view.getUint32(o, true)
        : Type === Uint8Array ? view.getUint8(o) : Type === Int16Array ? view.getInt16(o, true) : view.getInt8(o);
      if (a.normalized && Type !== Float32Array) x /= Type === Uint8Array ? 255 : Type === Uint16Array ? 65535 : Type === Int16Array ? 32767 : 127;
      v.push(x);
    }
    out.push(n === 1 ? v[0] : v);
  }
  return out;
}
// 4x4 column-major matrices as in glTF
const ident = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const mul = (a, b) => { const o = new Array(16).fill(0); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k]; return o; };
const apply = (m, [x, y, z]) => [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]];
function local(node) {
  if (node.matrix) return node.matrix.slice();
  const [tx, ty, tz] = node.translation || [0, 0, 0], [qx, qy, qz, qw] = node.rotation || [0, 0, 0, 1], [sx, sy, sz] = node.scale || [1, 1, 1];
  const r = [1 - 2 * (qy * qy + qz * qz), 2 * (qx * qy + qz * qw), 2 * (qx * qz - qy * qw), 0,
    2 * (qx * qy - qz * qw), 1 - 2 * (qx * qx + qz * qz), 2 * (qy * qz + qx * qw), 0,
    2 * (qx * qz + qy * qw), 2 * (qy * qz - qx * qw), 1 - 2 * (qx * qx + qy * qy), 0, 0, 0, 0, 1];
  return [r[0] * sx, r[1] * sx, r[2] * sx, 0, r[4] * sy, r[5] * sy, r[6] * sy, 0, r[8] * sz, r[9] * sz, r[10] * sz, 0, tx, ty, tz, 1];
}

// glbFile -> outDir/<name>.obj/.mtl + textures. scale: hub model scale; tile: hub units per tile;
// rotY: turn about the vertical axis first, in degrees as the hub's model rotY (DS Map Studio tiles cannot be rotated).
// frame: another model's bounds ([minX, minY, maxX, maxY] in tile units) to centre on instead of this model's own,
// so two parts of one building (sharing an origin in the game) line up when placed on the same cell
// The posed triangles of a .glb: world-space vertices, UVs (v flipped as in OBJ) and faces [material, [[v, t] x3]].
function geometry(glbFile) {
  const buf = fs.readFileSync(glbFile);
  const jsonLen = buf.readUInt32LE(12), gltf = JSON.parse(buf.toString('utf8', 20, 20 + jsonLen));
  const binStart = 20 + jsonLen + 8, bin = buf.subarray(binStart, binStart + buf.readUInt32LE(20 + jsonLen));
  const world = new Array(gltf.nodes.length);
  const parent = new Array(gltf.nodes.length).fill(-1);
  gltf.nodes.forEach((n, i) => (n.children || []).forEach((c) => (parent[c] = i)));
  const globalOf = (i) => world[i] || (world[i] = parent[i] < 0 ? local(gltf.nodes[i]) : mul(globalOf(parent[i]), local(gltf.nodes[i])));
  const verts = [], uvs = [], faces = []; // faces: [material, [[v, t], ...]]
  gltf.nodes.forEach((node, ni) => {
    if (node.mesh === undefined) return;
    const skin = node.skin !== undefined ? gltf.skins[node.skin] : null;
    const jointMats = skin ? skin.joints.map((j, k) => mul(globalOf(j), skin.inverseBindMatrices !== undefined ? readAccessor(gltf, bin, skin.inverseBindMatrices)[k] : ident())) : null;
    const nodeMat = skin ? null : globalOf(ni);
    for (const p of gltf.meshes[node.mesh].primitives) {
      if (p.mode !== undefined && p.mode !== 4) continue;
      const pos = readAccessor(gltf, bin, p.attributes.POSITION);
      const uv = p.attributes.TEXCOORD_0 !== undefined ? readAccessor(gltf, bin, p.attributes.TEXCOORD_0) : pos.map(() => [0, 0]);
      const joints = skin && p.attributes.JOINTS_0 !== undefined ? readAccessor(gltf, bin, p.attributes.JOINTS_0) : null;
      const weights = skin && p.attributes.WEIGHTS_0 !== undefined ? readAccessor(gltf, bin, p.attributes.WEIGHTS_0) : null;
      const idx = p.indices !== undefined ? readAccessor(gltf, bin, p.indices) : pos.map((_, i) => i);
      const v0 = verts.length, t0 = uvs.length;
      pos.forEach((v, i) => {
        let w;
        if (joints) { w = [0, 0, 0]; for (let k = 0; k < 4; k++) { const wt = weights[i][k]; if (!wt) continue; const q = apply(jointMats[joints[i][k]], v); w = [w[0] + q[0] * wt, w[1] + q[1] * wt, w[2] + q[2] * wt]; } }
        else w = apply(nodeMat, v);
        verts.push(w);
      });
      uv.forEach((t) => uvs.push([t[0], 1 - t[1]]));
      for (let i = 0; i + 2 < idx.length; i += 3) faces.push([p.material ?? -1, [0, 1, 2].map((k) => [v0 + idx[i + k], t0 + idx[i + k]])]);
    }
  });
  if (!verts.length) throw new Error('no geometry in ' + glbFile);
  return { gltf, verts, uvs, faces };
}

function convert(glbFile, outDir, name, scale, tile, rotY = 0, frame = null) {
  const { gltf, verts, uvs, faces } = geometry(glbFile);
  // to tile units, DS axes (x east, y north, z up), footprint from the origin
  const s = scale / tile;
  const ca = Math.cos(rotY * Math.PI / 180), sa = Math.sin(rotY * Math.PI / 180);
  const ds = verts.map(([x, y, z]) => { const rx = x * ca + z * sa, rz = -x * sa + z * ca; return [rx * s, -rz * s, y * s]; });
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const v of ds) for (let k = 0; k < 3; k++) { if (v[k] < lo[k]) lo[k] = v[k]; if (v[k] > hi[k]) hi[k] = v[k]; }
  const [minX, minY, minZ] = frame ? [frame[0], frame[1], lo[2]] : lo, [maxX, maxY] = frame ? [frame[2], frame[3]] : hi;
  // DS Map Studio tiles are at most 6x6; larger models keep their full size and overhang a centred 6x6 square
  const MAX = 6, fullW = Math.max(1, Math.ceil(maxX - minX - 0.05)), fullH = Math.max(1, Math.ceil(maxY - minY - 0.05));
  const w = Math.min(MAX, fullW), h = Math.min(MAX, fullH);
  const ox = (w - (maxX - minX)) / 2 - minX, oy = (h - (maxY - minY)) / 2 - minY;
  fs.mkdirSync(outDir, { recursive: true });
  const mats = (gltf.materials || []).map((m, i) => {
    const tex = m.pbrMetallicRoughness?.baseColorTexture;
    const img = tex !== undefined ? gltf.images[gltf.textures[tex.index].source].uri : null;
    return { name: `${name}_${(m.name || 'm' + i).replace(/[^A-Za-z0-9_]/g, '_')}`, img };
  });
  let mtl = '';
  for (const m of mats) {
    if (!m.img) continue;
    const dst = `${name}_${m.img}`;
    fs.copyFileSync(path.join(path.dirname(glbFile), m.img), path.join(outDir, dst));
    mtl += `newmtl ${m.name}\nmap_Kd ${dst}\nmap_d ${dst}\n\n`;
  }
  let obj = `mtllib ${name}.mtl\no ${name}\n`;
  for (const v of ds) obj += `v ${(v[0] + ox).toFixed(4)} ${(v[1] + oy).toFixed(4)} ${(v[2] - Math.min(0, minZ) * 0).toFixed(4)}\n`;
  for (const t of uvs) obj += `vt ${t[0].toFixed(5)} ${t[1].toFixed(5)}\n`;
  // flat normals per face; DS Map Studio needs them present
  const normals = [];
  for (const [, f] of faces) {
    const [a, b, c] = f.map(([vi]) => ds[vi]), u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]], l = Math.hypot(...n) || 1;
    normals.push(n.map((q) => q / l));
  }
  for (const n of normals) obj += `vn ${n[0].toFixed(4)} ${n[1].toFixed(4)} ${n[2].toFixed(4)}\n`;
  let current = null;
  faces.forEach(([m, f], i) => {
    const mat = mats[m];
    if (!mat || !mat.img) return;
    if (mat.name !== current) { obj += `usemtl ${mat.name}\n`; current = mat.name; }
    obj += 'f ' + f.map(([vi, ti]) => `${vi + 1}/${ti + 1}/${i + 1}`).join(' ') + '\n';
  });
  fs.writeFileSync(path.join(outDir, `${name}.obj`), obj);
  fs.writeFileSync(path.join(outDir, `${name}.mtl`), mtl);
  return { w, h, fullW, fullH, height: hi[2] - minZ, bounds: [minX, minY, maxX, maxY] };
}
module.exports = { convert, geometry };

if (require.main === module) {
  const [glb, outDir, name, scale = '1', tile = '20', rotY = '0'] = process.argv.slice(2);
  console.log(JSON.stringify(convert(glb, outDir, name, +scale, +tile, +rotY)));
}
