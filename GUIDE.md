# How the website works

The site is four files plus the `.gh` files themselves. GitHub Pages serves the repository as-is; there is no build step.

| File | What it holds |
|---|---|
| `index.html` | The page skeleton: header, the title and intro text, the footer text. |
| `assets/style.css` | Everything visual: colours, typeface, spacing, how many cards per row. |
| `assets/site.js` | The list of cards (`DATA`), the category names, the filters, the download links. |
| `assets/previews.js` | The drawing engine and the library of preview animations. |
| `previews/` | Optional real screen captures that replace a drawn animation. |
| `.nojekyll` | Tells GitHub Pages to serve the files without processing. Leave it. |

Every edit is made on GitHub: open the file, click the pencil icon, change it, click **Commit changes**. The site updates a minute or two later.

## The add-a-card tool

The quickest way to add or change a card is the tool page at **add.html** (https://shafiarch.github.io/Grasshopper/add.html). It is not linked from the main page.

1. Choose the .gh file (or type its name), or switch to "Existing card" to change one that is already on the site.
2. Click an animation thumbnail. Every type is shown moving, including variants.
3. Fill in title, category, plugins and description. The card on the right updates as you type.
4. Click **Download update (zip)**. The zip holds `index.html` (cache number raised), `assets/site.js` (with the new or changed entry) and the .gh file itself when you chose one.
5. Unzip, then on GitHub click Add file, Upload files, drag in `index.html`, the `assets` folder and the .gh file, and commit.

The tool reads the live `site.js` and `index.html` from the site each time, so it always edits the current versions. It never writes to the repository itself; the upload is the commit.

The manual route is below if you prefer editing on GitHub directly.

## Adding a new definition

1. Upload the `.gh` file to the repository root (Add file, Upload files).
2. Open `assets/site.js`, find the `DATA` list, and add an entry. Copy a neighbour and change the values:

```js
{ file: 'My_New_Script.gh', title: 'My New Script', cat: 'form', preview: 'diagrid', tags: ['Kangaroo'],
  desc: 'One or two sentences about what the definition does.' },
```

- `file` must match the file name exactly, including spaces and capitals. It is what the download button points at.
- `title` is the card heading. Cards are sorted alphabetically by title.
- `cat` is one of `form`, `structure`, `environment`, `optimization`, `urban`, `building`. The filter counts update by themselves.
- `preview` picks the drawn animation (list below). Some previews take a `variant`.
- `tags` are the plugin names shown under the description.
- `desc` is the description.

The file size under the download button is read from the file automatically.

3. Open `index.html` and raise the number in the three `?v=` links near the top and bottom (for example `?v=6` to `?v=7`). This makes browsers fetch the changed script instead of a cached copy. Do this whenever you change a `.js` or `.css` file.

## Changing text

- Card title, description, tags, category: the entry in `DATA` in `assets/site.js`.
- Filter names: the `CATEGORIES` list at the top of `assets/site.js`.
- Page title, intro paragraphs, byline, footer: `index.html`.
- To remove a card, delete its entry from `DATA` (and the file, if you like).

## How the animations work

Each card has a `<canvas>`. `assets/previews.js` contains a small wireframe renderer and a library of preview types. A preview type is a function that returns a set of 3D lines and points for a given moment in time; the renderer rotates a camera slowly around them, projects them to the canvas and strokes them in the page's ink and accent colours. Some types run a real simulation each frame: the Kangaroo previews are a spring mesh relaxed with Verlet integration, the Voronoi previews are computed by half-plane clipping, the path preview improves its route with 2-opt moves, the printer preview walks toward the geometric median.

Only cards on screen animate, so the page stays light. Resting the mouse on a preview pauses it.

The animations are schematic sketches of the idea of each definition; they are not generated from the `.gh` files.

### Preview types

| `preview` | Draws |
|---|---|
| `surfVoronoi` | Voronoi cells lifted onto a wavy surface, sites drifting |
| `attrVoronoi` | Flat Voronoi with cells pulled toward a moving attractor |
| `volVoronoi` | A cube with Voronoi cells on its faces |
| `diagrid` | Diagonal grid on a rippling surface |
| `diagridExport` | Diagrid flattening to a sheet and back |
| `hex` | Hexagonal panels on a dome |
| `cloth` | Mesh dropping under gravity, corners pinned |
| `kAnchor` | Mesh with moving anchor points |
| `drape` | Mesh draping over a sphere |
| `saddle` | Four-point tensile sail |
| `tent` | Mast-and-boundary tensile canopy |
| `foldedPlate` | Segmented zigzag plates |
| `circularFold` | Radial pleated roof (`variant: 1` closed apex, `variant: 2` oculus) |
| `shell` | Dome lattice with one segment pulled out |
| `massing` | Building massing with sun path (`variant`: `box`, `L`, `bar`, `tower`, `pitched`) |
| `thermalWall` | Wall section with heat flow and temperature line (`variant`: `insulator`, `workflow`) |
| `airflow` | Room with particles streaming inlet to outlet |
| `daylight` | Box with fins tracking the sun, floor sensor grid |
| `path` | Shortest tour through points, improving live |
| `printer` | Floor plate, desks and the best printer spot |
| `connection` | Sources connecting to the best point on a line |
| `branching` | Tree growing level by level, new seed each cycle |
| `units` | Unit boxes aggregating on a grid |
| `elevatedRoad` | Deck on piers following an alignment (`variant: 'piers'` for the pier version) |
| `lanes` | Road with moving dashed lane marks |
| `osmMap` | Street network revealing from the centre |
| `planExtrude` | Plan walls rising into a massing |
| `auditorium` | Raked section with sightlines |
| `stadium` | Ring of panels of varying height |
| `jitter` | Panel grid with jittered subdivision |
| `attractorScreen` | Perforated screen with an attractor |
| `isoSurface` | Doubly curved surface with isocurves |
| `terrain` | Terrain mesh with contour lines and a rising water level |
| `waffle` | Waffle structure: slices through a surface |
| `spaceTruss` | Two-layer space truss on four columns |
| `vaultRibs` | Arched ribs along a vault |
| `twistTower` | Floor plates twisting with height |
| `spiralStair` | Helical stair around a column |
| `facadePanels` | Facade panels opening in a wave |
| `vectorField` | Particles following a source-and-sink field |

## Getting an animation for a new file

Three options, from least to most effort:

1. **Reuse a type.** Pick the preview from the table that is closest to the idea. Most new definitions fit one of them.
2. **Record the real thing.** Capture the Grasshopper preview in Rhino with the Xbox Game Bar (Win+G), ScreenToGif, or any screen recorder. Trim to a few seconds, crop to 4:3, keep it under about 2 MB, save it in `previews/` and add `media: 'previews/my-file.mp4'` to the card entry. A real capture always replaces the drawn animation for that card. See `previews/README.md`.
3. **Add a new drawn type.** Describe the geometry and motion you want and a new generator can be added to `assets/previews.js`.
