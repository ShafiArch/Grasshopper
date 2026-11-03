/* Grasshopper Workflow Collection: card data and page behaviour.
   To add a definition: drop the .gh file in the repository root and add an
   entry below. `preview` picks a schematic animation (see assets/previews.js);
   `media` can point to a real capture (gif, mp4 or webm) in previews/ and it
   will be shown instead of the drawn animation. */
(function () {
  'use strict';

  const REPO = 'https://github.com/ShafiArch/Grasshopper';

  const CATEGORIES = [
    ['form', 'Form & Geometry'],
    ['structure', 'Form-finding'],
    ['environment', 'Environment'],
    ['optimization', 'Optimization & Growth'],
    ['urban', 'Urban & Infrastructure'],
    ['building', 'Building & Fabrication']
  ];

  const DATA = [
    { file: '3D_Automation_fromPlan.gh', title: '3D Automation from Plan', cat: 'building', preview: 'planExtrude', tags: ['Rhino', 'Grasshopper'],
      desc: 'Raises a 2D plan into a 3D massing in one pass: walls, slabs and openings read from the linework so a drawing becomes a model without redrawing.' },
    { file: 'Auditorium_Section.gh', title: 'Auditorium Section', cat: 'building', preview: 'auditorium', tags: ['Grasshopper'],
      desc: 'Rake geometry for an auditorium: rows set out from a focal point with the sightline of every row checked against the one in front, so riser height, seat count and clearance can be tuned together.' },
    { file: 'Biomorpher_Evolutionary_Growth.gh', title: 'Evolutionary Growth', cat: 'optimization', preview: 'branching', tags: ['Biomorpher'],
      desc: 'A growth rule exposed as genes and bred interactively in Biomorpher. The designer selects what to keep from each generation rather than chasing a single numeric target.' },
    { file: 'Circular Folded Plate.gh', title: 'Circular Folded Plate', cat: 'form', preview: 'circularFold', variant: 1, tags: ['Grasshopper'],
      desc: 'A radial folded-plate roof: pleats set out around a circle with adjustable count, depth and fold angle, giving a stiff shell made from flat panels.' },
    { file: 'Circular_Folded_plate.gh', title: 'Circular Folded Plate II', cat: 'form', preview: 'circularFold', variant: 2, tags: ['Grasshopper'],
      desc: 'A second setup of the radial pleat with a central opening and a different fold rhythm. Kept alongside the first version as an alternate starting point.' },
    { file: 'Daylight_optimization_Octopus_TTtoolbox_ClimateStudio.gh', title: 'Daylight Optimization', cat: 'environment', preview: 'daylight', tags: ['ClimateStudio', 'Octopus', 'TT Toolbox'],
      desc: 'Multi-objective daylight search: ClimateStudio runs the simulation, Octopus searches the facade variables, and TT Toolbox logs every generation for review.' },
    { file: 'Diagrid_Export.gh', title: 'Diagrid Export', cat: 'form', preview: 'diagridExport', tags: ['Grasshopper'],
      desc: 'Takes a diagrid off its surface and prepares it for the next tool: members sorted, nodes indexed and geometry flattened or baked for structural and fabrication software.' },
    { file: 'Diagrid_in_surface.gh', title: 'Diagrid in Surface', cat: 'form', preview: 'diagrid', tags: ['Grasshopper'],
      desc: 'Generates a diagonal grid across any doubly curved surface, with division count and member depth as live parameters.' },
    { file: 'Elevated_Road_Geometry_from_Alignment.gh', title: 'Elevated Road from Alignment', cat: 'urban', preview: 'elevatedRoad', tags: ['Grasshopper'],
      desc: 'Builds an elevated roadway from a horizontal alignment. Deck, edges and vertical profile follow the curve, so the whole structure updates when the alignment moves.' },
    { file: 'Elk_Urban_Map_OSM.gh', title: 'Urban Map from OSM', cat: 'urban', preview: 'osmMap', tags: ['Elk', 'OpenStreetMap'],
      desc: 'Pulls OpenStreetMap data into Rhino with Elk: streets, blocks and building footprints as clean curves ready for site modelling.' },
    { file: 'Galapagos_Script_Printer_Location.gh', title: 'Printer Location', cat: 'optimization', preview: 'printer', tags: ['Galapagos'],
      desc: 'A small, practical optimization. Galapagos finds the spot on a floor plate that minimizes the total walking distance from every desk to a shared printer.' },
    { file: 'Hexagon_in_Surface_Lunchbox.gh', title: 'Hexagon in Surface', cat: 'form', preview: 'hex', tags: ['LunchBox'],
      desc: 'Hexagonal panelling mapped onto a curved surface with LunchBox, with cell count and panel depth exposed for quick studies.' },
    { file: 'Honeybee_Full_Building_Energy_Simulation.gh', title: 'Full Building Energy Simulation', cat: 'environment', preview: 'massing', variant: 'box', tags: ['Ladybug', 'Honeybee', 'EnergyPlus'],
      desc: 'A complete Honeybee energy workflow: zones, constructions, schedules and loads assembled into an EnergyPlus model and run for annual results.' },
    { file: 'Honeybee_IAB_requirements_2023.gh', title: 'Honeybee: IAB Requirements', cat: 'environment', preview: 'massing', variant: 'L', tags: ['Ladybug', 'Honeybee'],
      desc: 'Honeybee energy setup organized around the 2023 IAB requirements. The base definition that the two project variants start from.' },
    { file: 'Honeybee_IAB_requirements_project01_2023.gh', title: 'IAB Requirements: Project 01', cat: 'environment', preview: 'massing', variant: 'bar', tags: ['Ladybug', 'Honeybee'],
      desc: 'First project application of the IAB workflow, with its own massing, zoning and inputs.' },
    { file: 'Honeybee_IAB_requirements_project02_2023.gh', title: 'IAB Requirements: Project 02', cat: 'environment', preview: 'massing', variant: 'tower', tags: ['Ladybug', 'Honeybee'],
      desc: 'Second project application of the IAB workflow, set up for a taller massing and a different program mix.' },
    { file: 'Honeybee_Insulator_Thermal_Analysis.gh', title: 'Insulator Thermal Analysis', cat: 'environment', preview: 'thermalWall', variant: 'insulator', tags: ['Honeybee'],
      desc: 'Compares insulation options through Honeybee: wall constructions swapped in turn, with heat flow and interior conditions reported for each.' },
    { file: 'Honeybee_Thermal_Workfolw_2023.gh', title: 'Thermal Workflow', cat: 'environment', preview: 'thermalWall', variant: 'workflow', tags: ['Honeybee'],
      desc: 'A streamlined Honeybee thermal workflow from the 2023 toolset: a short path from massing to zone temperatures and loads.' },
    { file: 'Impact_Analysis_of_Metal_Roofing_Honeybee.gh', title: 'Metal Roofing Impact', cat: 'environment', preview: 'massing', variant: 'pitched', tags: ['Honeybee'],
      desc: 'Tests how a metal roof changes building performance: roof construction, reflectance and insulation varied in Honeybee and the energy impact compared.' },
    { file: 'Indoorairflow_Butterfly_Workflow.gh', title: 'Indoor Airflow', cat: 'environment', preview: 'airflow', tags: ['Butterfly', 'OpenFOAM'],
      desc: 'Indoor CFD with Butterfly: a room, its openings and boundary conditions passed to OpenFOAM, with velocity and pressure brought back into Grasshopper.' },
    { file: 'Kangaroo Ancor Point Script.gh', title: 'Kangaroo Anchor Points', cat: 'structure', preview: 'kAnchor', tags: ['Kangaroo'],
      desc: 'Controls where a relaxed mesh is held: anchor points selected, weighted and moved while the form updates live.' },
    { file: 'Kangaroo_Basics.gh', title: 'Kangaroo Basics', cat: 'structure', preview: 'cloth', tags: ['Kangaroo'],
      desc: 'The starting point for physics-based form-finding: a mesh, springs, gravity and anchors wired into the Kangaroo solver.' },
    { file: 'Kangaroo_Example.gh', title: 'Kangaroo Example', cat: 'structure', preview: 'drape', tags: ['Kangaroo'],
      desc: 'A worked example of draping and collision: a mesh settles over an obstacle under gravity while length goals keep it taut.' },
    { file: 'Kangaroo_tensile_Example.gh', title: 'Tensile Example', cat: 'structure', preview: 'saddle', tags: ['Kangaroo'],
      desc: 'A tensile membrane found by relaxation: boundary points pinned high and low, the surface pulled into a minimal saddle.' },
    { file: 'Optimum_point_of_connection.gh', title: 'Optimum Point of Connection', cat: 'optimization', preview: 'path', tags: ['Galapagos'],
      desc: 'Finds the best single point to connect a set of locations, minimizing total length. Note: this file is byte-identical to Path Optimization, saved under a second name.' },
    { file: 'Parametric_Screen_Fabrication_Example.gh', title: 'Parametric Screen Fabrication', cat: 'building', preview: 'attractorScreen', tags: ['Grasshopper'],
      desc: 'A perforated screen driven by an attractor, with the panels unrolled, numbered and laid out for cutting.' },
    { file: 'Path_Optimization_Galapagos.gh', title: 'Path Optimization', cat: 'optimization', preview: 'path', tags: ['Galapagos'],
      desc: 'Shortest route through a set of points found with Galapagos: the visiting order is the genome, total length the fitness.' },
    { file: 'Pier_Placement_in_Alignment.gh', title: 'Pier Placement in Alignment', cat: 'urban', preview: 'elevatedRoad', variant: 'piers', tags: ['Grasshopper'],
      desc: 'Places bridge piers along an alignment at a controlled spacing, each pier perpendicular to the curve and sized to the deck above.' },
    { file: 'Residential_Unit_Growth_Biomorpher.gh', title: 'Residential Unit Growth', cat: 'optimization', preview: 'units', tags: ['Biomorpher'],
      desc: 'Aggregates residential units by rule, then uses Biomorpher to evolve the configuration toward daylight, density and adjacency preferences.' },
    { file: 'Road_lane_mark_generation.gh', title: 'Road Lane Marks', cat: 'urban', preview: 'lanes', tags: ['Grasshopper'],
      desc: 'Generates lane lines, dashes and edge markings along a road centreline, holding lane widths and dash rhythm through the curves.' },
    { file: 'Screen_UV_morph_jitter.gh', title: 'Screen UV Morph Jitter', cat: 'form', preview: 'jitter', tags: ['Grasshopper'],
      desc: 'A screen panel whose UV subdivision is morphed and jittered for a hand-set, irregular pattern that still stays inside a controlled grid.' },
    { file: 'Segmentet_folded_Plate.gh', title: 'Segmented Folded Plate', cat: 'form', preview: 'foldedPlate', tags: ['Grasshopper'],
      desc: 'A folded-plate structure broken into segments, each with its own fold depth, so a long span can vary its profile along its length.' },
    { file: 'Shell_Segment_Script.gh', title: 'Shell Segment', cat: 'form', preview: 'shell', tags: ['Grasshopper'],
      desc: 'Divides a shell into buildable segments: a dome or vault split along lattice lines into repeatable pieces.' },
    { file: 'Stadium_Random_Composition_Script.gh', title: 'Stadium Random Composition', cat: 'form', preview: 'stadium', tags: ['Grasshopper'],
      desc: 'A stadium envelope composed of randomized panels around an elliptical bowl, with seed and variation controlling the rhythm.' },
    { file: 'Surface_Voronoi.gh', title: 'Surface Voronoi', cat: 'form', preview: 'surfVoronoi', tags: ['Grasshopper'],
      desc: 'Voronoi cells projected onto a curved surface, with points that can be fixed, scattered or driven by a field.' },
    { file: 'TensileRelaxScript.gh', title: 'Tensile Relax', cat: 'structure', preview: 'tent', tags: ['Kangaroo'],
      desc: 'A relaxation script for tensile canopies: a mast lifts the membrane from a pinned boundary and the mesh settles into form.' },
    { file: 'Volume_Voronoi.gh', title: 'Volume Voronoi', cat: 'form', preview: 'volVoronoi', tags: ['Grasshopper'],
      desc: 'Three-dimensional Voronoi cells filling a volume. Cells can be shelled, offset or culled for porous massing studies.' },
    { file: 'Voronoi_with_attractor.gh', title: 'Voronoi with Attractor', cat: 'form', preview: 'attrVoronoi', tags: ['Grasshopper'],
      desc: 'A Voronoi pattern densified toward an attractor point, so cell size grades smoothly across the field.' }
  ];

  /* file sizes in bytes, read from the repository at build time */
  const SIZES = {
    '3D_Automation_fromPlan.gh': 24711, 'Auditorium_Section.gh': 34809, 'Biomorpher_Evolutionary_Growth.gh': 33242,
    'Circular Folded Plate.gh': 21465, 'Circular_Folded_plate.gh': 17776, 'Daylight_optimization_Octopus_TTtoolbox_ClimateStudio.gh': 1573913,
    'Diagrid_Export.gh': 10660, 'Diagrid_in_surface.gh': 15324, 'Elevated_Road_Geometry_from_Alignment.gh': 44748, 'Elk_Urban_Map_OSM.gh': 7735,
    'Galapagos_Script_Printer_Location.gh': 6823, 'Hexagon_in_Surface_Lunchbox.gh': 8958, 'Honeybee_Full_Building_Energy_Simulation.gh': 1104176,
    'Honeybee_IAB_requirements_2023.gh': 155548, 'Honeybee_IAB_requirements_project01_2023.gh': 214644, 'Honeybee_IAB_requirements_project02_2023.gh': 204412,
    'Honeybee_Insulator_Thermal_Analysis.gh': 736618, 'Honeybee_Thermal_Workfolw_2023.gh': 787689, 'Impact_Analysis_of_Metal_Roofing_Honeybee.gh': 740050,
    'Indoorairflow_Butterfly_Workflow.gh': 456341, 'Kangaroo Ancor Point Script.gh': 11100, 'Kangaroo_Basics.gh': 8654, 'Kangaroo_Example.gh': 30557,
    'Kangaroo_tensile_Example.gh': 13353, 'Optimum_point_of_connection.gh': 16023, 'Parametric_Screen_Fabrication_Example.gh': 16837,
    'Path_Optimization_Galapagos.gh': 16023, 'Pier_Placement_in_Alignment.gh': 236731, 'Residential_Unit_Growth_Biomorpher.gh': 40953,
    'Road_lane_mark_generation.gh': 29753, 'Screen_UV_morph_jitter.gh': 14829, 'Segmentet_folded_Plate.gh': 9181, 'Shell_Segment_Script.gh': 22837,
    'Stadium_Random_Composition_Script.gh': 6358, 'Surface_Voronoi.gh': 11640, 'TensileRelaxScript.gh': 18837, 'Volume_Voronoi.gh': 27766, 'Voronoi_with_attractor.gh': 10341
  };

  const fmtSize = (b) => (b >= 1e6 ? (b / 1e6).toFixed(1) + ' MB' : b >= 1e3 ? Math.round(b / 1e3) + ' KB' : b + ' B');
  const pad = (n) => String(n).padStart(2, '0');
  const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function cardHTML(d, i) {
    const href = encodeURI(d.file);
    const media = d.media
      ? (/\.(mp4|webm)$/i.test(d.media)
        ? `<video class="preview-media" src="${esc(d.media)}" autoplay muted loop playsinline></video>`
        : `<img class="preview-media" src="${esc(d.media)}" alt="">`)
      : `<canvas class="preview-canvas" data-preview="${esc(d.preview)}" data-variant="${esc(String(d.variant || ''))}" data-seed="${i + 1}" aria-hidden="true"></canvas>`;
    return `
      <article class="card" data-cat="${d.cat}" style="--i:${i}">
        <div class="preview">${media}</div>
        <div class="card-body">
          <div class="card-meta"><span class="index">${pad(i + 1)}</span><span class="cat">${esc(catName(d.cat))}</span></div>
          <h2 class="card-title">${esc(d.title)}</h2>
          <p class="card-desc">${esc(d.desc)}</p>
          <ul class="tags">${d.tags.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
        </div>
        <footer class="card-foot">
          <a class="dl" href="${href}" download="${esc(d.file)}" title="${esc(d.file)}">
            <span class="dl-label">Download .gh</span>
            <span class="dl-arrow" aria-hidden="true">&#8595;</span>
          </a>
          <span class="size" data-file="${esc(d.file)}">${SIZES[d.file] ? fmtSize(SIZES[d.file]) : ''}</span>
        </footer>
      </article>`;
  }

  function catName(k) { const c = CATEGORIES.find((x) => x[0] === k); return c ? c[1] : k; }

  function build() {
    const grid = document.getElementById('grid');
    const filters = document.getElementById('filters');
    const count = document.getElementById('count');
    if (!grid) return;

    const sorted = DATA.slice().sort((a, b) => a.title.localeCompare(b.title));
    grid.innerHTML = sorted.map(cardHTML).join('');
    if (count) count.textContent = String(sorted.length);

    const counts = {};
    for (const d of sorted) counts[d.cat] = (counts[d.cat] || 0) + 1;
    if (filters) {
      filters.innerHTML = [`<button class="filter is-active" data-cat="all"><span class="filter-label">All</span> <sup>${sorted.length}</sup></button>`]
        .concat(CATEGORIES.map(([k, n]) => `<button class="filter" data-cat="${k}"><span class="filter-label">${esc(n)}</span> <sup>${counts[k] || 0}</sup></button>`)).join('');
      filters.addEventListener('click', (e) => {
        const b = e.target.closest('.filter[data-cat]'); if (!b) return;
        filters.querySelectorAll('.filter').forEach((x) => x.classList.toggle('is-active', x === b));
        const cat = b.dataset.cat;
        let shown = 0;
        grid.querySelectorAll('.card').forEach((c) => { const on = cat === 'all' || c.dataset.cat === cat; c.hidden = !on; if (on) { c.style.setProperty('--i', shown); shown++; } });
        grid.classList.remove('is-filtering'); void grid.offsetWidth; grid.classList.add('is-filtering');
      });
    }

    if (window.GHPreviews) {
      grid.querySelectorAll('canvas.preview-canvas').forEach((cv) => {
        const v = cv.dataset.variant;
        window.GHPreviews.mount(cv, cv.dataset.preview, { seed: Number(cv.dataset.seed), variant: /^\d+$/.test(v) ? Number(v) : (v || undefined) });
      });
    }

    const year = document.getElementById('year');
    if (year) year.textContent = String(new Date().getFullYear());
    document.querySelectorAll('[data-repo]').forEach((a) => { a.href = REPO + (a.dataset.repo || ''); });

    /* File sizes are read from the files themselves once the page is up, so a
       new .gh needs no size entry; the SIZES table only gives a first value. */
    if (typeof fetch === 'function' && location.protocol !== 'file:') {
      grid.querySelectorAll('.size[data-file]').forEach((el) => {
        fetch(encodeURI(el.dataset.file), { method: 'HEAD' })
          .then((r) => { const n = Number(r.headers.get('content-length')); if (r.ok && n > 0) el.textContent = fmtSize(n); })
          .catch(() => { /* leave whatever is shown */ });
      });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build); else build();
  window.GH_DATA = DATA;
  window.GH_SITE = { DATA, CATEGORIES, cardHTML, catName, fmtSize };
})();
