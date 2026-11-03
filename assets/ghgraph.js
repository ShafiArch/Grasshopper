/* Reads a binary Grasshopper .gh file in the browser and extracts its wiring
   diagram: component boxes, parameter boxes, groups and wires, in canvas
   coordinates. A .gh file is a raw DEFLATE stream of a GH_IO binary archive
   (a tree of named chunks and typed items). Nothing is evaluated; the geometry
   the definition would produce is not available without Grasshopper. */
(function () {
  'use strict';

  const LIB_NAMES = {
    kangaroo: 'Kangaroo', lunchbox: 'LunchBox', elk: 'Elk', ladybug: 'Ladybug', honeybee: 'Honeybee', butterfly: 'Butterfly',
    octopus: 'Octopus', biomorpher: 'Biomorpher', galapagos: 'Galapagos', climatestudio: 'ClimateStudio', 'tt toolbox': 'TT Toolbox',
    tttoolbox: 'TT Toolbox', weaverbird: 'Weaverbird', pufferfish: 'Pufferfish', human: 'Human', anemone: 'Anemone', karamba: 'Karamba',
    wasp: 'Wasp', dendro: 'Dendro', 'mesh+': 'Mesh+', telepathy: 'Telepathy', metahopper: 'MetaHopper', elefront: 'Elefront'
  };

  /* ---------- inflate ---------- */
  async function inflateRaw(buf) {
    if (typeof DecompressionStream === 'function') {
      try {
        const ds = new DecompressionStream('deflate-raw');
        const stream = new Blob([buf]).stream().pipeThrough(ds);
        return new Uint8Array(await new Response(stream).arrayBuffer());
      } catch (e) { /* fall through */ }
    }
    if (typeof pako !== 'undefined' && pako.inflateRaw) return pako.inflateRaw(new Uint8Array(buf));
    throw new Error('This browser cannot decompress .gh files. Use a current Chrome, Edge, Firefox or Safari.');
  }

  /* ---------- GH_IO binary archive reader ---------- */
  function reader(u8) {
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    let i = 0;
    const td = new TextDecoder('utf-8');
    const r = {
      get pos() { return i; }, get len() { return u8.length; },
      u8() { return u8[i++]; },
      i32() { const v = dv.getInt32(i, true); i += 4; return v; },
      f32() { const v = dv.getFloat32(i, true); i += 4; return v; },
      f64() { const v = dv.getFloat64(i, true); i += 8; return v; },
      skip(n) { i += n; },
      str() { let n = 0, sh = 0, c; do { c = u8[i++]; n |= (c & 0x7f) << sh; sh += 7; } while (c & 0x80); const s = td.decode(u8.subarray(i, i + n)); i += n; return s; },
      guid() { let s = ''; for (let k = 0; k < 16; k++) s += u8[i + k].toString(16).padStart(2, '0'); i += 16; return s; }
    };
    return r;
  }
  const FIXED = { 1: 1, 2: 1, 3: 4, 4: 8, 5: 4, 6: 8, 7: 16, 8: 8, 9: 16, 30: 8, 31: 8, 32: 8, 33: 8, 34: 16, 35: 16, 36: 4, 50: 16, 51: 24, 52: 32, 60: 16, 61: 32, 70: 48, 71: 48, 72: 72, 80: 12 };
  function readItem(r) {
    const name = r.str(), idx = r.i32(), type = r.i32();
    let val;
    if (type === 3) val = r.i32();
    else if (type === 9) val = r.guid();
    else if (type === 10) val = r.str();
    else if (type === 31) val = [r.f32(), r.f32()];
    else if (type === 35) val = [r.f32(), r.f32(), r.f32(), r.f32()];
    else if (type === 20 || type === 37) { const n = r.i32(); r.skip(n); val = null; }
    else if (type === 21) { const n = r.i32(); r.skip(8 * n); val = null; }
    else if (FIXED[type] !== undefined) { r.skip(FIXED[type]); val = null; }
    else throw new Error('Unknown item type ' + type + ' (' + name + ') at byte ' + r.pos);
    return { name, idx, type, val };
  }
  function readChunk(r) {
    const name = r.str(), idx = r.i32(), ni = r.i32(), nc = r.i32();
    const items = [], chunks = [];
    for (let k = 0; k < ni; k++) items.push(readItem(r));
    for (let k = 0; k < nc; k++) chunks.push(readChunk(r));
    return { name, idx, items, chunks };
  }
  const find = (ch, name) => ch.chunks.filter((c) => c.name === name);
  const item = (ch, name) => { const it = ch.items.find((x) => x.name === name); return it ? it.val : undefined; };
  const itemsNamed = (ch, name) => ch.items.filter((x) => x.name === name).map((x) => x.val);

  /* ---------- graph extraction ---------- */
  function attrRect(ch) {
    const a = find(ch, 'Attributes')[0]; if (!a) return null;
    const b = item(a, 'Bounds'), p = item(a, 'Pivot');
    if (b) return [b[0], b[1], b[2], b[3]];
    if (p) return [p[0] - 25, p[1] - 10, 50, 20];
    return null;
  }
  function extract(root) {
    const defn = find(root, 'Definition')[0]; if (!defn) throw new Error('No Definition chunk; is this a Grasshopper file?');
    const objs = find(defn, 'DefinitionObjects')[0]; if (!objs) throw new Error('No objects found in the definition.');
    const libs = [];
    for (const c of find(defn, 'GHALibraries')) for (const l of c.chunks) { const n = item(l, 'Name'); if (n) libs.push(n); }
    const nodes = [], anchors = new Map(), inputs = [], groups = [], names = [];
    for (const o of objs.chunks) {
      const name = item(o, 'Name') || '';
      const cont = find(o, 'Container')[0]; if (!cont) continue;
      if (name === 'Group') { groups.push(itemsNamed(cont, 'ID')); continue; }
      const rect = attrRect(cont); if (!rect) continue;
      const iid = item(cont, 'InstanceGuid');
      names.push(name);
      let pin = find(cont, 'param_input'), pout = find(cont, 'param_output');
      const pdata = find(cont, 'ParameterData')[0];
      if (pdata) { pin = find(pdata, 'InputParam'); pout = find(pdata, 'OutputParam'); }
      const isComp = pin.length > 0 || pout.length > 0;
      nodes.push([rect[0], rect[1], rect[2], rect[3], isComp ? 0 : 1, iid]);
      if (isComp) {
        pin.forEach((p, k) => {
          const r = attrRect(p) || [rect[0], rect[1] + rect[3] * (k + 0.5) / Math.max(1, pin.length) - 10, 20, 20];
          const srcs = itemsNamed(p, 'Source'); if (srcs.length) inputs.push([r[0], r[1] + r[3] / 2, srcs]);
        });
        pout.forEach((p, k) => {
          const r = attrRect(p) || [rect[0] + rect[2] - 20, rect[1] + rect[3] * (k + 0.5) / Math.max(1, pout.length) - 10, 20, 20];
          const pid = item(p, 'InstanceGuid'); if (pid) anchors.set(pid, [r[0] + r[2], r[1] + r[3] / 2]);
        });
      } else {
        if (iid) anchors.set(iid, [rect[0] + rect[2], rect[1] + rect[3] / 2]);
        const srcs = itemsNamed(cont, 'Source'); if (srcs.length) inputs.push([rect[0], rect[1] + rect[3] / 2, srcs]);
      }
    }
    const edges = [];
    for (const [x, y, srcs] of inputs) for (const s of srcs) { const a = anchors.get(s); if (a) edges.push([a[0], a[1], x, y]); }
    const byId = new Map(); for (const n of nodes) if (n[5]) byId.set(n[5], n);
    for (const members of groups) {
      const rs = members.map((m) => byId.get(m)).filter(Boolean); if (!rs.length) continue;
      const x0 = Math.min(...rs.map((r) => r[0])) - 10, y0 = Math.min(...rs.map((r) => r[1])) - 10;
      const x1 = Math.max(...rs.map((r) => r[0] + r[2])) + 10, y1 = Math.max(...rs.map((r) => r[1] + r[3])) + 10;
      nodes.push([x0, y0, x1 - x0, y1 - y0, 2, null]);
    }
    if (!nodes.length) throw new Error('The definition has no objects with a position.');
    const mx = Math.min(...nodes.map((n) => n[0])), my = Math.min(...nodes.map((n) => n[1]));
    const W = Math.max(...nodes.map((n) => n[0] + n[2])) - mx, H = Math.max(...nodes.map((n) => n[1] + n[3])) - my;
    const rd = (v) => Math.round(v * 10) / 10;
    const graph = {
      v: 1, w: rd(W), h: rd(H),
      n: nodes.map((n) => [rd(n[0] - mx), rd(n[1] - my), rd(n[2]), rd(n[3]), n[4]]),
      e: edges.map((e) => [rd(e[0] - mx), rd(e[1] - my), rd(e[2] - mx), rd(e[3] - my)]),
      stats: { components: nodes.filter((n) => n[4] === 0).length, params: nodes.filter((n) => n[4] === 1).length, wires: edges.length, groups: nodes.filter((n) => n[4] === 2).length }
    };
    const tags = [];
    const add = (v) => { if (!tags.includes(v)) tags.push(v); };
    for (const l of libs) for (const k in LIB_NAMES) if (l.toLowerCase().includes(k)) add(LIB_NAMES[k]);
    for (const nm of names) {
      const low = nm.toLowerCase();
      for (const k in LIB_NAMES) if (low.startsWith(k)) add(LIB_NAMES[k]);
      if (/^(lb |ladybug)/.test(low)) add('Ladybug'); if (/^(hb |honeybee)/.test(low)) add('Honeybee');
      if (low === 'galapagos') add('Galapagos'); if (low.startsWith('octopus')) add('Octopus'); if (low.startsWith('biomorpher')) add('Biomorpher');
    }
    return { graph, libs, tags, names: [...new Set(names)].sort() };
  }

  /* Suggest the closest schematic type and a category from what is in the file. */
  const HINTS = [
    [/voronoi/, 'surfVoronoi', 'form'], [/kangaroo|solver|anchor|length|springs?/, 'cloth', 'structure'], [/diagrid|diamond panels/, 'diagrid', 'form'],
    [/hex/, 'hex', 'form'], [/honeybee|energy|energyplus|openstudio|ideal air/, 'massing', 'environment'], [/ladybug|sunpath|sun path|radiation/, 'massing', 'environment'],
    [/butterfly|cfd|openfoam/, 'airflow', 'environment'], [/daylight|illuminance|climatestudio/, 'daylight', 'environment'],
    [/galapagos|octopus|optimi/, 'path', 'optimization'], [/biomorpher/, 'branching', 'optimization'], [/elk|osm|openstreetmap/, 'osmMap', 'urban'],
    [/alignment|road|lane/, 'elevatedRoad', 'urban'], [/pier/, 'elevatedRoad', 'urban'], [/contour|terrain|topograph/, 'terrain', 'form'],
    [/facade|louver|fins?/, 'facadePanels', 'building'], [/stadium|seating|auditorium|rake/, 'auditorium', 'building'],
    [/truss/, 'spaceTruss', 'structure'], [/fold/, 'foldedPlate', 'form'], [/waffle|section|contour/, 'waffle', 'building'],
    [/twist|tower|floor/, 'twistTower', 'form'], [/stair|helix|spiral/, 'spiralStair', 'building'], [/attractor/, 'attractorScreen', 'form'],
    [/surface morph|morph|isotrim|divide surface/, 'isoSurface', 'form'], [/extrude|plan|walls?/, 'planExtrude', 'building']
  ];
  function suggest(info) {
    const hay = (info.names.join(' ') + ' ' + info.libs.join(' ')).toLowerCase();
    for (const [re, type, cat] of HINTS) if (re.test(hay)) return { preview: type, cat };
    return { preview: 'isoSurface', cat: 'form' };
  }

  /* Build a geometry recipe (see G.composed in previews.js) from what the file contains. */
  function hashStr(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) % 100000; }
  function recipe(info, fileName) {
    const names = info.names.map((n) => n.toLowerCase()), fn = (fileName || '').toLowerCase().replace(/[_-]+/g, ' ');
    const tags = info.tags || [];
    const count = (re) => names.filter((n) => re.test(n)).length + (re.test(fn) ? 2 : 0);
    const pick = (scores, order) => { let best = null, bs = 0; for (const k of order) if (scores[k] > bs) { bs = scores[k]; best = k; } return best; };
    const baseScores = {
      mesh: count(/kangaroo|solver|anchor|^load$|length\(line\)|^mesh|tensile|relax/) * 2 + (tags.includes('Kangaroo') ? 4 : 0),
      box: count(/^box$|box rectangle|masses|^hb |honeybee|ladybug|zone|massing|building|energy|room|thermal|roof/) + (tags.includes('Honeybee') ? 3 : 0),
      dome: count(/sphere|^arc|revolve|dome|shell|vault/) * 2,
      curve: count(/divide curve|perp frames|interpolate|offset curve|alignment|road|pier|lane|curve array|sweep|bridge/),
      ring: count(/polygon|ellipse|radial|stadium|circular|auditorium|arena/) * 1.5,
      plane: count(/rectangle|xy plane|xz plane|screen|facade|elevation|plan$|wall|louver|fins?$/),
      surface: count(/surface|loft|isotrim|evaluate surface|4point|edge surface|srf|morph/)
    };
    const base = pick(baseScores, ['mesh', 'box', 'dome', 'curve', 'ring', 'plane', 'surface']) || 'surface';
    const patScores = {
      voronoi: count(/voronoi/) * 3, hex: count(/hexagon|hex /) * 3, diagrid: count(/diamond|diagrid|triang|triremesh/) * 3,
      contours: count(/contour|section/) * 3, circles: count(/circle|polygon/) * (base === 'plane' || base === 'surface' || base === 'box' ? 1.5 : 0.5),
      scatter: count(/populate|random|jitter/) * 1.5, grid: count(/divide surface|isotrim|divide domain|panel|subsrf|grid/) + 0.5,
      stripes: count(/series|array|divide distance/) * 0.6
    };
    let pattern = pick(patScores, ['voronoi', 'hex', 'diagrid', 'contours', 'circles', 'scatter', 'grid', 'stripes']);
    if (base === 'curve' && pattern === 'grid') pattern = 'stripes';
    if (base === 'box' && pattern === 'grid') pattern = 'circles';
    const opScores = {
      extrude: count(/extrude|cap holes/), offset: count(/offset/), attractor: count(/closest point|remap|distance|pull point|attract/),
      rotate: count(/rotate|orient/), jitter: count(/jitter|random/), scale: count(/^scale/), pipe: count(/pipe/),
      loft: count(/loft|sweep|ruled/), morph: count(/morph/), array: count(/array/)
    };
    const ops = Object.keys(opScores).filter((k) => opScores[k] > 0).sort((a, b) => opScores[b] - opScores[a]).slice(0, 4);
    const overlay = [];
    if (tags.includes('Ladybug') || tags.includes('Honeybee') || count(/sunpath|sun path|radiation/)) overlay.push('sun');
    if (tags.includes('ClimateStudio') || count(/daylight|illuminance|radiance|sensor/)) overlay.push('sensors');
    if (tags.includes('Butterfly') || count(/airflow|cfd|wind/)) overlay.push('airflow');
    if (tags.includes('Kangaroo') && base !== 'mesh') overlay.push('kangaroo');
    if (tags.includes('Galapagos') || tags.includes('Octopus') || count(/galapagos|octopus|colibri|optimi/)) overlay.push('search');
    if (tags.includes('Biomorpher') || count(/biomorpher|anemone|wasp|growth|aggregat/)) overlay.push('growth');
    const comps = info.graph.stats.components;
    return { base, pattern, ops, overlay, seed: hashStr(fileName || names.join('')), density: Math.round((0.35 + 0.5 * Math.min(1, comps / 120)) * 100) / 100 };
  }

  async function parse(buf) {
    const u8 = await inflateRaw(buf);
    const r = reader(u8);
    const root = readChunk(r);
    const info = extract(root);
    info.suggest = suggest(info);
    return info;
  }

  const api = { parse, extract, suggest, recipe, readChunk, reader, inflateRaw };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.GHGraph = api;
})();
