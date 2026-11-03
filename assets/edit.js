/* Edit-a-card tool: rename a file, change its card text, or remove a card.
   Reads the live site.js and index.html, rewrites the entry, and bundles the
   renamed .gh (fetched from the site) so one upload plus one delete on GitHub
   completes a rename. Nothing here writes to GitHub. */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const P = window.GHPreviews, S = window.GH_SITE, T = window.GHTool;
  if (!P || !S || !T) { document.body.insertAdjacentHTML('beforeend', '<p class="hint status-err">A script did not load (previews.js, site.js or tooling.js).</p>'); return; }
  const REPO = 'https://github.com/ShafiArch/Grasshopper';

  const st = { orig: null, d: null, remove: false };

  function setStatus(msg, cls) { const el = $('status'); el.textContent = msg; el.className = 'hint ' + (cls || ''); }
  const renamed = () => st.orig && st.d && st.d.file !== st.orig.file;

  function load(file) {
    const d = S.DATA.find((x) => x.file === file); if (!d) return;
    st.orig = d; st.d = JSON.parse(JSON.stringify(d)); st.remove = false; $('remove').checked = false;
    $('fileName').value = d.file; $('title').value = d.title; $('cat').value = d.cat; $('tags').value = d.tags.join(', '); $('desc').value = d.desc;
    const anim = d.preview === 'composed' ? 'generated geometry' : d.preview === 'graph' ? 'wiring diagram' : d.media ? 'a real capture' : 'the drawn schematic "' + d.preview + '"' + (d.variant !== undefined ? ' (' + d.variant + ')' : '');
    $('fileInfo').textContent = 'Animation: ' + anim + '. Category: ' + S.catName(d.cat) + '.';
    update();
  }

  function update() {
    const d = st.d; if (!d) return;
    d.file = $('fileName').value.trim(); d.title = $('title').value.trim(); d.cat = $('cat').value;
    d.tags = $('tags').value.split(',').map((s) => s.trim()).filter(Boolean); d.desc = $('desc').value.trim();
    st.remove = $('remove').checked;
    $('renameNote').textContent = renamed() ? `Will rename ${st.orig.file} to ${d.file}. The zip will contain the file under its new name; delete the old one on GitHub afterwards.` : 'Unchanged. Edit the name above to rename the file.';
    $('howtoDelete').hidden = !(renamed() || st.remove);
    $('oldFileLink').href = REPO + '/blob/main/' + encodeURIComponent(st.orig.file).replace(/%2F/g, '/');
    $('howtoDelete').firstChild.textContent = st.remove ? 'Delete the file if you no longer want it in the repository: ' : 'Delete the old file: ';
    renderCard();
    $('entry').textContent = st.remove ? '(entry removed)' : T.entryText(d);
  }

  function renderCard() {
    const host = $('cardHost'), d = Object.assign({}, st.d);
    if (!d.title) d.title = 'Title'; if (!d.desc) d.desc = 'Description'; if (!d.file) d.file = 'file.gh';
    if (!d.tags.length) d.tags = ['Grasshopper'];
    const old = host.querySelector('canvas'); if (old) P.unmount(old);
    host.innerHTML = S.cardHTML(d, 0);
    host.style.opacity = st.remove ? 0.35 : 1;
    const cv = host.querySelector('canvas');
    if (cv) P.mount(cv, d.preview, { seed: 3, variant: d.variant, recipe: d.recipe, graphUrl: d.preview === 'graph' ? encodeURI(T.graphPath(st.orig.file)) : undefined });
    host.querySelector('.dl').addEventListener('click', (e) => e.preventDefault());
  }

  function validate() {
    const d = st.d; if (!d) throw new Error('Choose a card first.');
    if (st.remove) return;
    if (!d.file) throw new Error('The file name cannot be empty.');
    if (!/\.(gh|ghx)$/i.test(d.file)) throw new Error('The file name should end in .gh');
    if (/[\\/:*?"<>|]/.test(d.file)) throw new Error('The file name has a character GitHub will not accept.');
    if (renamed() && S.DATA.some((x) => x.file === d.file)) throw new Error('Another card already uses the name ' + d.file + '.');
    if (!d.title) throw new Error('Give the card a title.');
    if (!d.desc) throw new Error('Write a short description.');
  }

  async function buildUpdate() {
    validate();
    const live = await T.fetchLive();
    let site;
    if (st.remove) site = T.removeEntry(live.site, st.orig.file);
    else site = T.replaceEntry(live.site, st.orig.file, T.entryText(st.d));
    return { site, index: T.bumpIndex(live.index) };
  }

  function init() {
    $('cat').innerHTML = S.CATEGORIES.map(([k, n]) => `<option value="${k}">${n}</option>`).join('');
    $('existing').innerHTML = S.DATA.slice().sort((a, b) => a.title.localeCompare(b.title)).map((d) => `<option value="${d.file.replace(/"/g, '&quot;')}">${d.title}</option>`).join('');
    $('existing').addEventListener('change', () => load($('existing').value));
    for (const id of ['fileName', 'title', 'tags', 'desc']) $(id).addEventListener('input', update);
    $('cat').addEventListener('change', update); $('remove').addEventListener('change', update);

    $('dlZip').addEventListener('click', async () => {
      try {
        const u = await buildUpdate();
        const files = [['index.html', u.index], ['assets/site.js', u.site]];
        if (renamed()) {
          const r = await fetch(encodeURI(st.orig.file)); if (!r.ok) throw new Error('Could not fetch ' + st.orig.file + ' from the site (' + r.status + ').');
          files.push([st.d.file, await r.blob()]);
          if (st.d.preview === 'graph') { const g = await fetch(encodeURI(T.graphPath(st.orig.file))); if (g.ok) files.push([T.graphPath(st.d.file), await g.text()]); }
        }
        if (typeof JSZip !== 'function') { for (const [n, data] of files) T.download(n.split('/').pop(), data); setStatus('The zip library did not load, so the files were downloaded separately. site.js goes in assets.', 'status-ok'); return; }
        const zip = new JSZip(); for (const [n, data] of files) zip.file(n, data);
        T.download('grasshopper-update.zip', await zip.generateAsync({ type: 'blob' }));
        setStatus('Downloaded grasshopper-update.zip.' + (renamed() ? ' Remember to delete ' + st.orig.file + ' on GitHub after uploading.' : st.remove ? ' The card is removed; delete the .gh on GitHub if you no longer want it.' : ''), 'status-ok');
      } catch (e) { setStatus(e.message, 'status-err'); }
    });
    $('dlSite').addEventListener('click', async () => { try { const u = await buildUpdate(); T.download('site.js', u.site); setStatus('Downloaded site.js. It goes inside the assets folder.', 'status-ok'); } catch (e) { setStatus(e.message, 'status-err'); } });
    $('dlIndex').addEventListener('click', async () => { try { const u = await buildUpdate(); T.download('index.html', u.index); setStatus('Downloaded index.html with the cache number raised.', 'status-ok'); } catch (e) { setStatus(e.message, 'status-err'); } });
    $('copyEntry').addEventListener('click', async () => { try { validate(); await navigator.clipboard.writeText(T.entryText(st.d) + ','); setStatus('Entry copied.', 'status-ok'); } catch (e) { setStatus(e.message, 'status-err'); } });

    load($('existing').value);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
