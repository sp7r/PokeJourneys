'use strict';
const fs = require('fs');
function readObj(file) {
  const vertices = [], uv = [], groups = new Map(); let name = '';
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const p = raw.trim().split(/\s+/);
    if (p[0] === 'v') vertices.push([+p[1], +p[3], -p[2]]);
    if (p[0] === 'vt') uv.push([+p[1], 1 - p[2]]);
    if (p[0] === 'usemtl') name = p.slice(1).join(' ');
    if (p[0] !== 'f') continue;
    if (!groups.has(name)) groups.set(name, { name, vertices: [], uv: [], indices: [] });
    const s = groups.get(name);
    for (let i = 2; i < p.length - 1; i++) for (const token of [p[1], p[i], p[i + 1]]) {
      const [vi, ti] = token.split('/').map(Number);
      s.vertices.push(vertices[vi > 0 ? vi - 1 : vertices.length + vi]);
      s.uv.push(ti ? uv[ti > 0 ? ti - 1 : uv.length + ti] : [0, 0]);
    }
  } return [...groups.values()];
}
function placements(mapFile) {
  const lines = fs.readFileSync(mapFile, 'utf8').split(/\r?\n/).map(s => s.trim()); let current; const result = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] === 'mapstart') current = { xy: lines[++i].split(/\s+/).map(Number), tiles: [], heights: [] };
    else if (lines[i] === 'tilegrid' || lines[i] === 'heightgrid') {
      const dest = lines[i] === 'tilegrid' ? current.tiles : current.heights;
      dest.push(Array.from({ length: 32 }, () => lines[++i].split(/\s+/).map(Number)));
    } else if (lines[i] === 'mapend') {
      current.tiles.forEach((grid, layer) => grid.forEach((row, y) => row.forEach((id, x) => {
        if (id >= 0) result.push({ id, tile: [current.xy[0] * 32 + x, current.xy[1] * 32 + 31 - y], height: current.heights[layer][y][x], layer });
      })));
    }
  } return result;
}
module.exports = { readObj, placements };
