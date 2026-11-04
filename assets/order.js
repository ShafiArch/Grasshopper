/* Order-the-cards tool: arrange the cards, then download site.js with the new
   ORDER list. Nothing here writes to GitHub. */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const P = window.GHPreviews, S = window.GH_SITE, T = window.GHTool;
  if (!P || !S || !T) { document.body.insertAdjacentHTML('beforeend', '<p class="hint status-err">A script did not load (previews.js, site.js or tooling.js).</p>'); return; }

  const byFile = new Map(S.DATA.map((d) => [d.file, d]));
  function currentOrder() {
    const rank = new Map((S.ORDER || []).map((f, i) => [f, i]));
    return S.DATA.slice().sort((a, b) => { const ra = rank.has(a.file) ? rank.get(a.file) : Infinity, rb = rank.has(b.file) ? rank.get(b.file) : Infinity; return ra !== rb ? ra - rb : a.title.localeCompare(b.title); }).map((d) => d.file);
  }
  const original = currentOrder();
  let order = original.slice();
  let dragFrom = null;

  function setStatus(msg, cls) { const el = $('status'); el.textContent = msg; el.className = 'hint ' + (cls || ''); }

  function render() {
    const list = $('list');
    list.innerHTML = order.map((f, i) => {
      const d = byFile.get(f);
      return `<li class="order-item" draggable="true" data-file="${f.replace(/"/g, '&quot;')}">
        <span class="order-num">${i + 1}</span>
        <canvas class="order-thumb" data-preview="${d.preview}" data-variant="${d.variant === undefined ? '' : d.variant}"></canvas>
        <span class="order-text"><strong>${esc(d.title)}</strong><span>${esc(S.catName(d.cat))}</span></span>
        <span class="order-btns">
          <button type="button" data-move="top" title="Move to top">&#8657;</button>
          <button type="button" data-move="up" title="Move up">&#8593;</button>
          <button type="button" data-move="down" title="Move down">&#8595;</button>
          <button type="button" data-move="bottom" title="Move to bottom">&#8659;</button>
        </span>
      </li>`;
    }).join('');
    list.querySelectorAll('canvas').forEach((cv, i) => {
      const d = byFile.get(order[i]), v = cv.dataset.variant;
      P.mount(cv, d.preview, { seed: i + 7, variant: /^\d+$/.test(v) ? Number(v) : (v || undefined), recipe: d.recipe, graphUrl: d.graph ? encodeURI(d.graph) : undefined });
    });
    const changed = order.some((f, i) => f !== original[i]);
    $('summary').textContent = changed ? `Order changed. First: ${byFile.get(order[0]).title}. Last: ${byFile.get(order[order.length - 1]).title}.` : 'This is the order the site shows now.';
    renderPreview();
  }
  function renderPreview() {
    const host = $('preview');
    host.querySelectorAll('canvas').forEach((c) => P.unmount(c));
    host.innerHTML = order.slice(0, 4).map((f) => { const d = byFile.get(f); return `<div class="order-mini"><canvas data-preview="${d.preview}"></canvas><span>${esc(d.title)}</span></div>`; }).join('');
    host.querySelectorAll('canvas').forEach((cv, i) => { const d = byFile.get(order[i]); P.mount(cv, d.preview, { seed: i + 3, variant: d.variant, recipe: d.recipe, graphUrl: d.graph ? encodeURI(d.graph) : undefined }); });
  }
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function move(file, where) {
    const i = order.indexOf(file); if (i < 0) return;
    order.splice(i, 1);
    const j = where === 'top' ? 0 : where === 'bottom' ? order.length : where === 'up' ? Math.max(0, i - 1) : Math.min(order.length, i + 1);
    order.splice(j, 0, file);
    unmountAll(); render();
    const el = document.querySelector(`.order-item[data-file="${CSS.escape(file)}"]`); if (el) { el.classList.add('is-moved'); el.scrollIntoView({ block: 'nearest' }); }
  }
  function unmountAll() { $('list').querySelectorAll('canvas').forEach((c) => P.unmount(c)); }

  async function buildUpdate() {
    const live = await T.fetchLive();
    if (!T.orderList(live.site)) throw new Error('The live site.js has no ORDER list yet; upload the current site.js from the repository first.');
    const known = new Set(S.DATA.map((d) => d.file));
    const liveFiles = T.orderList(live.site).filter((f) => !known.has(f));
    return { site: T.setOrder(live.site, order.concat(liveFiles)), index: T.bumpIndex(live.index) };
  }

  function init() {
    render();
    const list = $('list');
    list.addEventListener('click', (e) => { const b = e.target.closest('button[data-move]'); if (!b) return; move(b.closest('.order-item').dataset.file, b.dataset.move); });
    list.addEventListener('dragstart', (e) => { const li = e.target.closest('.order-item'); if (!li) return; dragFrom = li.dataset.file; li.classList.add('is-dragging'); e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', dragFrom); } catch (err) { /* ignore */ } });
    list.addEventListener('dragend', () => { dragFrom = null; list.querySelectorAll('.is-dragging, .is-over').forEach((el) => el.classList.remove('is-dragging', 'is-over')); });
    list.addEventListener('dragover', (e) => { const li = e.target.closest('.order-item'); if (!li || !dragFrom) return; e.preventDefault(); e.dataTransfer.dropEffect = 'move'; list.querySelectorAll('.is-over').forEach((el) => el.classList.remove('is-over')); li.classList.add('is-over'); });
    list.addEventListener('drop', (e) => {
      const li = e.target.closest('.order-item'); if (!li || !dragFrom) return; e.preventDefault();
      const to = li.dataset.file; if (to === dragFrom) return;
      const from = order.indexOf(dragFrom); order.splice(from, 1);
      const rect = li.getBoundingClientRect(), after = e.clientY > rect.top + rect.height / 2;
      let j = order.indexOf(to) + (after ? 1 : 0); order.splice(j, 0, dragFrom);
      unmountAll(); render();
    });
    $('sortTitle').addEventListener('click', () => { order.sort((a, b) => byFile.get(a).title.localeCompare(byFile.get(b).title)); unmountAll(); render(); });
    $('sortCat').addEventListener('click', () => { const ci = new Map(S.CATEGORIES.map(([k], i) => [k, i])); order.sort((a, b) => (ci.get(byFile.get(a).cat) - ci.get(byFile.get(b).cat)) || byFile.get(a).title.localeCompare(byFile.get(b).title)); unmountAll(); render(); });
    $('reverse').addEventListener('click', () => { order.reverse(); unmountAll(); render(); });
    $('reset').addEventListener('click', () => { order = original.slice(); unmountAll(); render(); });
    $('find').addEventListener('input', () => {
      const qv = $('find').value.trim().toLowerCase(); if (!qv) return;
      const f = order.find((x) => byFile.get(x).title.toLowerCase().includes(qv)); if (!f) return;
      const el = document.querySelector(`.order-item[data-file="${CSS.escape(f)}"]`); if (el) { el.scrollIntoView({ block: 'center' }); list.querySelectorAll('.is-moved').forEach((x) => x.classList.remove('is-moved')); el.classList.add('is-moved'); }
    });
    $('dlZip').addEventListener('click', async () => {
      try {
        const u = await buildUpdate();
        if (typeof JSZip !== 'function') { T.download('site.js', u.site); T.download('index.html', u.index); setStatus('The zip library did not load, so the files were downloaded separately. site.js goes in assets.', 'status-ok'); return; }
        const zip = new JSZip(); zip.file('index.html', u.index); zip.file('assets/site.js', u.site);
        T.download('grasshopper-update.zip', await zip.generateAsync({ type: 'blob' }));
        setStatus('Downloaded grasshopper-update.zip.', 'status-ok');
      } catch (e) { setStatus(e.message, 'status-err'); }
    });
    $('dlSite').addEventListener('click', async () => { try { const u = await buildUpdate(); T.download('site.js', u.site); setStatus('Downloaded site.js. It goes inside the assets folder.', 'status-ok'); } catch (e) { setStatus(e.message, 'status-err'); } });
    $('dlIndex').addEventListener('click', async () => { try { const u = await buildUpdate(); T.download('index.html', u.index); setStatus('Downloaded index.html with the cache number raised.', 'status-ok'); } catch (e) { setStatus(e.message, 'status-err'); } });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
