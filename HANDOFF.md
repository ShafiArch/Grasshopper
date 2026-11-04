# Grasshopper Workflow Collection: project handoff

A complete briefing for continuing this project in a fresh session (new Claude account or any collaborator). Everything below is current as of 3 November 2026.

## 1. What this is

- **Owner:** Shafiul Islam (ShafiArch on GitHub), architectural and computational designer.
- **Repository:** https://github.com/ShafiArch/Grasshopper (public, branch `main`).
- **Live site:** https://shafiarch.github.io/Grasshopper/ (GitHub Pages, served from the root of `main`).
- **Add-a-card tool:** https://shafiarch.github.io/Grasshopper/add.html **edit-a-card tool:** https://shafiarch.github.io/Grasshopper/edit.html and **order tool:** https://shafiarch.github.io/Grasshopper/order.html (none is linked from the main page).
- **Purpose:** a public library of 38 reusable Grasshopper definitions (.gh). The site shows one card per file with a live animated preview, a short description, plugin tags and a download button.

Working with the site requires nothing but a browser and GitHub. There is no build step, no framework, no package manager.

## 2. How to work on it

Two options:

1. **Edit on GitHub.** Open a file, pencil icon, change, Commit changes. Pages redeploys in one or two minutes.
2. **Clone and push.** `git clone https://github.com/ShafiArch/Grasshopper.git`, edit, commit, push. For a Claude session to push, the Claude GitHub App must be installed on the ShafiArch account for this repository (https://github.com/apps/claude/installations/select_target) and GitHub must be connected in claude.ai settings. Without that, Claude can read the repo but pushes are refused with 403.

**Cache rule (important):** `index.html` loads the scripts and stylesheet with `?v=N`. Whenever any `.js` or `.css` changes, raise that number in `index.html` or visitors keep the cached old file. The current value is in `index.html` (it was `v=13` at handoff). The tool page `add.html` loads its scripts with a timestamp instead, so it never caches.

To check what Pages is serving: View page source and look at the `?v=` value, or wait a few minutes; the Pages CDN can lag a commit by up to ten minutes.

## 3. File map

| Path | Role |
|---|---|
| `index.html` | Page skeleton: header, title and intro text, filters container, grid, footer. |
| `assets/style.css` | All styling. Tokens on `:root` (`--paper`, `--ink`, `--ink-2`, `--rule`, `--accent`), dark mode via `prefers-color-scheme`, column counts by width. |
| `assets/site.js` | The card list `DATA`, `CATEGORIES`, filter logic, download links, automatic file sizes (HEAD request per file). Exposes `window.GH_DATA` and `window.GH_SITE` for the tool. |
| `assets/previews.js` | The drawing engine and every preview type. Exposes `window.GHPreviews` with `mount`, `unmount`, `catalog`, `G` (all generators). |
| `assets/ghgraph.js` | In-browser reader for binary .gh files: inflate, parse the GH_IO archive, extract the wiring graph, derive tags, a suggested schematic, and a geometry recipe. Exposes `window.GHGraph`. |
| `add.html`, `assets/add.js`, `assets/add.css` | The add-a-card tool. |
| `edit.html`, `assets/edit.js` | The edit-a-card tool: rename a file, change title, description, category, plugins, or remove a card. |
| `order.html`, `assets/order.js` | The order tool: drag cards into display order; rewrites `ORDER` in `site.js`. |
| `assets/tooling.js` | Helpers shared by both tools: entry text, add/replace/remove entries in the live `site.js`, cache bump, downloads. |
| `graphs/*.json` | One wiring diagram per definition, generated from the .gh files (used by `preview: 'graph'`). |
| `previews/` | Optional real captures (gif, mp4, webm) that replace a drawn animation; see `previews/README.md`. |
| `GUIDE.md` | User-facing guide to adding cards, changing text, and how animations work. |
| `README.md` | Repository readme with the site link. |
| `.nojekyll` | Tells Pages to serve files as-is. Keep it. |
| `*.gh` | The definitions themselves, at the repository root, downloaded directly by the cards. |

## 4. Design decisions (so they are not undone by accident)

- Trace-paper look: paper `#f5f5f2`, pure black ink, one accent (blueprint blue `#1f3fc4`) used only for the "live" element of an animation (sun, attractor, pulses, pinned points). Dark mode: graphite paper `#1c1d1b`, light ink, lighter blue accent.
- One typeface, **Archivo** (Google Fonts, variable width axis): extended width for the big title, normal for reading, condensed for small data. No monospace labels, no all-caps eyebrows, no numbered cards.
- Cards have **no borders or panels**; whitespace separates them. Each card: preview (max 352 px wide, 4:3, left-aligned with the text), category, title, description, plugin tags, then a download button with the file size.
- Grid: 4 columns at 1500 px and wider, 3 from 1100 to 1500, 2 from 560 to 1100, 1 below. Previews stay 352 px wide on desktop; on phones they fill the column.
- **Animations always run** on any device, regardless of the OS reduced-motion setting (an earlier version honoured it and the owner's desktop appeared frozen). Only cards on screen animate (IntersectionObserver). Resting the mouse on a preview pauses it; moving off resumes from the same frame. Touch does not pause.
- Writing: no em dashes or en dashes anywhere (owner's organisation rule); use commas, semicolons, parentheses or periods. Descriptions are one or two plain sentences in a confident architectural voice.
- Cards appear in the order of the `ORDER` list in `assets/site.js` (file names, first to last); unlisted cards follow alphabetically by title. The tools keep the list in step: add appends, rename substitutes, remove deletes.

## 5. The card entry format (`DATA` in `assets/site.js`)

```js
{ file: 'Surface_Voronoi.gh', title: 'Surface Voronoi', cat: 'form', preview: 'surfVoronoi', tags: ['Grasshopper'],
  desc: 'Voronoi cells projected onto a curved surface, with points that can be fixed, scattered or driven by a field.' },
```

Fields:
- `file`: exact file name at the repo root (spaces and capitals matter). The download button points at it.
- `title`, `desc`, `tags` (plugin names), `cat`: one of `form`, `structure`, `environment`, `optimization`, `urban`, `building` (names in `CATEGORIES`).
- `preview`: which animation to draw. Optional `variant` for some types (`circularFold` 1 or 2; `massing` box, L, bar, tower, pitched; `thermalWall` insulator or workflow; `elevatedRoad` piers).
- `preview: 'graph'` plus `graph: 'graphs/<file>.json'`: the definition's own wiring diagram.
- `preview: 'composed'` plus `recipe: { base, pattern, ops, overlay, seed, density }`: a geometry sketch generated from the file's components (see section 7).
- `media: 'previews/x.mp4'` (or gif, webm): a real capture that replaces the drawn animation.

Sizes are read automatically (HEAD request), so nothing else is needed for a new file. The `SIZES` table in `site.js` only gives first values for the original 38 files.

Note: `Optimum_point_of_connection.gh` and `Path_Optimization_Galapagos.gh` are byte-identical; both are listed, the first says so in its description.

## 6. The preview engine (`assets/previews.js`)

- A tiny 3D wireframe renderer on canvas 2D. Each preview type is an object `{ view, init(state, R, opts, sketch), step(t, state, R, variant, cam) }` where `step` returns items in world units (roughly ±1): `L(points, style)` polylines, `D(point, style)` dots, `{kind:'multi', paths}` many polylines in one stroke, `{kind:'segs', segs}` segments. Styles: `w` width, `a` alpha, `c: 'accent'`, `closed`, `dash` (world units), `dashOff`.
- The camera orbits (`view.spin`), elevation `view.el`, zoom `view.zoom` as a fraction of min(width, height). `step` can return `{items, az}` to set an extra azimuth. `cam` passed to `step` holds `{dir, w, h, zoom}`.
- Helpers available inside the file: `rng(seed)`, `lerp`, `clamp`, `smooth`, `tri`, `frac`, `voronoi(sites, x0, y0, x1, y1)`, `liftPoly`, `makeCloth` / `stepCloth` / `clothLines` / `resetCloth` / `runPhysics` (Verlet spring mesh), `surfaceLines(f, nu, nv)`, `cubeLines`, `circlePts`, `groundGrid`, `sunPath`, `alignment`.
- 47 catalogue entries (`GHPreviews.catalog`: type, variant, label), including nine general-purpose types added for new files: `isoSurface`, `terrain`, `waffle`, `spaceTruss`, `vaultRibs`, `twistTower`, `spiralStair`, `facadePanels`, `vectorField`.
- Special types not in the catalogue: `graph` (needs `opts.graph` object or `opts.graphUrl`) and `composed` (needs `opts.recipe`).
- `mount(canvas, type, opts)` sizes the canvas to its CSS box times devicePixelRatio (capped at 2), observes visibility, and joins one shared requestAnimationFrame loop. `unmount(canvas)` releases it.

## 7. Reading .gh files in the browser (`assets/ghgraph.js`)

Findings that took effort to establish, worth keeping:

- A binary `.gh` is a **raw DEFLATE stream** (no zlib or gzip header) of a **GH_IO binary archive**. Decompress with `DecompressionStream('deflate-raw')` (Chrome 103+, Safari 16.4+, Firefox 113+) or `pako.inflateRaw` as fallback.
- The archive is a tree of **chunks**: `name` (.NET BinaryWriter string: 7-bit length prefix, UTF-8), `int32 index`, `int32 itemCount`, `int32 chunkCount`, then items, then child chunks. Each **item**: `name`, `int32 index`, `int32 type`, data.
- Item type codes verified on all 38 files (sizes in bytes): 1 bool(1), 2 byte(1), 3 int32(4), 4 int64(8), 5 single(4), 6 double(8), 7 decimal(16), 8 date(8), 9 guid(16), 10 string(7-bit length + UTF-8), 20 bytearray (int32 length + bytes), 21 double array (int32 count + 8 each), 30 point int (8), 31 pointf (8), 32 size int (8), 33 sizef (8), 34 rectangle int (16), 35 rectanglef (16), 36 colour (4), 37 bitmap (int32 length + bytes), 50 point2d (16), 51 point3d (24), 52 point4d (32), 60 interval (16), 61 interval2d (32), 70 line (48), 71 bounding box (48), 72 plane (72), 80 version (12).
- Structure used: `Root` > `Definition` > `DefinitionObjects` > `Object[i]` with items `GUID` (component type) and `Name`, and chunk `Container` with `InstanceGuid`, `NickName`, `Attributes` (`Bounds` rectanglef, `Pivot` pointf), and for components either `param_input[i]` / `param_output[i]` chunks or `ParameterData` > `InputParam[i]` / `OutputParam[i]` (script components). Each parameter has its own `InstanceGuid` and `Attributes`; inputs carry `Source[i]` guids pointing at the parameter (or standalone object) feeding them. `Group` objects list member `ID`s. `Definition` > `GHALibraries` lists plugin libraries. `Root` > `Thumbnail` is a 150x100 PNG of the canvas (not the geometry).
- **What is not in the file:** the geometry the definition produces. Internalised inputs are stored as Rhino binary (not decodable in a browser); outputs are never stored. Any "geometry" shown on the site is therefore either a schematic, a sketch assembled from component names, or a real capture from Rhino.

`GHGraph.parse(arrayBuffer)` returns `{ graph, libs, tags, names, weighted, finals, groupNicks, suggest }`:
- `graph`: `{ v, w, h, n: [[x, y, w, h, kind]...], e: [[x1, y1, x2, y2]...], stats }` in canvas units (kind 0 component, 1 parameter, 2 group). This is what `graphs/*.json` holds.
- `tags`: plugin names from libraries and component name prefixes.
- `weighted`: component name (or `~nickname`) to weight, where components close to the **end of the definition** weigh most (0.25 to 1.0 by distance to the end nodes, display-only objects ignored).
- `finals`: names of the end nodes.
- `GHGraph.recipe(info, fileName)` turns that into a composed recipe by scoring regexes against the weighted names, with a bonus for the file name. `GHGraph.suggest(info)` picks the closest catalogue schematic.

The Python reference implementation used during development is not in the repo; the JS is the source of truth and was verified against all 38 files.

## 8. The composed sketch (`preview: 'composed'`)

Recipe fields and allowed values (also listed on `GHPreviews.G.composed.bases/patterns/ops/overlays`):
- `base`: surface, plane, box, curve, dome, mesh, ring
- `pattern`: grid, voronoi, hex, diagrid, circles, scatter, contours, stripes, or null
- `ops`: extrude, offset, attractor, rotate, jitter, scale, pipe, loft, morph, array, fold
- `overlay`: sun, sensors, airflow, kangaroo, search, growth
- `seed`: integer (variation), `density`: 0 to 1

The curve base renders ops specially: extrude gives the deck thickness, offset draws lane lines, array or rotate places piers. The mesh base is a dropping and relaxing Kangaroo-style net; the kangaroo overlay relaxes a net over any other base.

## 9. The add-a-card tool (`add.html`)

Flow: choose a .gh (or type its name) or pick an existing card; the file is read in the browser (existing cards fetch their .gh from the site); two from-file animations appear (generated geometry, selected by default, with an Adjust panel and a Vary button; and the wiring diagram), plus the 47 drawn thumbnails with the file's suggestion marked; fill title, category (suggested), plugins (filled from the file), description; the card renders live on the right with the exact entry text. **Download update (zip)** fetches the live `assets/site.js` and `index.html`, inserts or replaces the entry, raises the `?v=` number, and bundles `graphs/<file>.json` when the wiring animation is chosen and the .gh itself when one was picked. The user unzips and drags the files into the repo root on GitHub. The tool never writes to GitHub itself; JSZip and pako load from cdnjs.

**Edit-a-card tool (`edit.html`)**: choose a card, edit file name, title, category, plugins, description, or tick remove. The download rewrites the entry in `site.js` (keyed on the old file name), bumps `index.html`, and when renaming includes the .gh fetched from the site under its new name (plus its `graphs/` json if used). The old file must then be deleted on GitHub by hand; the page links to it.

The entry regex for replacing an existing card assumes the entry's final `}` is followed by `,\n` or `\n  ];`, and that a `recipe` object is written on one line followed by `, tags:`; keep that formatting if editing `DATA` by hand.

## 10. Testing approach used

- Node syntax check: `node --check assets/*.js`.
- Mock-canvas run of every generator for 30 simulated seconds (catches exceptions and NaN). The `graph` type draws nothing without data, which the mock reports as a failure; that is expected.
- Playwright with headless Chrome against a local static server: full-page screenshots at several widths, hover pause and resume, touch, column counts, download links (all 38 resolve), the tool's file upload, adjust panel and generated `site.js` (must pass `node --check`).
- Visual review of contact sheets of all previews.

## 11. Known limitations and ideas not yet done

- No geometry from the files (see section 7). Real captures in `previews/` are the only true picture of outputs.
- Recipe rules are regex heuristics; some files land on a generic choice (Elk OSM map, the Galapagos files). The Adjust panel exists for that. Tuning candidates: use more nicknames and group names, treat "Custom Preview" inputs as the geometric output, add bases (tower of plates, aggregated blocks).
- The 38 original cards still use the hand-picked schematics. Every file already has a `graphs/*.json`, and recipes can be generated for all of them; switching all cards to `composed` or `graph` is a one-commit job if wanted.
- A GitHub App or token could let the tool commit directly instead of the zip-and-upload step; deliberately not done to avoid storing credentials in a browser page.
- Possible: search box, per-card detail page, OG image, a "Vary" seed shown on the card, a Rhino-side script that exports a GIF of the viewport named after the .gh so `previews/` fills itself.
- The two Circular Folded Plate files are different definitions kept side by side; the two Galapagos path files are identical.

## 12. Licensing

Definitions (`.gh`, `graphs/`): © 2026 Shafiul Islam, CC BY 4.0 (`LICENSE-DEFINITIONS.md`). Website code: MIT (`LICENSE`). The README and the site footer state both. Keep these notices when restructuring.

## 13. Quick commands

```
# clone
git clone https://github.com/ShafiArch/Grasshopper.git
# after editing js/css: raise ?v= in index.html, then
git add -A && git commit -m "..." && git push
# local preview
cd Grasshopper && python3 -m http.server 8000   # then open http://localhost:8000/
```
