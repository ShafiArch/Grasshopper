/* Add-a-card tool: builds a DATA entry for a Grasshopper file, shows the card
   live, and produces the files to drop into the repository. It reads the
   current assets/site.js and index.html from the site itself, so it always
   edits the live versions. */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const P = window.GHPreviews, S = window.GH_SITE;
  if (!P || !S) { document.body.insertAdjacentHTML('beforeend', '<p class="hint status-err">previews.js or site.js did not load.</p>'); return; }

  const state = { mode: 'new', file: null, fileName: '', preview: 'isoSurface', variant: undefined, title: '', cat: 'form', tags: [], desc: '' };
  let cardSketch = null;

  /* ----- helpers ----- */
  const q = (s) => "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
  const titleFromFile = (name) => name.replace(/\.(gh|ghx)$/i, '').replace(/[_\s]+/g, ' ').replace(/\s+/g, ' ').trim()
    .split(' ').map((w) => (w.length > 3 && w === w.toLowerCase() ? w[0].toUpperCase() + w.slice(1) : w)).join(' ');
  function entryText() {
    const v = state.variant === undefined || state.variant === '' ? '' : `, variant: ${typeof state.variant === 'number' ? state.variant : q(state.variant)}`;
    const tags = state.tags.length ? state.tags : ['Grasshopper'];
    return `{ file: ${q(state.fileName)}, title: ${q(state.title)}, cat: ${q(state.cat)}, preview: ${q(state.preview)}${v}, tags: [${tags.map(q).join(', ')}],\n      desc: ${q(state.desc)} }`;
  }
  function entryObject() {
    return { file: state.fileName, title: state.title, cat: state.cat, preview: state.preview, variant: state.variant, tags: state.tags.length ? state.tags : ['Grasshopper'], desc: state.desc };
  }
  function setStatus(msg, cls) { const el = $('status'); el.textContent = msg; el.className = 'hint ' + (cls || ''); }

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
    if (cv) cardSketch = P.mount(cv, state.preview, { seed: 3, variant: state.variant });
    const size = host.querySelector('.size');
    if (size) size.textContent = state.file ? S.fmtSize(state.file.size) : '';
    host.querySelector('.dl').addEventListener('click', (e) => e.preventDefault());
    $('entry').textContent = entryText();
  }

  /* ----- picker ----- */
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
  }
  function markPick() {
    document.querySelectorAll('.pick').forEach((b) => {
      const [type, variant] = P.catalog[Number(b.dataset.i)];
      const v = variant === null ? undefined : variant;
      b.classList.toggle('is-selected', type === state.preview && String(v) === String(state.variant));
    });
    const sel = document.querySelector('.pick.is-selected');
    if (sel) sel.scrollIntoView({ block: 'nearest' });
  }

  /* ----- form wiring ----- */
  function loadExisting(file) {
    const d = S.DATA.find((x) => x.file === file); if (!d) return;
    state.fileName = d.file; state.title = d.title; state.cat = d.cat; state.tags = d.tags.slice(); state.desc = d.desc;
    state.preview = d.preview; state.variant = d.variant;
    $('title').value = d.title; $('cat').value = d.cat; $('tags').value = d.tags.join(', '); $('desc').value = d.desc;
    markPick(); renderCard();
  }

  function init() {
    $('cat').innerHTML = S.CATEGORIES.map(([k, n]) => `<option value="${k}">${n}</option>`).join('');
    $('existing').innerHTML = S.DATA.slice().sort((a, b) => a.title.localeCompare(b.title)).map((d) => `<option value="${d.file.replace(/"/g, '&quot;')}">${d.title}</option>`).join('');
    buildPicker();

    document.querySelectorAll('input[name="mode"]').forEach((r) => r.addEventListener('change', () => {
      state.mode = r.value;
      $('modeNew').hidden = state.mode !== 'new'; $('modeExisting').hidden = state.mode !== 'existing';
      if (state.mode === 'existing') { state.file = null; loadExisting($('existing').value); }
      else { state.fileName = $('fileName').value.trim(); renderCard(); }
    }));
    $('existing').addEventListener('change', () => loadExisting($('existing').value));
    $('file').addEventListener('change', () => {
      const f = $('file').files[0]; if (!f) return;
      state.file = f; state.fileName = f.name; $('fileName').value = f.name;
      if (!$('title').value) { state.title = titleFromFile(f.name); $('title').value = state.title; }
      renderCard();
    });
    $('fileName').addEventListener('input', () => { state.fileName = $('fileName').value.trim(); if (state.file && state.file.name !== state.fileName) state.file = null; if (!$('title').value && state.fileName) { state.title = titleFromFile(state.fileName); $('title').value = state.title; } renderCard(); });
    $('title').addEventListener('input', () => { state.title = $('title').value.trim(); renderCard(); });
    $('cat').addEventListener('change', () => { state.cat = $('cat').value; renderCard(); });
    $('tags').addEventListener('input', () => { state.tags = $('tags').value.split(',').map((s) => s.trim()).filter(Boolean); renderCard(); });
    $('desc').addEventListener('input', () => { state.desc = $('desc').value.trim(); renderCard(); });

    $('dlZip').addEventListener('click', async () => {
      try {
        const u = await buildUpdate();
        if (typeof JSZip !== 'function') { download('site.js', u.site); download('index.html', u.index); setStatus('The zip library did not load, so site.js and index.html were downloaded separately. Put site.js inside assets.', 'status-ok'); return; }
        const zip = new JSZip();
        zip.file('index.html', u.index); zip.file('assets/site.js', u.site);
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

    markPick(); renderCard();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
