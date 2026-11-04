/* Shared helpers for the card tools (add.html and edit.html): entry text,
   editing the live site.js and index.html, downloads. */
(function () {
  'use strict';

  const q = (s) => "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
  const base = (name) => name.replace(/\.(gh|ghx)$/i, '');
  const graphPath = (fileName) => 'graphs/' + base(fileName) + '.json';
  const titleFromFile = (name) => base(name).replace(/[_\s]+/g, ' ').replace(/\s+/g, ' ').trim()
    .split(' ').map((w) => (w.length > 3 && w === w.toLowerCase() ? w[0].toUpperCase() + w.slice(1) : w)).join(' ');
  const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  function recipeText(rc) {
    return `{ base: ${q(rc.base)}, pattern: ${rc.pattern ? q(rc.pattern) : 'null'}, ops: [${(rc.ops || []).map(q).join(', ')}], overlay: [${(rc.overlay || []).map(q).join(', ')}], seed: ${rc.seed | 0}, density: ${rc.density} }`;
  }

  /* d: { file, title, cat, preview, variant, recipe, media, tags, desc } */
  function entryText(d) {
    const fromFile = d.preview === 'graph' || d.preview === 'composed';
    const v = fromFile || d.variant === undefined || d.variant === '' || d.variant === null ? '' : `, variant: ${typeof d.variant === 'number' ? d.variant : q(d.variant)}`;
    const extra = d.preview === 'graph' ? `, graph: ${q(graphPath(d.file))}` : d.preview === 'composed' && d.recipe ? `, recipe: ${recipeText(d.recipe)}` : '';
    const media = d.media ? `, media: ${q(d.media)}` : '';
    const tags = d.tags && d.tags.length ? d.tags : ['Grasshopper'];
    return `{ file: ${q(d.file)}, title: ${q(d.title)}, cat: ${q(d.cat)}, preview: ${q(d.preview)}${v}${extra}${media}, tags: [${tags.map(q).join(', ')}],\n      desc: ${q(d.desc)} }`;
  }

  async function fetchText(path) {
    const r = await fetch(path + (path.includes('?') ? '&' : '?') + 't=' + Date.now(), { cache: 'no-store' });
    if (!r.ok) throw new Error(path + ' could not be read (' + r.status + ')');
    return r.text();
  }
  const entryRe = (file) => new RegExp("\\{ file: '" + escRe(file) + "'[\\s\\S]*?\\}(?=,\\n|\\n  \\];)");

  /* Insert a new entry at the end of DATA. */
  function addEntry(src, entry, file) {
    if (src.includes('file: ' + q(file))) throw new Error('site.js already has a card for ' + file + '.');
    const start = src.indexOf('const DATA = ['); if (start < 0) throw new Error('DATA list not found in site.js.');
    const end = src.indexOf('\n  ];', start); if (end < 0) throw new Error('End of DATA list not found in site.js.');
    const before = src.slice(0, end), empty = /\[\s*$/.test(before);
    return orderAdd(before + (empty ? '\n    ' : ',\n    ') + entry + src.slice(end), file);
  }
  /* Replace the entry whose file is oldFile with entry (which may carry a new file name). */
  function replaceEntry(src, oldFile, entry, newFile) {
    const re = entryRe(oldFile);
    if (!re.test(src)) throw new Error('The entry for ' + oldFile + ' was not found in site.js.');
    const out = src.replace(re, entry);
    return newFile && newFile !== oldFile ? orderRename(out, oldFile, newFile) : out;
  }
  /* Remove the entry whose file is file, tidying the comma. */
  function removeEntry(src, file) {
    const re = new RegExp("(,\\n    )?\\{ file: '" + escRe(file) + "'[\\s\\S]*?\\}(?=,\\n|\\n  \\];)(,)?");
    if (!re.test(src)) throw new Error('The entry for ' + file + ' was not found in site.js.');
    return orderRemove(src.replace(re, (m, leadComma, trailComma) => (leadComma && trailComma ? ',' : '')), file);
  }
  /* ----- the ORDER list (display order of cards) ----- */
  const ORDER_RE = /const ORDER = \[([\s\S]*?)\];/;
  function orderList(src) {
    const m = src.match(ORDER_RE); if (!m) return null;
    const out = []; m[1].replace(/'((?:[^'\\]|\\.)*)'/g, (mm, f) => { out.push(f.replace(/\\(.)/g, '$1')); return mm; });
    return out;
  }
  function setOrder(src, files) {
    if (!ORDER_RE.test(src)) return src;
    const body = files.length ? '\n' + files.map((f) => '    ' + q(f)).join(',\n') + '\n  ' : '';
    return src.replace(ORDER_RE, 'const ORDER = [' + body + '];');
  }
  function orderAdd(src, file) { const o = orderList(src); if (!o || o.includes(file)) return src; o.push(file); return setOrder(src, o); }
  function orderRename(src, oldFile, newFile) { const o = orderList(src); if (!o) return src; const i = o.indexOf(oldFile); if (i < 0) return orderAdd(src, newFile); if (oldFile !== newFile) o[i] = newFile; return setOrder(src, o); }
  function orderRemove(src, file) { const o = orderList(src); if (!o) return src; return setOrder(src, o.filter((f) => f !== file)); }

  function bumpIndex(src) {
    let max = 0; src.replace(/\?v=(\d+)/g, (m, n) => { max = Math.max(max, Number(n)); return m; });
    return src.replace(/\?v=\d+/g, '?v=' + (max + 1));
  }
  function download(name, data) {
    const blob = data instanceof Blob ? data : new Blob([data], { type: 'text/plain' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  async function fetchLive() {
    const [site, index] = await Promise.all([fetchText('assets/site.js'), fetchText('index.html')]);
    return { site, index };
  }

  window.GHTool = { q, base, graphPath, titleFromFile, entryText, recipeText, fetchText, fetchLive, addEntry, replaceEntry, removeEntry, orderList, setOrder, bumpIndex, download };
})();
