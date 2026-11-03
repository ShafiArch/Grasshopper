/* Add-a-card tool: reads a Grasshopper file in the browser, animates its own
   wiring diagram (or one of the drawn schematics), builds the DATA entry,
   shows the card live, and produces the files to drop into the repository.
   It reads the current assets/site.js and index.html from the site itself,
   so it always edits the live versions. Nothing here writes to GitHub. */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const P = window.GHPreviews, S = window.GH_SITE, R = window.GHGraph;
  if (!P || !S || !R) { document.body.insertAdjacentHTML('beforeend', '<p class="hint status-err">A script did not load (previews.js, site.js or ghgraph.js).</p>'); return; }

  const state = { mode: 'new', file: null, fileName: '', preview: 'composed', variant: undefined, title: '', cat: 'form', tags: [], desc: '', graph: null, info: null, recipe: null, userCat: false, userTags: false };

  /* ----- helpers ----- */
  const q = (s) => "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
  const base = (name) => name.replace(/\.(gh|ghx)$/i, '');
  const graphPath = () => 'graphs/' + base(state.fileName) + '.json';
  const titleFromFile = (name) => base(name).replace(/[_\s]+/g, ' ').replace(/\s+/g, ' ').trim()
    .split(' ').map((w) => (w.length > 3 && w === w.toLowerCase() ? w[0].toUpperCase() + w.slice(1) : w)).join(' ');
  const fromFile = () => state.preview === 'graph' || state.preview === 'composed';
  function recipeText(rc) {
    return `{ base: ${q(rc.base)}, pattern: ${rc.pattern ? q(rc.pattern) : 'null'}, ops: [${rc.ops.map(q).join(', ')}], overlay: [${rc.overlay.map(q).join(', ')}], seed: ${rc.seed | 0}, density: ${rc.density} }`;
  }
  function entryText() {
    const v = fromFile() || state.variant === undefined || state.variant === '' ? '' : `, variant: ${typeof state.variant === 'number' ? state.variant : q(state.variant)}`;
    const extra = state.preview === 'graph' ? `, graph: ${q(graphPath())}` : state.preview === 'composed' && state.recipe ? `, recipe: ${recipeText(state.recipe)}` : '';
    const tags = state.tags.length ? state.tags : ['Grasshopper'];
    return `{ file: ${q(state.fileName)}, title: ${q(state.title)}, cat: ${q(state.cat)}, preview: ${q(state.preview)}${v}${extra}, tags: [${tags.map(q).join(', ')}],\n      desc: ${q(state.desc)} }`;
  }
  function entryObject() {
    return { file: state.fileName, title: state.title, cat: state.cat, preview: state.preview, variant: fromFile() ? undefined : state.variant, recipe: state.preview === 'composed' ? state.recipe : undefined, tags: state.tags.length ? state.tags : ['Grasshopper'], desc: state.desc };
  }
  function setStatus(msg, cls) { const el = $('status'); el.textContent = msg; el.className = 'hint ' + (cls || ''); }
  function graphJSON() { const g = state.graph; return JSON.stringify({ v: g.v, w: g.w, h: g.h, n: g.n, e: g.e, stats: g.stats }); }

  /* ----- reading the .gh ----- */
  let reqId = 0;
  async function readDefinition(buf, label) {
    const my = ++reqId;
    $('fileInfo').textContent = 'Reading ' + label + '…';
    try {
      const info = await R.parse(buf);
      if (my !== reqId) return; /* a newer file was chosen meanwhile */
      state.info = info; state.graph = info.graph;
      const st = info.graph.stats;
      $('fileInfo').textContent = `${st.components} components, ${st.params} parameters, ${st.wires} wires` + (st.groups ? `, ${st.groups} groups` : '') + (info.tags.length ? '. Plugins: ' + info.tags.join(', ') : '') + '.';
      if (!state.userTags && info.tags.length) { state.tags = info.tags.slice(); $('tags').value = state.tags.join(', '); }
      if (!state.userCat && state.mode === 'new') { state.cat = info.suggest.cat; $('cat').value = state.cat; }
      if (!(state.mode === 'existing' && state.recipe)) state.recipe = R.recipe(info, state.fileName);
      if (state.mode === 'new' || !fromFile()) { state.preview = 'composed'; state.variant = undefined; }
      $('fromFileNote').textContent = 'Made from the file: a geometry sketch assembled from the components it uses (adjust it on the right), and its wiring diagram with every component and wire at its real position.';
      fillAdjust();
    } catch (e) {
      if (my !== reqId) return;
      state.info = null; state.graph = null; state.recipe = null;
      $('fileInfo').textContent = 'Could not read the file: ' + e.message;
      $('fromFileNote').textContent = 'This file could not be read, so pick a drawn animation below.';
      if (fromFile()) { state.preview = 'isoSurface'; state.variant = undefined; }
    }
    mountFromFile(); markPick(); renderCard();
  }
  async function readFromSite(file) {
    const my = ++reqId;
    $('fileInfo').textContent = 'Fetching ' + file + '…';
    try {
      const r = await fetch(encodeURI(file)); if (!r.ok) throw new Error('not on the site (' + r.status + ')');
      const buf = await r.arrayBuffer();
      if (my !== reqId) return;
      await readDefinition(buf, file);
    } catch (e) { if (my !== reqId) return; $('fileInfo').textContent = 'Could not fetch ' + file + ': ' + e.message; state.graph = null; mountFromFile(); markPick(); renderCard(); }
  }

  /* ----- source editing ----- */
  async function fetchText(path) {
    const r = await fetch(path + (path.includes('?') ? '&' : '?') + 't=' + Date.now(), { cache: 'no-store' });
    if (!r.ok) throw new Error(path + ' could not be read (' + r.status + ')');
    return r.text();
  }
  function patchSite(src) {
    const entry = entryText();
    if (state.mode === 'existing') {
      const re = new RegExp("\\{ file: '" + state.fileName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + "'[\\s\\S]*?\\}(?=,\\n|\\n  \\];)");
      if (!re.test(src)) throw new Error('The entry for ' + state.fileName + ' was not found in site.js.');
      return src.replace(re, entry);
    }
    if (src.includes("file: " + q(state.fileName))) throw new Error('site.js already has a card for ' + state.fileName + '. Choose "Existing card" to change it.');
    const start = src.indexOf('const DATA = ['); if (start < 0) throw new Error('DATA list not found in site.js.');
    const end = src.indexOf('\n  ];', start); if (end < 0) throw new Error('End of DATA list not found in site.js.');
    const before = src.slice(0, end), empty = /\[\s*$/.test(before);
    return before + (empty ? '\n    ' : ',\n    ') + entry + src.slice(end);
  }
  function bumpIndex(src) {
    let max = 0; src.replace(/\?v=(\d+)/g, (m, n) => { max = Math.max(max, Number(n)); return m; });
    return src.replace(/\?v=\d+/g, '?v=' + (max + 1));
  }
  function validate() {
    if (!state.fileName) throw new Error('Choose a .gh file or type its name first.');
    if (!/\.(gh|ghx)$/i.test(state.fileName)) throw new Error('The file name should end in .gh');
    if (!state.title) throw new Error('Give the card a title.');
    if (!state.desc) throw new Error('Write a short description.');
    if (state.preview === 'graph' && !state.graph) throw new Error('The wiring diagram needs the file: choose the .gh itself, or pick a drawn animation.');
    if (state.preview === 'composed' && !state.recipe) throw new Error('The generated sketch needs the file: choose the .gh itself, or pick a drawn animation.');
  }
  function download(name, data) {
    const blob = data instanceof Blob ? data : new Blob([data], { type: 'text/plain' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  async function buildUpdate() {
    validate();
    const [siteSrc, indexSrc] = await Promise.all([fetchText('assets/site.js'), fetchText('index.html')]);
    return { site: patchSite(siteSrc), index: bumpIndex(indexSrc) };
  }

  /* ----- live card ----- */
  function renderCard() {
    const host = $('cardHost');
    const d = entryObject();
    if (!d.title) d.title = 'Title';
    if (!d.desc) d.desc = 'Description';
    if (!d.file) d.file = 'file.gh';
    const old = host.querySelector('canvas'); if (old) P.unmount(old);
    host.innerHTML = S.cardHTML(d, 0);
    const cv = host.querySelector('canvas');
    if (cv) P.mount(cv, state.preview, { seed: 3, variant: state.variant, graph: state.preview === 'graph' ? state.graph : undefined, recipe: state.preview === 'composed' ? state.recipe : undefined });
    const size = host.querySelector('.size');
    if (size) size.textContent = state.file ? S.fmtSize(state.file.size) : '';
    host.querySelector('.dl').addEventListener('click', (e) => e.preventDefault());
    $('entry').textContent = entryText();
  }

  /* ----- picker ----- */
  function mountFromFile() {
    const cv = $('pickFile').querySelector('canvas'), cc = $('pickComposed').querySelector('canvas');
    P.unmount(cv); P.unmount(cc);
    if (state.graph) P.mount(cv, 'graph', { seed: 5, graph: state.graph }); else cv.getContext('2d').clearRect(0, 0, cv.width, cv.height);
    if (state.recipe) P.mount(cc, 'composed', { seed: 5, recipe: state.recipe }); else cc.getContext('2d').clearRect(0, 0, cc.width, cc.height);
    $('pickFile').disabled = !state.graph; $('pickComposed').disabled = !state.recipe;
    $('adjust').hidden = !state.recipe;
  }
  const G2 = P.G.composed;
  function fillAdjust() {
    const rc = state.recipe; if (!rc) return;
    $('rcBase').innerHTML = G2.bases.map((b) => `<option value="${b}"${b === rc.base ? ' selected' : ''}>${b}</option>`).join('');
    $('rcPattern').innerHTML = G2.patterns.map((b) => `<option value="${b === null ? '' : b}"${b === rc.pattern ? ' selected' : ''}>${b === null ? 'none' : b}</option>`).join('');
    $('rcOps').innerHTML = G2.ops.map((o) => `<label><input type="checkbox" data-op="${o}"${rc.ops.includes(o) ? ' checked' : ''}><span>${o}</span></label>`).join('');
    $('rcOverlay').innerHTML = G2.overlays.map((o) => `<label><input type="checkbox" data-ov="${o}"${rc.overlay.includes(o) ? ' checked' : ''}><span>${o}</span></label>`).join('');
    $('rcDensity').value = rc.density;
  }
  function readAdjust() {
    const rc = state.recipe; if (!rc) return;
    rc.base = $('rcBase').value; rc.pattern = $('rcPattern').value || null;
    rc.ops = [...$('rcOps').querySelectorAll('input:checked')].map((i) => i.dataset.op);
    rc.overlay = [...$('rcOverlay').querySelectorAll('input:checked')].map((i) => i.dataset.ov);
    rc.density = Number($('rcDensity').value);
    state.preview = 'composed'; state.variant = undefined;
    mountFromFile(); markPick(); renderCard();
  }
  function buildPicker() {
    const pk = $('picker');
    pk.innerHTML = P.catalog.map(([type, variant, label], i) =>
      `<button type="button" class="pick" data-i="${i}"><canvas data-preview="${type}" data-variant="${variant === null ? '' : variant}"></canvas><span>${label}</span></button>`).join('');
    pk.querySelectorAll('canvas').forEach((cv, i) => { const [type, variant] = P.catalog[i]; P.mount(cv, type, { seed: i + 11, variant: variant === null ? undefined : variant }); });
    pk.addEventListener('click', (e) => {
      const b = e.target.closest('.pick'); if (!b) return;
      const [type, variant] = P.catalog[Number(b.dataset.i)];
      state.preview = type; state.variant = variant === null ? undefined : variant;
      markPick(); renderCard();
    });
    $('pickFile').addEventListener('click', () => { if (!state.graph) return; state.preview = 'graph'; state.variant = undefined; markPick(); renderCard(); });
    $('pickComposed').addEventListener('click', () => { if (!state.recipe) return; state.preview = 'composed'; state.variant = undefined; markPick(); renderCard(); });
    $('adjust').addEventListener('change', readAdjust);
    $('rcDensity').addEventListener('input', readAdjust);
    $('rcReseed').addEventListener('click', () => { if (!state.recipe) return; state.recipe.seed = Math.floor(Math.random() * 100000); readAdjust(); });
  }
  function markPick() {
    document.querySelectorAll('#picker .pick').forEach((b) => {
      const [type, variant] = P.catalog[Number(b.dataset.i)];
      const v = variant === null ? undefined : variant;
      b.classList.toggle('is-selected', !fromFile() && type === state.preview && String(v) === String(state.variant));
      b.classList.toggle('is-suggested', !!(state.info && fromFile() && type === state.info.suggest.preview && (v === undefined || String(v) === String(state.info.suggest.variant))));
    });
    $('pickFile').classList.toggle('is-selected', state.preview === 'graph');
    $('pickComposed').classList.toggle('is-selected', state.preview === 'composed');
  }

  /* ----- form wiring ----- */
  function loadExisting(file) {
    const d = S.DATA.find((x) => x.file === file); if (!d) return;
    state.fileName = d.file; state.title = d.title; state.cat = d.cat; state.tags = d.tags.slice(); state.desc = d.desc;
    state.preview = d.preview; state.variant = d.variant; state.graph = null; state.info = null; state.recipe = d.recipe ? JSON.parse(JSON.stringify(d.recipe)) : null; state.userTags = true; state.userCat = true;
    fillAdjust();
    $('title').value = d.title; $('cat').value = d.cat; $('tags').value = d.tags.join(', '); $('desc').value = d.desc;
    mountFromFile(); markPick(); renderCard();
    readFromSite(d.file);
  }

  function init() {
    $('cat').innerHTML = S.CATEGORIES.map(([k, n]) => `<option value="${k}">${n}</option>`).join('');
    $('existing').innerHTML = S.DATA.slice().sort((a, b) => a.title.localeCompare(b.title)).map((d) => `<option value="${d.file.replace(/"/g, '&quot;')}">${d.title}</option>`).join('');
    buildPicker();

    document.querySelectorAll('input[name="mode"]').forEach((r) => r.addEventListener('change', () => {
      state.mode = r.value;
      $('modeNew').hidden = state.mode !== 'new'; $('modeExisting').hidden = state.mode !== 'existing';
      if (state.mode === 'existing') { state.file = null; loadExisting($('existing').value); }
      else { state.fileName = $('fileName').value.trim(); state.graph = null; state.info = null; state.recipe = null; $('fileInfo').textContent = ''; state.userTags = false; state.userCat = false; mountFromFile(); if (fromFile()) state.preview = 'isoSurface'; markPick(); renderCard(); }
    }));
    $('existing').addEventListener('change', () => loadExisting($('existing').value));
    $('file').addEventListener('change', async () => {
      const f = $('file').files[0]; if (!f) return;
      state.file = f; state.fileName = f.name; $('fileName').value = f.name;
      if (!$('title').value) { state.title = titleFromFile(f.name); $('title').value = state.title; }
      renderCard();
      await readDefinition(await f.arrayBuffer(), f.name);
    });
    $('fileName').addEventListener('input', () => {
      state.fileName = $('fileName').value.trim();
      if (state.file && state.file.name !== state.fileName) { state.file = null; state.graph = null; state.info = null; state.recipe = null; $('fileInfo').textContent = ''; mountFromFile(); if (fromFile()) { state.preview = 'isoSurface'; markPick(); } }
      if (!$('title').value && state.fileName) { state.title = titleFromFile(state.fileName); $('title').value = state.title; }
      renderCard();
    });
    $('title').addEventListener('input', () => { state.title = $('title').value.trim(); renderCard(); });
    $('cat').addEventListener('change', () => { state.cat = $('cat').value; state.userCat = true; renderCard(); });
    $('tags').addEventListener('input', () => { state.tags = $('tags').value.split(',').map((s) => s.trim()).filter(Boolean); state.userTags = true; renderCard(); });
    $('desc').addEventListener('input', () => { state.desc = $('desc').value.trim(); renderCard(); });

    $('dlZip').addEventListener('click', async () => {
      try {
        const u = await buildUpdate();
        if (typeof JSZip !== 'function') {
          download('site.js', u.site); download('index.html', u.index);
          if (state.preview === 'graph') download(base(state.fileName) + '.json', graphJSON());
          setStatus('The zip library did not load, so the files were downloaded separately. site.js goes in assets, the .json in graphs.', 'status-ok'); return;
        }
        const zip = new JSZip();
        zip.file('index.html', u.index); zip.file('assets/site.js', u.site);
        if (state.preview === 'graph') zip.file(graphPath(), graphJSON());
        if (state.mode === 'new' && state.file) zip.file(state.fileName, state.file);
        const blob = await zip.generateAsync({ type: 'blob' });
        download('grasshopper-update.zip', blob);
        setStatus('Downloaded grasshopper-update.zip' + (state.mode === 'new' && !state.file ? '. It has no .gh inside because you typed the name; upload the file yourself.' : '.'), 'status-ok');
      } catch (e) { setStatus(e.message, 'status-err'); }
    });
    $('dlSite').addEventListener('click', async () => { try { const u = await buildUpdate(); download('site.js', u.site); setStatus('Downloaded site.js. It goes inside the assets folder.', 'status-ok'); } catch (e) { setStatus(e.message, 'status-err'); } });
    $('dlIndex').addEventListener('click', async () => { try { const u = await buildUpdate(); download('index.html', u.index); setStatus('Downloaded index.html with the cache number raised.', 'status-ok'); } catch (e) { setStatus(e.message, 'status-err'); } });
    $('copyEntry').addEventListener('click', async () => {
      try { validate(); await navigator.clipboard.writeText(entryText() + ','); setStatus('Entry copied. Paste it into DATA in assets/site.js.', 'status-ok'); } catch (e) { setStatus(e.message, 'status-err'); }
    });

    state.preview = 'isoSurface';
    mountFromFile(); markPick(); renderCard();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
