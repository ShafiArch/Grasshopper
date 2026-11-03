/* Grasshopper Workflow Collection: schematic wireframe previews.
   Each preview is a small procedural animation that sketches the idea of a
   definition (a voronoi on a surface, a relaxed membrane, a sun path over a
   massing). They are drawn live on canvas, not rendered from the .gh files. */
(function () {
  'use strict';

  const TAU = Math.PI * 2;
  const lerp = (a, b, t) => a + (b - a) * t;
  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
  const smooth = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
  const tri = (x) => 1 - Math.abs(((x % 2) + 2) % 2 - 1);
  const frac = (x) => x - Math.floor(x);
  const dist2 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ---------- drawing primitives ---------- */
  const L = (pts, o) => Object.assign({ kind: 'line', pts }, o || {});
  const D = (p, o) => Object.assign({ kind: 'dot', p }, o || {});

  function cubeLines(c, s, o) {
    const [cx, cy, cz] = c, [sx, sy, sz] = s;
    const x0 = cx - sx / 2, x1 = cx + sx / 2, y0 = cy - sy / 2, y1 = cy + sy / 2, z0 = cz - sz / 2, z1 = cz + sz / 2;
    return [
      L([[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0]], Object.assign({ closed: true }, o)),
      L([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], Object.assign({ closed: true }, o)),
      L([[x0, y0, z0], [x0, y0, z1]], o), L([[x1, y0, z0], [x1, y0, z1]], o),
      L([[x1, y1, z0], [x1, y1, z1]], o), L([[x0, y1, z0], [x0, y1, z1]], o)
    ];
  }

  function surfaceLines(f, nu, nv, o, su, sv) {
    su = su || 1; sv = sv || 1;
    const out = [];
    for (let i = 0; i <= nu; i += su) {
      const pts = [];
      for (let j = 0; j <= nv; j++) pts.push(f(i / nu, j / nv));
      out.push(L(pts, o));
    }
    for (let j = 0; j <= nv; j += sv) {
      const pts = [];
      for (let i = 0; i <= nu; i++) pts.push(f(i / nu, j / nv));
      out.push(L(pts, o));
    }
    return out;
  }

  function circlePts(c, r, n, axis) {
    const pts = [];
    for (let k = 0; k < n; k++) {
      const a = (k / n) * TAU, u = Math.cos(a) * r, v = Math.sin(a) * r;
      if (axis === 'z') pts.push([c[0] + u, c[1] + v, c[2]]);
      else if (axis === 'y') pts.push([c[0] + u, c[1], c[2] + v]);
      else pts.push([c[0], c[1] + u, c[2] + v]);
    }
    return pts;
  }

  function groundGrid(n, size, o) {
    const out = [], h = size / 2;
    for (let i = 0; i <= n; i++) {
      const v = lerp(-h, h, i / n);
      out.push(L([[-h, v, 0], [h, v, 0]], o));
      out.push(L([[v, -h, 0], [v, h, 0]], o));
    }
    return out;
  }

  /* ---------- 2D voronoi by half-plane clipping ---------- */
  function clipHalf(poly, mx, my, nx, ny) {
    const out = [], n = poly.length;
    for (let k = 0; k < n; k++) {
      const a = poly[k], b = poly[(k + 1) % n];
      const da = (a[0] - mx) * nx + (a[1] - my) * ny, db = (b[0] - mx) * nx + (b[1] - my) * ny;
      if (da <= 0) out.push(a);
      if ((da < 0 && db > 0) || (da > 0 && db < 0)) {
        const t = da / (da - db);
        out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      }
    }
    return out;
  }
  function voronoi(sites, x0, y0, x1, y1) {
    const cells = [];
    for (let i = 0; i < sites.length; i++) {
      let poly = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
      const p = sites[i];
      for (let j = 0; j < sites.length && poly.length; j++) {
        if (i === j) continue;
        const q = sites[j];
        poly = clipHalf(poly, (p[0] + q[0]) / 2, (p[1] + q[1]) / 2, q[0] - p[0], q[1] - p[1]);
      }
      cells.push(poly);
    }
    return cells;
  }
  function liftPoly(poly, h, sub) {
    const pts = [];
    for (let k = 0; k < poly.length; k++) {
      const a = poly[k], b = poly[(k + 1) % poly.length];
      for (let s = 0; s < sub; s++) {
        const x = lerp(a[0], b[0], s / sub), y = lerp(a[1], b[1], s / sub);
        pts.push([x, y, h(x, y)]);
      }
    }
    return pts;
  }

  /* ---------- verlet mesh (kangaroo-style) ---------- */
  function makeCloth(n, m, place, restScale) {
    const P = [], C = [];
    for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) {
      const p = place(i, j);
      P.push({ p: p.slice(), q: p.slice(), o: p.slice(), pin: null, i, j });
    }
    const id = (i, j) => i * m + j;
    const add = (a, b) => {
      const r = Math.hypot(P[a].p[0] - P[b].p[0], P[a].p[1] - P[b].p[1], P[a].p[2] - P[b].p[2]);
      const k = typeof restScale === 'function' ? restScale(P[a], P[b]) : (restScale || 1);
      C.push([a, b, r * k]);
    };
    for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) {
      if (i < n - 1) add(id(i, j), id(i + 1, j));
      if (j < m - 1) add(id(i, j), id(i, j + 1));
      if (i < n - 1 && j < m - 1) { add(id(i, j), id(i + 1, j + 1)); add(id(i + 1, j), id(i, j + 1)); }
    }
    return { n, m, P, C, id };
  }
  function stepCloth(c, dt, g, iters, damp, collide) {
    const P = c.P;
    for (const a of P) {
      if (a.pin) { a.p[0] = a.pin[0]; a.p[1] = a.pin[1]; a.p[2] = a.pin[2]; a.q = a.p.slice(); continue; }
      const vx = (a.p[0] - a.q[0]) * damp, vy = (a.p[1] - a.q[1]) * damp, vz = (a.p[2] - a.q[2]) * damp;
      a.q = a.p.slice();
      a.p[0] += vx; a.p[1] += vy; a.p[2] += vz + g * dt * dt;
    }
    for (let it = 0; it < iters; it++) {
      for (const [ia, ib, rest] of c.C) {
        const a = P[ia], b = P[ib];
        const dx = b.p[0] - a.p[0], dy = b.p[1] - a.p[1], dz = b.p[2] - a.p[2];
        const len = Math.hypot(dx, dy, dz) || 1e-6, diff = (len - rest) / len;
        const wa = a.pin ? 0 : 1, wb = b.pin ? 0 : 1, ws = wa + wb || 1;
        const fa = (wa / ws) * diff, fb = (wb / ws) * diff;
        a.p[0] += dx * fa; a.p[1] += dy * fa; a.p[2] += dz * fa;
        b.p[0] -= dx * fb; b.p[1] -= dy * fb; b.p[2] -= dz * fb;
      }
      if (collide) for (const a of P) if (!a.pin) collide(a.p);
    }
  }
  function clothLines(c, o) {
    const out = [];
    for (let i = 0; i < c.n; i++) out.push(L(Array.from({ length: c.m }, (_, j) => c.P[c.id(i, j)].p), o));
    for (let j = 0; j < c.m; j++) out.push(L(Array.from({ length: c.n }, (_, i) => c.P[c.id(i, j)].p), o));
    return out;
  }
  function resetCloth(c) { for (const a of c.P) { a.p = a.o.slice(); a.q = a.o.slice(); } }
  function runPhysics(s, t, dt, maxSteps, fn) {
    if (s.simT === undefined) s.simT = t;
    let n = Math.min(maxSteps, Math.floor((t - s.simT) / dt));
    if (n <= 0) return;
    for (let k = 0; k < n; k++) fn();
    s.simT += n * dt;
    if (t - s.simT > dt * maxSteps) s.simT = t;
  }

  /* ---------- shared bits ---------- */
  function sunPath(t, period, R, out) {
    const u = frac(t / period), a = lerp(0.15, Math.PI - 0.15, u);
    const sun = [R * Math.cos(a), -R * 0.55 * Math.sin(a), R * 0.78 * Math.sin(a)];
    const arc = [];
    for (let k = 0; k <= 32; k++) { const b = lerp(0.15, Math.PI - 0.15, k / 32); arc.push([R * Math.cos(b), -R * 0.55 * Math.sin(b), R * 0.78 * Math.sin(b)]); }
    out.push(L(arc, { a: 0.3, dash: [0.03, 0.03] }));
    out.push(L([[sun[0], sun[1], 0], sun], { a: 0.2, dash: [0.02, 0.025] }));
    out.push(D(sun, { c: 'accent', r: 3.2 }));
    out.push(L(circlePts(sun, 0.07, 24, 'y'), { c: 'accent', a: 0.6, closed: true, w: 0.8 }));
    return { sun, a };
  }

  function alignment(u, t) {
    const amp = 0.3 + 0.07 * Math.sin(t * 0.3);
    return [lerp(-1.15, 1.15, u), amp * Math.sin(u * 4.6 + 0.3 * Math.sin(t * 0.2)) + 0.08 * (u - 0.5), 0];
  }

  /* ---------- generators ---------- */
  const G = {};

  G.surfVoronoi = {
    view: { el: 0.62, spin: 0.1, zoom: 0.46 },
    init(s, R) { s.base = Array.from({ length: 17 }, () => [R() * 1.9 - 0.95, R() * 1.9 - 0.95]); s.ph = s.base.map(() => R() * TAU); },
    step(t, s) {
      const h = (x, y) => 0.26 * Math.sin(1.5 * x + 0.6) * Math.cos(1.25 * y) + 0.05 * Math.sin(3 * y);
      const sites = s.base.map((p, i) => [clamp(p[0] + 0.11 * Math.sin(t * 0.33 + s.ph[i]), -0.98, 0.98), clamp(p[1] + 0.11 * Math.cos(t * 0.29 + s.ph[i] * 1.7), -0.98, 0.98)]);
      const out = surfaceLines((u, v) => { const x = lerp(-1, 1, u), y = lerp(-1, 1, v); return [x, y, h(x, y)]; }, 8, 8, { a: 0.14, w: 0.8 });
      for (const cell of voronoi(sites, -1, -1, 1, 1)) if (cell.length > 2) out.push(L(liftPoly(cell, h, 4), { closed: true, w: 1.05 }));
      for (const p of sites) out.push(D([p[0], p[1], h(p[0], p[1])], { r: 1.6, a: 0.85 }));
      return out;
    }
  };

  G.attrVoronoi = {
    view: { el: 1.0, spin: 0.04, zoom: 0.44 },
    init(s, R) { s.base = Array.from({ length: 26 }, () => [R() * 1.9 - 0.95, R() * 1.9 - 0.95]); },
    step(t, s) {
      const A = [0.55 * Math.cos(t * 0.38), 0.5 * Math.sin(t * 0.5 + 1)];
      const sites = s.base.map((p) => { const d = Math.hypot(A[0] - p[0], A[1] - p[1]); const k = 0.32 * Math.exp(-d / 0.9); return [p[0] + (A[0] - p[0]) * k, p[1] + (A[1] - p[1]) * k]; });
      const out = [L([[-1, -1, 0], [1, -1, 0], [1, 1, 0], [-1, 1, 0]], { closed: true, a: 0.3 })];
      for (const cell of voronoi(sites, -1, -1, 1, 1)) if (cell.length > 2) out.push(L(cell.map((p) => [p[0], p[1], 0]), { closed: true }));
      for (const p of sites) out.push(D([p[0], p[1], 0], { r: 1.3, a: 0.7 }));
      out.push(D([A[0], A[1], 0.02], { c: 'accent', r: 3 }));
      out.push(L(circlePts([A[0], A[1], 0.02], 0.09, 24, 'z'), { c: 'accent', closed: true, a: 0.7, w: 0.8 }));
      return out;
    }
  };

  G.volVoronoi = {
    view: { el: 0.5, spin: 0.14, zoom: 0.42 },
    init(s, R) {
      s.faces = [];
      const h = 0.64;
      const frames = [
        (u, v) => [h, u * h, v * h], (u, v) => [-h, u * h, v * h],
        (u, v) => [u * h, h, v * h], (u, v) => [u * h, -h, v * h],
        (u, v) => [u * h, v * h, h], (u, v) => [u * h, v * h, -h]
      ];
      for (const f of frames) s.faces.push({ f, sites: Array.from({ length: 7 }, () => [R() * 1.8 - 0.9, R() * 1.8 - 0.9]), ph: Array.from({ length: 7 }, () => R() * TAU) });
    },
    step(t, s, R, v, cam) {
      const out = cubeLines([0, 0, 0], [1.28, 1.28, 1.28], { w: 1.2 });
      const normals = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
      s.faces.forEach((face, fi) => {
        const n = normals[fi], facing = cam ? (n[0] * cam.dir[0] + n[1] * cam.dir[1] + n[2] * cam.dir[2]) < 0 : true;
        const sites = face.sites.map((p, i) => [clamp(p[0] + 0.1 * Math.sin(t * 0.35 + face.ph[i]), -0.98, 0.98), clamp(p[1] + 0.1 * Math.cos(t * 0.31 + face.ph[i] * 2), -0.98, 0.98)]);
        for (const cell of voronoi(sites, -1, -1, 1, 1)) if (cell.length > 2) out.push(L(cell.map((p) => face.f(p[0], p[1])), { closed: true, a: facing ? 0.85 : 0.12, w: facing ? 1.0 : 0.7 }));
        if (facing) for (const p of sites) out.push(D(face.f(p[0], p[1]), { r: 1.2, a: 0.5 }));
      });
      return out;
    }
  };

  function diagridSurface(f, n, o, nodes) {
    const out = [], P = [];
    for (let i = 0; i <= n; i++) { P[i] = []; for (let j = 0; j <= n; j++) P[i][j] = f(i / n, j / n); }
    for (let k = -n; k <= n; k++) {
      const a = [], b = [];
      for (let i = 0; i <= n; i++) { const j = i - k; if (j >= 0 && j <= n) a.push(P[i][j]); const j2 = k - i + n; if (j2 >= 0 && j2 <= n) b.push(P[i][j2]); }
      if (a.length > 1) out.push(L(a, o)); if (b.length > 1) out.push(L(b, o));
    }
    out.push(L([P[0][0], P[n][0], P[n][n], P[0][n]], { closed: true, w: 1.3 }));
    if (nodes) for (let i = 0; i <= n; i++) for (let j = 0; j <= n; j++) if ((i + j) % 2 === 0) out.push(D(P[i][j], { r: 1.1, a: 0.6 }));
    return out;
  }

  G.diagrid = {
    view: { el: 0.5, spin: 0.12, zoom: 0.46 },
    step(t) {
      return diagridSurface((u, v) => { const x = lerp(-1, 1, u), y = lerp(-1, 1, v); return [x, y, 0.28 * Math.sin(x * 2.1 + t * 0.45) * Math.cos(y * 1.7) + 0.08 * Math.sin(y * 3 - t * 0.3)]; }, 12, { w: 0.95 }, false);
    }
  };

  G.diagridExport = {
    view: { el: 0.48, spin: 0.1, zoom: 0.46 },
    step(t) {
      const m = smooth(tri(t / 4.5) * 1.3 - 0.15);
      const out = diagridSurface((u, v) => { const x = lerp(-1, 1, u), y = lerp(-1, 1, v); return [x, y, m * (0.3 * Math.sin(x * 2.1) * Math.cos(y * 1.7))]; }, 12, { w: 0.95 }, true);
      out.push(L([[-1.12, -1.12, 0], [1.12, -1.12, 0], [1.12, 1.12, 0], [-1.12, 1.12, 0]], { closed: true, a: 0.35 * (1 - m), dash: [0.04, 0.03] }));
      return out;
    }
  };

  G.hex = {
    view: { el: 0.46, spin: 0.11, zoom: 0.46 },
    step(t) {
      const a = 0.125, out = [], amp = 0.42 * (0.85 + 0.15 * Math.sin(t * 0.5));
      const z = (x, y) => { const r = Math.hypot(x, y) / 1.0; return amp * Math.max(0, 1 - r * r); };
      for (let i = -8; i <= 8; i++) for (let j = -8; j <= 8; j++) {
        const cx = a * 1.5 * i, cy = a * Math.sqrt(3) * (j + 0.5 * (i & 1));
        if (Math.hypot(cx, cy) > 0.93) continue;
        const pts = [];
        for (let k = 0; k < 6; k++) { const an = (k / 6) * TAU; const x = cx + a * Math.cos(an), y = cy + a * Math.sin(an); pts.push([x, y, z(x, y)]); }
        out.push(L(pts, { closed: true }));
      }
      out.push(L(circlePts([0, 0, 0], 1.0, 64, 'z'), { closed: true, a: 0.3 }));
      return out;
    }
  };

  G.cloth = {
    view: { el: 0.42, spin: 0.1, zoom: 0.46, yc: 0.5 },
    init(s) { s.c = makeCloth(12, 12, (i, j) => [lerp(-0.8, 0.8, i / 11), lerp(-0.8, 0.8, j / 11), 0.35]); for (const k of [0, 11, 132, 143]) s.c.P[k].pin = s.c.P[k].o.slice(); s.cycle = 0; },
    step(t, s) {
      if (t - s.cycle > 7.5) { resetCloth(s.c); s.cycle = t; }
      runPhysics(s, t, 1 / 60, 4, () => stepCloth(s.c, 1 / 60, -2.0, 4, 0.985));
      const out = clothLines(s.c, { w: 0.9 });
      for (const a of s.c.P) if (a.pin) out.push(D(a.p, { c: 'accent', r: 2.6 }));
      out.push(...groundGrid(4, 2.0, { a: 0.1 }));
      return out;
    }
  };

  G.kAnchor = {
    view: { el: 0.4, spin: 0.12, zoom: 0.46 },
    init(s) { s.c = makeCloth(13, 13, (i, j) => [lerp(-0.8, 0.8, i / 12), lerp(-0.8, 0.8, j / 12), 0.0]); for (const k of [0, 12, 156, 168]) s.c.P[k].pin = s.c.P[k].o.slice(); },
    step(t, s) {
      const mid = s.c.P[s.c.id(6, 6)], k2 = s.c.P[s.c.id(3, 9)];
      mid.pin = [0.22 * Math.cos(t * 0.45), 0.22 * Math.sin(t * 0.45), 0.35 + 0.25 * Math.sin(t * 0.7)];
      k2.pin = [k2.o[0], k2.o[1], 0.15 + 0.12 * Math.sin(t * 0.9 + 2)];
      runPhysics(s, t, 1 / 60, 4, () => stepCloth(s.c, 1 / 60, -0.8, 6, 0.93));
      const out = clothLines(s.c, { w: 0.9 });
      for (const a of s.c.P) if (a.pin) { out.push(D(a.p, { c: 'accent', r: 2.6 })); out.push(L([[a.p[0], a.p[1], -0.0], a.p], { a: 0.25, dash: [0.02, 0.02] })); }
      out.push(L(circlePts(mid.pin, 0.08, 20, 'z'), { c: 'accent', closed: true, a: 0.7, w: 0.8 }));
      out.push(...groundGrid(4, 2.0, { a: 0.1 }));
      return out;
    }
  };

  G.drape = {
    view: { el: 0.38, spin: 0.1, zoom: 0.46, yc: 0.52 },
    init(s) { s.c = makeCloth(15, 15, (i, j) => [lerp(-0.9, 0.9, i / 14) + 0.001 * i, lerp(-0.9, 0.9, j / 14), 0.6]); s.cycle = 0; },
    step(t, s) {
      if (t - s.cycle > 8) { resetCloth(s.c); s.cycle = t; }
      const C = [0, 0, -0.1], r = 0.46, ground = -0.56;
      runPhysics(s, t, 1 / 60, 4, () => stepCloth(s.c, 1 / 60, -1.8, 4, 0.98, (p) => {
        const dx = p[0] - C[0], dy = p[1] - C[1], dz = p[2] - C[2], d = Math.hypot(dx, dy, dz);
        if (d < r + 0.015) { const k = (r + 0.015) / d; p[0] = C[0] + dx * k; p[1] = C[1] + dy * k; p[2] = C[2] + dz * k; }
        if (p[2] < ground) p[2] = ground;
      }));
      const out = clothLines(s.c, { w: 0.9 });
      for (let k = -2; k <= 2; k++) { const z = C[2] + k * 0.17; const rr = Math.sqrt(Math.max(0, r * r - (z - C[2]) ** 2)); out.push(L(circlePts([0, 0, z], rr, 40, 'z'), { closed: true, a: 0.22, dash: [0.02, 0.02] })); }
      out.push(L([[-1.1, -1.1, ground], [1.1, -1.1, ground], [1.1, 1.1, ground], [-1.1, 1.1, ground]], { closed: true, a: 0.2 }));
      return out;
    }
  };

  G.saddle = {
    view: { el: 0.3, spin: 0.14, zoom: 0.46, yc: 0.5 },
    init(s) {
      const edge = (a) => a.i === 0 || a.j === 0 || a.i === 11 || a.j === 11;
      s.c = makeCloth(12, 12, (i, j) => [lerp(-0.85, 0.85, i / 11), lerp(-0.85, 0.85, j / 11), 0], (a, b) => (edge(a) && edge(b) ? 0.97 : 0.8));
    },
    step(t, s) {
      const c = s.c, hi = 0.5 + 0.12 * Math.sin(t * 0.5), lo = -0.3 + 0.1 * Math.sin(t * 0.7 + 1);
      c.P[c.id(0, 0)].pin = [-0.85, -0.85, hi]; c.P[c.id(11, 11)].pin = [0.85, 0.85, hi];
      c.P[c.id(0, 11)].pin = [-0.85, 0.85, lo]; c.P[c.id(11, 0)].pin = [0.85, -0.85, lo];
      runPhysics(s, t, 1 / 60, 4, () => stepCloth(c, 1 / 60, 0, 3, 0.9));
      const out = clothLines(c, { w: 0.9 });
      const b = [c.P[c.id(0, 0)], c.P[c.id(11, 11)], c.P[c.id(0, 11)], c.P[c.id(11, 0)]];
      for (const a of b) { out.push(D(a.p, { c: 'accent', r: 2.8 })); out.push(L([[a.p[0], a.p[1], -0.45], a.p], { a: 0.35 })); }
      out.push(L([[-1.05, -1.05, -0.45], [1.05, -1.05, -0.45], [1.05, 1.05, -0.45], [-1.05, 1.05, -0.45]], { closed: true, a: 0.18 }));
      return out;
    }
  };

  G.tent = {
    view: { el: 0.32, spin: 0.12, zoom: 0.46, yc: 0.55 },
    init(s) {
      const n = 15;
      s.c = makeCloth(n, n, (i, j) => { const x = lerp(-1, 1, i / (n - 1)), y = lerp(-1, 1, j / (n - 1)); return [0.92 * x * Math.sqrt(1 - y * y / 2), 0.92 * y * Math.sqrt(1 - x * x / 2), 0]; }, 0.78);
      for (const a of s.c.P) if (a.i === 0 || a.j === 0 || a.i === n - 1 || a.j === n - 1) a.pin = a.o.slice();
      s.mast = s.c.P[s.c.id(7, 7)];
    },
    step(t, s) {
      const h = 0.62 + 0.1 * Math.sin(t * 0.6);
      s.mast.pin = [0, 0, h];
      runPhysics(s, t, 1 / 60, 4, () => stepCloth(s.c, 1 / 60, 0, 3, 0.9));
      const out = clothLines(s.c, { w: 0.9 });
      out.push(L([[0, 0, -0.5], [0, 0, h]], { w: 1.6 }));
      out.push(D([0, 0, h], { c: 'accent', r: 3 }));
      for (const a of s.c.P) if (a.pin && a !== s.mast && (a.i + a.j) % 2 === 0) out.push(D(a.p, { r: 1.4, a: 0.8 }));
      out.push(L(circlePts([0, 0, -0.5], 1.25, 64, 'z'), { closed: true, a: 0.18 }));
      return out;
    }
  };

  G.foldedPlate = {
    view: { el: 0.36, spin: 0.1, zoom: 0.44 },
    step(t) {
      const out = [], nF = 9, segs = 3, len = 0.58, gap = 0.04;
      for (let k = 0; k < segs; k++) {
        const y0 = -0.9 + k * (len + gap), y1 = y0 + len, amp = 0.13 + 0.1 * Math.sin(t * 0.6 + k * 1.3), zb = 0.05 * k;
        const prof = [];
        for (let i = 0; i <= nF; i++) prof.push([lerp(-0.85, 0.85, i / nF), zb + (i % 2 ? amp : -amp)]);
        out.push(L(prof.map((p) => [p[0], y0, p[1]]), { w: 1.2 }));
        out.push(L(prof.map((p) => [p[0], y1, p[1]]), { w: 1.2 }));
        for (const p of prof) out.push(L([[p[0], y0, p[1]], [p[0], y1, p[1]]], { w: 0.9 }));
      }
      out.push(...groundGrid(4, 2.4, { a: 0.1 }).map((l) => { l.pts = l.pts.map((p) => [p[0], p[1], -0.5]); return l; }));
      return out;
    }
  };

  G.circularFold = {
    view: { el: 0.4, spin: 0.14, zoom: 0.44, yc: 0.55 },
    step(t, s, R, v) {
      const out = [], n = v === 2 ? 16 : 20, amp = 0.1 + 0.08 * Math.sin(t * 0.5), ri = v === 2 ? 0.4 : 0, za = v === 2 ? 0.3 : 0.38;
      const rim = [], inner = [];
      for (let k = 0; k < 2 * n; k++) {
        const a = (k / (2 * n)) * TAU, z = k % 2 ? amp : -amp;
        rim.push([0.95 * Math.cos(a), 0.95 * Math.sin(a), z]);
        inner.push([ri * Math.cos(a), ri * Math.sin(a), za - (v === 2 ? z * 0.6 : 0)]);
      }
      out.push(L(rim, { closed: true, w: 1.3 }));
      if (ri > 0) out.push(L(inner, { closed: true, w: 1.2 }));
      for (let k = 0; k < 2 * n; k++) out.push(L([inner[k], rim[k]], { w: 0.9 }));
      out.push(L(circlePts([0, 0, -0.45], 1.2, 64, 'z'), { closed: true, a: 0.18 }));
      return out;
    }
  };

  G.shell = {
    view: { el: 0.34, spin: 0.1, zoom: 0.44, yc: 0.56 },
    step(t) {
      const out = [], r = 0.92, nLon = 24, nLat = 7, latMax = 1.42, z0 = -0.35;
      const sp = (lon, lat, rr) => [rr * Math.cos(lat) * Math.cos(lon), rr * Math.cos(lat) * Math.sin(lon), z0 + rr * Math.sin(lat)];
      const seg = Math.floor(t / 2.2), w = TAU / 8, start = seg * w, ex = 0.06 * smooth(tri((t / 2.2) * 2));
      const inWedge = (lon) => { const d = ((lon - start) % TAU + TAU) % TAU; return d < w + 1e-6; };
      for (let i = 0; i < nLon; i++) {
        const lon = (i / nLon) * TAU, pts = [];
        for (let k = 0; k <= 24; k++) pts.push(sp(lon, lerp(0.1, latMax, k / 24), r));
        out.push(L(pts, { a: 0.3, w: 0.8 }));
      }
      for (let k = 0; k <= nLat; k++) { const lat = lerp(0.1, latMax, k / nLat), pts = []; for (let i = 0; i <= 64; i++) pts.push(sp((i / 64) * TAU, lat, r)); out.push(L(pts, { closed: true, a: 0.3, w: 0.8 })); }
      for (let i = 0; i <= 3; i++) {
        const lon = start + (i / 3) * w, pts = [];
        for (let k = 0; k <= 24; k++) pts.push(sp(lon, lerp(0.1, latMax, k / 24), r + ex));
        out.push(L(pts, { w: 1.3 }));
      }
      for (let k = 0; k <= nLat; k++) { const lat = lerp(0.1, latMax, k / nLat), pts = []; for (let i = 0; i <= 12; i++) pts.push(sp(start + (i / 12) * w, lat, r + ex)); out.push(L(pts, { w: 1.3 })); }
      out.push(D(sp(start + w / 2, latMax, r + ex), { c: 'accent', r: 2.4 }));
      out.push(L(circlePts([0, 0, z0 + r * Math.sin(0.1)], r * Math.cos(0.1) + 0.12, 64, 'z'), { closed: true, a: 0.15 }));
      void inWedge;
      return out;
    }
  };

  function massingLines(kind) {
    const out = [], floors = [];
    const box = (c, s) => { out.push(...cubeLines(c, s, { w: 1.2 })); for (let z = 0.15; z < c[2] + s[2] / 2 - 0.02; z += 0.15) floors.push(L([[c[0] - s[0] / 2, c[1] - s[1] / 2, z], [c[0] + s[0] / 2, c[1] - s[1] / 2, z], [c[0] + s[0] / 2, c[1] + s[1] / 2, z], [c[0] - s[0] / 2, c[1] + s[1] / 2, z]], { closed: true, a: 0.3 })); };
    let south = { y: -0.35, x0: -0.5, x1: 0.5, z0: 0, z1: 0.6 };
    if (kind === 'box') box([0, 0, 0.3], [1.0, 0.7, 0.6]);
    else if (kind === 'bar') { box([0, 0, 0.25], [1.4, 0.45, 0.5]); south = { y: -0.225, x0: -0.7, x1: 0.7, z0: 0, z1: 0.5 }; }
    else if (kind === 'tower') { box([0, 0, 0.55], [0.5, 0.5, 1.1]); box([0.5, 0.1, 0.15], [0.5, 0.7, 0.3]); south = { y: -0.25, x0: -0.25, x1: 0.25, z0: 0, z1: 1.1 }; }
    else if (kind === 'L') { box([-0.25, 0, 0.3], [0.5, 0.9, 0.6]); box([0.3, -0.25, 0.22], [0.6, 0.4, 0.45]); south = { y: -0.45, x0: -0.5, x1: 0, z0: 0, z1: 0.6 }; }
    else if (kind === 'pitched') {
      box([0, 0, 0.225], [1.0, 0.7, 0.45]);
      const r = 0.3;
      out.push(L([[-0.5, 0, 0.45 + r], [0.5, 0, 0.45 + r]], { w: 1.4 }));
      out.push(L([[-0.5, -0.35, 0.45], [-0.5, 0, 0.45 + r], [-0.5, 0.35, 0.45]], { w: 1.2 }));
      out.push(L([[0.5, -0.35, 0.45], [0.5, 0, 0.45 + r], [0.5, 0.35, 0.45]], { w: 1.2 }));
      for (let i = 1; i < 6; i++) { const x = lerp(-0.5, 0.5, i / 6); out.push(L([[x, -0.35, 0.45], [x, 0, 0.45 + r], [x, 0.35, 0.45]], { a: 0.35 })); }
      south = { y: -0.35, x0: -0.5, x1: 0.5, z0: 0, z1: 0.45 };
    }
    return { out: out.concat(floors), south };
  }

  G.massing = {
    view: { el: 0.5, spin: 0.09, zoom: 0.4, yc: 0.58 },
    step(t, s, R, v) {
      const m = massingLines(v || 'box'), out = m.out;
      out.push(...groundGrid(6, 2.6, { a: 0.1 }));
      const { sun } = sunPath(t, 11, 1.35, out);
      const sd = [sun[0], sun[1], sun[2]], sl = Math.hypot(sd[0], sd[1], sd[2]); sd[0] /= sl; sd[1] /= sl; sd[2] /= sl;
      const S = m.south, nx = 7, nz = 3;
      for (let i = 0; i < nx; i++) for (let k = 0; k < nz; k++) {
        const p = [lerp(S.x0 + 0.07, S.x1 - 0.07, i / (nx - 1)), S.y - 0.01, lerp(S.z0 + 0.1, S.z1 - 0.1, k / (nz - 1))];
        const dot = Math.max(0, -sd[1]) * (0.6 + 0.4 * Math.max(0, sd[2]));
        out.push(D(p, { r: 0.8 + 2.6 * dot, a: 0.75, c: dot > 0.45 ? 'accent' : 'ink' }));
      }
      const roofPts = [[S.x0, S.y, S.z1], [S.x1, S.y, S.z1], [(S.x0 + S.x1) / 2, S.y, S.z0 + 0.2]];
      for (const p of roofPts) out.push(L([sun, p], { a: 0.18, dash: [0.03, 0.04] }));
      return out;
    }
  };

  G.thermalWall = {
    view: { el: 0, spin: 0, az: 0, zoom: 0.5, yc: 0.5 },
    step(t, s, R, v) {
      const out = [], z0 = -0.6, z1 = 0.6;
      const insul = v === 'insulator' ? 0.16 + 0.12 * smooth(tri(t / 3.5)) : 0.24;
      const xs = [-0.42, -0.34, -0.3, -0.3 + insul, -0.3 + insul + 0.06, -0.3 + insul + 0.08];
      for (const x of xs) out.push(L([[x, 0, z0], [x, 0, z1]], { w: 1.2 }));
      out.push(L([[xs[0], 0, z0], [xs[5], 0, z0]], { w: 1.2 })); out.push(L([[xs[0], 0, z1], [xs[5], 0, z1]], { w: 1.2 }));
      const hx0 = xs[2], hx1 = xs[3], step = 0.055, off = frac(t * 0.08) * step;
      for (let z = z0 - 0.6 + off; z < z1 + 0.2; z += step) {
        const pts = [];
        let a = [hx0, 0, z], b = [hx1, 0, z + (hx1 - hx0)];
        if (b[2] > z1) { const k = (z1 - a[2]) / (b[2] - a[2]); b = [a[0] + (b[0] - a[0]) * k, 0, z1]; }
        if (a[2] < z0) { const k = (z0 - a[2]) / (b[2] - a[2]); a = [a[0] + (b[0] - a[0]) * k, 0, z0]; }
        if (a[0] < b[0]) { pts.push(a, b); out.push(L(pts, { a: 0.35, w: 0.7 })); }
      }
      for (let k = 0; k < 6; k++) {
        const z = lerp(z0 + 0.1, z1 - 0.1, k / 5);
        out.push(L([[-0.95, 0, z], [xs[0] - 0.03, 0, z]], { a: 0.4, dash: [0.035, 0.03], dashOff: -t * 0.08 }));
        out.push(L([[xs[5] + 0.03, 0, z], [0.95, 0, z]], { a: 0.25, dash: [0.035, 0.03], dashOff: -t * 0.03 }));
        out.push(L([[xs[0] - 0.08, 0, z + 0.025], [xs[0] - 0.03, 0, z], [xs[0] - 0.08, 0, z - 0.025]], { a: 0.4, w: 0.8 }));
      }
      const tOut = -0.42 + 0.14 * Math.sin(t * 0.45), tIn = 0.42, Rs = [0.4, 0.15, 4.2, 0.35, 0.25], total = Rs.reduce((a, b) => a + b, 0);
      const prof = [[-0.95, 0, tOut], [xs[0], 0, tOut]];
      let acc = 0;
      for (let i = 0; i < 5; i++) { acc += Rs[i]; prof.push([xs[i + 1], 0, lerp(tOut, tIn, acc / total)]); }
      prof.push([0.95, 0, tIn]);
      out.push(L(prof, { c: 'accent', w: 1.5 }));
      out.push(D([xs[0], 0, tOut], { c: 'accent', r: 2.2 })); out.push(D([xs[5], 0, tIn], { c: 'accent', r: 2.2 }));
      out.push(L([[-0.95, 0, -0.75], [0.95, 0, -0.75]], { a: 0.2 }));
      return out;
    }
  };

  G.airflow = {
    view: { el: 0.46, spin: 0.07, zoom: 0.42, yc: 0.52 },
    init(s, R) { s.P = Array.from({ length: 110 }, () => ({ p: [lerp(-0.68, 0.68, R()), lerp(-0.42, 0.42, R()), lerp(0.05, 0.5, R())], age: R() * 6 })); s.lastT = null; },
    step(t, s, R) {
      const dt = s.lastT === null ? 0.016 : clamp(t - s.lastT, 0, 0.05); s.lastT = t;
      const out = cubeLines([0, 0, 0.275], [1.4, 0.9, 0.55], { w: 1.2 });
      out.push(L([[-0.7, -0.16, 0.12], [-0.7, 0.16, 0.12], [-0.7, 0.16, 0.38], [-0.7, -0.16, 0.38]], { closed: true, c: 'accent', w: 1.1 }));
      out.push(L([[0.7, 0.05, 0.1], [0.7, 0.35, 0.1], [0.7, 0.35, 0.3], [0.7, 0.05, 0.3]], { closed: true, c: 'accent', w: 1.1 }));
      const vel = (p) => {
        const x = p[0], y = p[1], z = p[2];
        let vx = 0.42 + 0.1 * Math.sin(y * 4 + t * 0.7), vy = 0.14 * Math.sin(x * 3.2 + t * 0.5) + 0.12 * (x > 0 ? (0.2 - y) : (-y)) , vz = 0.1 * Math.cos(x * 2.5 + z * 6 + t * 0.4);
        const dx = x - 0.1, dy = y + 0.05, r2 = dx * dx + dy * dy + 0.05;
        vx += -dy * 0.18 / r2 * 0.4; vy += dx * 0.18 / r2 * 0.4;
        return [vx, vy, vz];
      };
      for (const q of s.P) {
        const v = vel(q.p);
        q.p[0] += v[0] * dt; q.p[1] += v[1] * dt; q.p[2] += v[2] * dt; q.age += dt;
        q.p[1] = clamp(q.p[1], -0.44, 0.44); q.p[2] = clamp(q.p[2], 0.02, 0.53);
        if (q.p[0] > 0.7 || q.age > 7) { q.p = [-0.69, lerp(-0.15, 0.15, R()), lerp(0.13, 0.37, R())]; q.age = 0; }
        const tail = [q.p[0] - v[0] * 0.14, q.p[1] - v[1] * 0.14, q.p[2] - v[2] * 0.14];
        const fade = Math.min(1, q.age * 3);
        out.push(L([tail, q.p], { a: 0.55 * fade, w: 0.9 }));
        out.push(D(q.p, { r: 1.1, a: 0.8 * fade }));
      }
      out.push(...groundGrid(5, 2.2, { a: 0.08 }));
      return out;
    }
  };

  G.daylight = {
    view: { el: 0.42, spin: 0.08, zoom: 0.42, yc: 0.56 },
    step(t) {
      const out = [], sx = 1.1, sy = 0.8, sz = 0.5;
      out.push(L([[-sx / 2, -sy / 2, 0], [sx / 2, -sy / 2, 0], [sx / 2, sy / 2, 0], [-sx / 2, sy / 2, 0]], { closed: true, w: 1.2 }));
      out.push(L([[-sx / 2, -sy / 2, sz], [sx / 2, -sy / 2, sz], [sx / 2, sy / 2, sz], [-sx / 2, sy / 2, sz]], { closed: true, w: 1.2 }));
      for (const [x, y] of [[-sx / 2, -sy / 2], [sx / 2, -sy / 2], [sx / 2, sy / 2], [-sx / 2, sy / 2]]) out.push(L([[x, y, 0], [x, y, sz]], { w: 1.2 }));
      out.push(L([[-sx / 2, sy / 2, 0], [-sx / 2, sy / 2, sz]], { w: 1.2 }));
      const { a } = sunPath(t, 11, 1.35, out);
      const alt = Math.sin(a), theta = 0.15 + 0.75 * alt, nf = 6;
      for (let k = 0; k < nf; k++) {
        const z = lerp(0.08, sz - 0.05, k / (nf - 1)), d = 0.13;
        const y1 = -sy / 2 - d * Math.cos(theta), z1 = z - d * Math.sin(theta);
        out.push(L([[-sx / 2, -sy / 2, z], [sx / 2, -sy / 2, z], [sx / 2, y1, z1], [-sx / 2, y1, z1]], { closed: true, c: 'accent', a: 0.85, w: 0.9 }));
      }
      const block = 1 - 0.55 * Math.abs(Math.cos(theta - alt * 1.3));
      for (let i = 0; i < 8; i++) for (let j = 0; j < 5; j++) {
        const x = lerp(-sx / 2 + 0.08, sx / 2 - 0.08, i / 7), y = lerp(-sy / 2 + 0.08, sy / 2 - 0.08, j / 4);
        const depth = (y + sy / 2) / sy, I = Math.max(0.05, alt) * block * Math.exp(-2.4 * depth);
        out.push(D([x, y, 0.015], { r: 0.7 + 3.2 * I, a: 0.5 + 0.4 * I }));
      }
      out.push(...groundGrid(5, 2.4, { a: 0.08 }));
      return out;
    }
  };

  function tourLength(pts, tour) { let s = 0; for (let i = 0; i < tour.length; i++) s += dist2(pts[tour[i]], pts[tour[(i + 1) % tour.length]]); return s; }
  G.path = {
    view: { el: 1.15, spin: 0.03, zoom: 0.44 },
    init(s, R) { s.R = R; s.cycle = -99; },
    step(t, s) {
      const R = s.R;
      if (t - s.cycle > 10) {
        s.cycle = t; s.pts = Array.from({ length: 13 }, () => [R() * 1.8 - 0.9, R() * 1.8 - 0.9]);
        s.tour = s.pts.map((_, i) => i); for (let i = s.tour.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [s.tour[i], s.tour[j]] = [s.tour[j], s.tour[i]]; }
        s.cand = null; s.len = tourLength(s.pts, s.tour);
      }
      if (frac(t * 6) < 0.5 && !s.hold) {
        s.hold = true;
        const n = s.tour.length;
        for (let k = 0; k < 8; k++) {
          let i = Math.floor(R() * n), j = Math.floor(R() * n); if (i > j) [i, j] = [j, i];
          if (j - i > 1 && !(i === 0 && j === n - 1)) {
            const nt = s.tour.slice(0, i + 1).concat(s.tour.slice(i + 1, j + 1).reverse(), s.tour.slice(j + 1));
            const nl = tourLength(s.pts, nt); s.cand = [i, j];
            if (nl < s.len - 1e-6) { s.tour = nt; s.len = nl; s.flash = t; break; }
          }
        }
      } else if (frac(t * 6) >= 0.5) s.hold = false;
      const out = [L([[-1, -1, 0], [1, -1, 0], [1, 1, 0], [-1, 1, 0]], { closed: true, a: 0.25 })];
      out.push(L(s.tour.map((k) => [s.pts[k][0], s.pts[k][1], 0]), { closed: true, w: 1.3 }));
      if (s.cand) { const [i, j] = s.cand, n = s.tour.length, P = (k) => [s.pts[s.tour[k % n]][0], s.pts[s.tour[k % n]][1], 0.01]; out.push(L([P(i), P(j)], { c: 'accent', a: 0.5, dash: [0.02, 0.02] })); out.push(L([P(i + 1), P(j + 1)], { c: 'accent', a: 0.5, dash: [0.02, 0.02] })); }
      for (const p of s.pts) out.push(D([p[0], p[1], 0], { r: 2.4 }));
      out.push(D([s.pts[s.tour[0]][0], s.pts[s.tour[0]][1], 0.01], { c: 'accent', r: 3.2 }));
      return out;
    }
  };

  function median(pts, P, k) {
    let nx = 0, ny = 0, w = 0;
    for (const q of pts) { const d = Math.hypot(q[0] - P[0], q[1] - P[1]) + 1e-3; nx += q[0] / d; ny += q[1] / d; w += 1 / d; }
    return [lerp(P[0], nx / w, k), lerp(P[1], ny / w, k)];
  }
  G.printer = {
    view: { el: 1.25, spin: 0, zoom: 0.46, az: -0.2 },
    init(s, R) { s.R = R; s.cycle = -99; s.P = [0, 0]; },
    step(t, s) {
      const R = s.R;
      if (t - s.cycle > 9) {
        s.cycle = t; s.desks = [];
        const rooms = [[-0.95, -0.6, -0.33, 0.2], [-0.33, -0.6, 0.33, 0.2], [0.33, -0.6, 0.95, 0.2], [-0.95, 0.25, 0.95, 0.6]];
        for (let k = 0; k < 9; k++) { const r = rooms[k % 4]; s.desks.push([lerp(r[0] + 0.1, r[2] - 0.1, R()), lerp(r[1] + 0.08, r[3] - 0.08, R())]); }
      }
      const M = median(s.desks, s.P, 1);
      s.P[0] += (M[0] - s.P[0]) * 0.035 + 0.004 * Math.sin(t * 9.3); s.P[1] += (M[1] - s.P[1]) * 0.035 + 0.004 * Math.cos(t * 7.1);
      const out = [L([[-1, -0.65, 0], [1, -0.65, 0], [1, 0.65, 0], [-1, 0.65, 0]], { closed: true, w: 1.3 })];
      out.push(L([[-0.33, -0.65, 0], [-0.33, 0.2, 0]], { w: 1.1 })); out.push(L([[0.33, -0.65, 0], [0.33, 0.2, 0]], { w: 1.1 }));
      out.push(L([[-1, 0.2, 0], [-0.6, 0.2, 0]], { w: 1.1 })); out.push(L([[-0.45, 0.2, 0], [0.45, 0.2, 0]], { w: 1.1 })); out.push(L([[0.6, 0.2, 0], [1, 0.2, 0]], { w: 1.1 }));
      for (const d of s.desks) {
        out.push(L([[d[0] - 0.05, d[1] - 0.03, 0], [d[0] + 0.05, d[1] - 0.03, 0], [d[0] + 0.05, d[1] + 0.03, 0], [d[0] - 0.05, d[1] + 0.03, 0]], { closed: true, a: 0.7 }));
        out.push(L([[d[0], d[1], 0], [s.P[0], s.P[1], 0]], { a: 0.3, dash: [0.02, 0.02] }));
      }
      out.push(D([s.P[0], s.P[1], 0.01], { c: 'accent', r: 3.2 }));
      out.push(L(circlePts([s.P[0], s.P[1], 0.01], 0.08, 24, 'z'), { c: 'accent', closed: true, a: 0.7, w: 0.8 }));
      return out;
    }
  };

  G.connection = {
    view: { el: 1.15, spin: 0.03, zoom: 0.46 },
    init(s, R) { s.src = Array.from({ length: 7 }, () => [R() * 1.7 - 0.85, lerp(0.25, 0.9, R())]); s.ph = s.src.map(() => R() * TAU); s.u = 0.5; },
    step(t, s) {
      const curve = (u) => [lerp(-1, 1, u), -0.45 + 0.22 * Math.sin(u * 5 + 1) + 0.1 * Math.sin(u * 2), 0];
      const src = s.src.map((p, i) => [p[0] + 0.1 * Math.sin(t * 0.4 + s.ph[i]), p[1] + 0.08 * Math.cos(t * 0.35 + s.ph[i] * 2), 0]);
      const cost = (u) => { const c = curve(u); let s2 = 0; for (const p of src) s2 += dist2(p, c); return s2; };
      for (let k = 0; k < 3; k++) { const e = 0.002, g = (cost(s.u + e) - cost(s.u - e)) / (2 * e); s.u = clamp(s.u - g * 0.02, 0.02, 0.98); }
      const C = curve(s.u), out = [];
      out.push(L(Array.from({ length: 41 }, (_, i) => curve(i / 40)), { w: 1.4 }));
      for (const p of src) { out.push(D(p, { r: 2.4 })); out.push(L([p, C], { a: 0.32 })); }
      out.push(D(C, { c: 'accent', r: 3.2 }));
      out.push(L(circlePts(C, 0.08, 24, 'z'), { c: 'accent', closed: true, a: 0.7, w: 0.8 }));
      out.push(L([[-1, -1, 0], [1, -1, 0], [1, 1, 0], [-1, 1, 0]], { closed: true, a: 0.2 }));
      return out;
    }
  };

  G.branching = {
    view: { el: 0.28, spin: 0.13, zoom: 0.44, yc: 0.56 },
    init(s, R) { s.R = R; s.cycle = -99; },
    step(t, s) {
      const R = s.R;
      if (t - s.cycle > 9) {
        s.cycle = t; s.segs = [];
        const grow = (p, d, len, depth) => {
          const q = [p[0] + d[0] * len, p[1] + d[1] * len, p[2] + d[2] * len];
          s.segs.push({ a: p, b: q, depth });
          if (depth >= 5) return;
          const nb = depth < 2 ? 3 : 2 + (R() < 0.4 ? 1 : 0);
          for (let k = 0; k < nb; k++) {
            const az = R() * TAU, tilt = 0.35 + R() * 0.55, nd = [d[0] + Math.cos(az) * tilt, d[1] + Math.sin(az) * tilt, d[2]];
            const l = Math.hypot(nd[0], nd[1], nd[2]); nd[0] /= l; nd[1] /= l; nd[2] /= l;
            grow(q, nd, len * (0.66 + R() * 0.1), depth + 1);
          }
        };
        grow([0, 0, -0.9], [0, 0, 1], 0.5, 0);
      }
      const g = (t - s.cycle) / 7.5 * 6, out = [];
      for (const sg of s.segs) {
        const k = clamp(g - sg.depth, 0, 1); if (k <= 0) continue;
        const b = [lerp(sg.a[0], sg.b[0], k), lerp(sg.a[1], sg.b[1], k), lerp(sg.a[2], sg.b[2], k)];
        out.push(L([sg.a, b], { w: 1.8 - sg.depth * 0.25, a: 1 - sg.depth * 0.08 }));
        if (k < 1) out.push(D(b, { c: 'accent', r: 1.6 }));
      }
      out.push(L(circlePts([0, 0, -0.9], 0.9, 64, 'z'), { closed: true, a: 0.18 }));
      return out;
    }
  };

  G.units = {
    view: { el: 0.5, spin: 0.11, zoom: 0.4, yc: 0.56 },
    init(s, R) { s.R = R; s.cycle = -99; },
    step(t, s) {
      const R = s.R, cs = 0.3, N = 24;
      if (t - s.cycle > 13) { s.cycle = t; s.cells = [[0, 0, 0]]; s.last = 0; }
      const want = Math.min(N, Math.floor((t - s.cycle) / 0.42));
      const has = (c) => s.cells.some((d) => d[0] === c[0] && d[1] === c[1] && d[2] === c[2]);
      let guard = 0;
      while (s.cells.length < want && guard++ < 400) {
        const b = s.cells[Math.floor(R() * s.cells.length)], dirs = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1]];
        const d = dirs[Math.floor(R() * dirs.length)], c = [b[0] + d[0], b[1] + d[1], b[2] + d[2]];
        if (Math.abs(c[0]) > 2 || Math.abs(c[1]) > 1 || c[2] > 2 || c[2] < 0 || has(c)) continue;
        if (c[2] > 0 && !has([c[0], c[1], c[2] - 1])) continue;
        s.cells.push(c); s.last = t;
      }
      const out = groundGrid(6, 1.8, { a: 0.1 });
      s.cells.forEach((c, i) => {
        const fresh = i === s.cells.length - 1 && t - s.last < 0.42 && s.cells.length > 1;
        out.push(...cubeLines([c[0] * cs, c[1] * cs, c[2] * cs + cs / 2], [cs, cs, cs], { w: fresh ? 1.4 : 1.0, c: fresh ? 'accent' : 'ink' }));
      });
      return out;
    }
  };

  G.elevatedRoad = {
    view: { el: 0.36, spin: 0.1, zoom: 0.42, yc: 0.54 },
    step(t, s, R, v) {
      const out = [], w = 0.17, zd = (u) => 0.42 + 0.08 * Math.sin(u * 2.2 + 0.5), ground = -0.35, n = 64;
      const Lp = [], Rp = [], Cp = [], Gp = [];
      for (let i = 0; i <= n; i++) {
        const u = i / n, c = alignment(u, t), c2 = alignment(u + 0.001, t), tx = c2[0] - c[0], ty = c2[1] - c[1], tl = Math.hypot(tx, ty) || 1;
        const nx = -ty / tl, ny = tx / tl, z = zd(u);
        Lp.push([c[0] + nx * w, c[1] + ny * w, z]); Rp.push([c[0] - nx * w, c[1] - ny * w, z]); Cp.push([c[0], c[1], z]); Gp.push([c[0], c[1], ground]);
      }
      out.push(L(Lp, { w: 1.3 })); out.push(L(Rp, { w: 1.3 }));
      out.push(L(Cp, { a: 0.35, dash: [0.03, 0.03], dashOff: -t * 0.05 }));
      out.push(L(Gp, { a: 0.25, dash: [0.02, 0.03] }));
      const spacing = v === 'piers' ? 0.11 + 0.04 * Math.sin(t * 0.35) : 0.1;
      for (let u = 0.04; u <= 0.97; u += spacing) {
        const i = Math.round(u * n), l = Lp[i], r = Rp[i], c = Cp[i];
        if (v === 'piers') {
          const li = [lerp(l[0], c[0], 0.3), lerp(l[1], c[1], 0.3)], ri = [lerp(r[0], c[0], 0.3), lerp(r[1], c[1], 0.3)];
          out.push(L([[li[0], li[1], ground], [li[0], li[1], c[2] - 0.03]], { w: 1.2 })); out.push(L([[ri[0], ri[1], ground], [ri[0], ri[1], c[2] - 0.03]], { w: 1.2 }));
          out.push(L([[l[0], l[1], c[2] - 0.03], [r[0], r[1], c[2] - 0.03]], { w: 1.2 }));
          out.push(D([c[0], c[1], ground], { c: 'accent', r: 2.4 }));
        } else {
          out.push(L([[c[0], c[1], ground], [c[0], c[1], c[2]]], { w: 1.2 }));
          out.push(L([l, r], { a: 0.6 }));
        }
      }
      if (v !== 'piers') for (let i = 2; i < n; i += 3) out.push(L([Lp[i], Rp[i]], { a: 0.25 }));
      out.push(...groundGrid(5, 2.6, { a: 0.08 }).map((l) => { l.pts = l.pts.map((p) => [p[0], p[1], ground]); return l; }));
      return out;
    }
  };

  G.lanes = {
    view: { el: 1.35, spin: 0, zoom: 0.46, az: 0 },
    step(t) {
      const out = [], n = 80, C = (u) => [lerp(-1.1, 1.1, u), 0.3 * Math.sin(u * 3.4 + 0.4)], offs = [-0.26, -0.087, 0.087, 0.26];
      const lines = offs.map(() => []);
      for (let i = 0; i <= n; i++) {
        const u = i / n, c = C(u), c2 = C(u + 0.001), tx = c2[0] - c[0], ty = c2[1] - c[1], tl = Math.hypot(tx, ty), nx = -ty / tl, ny = tx / tl;
        offs.forEach((o, k) => lines[k].push([c[0] + nx * o, c[1] + ny * o, 0]));
      }
      out.push(L(lines[0], { w: 1.5 })); out.push(L(lines[3], { w: 1.5 }));
      out.push(L(lines[1], { w: 1.1, dash: [0.07, 0.05], dashOff: -t * 0.11 }));
      out.push(L(lines[2], { w: 1.1, dash: [0.07, 0.05], dashOff: -t * 0.11 }));
      for (let i = 10; i < n; i += 20) {
        const p = lines[1][i], q = lines[2][i], cx = lerp(p[0], q[0], 0.5), cy = lerp(p[1], q[1], 0.5);
        const c2 = C(i / n), c3 = C(i / n + 0.001), tx = c3[0] - c2[0], ty = c3[1] - c2[1], tl = Math.hypot(tx, ty), ux = tx / tl, uy = ty / tl, nx = -uy, ny = ux;
        out.push(L([[cx - ux * 0.02 + nx * 0.03, cy - uy * 0.02 + ny * 0.03, 0], [cx + ux * 0.03, cy + uy * 0.03, 0], [cx - ux * 0.02 - nx * 0.03, cy - uy * 0.02 - ny * 0.03, 0]], { c: 'accent', a: 0.85, w: 1.2 }));
      }
      out.push(L(lines[0].map((p, i) => { const q = lines[0][i]; return [q[0], q[1] - 0.06, 0]; }), { a: 0.2 }));
      out.push(L(lines[3].map((q) => [q[0], q[1] + 0.06, 0]), { a: 0.2 }));
      return out;
    }
  };

  G.osmMap = {
    view: { el: Math.PI / 2, spin: 0, zoom: 0.46, az: 0 },
    init(s, R) {
      s.streets = []; s.bld = [];
      const bend = (x0, y0, x1, y1, k) => { const pts = []; for (let i = 0; i <= 12; i++) { const u = i / 12; pts.push([lerp(x0, x1, u) + k * Math.sin(u * Math.PI) * (y1 - y0), lerp(y0, y1, u) + k * Math.sin(u * Math.PI) * (x1 - x0)]); } return pts; };
      const xs = [], ys = [];
      for (let i = 0; i <= 6; i++) { xs.push(lerp(-1.05, 1.05, i / 6) + (R() - 0.5) * 0.1); ys.push(lerp(-1.05, 1.05, i / 6) + (R() - 0.5) * 0.1); }
      for (const x of xs) s.streets.push({ pts: bend(x, -1.1, x, 1.1, (R() - 0.5) * 0.08), w: 0.8 + R() * 0.6 });
      for (const y of ys) s.streets.push({ pts: bend(-1.1, y, 1.1, y, (R() - 0.5) * 0.08), w: 0.8 + R() * 0.6 });
      s.streets.push({ pts: bend(-1.1, -0.8, 1.1, 0.9, 0.05), w: 1.6 });
      s.streets.push({ pts: bend(-1.1, 1.0, 0.5, -1.1, -0.04), w: 1.3 });
      for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) {
        const x0 = xs[i] + 0.06, x1 = xs[i + 1] - 0.06, y0 = ys[j] + 0.06, y1 = ys[j + 1] - 0.06;
        const nb = 1 + Math.floor(R() * 3);
        for (let k = 0; k < nb; k++) { const bw = lerp(0.07, 0.16, R()), bh = lerp(0.06, 0.14, R()), bx = lerp(x0, x1 - bw, R()), by = lerp(y0, y1 - bh, R()); if (bx + bw < x1 && by + bh < y1) s.bld.push([bx, by, bw, bh]); }
      }
    },
    step(t, s) {
      const cyc = frac(t / 9), Rr = smooth(cyc / 0.75) * 1.9, fade = cyc > 0.86 ? 1 - (cyc - 0.86) / 0.14 : 1, out = [];
      for (const st of s.streets) {
        let run = [];
        for (const p of st.pts) { if (Math.hypot(p[0], p[1]) < Rr) run.push([p[0], p[1], 0]); else { if (run.length > 1) out.push(L(run, { w: st.w, a: fade })); run = []; } }
        if (run.length > 1) out.push(L(run, { w: st.w, a: fade }));
      }
      for (const b of s.bld) if (Math.hypot(b[0] + b[2] / 2, b[1] + b[3] / 2) < Rr) out.push(L([[b[0], b[1], 0], [b[0] + b[2], b[1], 0], [b[0] + b[2], b[1] + b[3], 0], [b[0], b[1] + b[3], 0]], { closed: true, a: 0.55 * fade, w: 0.8 }));
      out.push(L(circlePts([0, 0, 0], Rr, 72, 'z'), { closed: true, c: 'accent', a: 0.5 * fade, dash: [0.02, 0.03] }));
      out.push(D([0, 0, 0], { c: 'accent', r: 2.4, a: fade }));
      return out;
    }
  };

  G.planExtrude = {
    view: { el: 0.5, spin: 0.1, zoom: 0.42, yc: 0.56 },
    step(t) {
      const cyc = frac(t / 7), h = cyc < 0.45 ? 0.8 * smooth(cyc / 0.45) : cyc < 0.85 ? 0.8 : 0.8 * (1 - smooth((cyc - 0.85) / 0.15));
      const walls = [[[-0.6, -0.4], [0.6, -0.4]], [[0.6, -0.4], [0.6, 0.4]], [[0.6, 0.4], [-0.6, 0.4]], [[-0.6, 0.4], [-0.6, -0.4]],
        [[-0.2, -0.4], [-0.2, 0.1]], [[-0.2, 0.1], [0.6, 0.1]], [[0.25, -0.4], [0.25, -0.1]], [[-0.6, 0.1], [-0.45, 0.1]]];
      const out = [];
      for (const w of walls) {
        out.push(L([[w[0][0], w[0][1], 0], [w[1][0], w[1][1], 0]], { w: 1.3 }));
        if (h > 0.005) {
          out.push(L([[w[0][0], w[0][1], h], [w[1][0], w[1][1], h]], { w: 1.1 }));
          out.push(L([[w[0][0], w[0][1], 0], [w[0][0], w[0][1], h]], { a: 0.7 })); out.push(L([[w[1][0], w[1][1], 0], [w[1][0], w[1][1], h]], { a: 0.7 }));
          if (h > 0.4) out.push(L([[w[0][0], w[0][1], 0.4], [w[1][0], w[1][1], 0.4]], { a: 0.4 }));
        }
      }
      for (const [x, y] of [[-0.2, -0.15], [0.25, -0.25], [0.1, 0.1]]) out.push(L(circlePts([x, y, 0], 0.07, 12, 'z').slice(0, 4), { a: 0.5 }));
      out.push(...groundGrid(6, 1.8, { a: 0.1 }));
      return out;
    }
  };

  G.auditorium = {
    view: { el: 0, spin: 0, az: 0, zoom: 0.46, yc: 0.58 },
    step(t) {
      const out = [], F = [-0.82, 0, 0.0], e = 0.13, n = 11, c = 0.045 + 0.05 * smooth(tri(t / 5));
      out.push(L([[-1.1, 0, -0.45], [-1.1, 0, -0.28], [-0.55, 0, -0.28], [-0.55, 0, -0.45]], { w: 1.3 }));
      out.push(D(F, { c: 'accent', r: 3 }));
      const rows = []; let prevEye = [-0.55, 0, -0.28 + e * 0.6];
      for (let i = 0; i < n; i++) {
        const x = -0.42 + i * 0.125;
        const need = F[2] + (x - F[0]) * ((prevEye[2] + c) - F[2]) / (prevEye[0] - F[0]);
        const z = Math.max(need - e, i === 0 ? -0.4 : -0.4);
        rows.push([x, z]); prevEye = [x, 0, z + e];
      }
      const floor = [[-0.55, 0, -0.45], [-0.55, 0, -0.42]];
      rows.forEach((r, i) => { floor.push([r[0] - 0.06, 0, r[1] - 0.02]); floor.push([r[0] - 0.06, 0, (rows[i + 1] ? rows[i + 1][1] : r[1] + 0.08) - 0.02]); });
      floor.push([rows[n - 1][0] + 0.07, 0, rows[n - 1][1] + 0.06]); floor.push([rows[n - 1][0] + 0.07, 0, -0.45]);
      out.push(L(floor, { w: 1.3 }));
      const hot = Math.floor(t * 1.1) % n;
      rows.forEach((r, i) => {
        out.push(L([[r[0] - 0.04, 0, r[1]], [r[0] + 0.03, 0, r[1]], [r[0] + 0.03, 0, r[1] + 0.09]], { w: 1.0 }));
        out.push(L([[r[0] + 0.03, 0, r[1] + 0.09], [r[0] + 0.04, 0, r[1] + 0.13]], { a: 0.6 }));
        const eye = [r[0], 0, r[1] + e];
        out.push(D(eye, { r: 1.6, a: 0.8, c: i === hot ? 'accent' : 'ink' }));
        out.push(L([eye, F], { a: i === hot ? 0.9 : 0.16, c: i === hot ? 'accent' : 'ink', w: i === hot ? 1.1 : 0.8 }));
      });
      out.push(L([[-1.15, 0, -0.45], [1.05, 0, -0.45]], { a: 0.35 }));
      return out;
    }
  };

  G.stadium = {
    view: { el: 0.44, spin: 0.1, zoom: 0.42, yc: 0.56 },
    init(s, R) { s.R = R; s.A = Array.from({ length: 46 }, () => lerp(0.12, 0.55, R())); s.B = s.A.map(() => lerp(0.12, 0.55, R())); s.k = 0; },
    step(t, s) {
      const cyc = Math.floor(t / 5), u = smooth(frac(t / 5) * 1.25);
      if (cyc !== s.k) { s.k = cyc; s.A = s.B; s.B = s.A.map(() => lerp(0.12, 0.55, s.R())); }
      const out = [], N = 46, a = 1.0, b = 0.68;
      for (let i = 0; i < N; i++) {
        const th = (i / N) * TAU, cx = a * Math.cos(th), cy = b * Math.sin(th), tx = -a * Math.sin(th), ty = b * Math.cos(th), tl = Math.hypot(tx, ty), w = 0.055;
        const p0 = [cx - tx / tl * w, cy - ty / tl * w], p1 = [cx + tx / tl * w, cy + ty / tl * w], h = lerp(s.A[i], s.B[i], u);
        out.push(L([[p0[0], p0[1], 0], [p1[0], p1[1], 0], [p1[0], p1[1], h], [p0[0], p0[1], h]], { closed: true, w: 1.0 }));
      }
      for (let k = 0; k < 3; k++) out.push(L(circlePts([0, 0, 0.06 + k * 0.09], 1, 72, 'z').map((p) => [p[0] * a * (0.8 - k * 0.12), p[1] * b * (0.8 - k * 0.12), p[2]]), { closed: true, a: 0.35 }));
      out.push(L([[-0.42, -0.26, 0], [0.42, -0.26, 0], [0.42, 0.26, 0], [-0.42, 0.26, 0]], { closed: true, a: 0.25 }));
      out.push(L(circlePts([0, 0, 0], 1, 72, 'z').map((p) => [p[0] * a, p[1] * b, 0]), { closed: true, a: 0.3 }));
      return out;
    }
  };

  G.jitter = {
    view: { el: 0.22, spin: 0, zoom: 0.46 },
    step(t) {
      const nx = 12, nz = 9, m = 0.55 + 0.45 * Math.sin(t * 0.35), P = [], out = [];
      for (let i = 0; i <= nx; i++) { P[i] = []; for (let j = 0; j <= nz; j++) {
        const x0 = lerp(-0.85, 0.85, i / nx), z0 = lerp(-0.6, 0.6, j / nz);
        const edge = i === 0 || j === 0 || i === nx || j === nz;
        const jx = edge ? 0 : 0.04 * m * Math.sin(t * 0.8 + i * 1.7 + j * 0.9), jz = edge ? 0 : 0.035 * m * Math.cos(t * 0.7 + i * 0.5 + j * 1.3);
        P[i][j] = [x0 + jx, 0.1 * Math.sin(x0 * 2.2 + t * 0.3) * Math.cos(z0 * 2), z0 + jz];
      } }
      for (let i = 0; i <= nx; i++) out.push(L(P[i], { w: i === 0 || i === nx ? 1.3 : 0.9 }));
      for (let j = 0; j <= nz; j++) out.push(L(P.map((col) => col[j]), { w: j === 0 || j === nz ? 1.3 : 0.9 }));
      for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) if ((i + j) % 3 === 0) {
        const c = [(P[i][j][0] + P[i + 1][j + 1][0]) / 2, (P[i][j][1] + P[i + 1][j + 1][1]) / 2, (P[i][j][2] + P[i + 1][j + 1][2]) / 2];
        out.push(L([P[i][j], P[i + 1][j + 1]], { a: 0.25 }));
        out.push(D(c, { r: 1.2, a: 0.5 }));
      }
      return { items: out, az: 0.35 * Math.sin(t * 0.25) };
    }
  };

  G.attractorScreen = {
    view: { el: 0.2, spin: 0, zoom: 0.46 },
    step(t) {
      const nx = 12, nz = 8, cs = 0.14, out = [], A = [0.55 * Math.sin(t * 0.45), 0, 0.35 * Math.sin(t * 0.63 + 1)];
      const y = (x, z) => 0.08 * Math.sin(x * 2 + t * 0.3) * Math.cos(z * 2.5);
      for (let i = 0; i <= nx; i++) { const x = (i - nx / 2) * cs; out.push(L([[x, y(x, -nz / 2 * cs), -nz / 2 * cs], [x, y(x, nz / 2 * cs), nz / 2 * cs]], { a: i === 0 || i === nx ? 1 : 0.2, w: i === 0 || i === nx ? 1.3 : 0.8 })); }
      for (let j = 0; j <= nz; j++) { const z = (j - nz / 2) * cs; out.push(L([[-nx / 2 * cs, y(-nx / 2 * cs, z), z], [nx / 2 * cs, y(nx / 2 * cs, z), z]], { a: j === 0 || j === nz ? 1 : 0.2, w: j === 0 || j === nz ? 1.3 : 0.8 })); }
      for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
        const x = (i - nx / 2 + 0.5) * cs, z = (j - nz / 2 + 0.5) * cs, d = Math.hypot(x - A[0], z - A[2]);
        const r = clamp(0.012 + 0.055 * Math.exp(-d * 2.4), 0.012, cs * 0.46), pts = [];
        for (let k = 0; k < 14; k++) { const an = (k / 14) * TAU, px = x + r * Math.cos(an), pz = z + r * Math.sin(an); pts.push([px, y(px, pz) - 0.005, pz]); }
        out.push(L(pts, { closed: true, w: 1.0 }));
      }
      out.push(D([A[0], y(A[0], A[2]) - 0.02, A[2]], { c: 'accent', r: 2.6 }));
      out.push(L(circlePts([A[0], y(A[0], A[2]) - 0.02, A[2]], 0.07, 24, 'y'), { c: 'accent', closed: true, a: 0.7, w: 0.8 }));
      return { items: out, az: 0.35 * Math.sin(t * 0.22) };
    }
  };

  /* ---------- general-purpose types (for new definitions) ---------- */

  G.isoSurface = {
    view: { el: 0.42, spin: 0.1, zoom: 0.46 },
    step(t) {
      const f = (u, v) => { const x = lerp(-1, 1, u), y = lerp(-1, 1, v); return [x, y, 0.3 * Math.sin(x * 1.9 + t * 0.4) * Math.cos(y * 1.6) + 0.12 * Math.sin((x + y) * 2.5 - t * 0.3)]; };
      const out = surfaceLines(f, 16, 16, { w: 0.85, a: 0.8 });
      out.push(...surfaceLines(f, 4, 4, { w: 1.3 }));
      return out;
    }
  };

  G.twistTower = {
    view: { el: 0.3, spin: 0.12, zoom: 0.4, yc: 0.58 },
    step(t) {
      const out = [], n = 14, tw = 0.9 + 0.5 * Math.sin(t * 0.35), corners = [];
      for (let k = 0; k <= n; k++) {
        const z = -0.85 + k * 0.12, a = tw * (k / n) * 1.1, s = 0.42 * (1 - 0.25 * (k / n)), pts = [];
        for (let c = 0; c < 4; c++) { const b = a + c * Math.PI / 2 + Math.PI / 4; pts.push([s * Math.SQRT2 * Math.cos(b), s * Math.SQRT2 * Math.sin(b), z]); }
        out.push(L(pts, { closed: true, w: k === 0 || k === n ? 1.3 : 0.9 }));
        corners.push(pts);
      }
      for (let c = 0; c < 4; c++) out.push(L(corners.map((p) => p[c]), { w: 1.1 }));
      out.push(L([[0, 0, -0.85], [0, 0, -0.85 + n * 0.12]], { a: 0.3, dash: [0.02, 0.02] }));
      out.push(...groundGrid(5, 2.0, { a: 0.1 }).map((l) => { l.pts = l.pts.map((p) => [p[0], p[1], -0.85]); return l; }));
      return out;
    }
  };

  G.facadePanels = {
    view: { el: 0.22, spin: 0, zoom: 0.46 },
    step(t) {
      const nx = 10, nz = 6, cs = 0.16, out = [];
      for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
        const x0 = (i - nx / 2) * cs, z0 = (j - nz / 2) * cs, x1 = x0 + cs, z1 = z0 + cs;
        out.push(L([[x0, 0, z0], [x1, 0, z0], [x1, 0, z1], [x0, 0, z1]], { closed: true, a: 0.35, w: 0.8 }));
        const open = 0.5 + 0.5 * Math.sin(t * 0.9 - i * 0.55 - j * 0.35), ang = open * 1.2, d = cs * 0.9;
        const hx = x0 + cs * 0.05, y1 = -d * Math.sin(ang), x2 = hx + d * Math.cos(ang);
        out.push(L([[hx, 0, z0 + 0.012], [x2, y1, z0 + 0.012], [x2, y1, z1 - 0.012], [hx, 0, z1 - 0.012]], { closed: true, w: 1.0, c: open > 0.85 ? 'accent' : 'ink' }));
      }
      out.push(L([[-nx / 2 * cs, 0, -nz / 2 * cs], [nx / 2 * cs, 0, -nz / 2 * cs], [nx / 2 * cs, 0, nz / 2 * cs], [-nx / 2 * cs, 0, nz / 2 * cs]], { closed: true, w: 1.3 }));
      return { items: out, az: 0.5 + 0.3 * Math.sin(t * 0.2) };
    }
  };

  G.terrain = {
    view: { el: 0.5, spin: 0.08, zoom: 0.44 },
    init(s, R) { s.h = (x, y) => 0.22 * Math.sin(x * 2.1 + 0.7) * Math.cos(y * 1.7 + 0.3) + 0.14 * Math.sin(x * 4.3 - y * 2.2) + 0.08 * Math.cos(y * 5.1 + x); void R; },
    step(t, s) {
      const n = 22, out = [], H = [];
      for (let i = 0; i <= n; i++) { H[i] = []; for (let j = 0; j <= n; j++) H[i][j] = s.h(lerp(-1, 1, i / n), lerp(-1, 1, j / n)); }
      const P = (i, j) => [lerp(-1, 1, i / n), lerp(-1, 1, j / n), H[i][j]];
      for (let i = 0; i <= n; i += 2) out.push(L(Array.from({ length: n + 1 }, (_, j) => P(i, j)), { a: 0.18, w: 0.7 }));
      for (let j = 0; j <= n; j += 2) out.push(L(Array.from({ length: n + 1 }, (_, i) => P(i, j)), { a: 0.18, w: 0.7 }));
      const water = -0.1 + 0.16 * Math.sin(t * 0.3);
      for (let k = 0; k < 9; k++) {
        const lv = -0.3 + k * 0.08, hot = Math.abs(lv - water) < 0.04, segs = [];
        for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
          const c = [H[i][j], H[i + 1][j], H[i + 1][j + 1], H[i][j + 1]], pts = [];
          const e = [[0, 1, i, j, i + 1, j], [1, 2, i + 1, j, i + 1, j + 1], [2, 3, i + 1, j + 1, i, j + 1], [3, 0, i, j + 1, i, j]];
          for (const [a, b, ia, ja, ib, jb] of e) {
            if ((c[a] - lv) * (c[b] - lv) < 0) { const f = (lv - c[a]) / (c[b] - c[a]); pts.push([lerp(lerp(-1, 1, ia / n), lerp(-1, 1, ib / n), f), lerp(lerp(-1, 1, ja / n), lerp(-1, 1, jb / n), f), lv]); }
          }
          if (pts.length >= 2) segs.push([pts[0], pts[1]]);
          if (pts.length === 4) segs.push([pts[2], pts[3]]);
        }
        out.push({ kind: 'segs', segs, w: hot ? 1.4 : 0.95, c: hot ? 'accent' : 'ink', a: hot ? 1 : 0.85 });
      }
      out.push(L([[-1, -1, -0.45], [1, -1, -0.45], [1, 1, -0.45], [-1, 1, -0.45]], { closed: true, a: 0.2 }));
      return out;
    }
  };

  G.spaceTruss = {
    view: { el: 0.35, spin: 0.1, zoom: 0.44 },
    step(t) {
      const n = 7, cs = 0.26, d = 0.2, out = [], camber = 0.12 + 0.08 * Math.sin(t * 0.5);
      const top = (i, j) => { const x = (i - n / 2) * cs, y = (j - n / 2) * cs; return [x, y, 0.2 + camber * (1 - (x * x + y * y) / 1.8)]; };
      const bot = (i, j) => { const p = top(i + 0.5, j + 0.5); return [p[0], p[1], p[2] - d]; };
      for (let i = 0; i <= n; i++) { out.push(L(Array.from({ length: n + 1 }, (_, j) => top(i, j)), { w: 1.1 })); out.push(L(Array.from({ length: n + 1 }, (_, j) => top(j, i)), { w: 1.1 })); }
      for (let i = 0; i < n; i++) { out.push(L(Array.from({ length: n }, (_, j) => bot(i, j)), { w: 0.9, a: 0.7 })); out.push(L(Array.from({ length: n }, (_, j) => bot(j, i)), { w: 0.9, a: 0.7 })); }
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { const b = bot(i, j); for (const [di, dj] of [[0, 0], [1, 0], [1, 1], [0, 1]]) out.push(L([b, top(i + di, j + dj)], { a: 0.35, w: 0.7 })); }
      for (const [i, j] of [[0, 0], [n, 0], [n, n], [0, n]]) { const p = top(i, j); out.push(L([[p[0], p[1], -0.6], p], { w: 1.3 })); }
      out.push(...groundGrid(5, 2.2, { a: 0.1 }).map((l) => { l.pts = l.pts.map((p) => [p[0], p[1], -0.6]); return l; }));
      return out;
    }
  };

  G.vaultRibs = {
    view: { el: 0.3, spin: 0.11, zoom: 0.42, yc: 0.56 },
    step(t) {
      const out = [], n = 11, len = 2.0, w = 0.75, ribs = [];
      for (let k = 0; k <= n; k++) {
        const y = -len / 2 + (k / n) * len, h = 0.5 + 0.2 * Math.sin(y * 2.2 + t * 0.5), pts = [];
        for (let i = 0; i <= 20; i++) { const a = (i / 20) * Math.PI; pts.push([-w * Math.cos(a), y, -0.45 + h * Math.sin(a)]); }
        ribs.push(pts); out.push(L(pts, { w: 1.2 }));
      }
      for (let i = 0; i <= 20; i += 2) out.push(L(ribs.map((r) => r[i]), { a: 0.45, w: 0.8 }));
      out.push(L([[-w, -len / 2, -0.45], [-w, len / 2, -0.45]], { w: 1.2 })); out.push(L([[w, -len / 2, -0.45], [w, len / 2, -0.45]], { w: 1.2 }));
      out.push(...groundGrid(5, 2.4, { a: 0.1 }).map((l) => { l.pts = l.pts.map((p) => [p[0], p[1], -0.45]); return l; }));
      return out;
    }
  };

  G.spiralStair = {
    view: { el: 0.28, spin: 0.14, zoom: 0.42, yc: 0.55 },
    step(t) {
      const out = [], n = 26, r0 = 0.16, r1 = 0.75, rise = 1.5, turns = 1.5 + 0.3 * Math.sin(t * 0.3), outer = [], inner = [];
      for (let k = 0; k <= n; k++) {
        const a = (k / n) * TAU * turns, z = -0.75 + (k / n) * rise, a2 = ((k + 1) / n) * TAU * turns;
        const p0 = [r0 * Math.cos(a), r0 * Math.sin(a), z], p1 = [r1 * Math.cos(a), r1 * Math.sin(a), z];
        outer.push(p1); inner.push(p0);
        if (k < n) { const q1 = [r1 * Math.cos(a2), r1 * Math.sin(a2), z], q0 = [r0 * Math.cos(a2), r0 * Math.sin(a2), z]; out.push(L([p0, p1, q1, q0], { closed: true, w: 1.0 })); }
      }
      out.push(L([[0, 0, -0.8], [0, 0, 0.8]], { w: 1.6 }));
      out.push(L(outer.map((p) => [p[0], p[1], p[2] + 0.32]), { w: 1.0, a: 0.7 }));
      for (let k = 0; k <= n; k += 2) out.push(L([outer[k], [outer[k][0], outer[k][1], outer[k][2] + 0.32]], { a: 0.5, w: 0.8 }));
      out.push(L(circlePts([0, 0, -0.78], 0.95, 48, 'z'), { closed: true, a: 0.18 }));
      return out;
    }
  };

  G.vectorField = {
    view: { el: 0.7, spin: 0.06, zoom: 0.46 },
    init(s, R) { s.P = Array.from({ length: 160 }, () => ({ p: [R() * 2 - 1, R() * 2 - 1], age: R() * 5 })); s.lastT = null; },
    step(t, s, R) {
      const dt = s.lastT === null ? 0.016 : clamp(t - s.lastT, 0, 0.05); s.lastT = t;
      const A = [0.5 * Math.cos(t * 0.3), 0.5 * Math.sin(t * 0.3)], B = [-A[0], -A[1]];
      const vel = (p) => { const f = (c, sgn) => { const dx = p[0] - c[0], dy = p[1] - c[1], r2 = dx * dx + dy * dy + 0.03; return [sgn * dx / r2 * 0.08, sgn * dy / r2 * 0.08]; }; const a = f(A, 1), b = f(B, -1); return [a[0] + b[0] - 0.02 * p[1], a[1] + b[1] + 0.02 * p[0]]; };
      const out = [L([[-1, -1, 0], [1, -1, 0], [1, 1, 0], [-1, 1, 0]], { closed: true, a: 0.25 })];
      for (const q of s.P) {
        const v = vel(q.p), sp = Math.hypot(v[0], v[1]);
        q.p[0] += v[0] * dt * 2; q.p[1] += v[1] * dt * 2; q.age += dt;
        if (Math.abs(q.p[0]) > 1 || Math.abs(q.p[1]) > 1 || q.age > 6 || Math.hypot(q.p[0] - B[0], q.p[1] - B[1]) < 0.06) { q.p = [R() * 2 - 1, R() * 2 - 1]; q.age = 0; }
        const k = Math.min(0.12, 0.05 / (sp + 0.02)) * Math.min(1, q.age * 3);
        out.push(L([[q.p[0] - v[0] * k * 4, q.p[1] - v[1] * k * 4, 0], [q.p[0], q.p[1], 0]], { a: 0.6, w: 0.9 }));
      }
      out.push(D([A[0], A[1], 0.01], { c: 'accent', r: 3 })); out.push(L(circlePts([B[0], B[1], 0.01], 0.06, 20, 'z'), { c: 'accent', closed: true, w: 1.0 }));
      return out;
    }
  };

  G.waffle = {
    view: { el: 0.4, spin: 0.1, zoom: 0.44 },
    step(t) {
      const out = [], n = 8, f = (x, y) => 0.35 * Math.exp(-(x * x + y * y) * 1.2) + 0.12 * Math.sin(x * 2 + t * 0.4) * Math.cos(y * 2), base = -0.4;
      const gap = 0.35 + 0.35 * Math.sin(t * 0.3) * 0;
      for (let k = 0; k <= n; k++) {
        const x = lerp(-0.9, 0.9, k / n), y = lerp(-0.9, 0.9, k / n), ex = 0.06 * (0.5 + 0.5 * Math.sin(t * 0.4)) * (k - n / 2);
        const sx = []; for (let i = 0; i <= 20; i++) { const yy = lerp(-0.9, 0.9, i / 20); sx.push([x + ex, yy, f(x, yy)]); }
        out.push(L(sx.concat([[x + ex, 0.9, base], [x + ex, -0.9, base]]), { closed: true, w: 1.0 }));
        const sy = []; for (let i = 0; i <= 20; i++) { const xx = lerp(-0.9, 0.9, i / 20); sy.push([xx, y + ex, f(xx, y)]); }
        out.push(L(sy.concat([[0.9, y + ex, base], [-0.9, y + ex, base]]), { closed: true, w: 1.0, a: 0.75 }));
      }
      void gap;
      out.push(...groundGrid(4, 2.2, { a: 0.1 }).map((l) => { l.pts = l.pts.map((p) => [p[0], p[1], base - 0.1]); return l; }));
      return out;
    }
  };

  /* ---------- wiring diagram read from the .gh file itself ---------- */
  /* Data: { w, h, n: [[x, y, w, h, kind]...], e: [[x1, y1, x2, y2]...] } in Grasshopper
     canvas units (kind 0 component, 1 parameter, 2 group). Produced by ghgraph.js. */
  G.graph = {
    view: { el: Math.PI / 2, az: 0, spin: 0, zoom: 0.5, yc: 0.5 },
    init(s, R, opts, sk) {
      s.g = (opts && opts.graph) || null; s.R = R;
      if (!s.g && opts && opts.graphUrl && typeof fetch === 'function') {
        fetch(opts.graphUrl).then((r) => (r.ok ? r.json() : null)).then((g) => { if (g && g.n) { s.g = g; if (sk && sk.active) kick(); } }).catch(() => {});
      }
    },
    step(t, s, R, v, cam) {
      const g = s.g; if (!g || !g.n.length || !cam) return [];
      if (!s.prep) {
        const hs = g.n.filter((n) => n[4] !== 2).map((n) => n[3]).sort((a, b) => a - b);
        s.medH = hs.length ? hs[hs.length >> 1] : 20;
        s.wires = g.e.map((e) => { const d = clamp(Math.abs(e[2] - e[0]) * 0.5, 15, 150); return { p: [e[0], e[1], e[0] + d, e[1], e[2] - d, e[3], e[2], e[3]], a: e[0] / Math.max(1, g.w) }; });
        s.prep = true;
      }
      const W = Math.max(g.w, 1), H = Math.max(g.h, 1), availW = cam.w * 0.9, availH = cam.h * 0.86;
      const fit = Math.min(availW / W, availH / H), sMin = 6 / Math.max(8, s.medH);
      const sc = Math.min(Math.max(fit, Math.min(sMin, 1.2)), fit * 3), winW = availW / sc, winH = availH / sc;
      const pan = sc > fit + 1e-9;
      const cx = pan ? W / 2 + Math.max(0, (W - winW) / 2) * Math.sin(t * 0.08) : W / 2;
      const cy = pan ? H / 2 + Math.max(0, (H - winH) / 2) * Math.sin(t * 0.05 + 1.3) : H / 2;
      const k = sc / cam.zoom;
      const X = (x) => (x - cx) * k, Y = (y) => -(y - cy) * k;
      const vx0 = cx - winW / 2 - 60, vx1 = cx + winW / 2 + 60, vy0 = cy - winH / 2 - 60, vy1 = cy + winH / 2 + 60;
      const vis = (x, y, w, h) => x + w >= vx0 && x <= vx1 && y + h >= vy0 && y <= vy1;
      const out = [], T = 7, ph = frac(t / T + 0.1), groups = [], params = [], comps = [], hot = [], divs = [], wires = [], live = [], dots = [];
      for (const n of g.n) {
        if (!vis(n[0], n[1], n[2], n[3])) continue;
        const r = [[X(n[0]), Y(n[1]), 0], [X(n[0] + n[2]), Y(n[1]), 0], [X(n[0] + n[2]), Y(n[1] + n[3]), 0], [X(n[0]), Y(n[1] + n[3]), 0]];
        if (n[4] === 2) { groups.push(r); continue; }
        const a = n[0] / W, on = Math.abs(ph - a) < 0.035 || Math.abs(ph - a - 1) < 0.035;
        if (on) hot.push(r); else if (n[4] === 1) params.push(r); else comps.push(r);
        if (n[4] === 0 && n[2] * sc > 18) { divs.push([[X(n[0] + n[2] * 0.3), Y(n[1]), 0], [X(n[0] + n[2] * 0.3), Y(n[1] + n[3]), 0]]); divs.push([[X(n[0] + n[2] * 0.7), Y(n[1]), 0], [X(n[0] + n[2] * 0.7), Y(n[1] + n[3]), 0]]); }
      }
      const bez = (p, u) => { const m = 1 - u, a = m * m * m, b = 3 * m * m * u, c = 3 * m * u * u, d = u * u * u; return [a * p[0] + b * p[2] + c * p[4] + d * p[6], a * p[1] + b * p[3] + c * p[5] + d * p[7]]; };
      for (const wr of s.wires) {
        const p = wr.p;
        if (!vis(Math.min(p[0], p[6]), Math.min(p[1], p[7]), Math.abs(p[6] - p[0]), Math.abs(p[7] - p[1]))) continue;
        const pl = []; for (let i = 0; i <= 10; i++) { const q = bez(p, i / 10); pl.push([X(q[0]), Y(q[1]), 0]); }
        let pr2 = (ph - wr.a) / 0.09; if (pr2 < -0.5) pr2 += 1 / 0.09;
        if (pr2 >= 0 && pr2 <= 1) { live.push(pl); const q = bez(p, pr2); dots.push([X(q[0]), Y(q[1]), 0.01]); } else wires.push(pl);
      }
      if (groups.length) out.push({ kind: 'multi', paths: groups, closed: true, a: 0.16, w: 0.8 });
      if (wires.length) out.push({ kind: 'multi', paths: wires, a: 0.4, w: 0.8 });
      if (params.length) out.push({ kind: 'multi', paths: params, closed: true, a: 0.6, w: 0.9 });
      if (comps.length) out.push({ kind: 'multi', paths: comps, closed: true, a: 0.95, w: 1.1 });
      if (divs.length) out.push({ kind: 'multi', paths: divs, a: 0.4, w: 0.7 });
      if (live.length) out.push({ kind: 'multi', paths: live, c: 'accent', a: 0.8, w: 1.0 });
      if (hot.length) out.push({ kind: 'multi', paths: hot, closed: true, c: 'accent', a: 1, w: 1.5 });
      for (const d of dots) out.push(D(d, { c: 'accent', r: 2.2 }));
      out.push(L([[X(ph * W), Y(vy0), 0], [X(ph * W), Y(vy1), 0]], { c: 'accent', a: 0.12, w: 1 }));
      return out;
    }
  };

  /* ---------- composed geometry: a sketch assembled from what a .gh contains ---------- */
  /* recipe = { base, pattern, ops: [], overlay: [], seed, density }
     base: surface | plane | box | curve | dome | mesh | ring
     pattern: grid | voronoi | hex | diagrid | circles | scatter | contours | stripes | null
     ops: extrude, offset, attractor, rotate, jitter, scale, pipe, loft, morph, array
     overlay: sun, sensors, airflow, kangaroo, search, growth */
  const COMPOSE_BASES = ['surface', 'plane', 'box', 'curve', 'dome', 'mesh', 'ring'];
  const COMPOSE_PATTERNS = [null, 'grid', 'voronoi', 'hex', 'diagrid', 'circles', 'scatter', 'contours', 'stripes'];
  const COMPOSE_OPS = ['extrude', 'offset', 'attractor', 'rotate', 'jitter', 'scale', 'pipe', 'loft', 'morph', 'array', 'fold'];
  const COMPOSE_OVERLAYS = ['sun', 'sensors', 'airflow', 'kangaroo', 'search', 'growth'];

  G.composed = {
    view: { el: 0.45, spin: 0.1, zoom: 0.44, yc: 0.54 },
    init(s, R, opts) {
      const rc = Object.assign({ base: 'surface', pattern: 'grid', ops: [], overlay: [], seed: 1, density: 0.5 }, (opts && opts.recipe) || {});
      rc.ops = (rc.ops || []).filter((o) => COMPOSE_OPS.includes(o)); rc.overlay = (rc.overlay || []).filter((o) => COMPOSE_OVERLAYS.includes(o));
      if (!COMPOSE_BASES.includes(rc.base)) rc.base = 'surface';
      if (!COMPOSE_PATTERNS.includes(rc.pattern)) rc.pattern = 'grid';
      s.rc = rc; s.R = rng((rc.seed | 0) * 48271 + 7); const Q = s.R;
      s.has = (o) => rc.ops.includes(o); s.ov = (o) => rc.overlay.includes(o);
      s.azOff = Q() * TAU; s.amp = 0.18 + 0.2 * Q(); s.fx = 1.4 + Q() * 1.4; s.fy = 1.2 + Q() * 1.4; s.ph1 = Q() * TAU;
      const d = clamp(rc.density, 0, 1);
      s.n = Math.round(lerp(5, 11, d)); s.m = Math.round(lerp(4, 9, d));
      if (rc.pattern === 'voronoi' || rc.pattern === 'scatter') { const k = Math.round(lerp(10, 26, d)); s.sites = Array.from({ length: k }, () => [Q(), Q()]); s.sph = s.sites.map(() => Q() * TAU); }
      if (rc.pattern === 'hex') s.hexA = lerp(0.11, 0.065, d);
      if (rc.base === 'mesh' || s.ov('kangaroo')) {
        const nC = 12;
        s.cloth = makeCloth(nC, nC, (i, j) => [lerp(-0.85, 0.85, i / (nC - 1)), lerp(-0.85, 0.85, j / (nC - 1)), rc.base === 'mesh' ? 0.35 : 0], rc.base === 'mesh' ? 1 : 0.85);
        const P = s.cloth.P, pins = rc.base === 'mesh' ? [[0, 0], [nC - 1, 0], [nC - 1, nC - 1], [0, nC - 1]] : [[0, 0], [nC - 1, 0], [nC - 1, nC - 1], [0, nC - 1], [Math.floor(nC / 2), Math.floor(nC / 2)]];
        for (const [i, j] of pins) { const a = P[s.cloth.id(i, j)]; a.pin = a.o.slice(); }
        s.cycle = 0;
      }
      if (s.ov('airflow')) { s.pt = Array.from({ length: 70 }, () => ({ p: [Q() * 2 - 1, Q() * 2 - 1, 0.1 + Q() * 0.5], age: Q() * 5 })); s.lastT = null; }
      if (s.ov('search')) { s.cand = Array.from({ length: 7 }, () => [Q(), Q()]); s.best = [Q(), Q()]; }
      s.revealOrder = null;
    },
    step(t, s, R) {
      const rc = s.rc, out = [], Q = s.R, has = s.has, ov = s.ov, amp = s.amp * (has('morph') ? 0.8 + 0.5 * Math.sin(t * 0.4) : 1);
      /* ----- base surface F(u,v) -> xyz ----- */
      let F, N = null, drawBase = true;
      const hz = (x, y) => amp * Math.sin(x * s.fx + s.ph1 + t * 0.25) * Math.cos(y * s.fy) + 0.06 * Math.sin((x - y) * 2.3 + t * 0.2);
      if (rc.base === 'surface') F = (u, v) => { const x = lerp(-1, 1, u), y = lerp(-1, 1, v); return [x, y, hz(x, y)]; };
      else if (rc.base === 'plane') F = (u, v) => { const x = lerp(-0.95, 0.95, u), z = lerp(-0.65, 0.65, v); return [x, has('morph') ? 0.12 * Math.sin(x * 2 + t * 0.3) * Math.cos(z * 2) : 0, z]; };
      else if (rc.base === 'box') F = (u, v) => [lerp(-0.6, 0.6, u), -0.4, lerp(0.02, 0.58, v)];
      else if (rc.base === 'curve') F = (u, v) => { const c = alignment(u, t), c2 = alignment(u + 0.002, t), tx = c2[0] - c[0], ty = c2[1] - c[1], l = Math.hypot(tx, ty) || 1; const w = 0.22; return [c[0] - ty / l * w * (v - 0.5) * 2, c[1] + tx / l * w * (v - 0.5) * 2, 0.1 + 0.06 * Math.sin(u * 3)]; };
      else if (rc.base === 'dome') F = (u, v) => { const lon = u * TAU, lat = lerp(0.1, 1.45, v), r = 0.92; return [r * Math.cos(lat) * Math.cos(lon), r * Math.cos(lat) * Math.sin(lon), -0.35 + r * Math.sin(lat)]; };
      else if (rc.base === 'ring') F = (u, v) => { const a = u * TAU, r = lerp(0.3, 0.95, v); return [r * Math.cos(a), r * Math.sin(a), 0.32 * (1 - v) + (has('rotate') ? 0.06 * Math.sin(a * 8 + t) : 0)]; };
      else if (rc.base === 'mesh') {
        if (t - s.cycle > 8) { resetCloth(s.cloth); s.cycle = t; }
        runPhysics(s, t, 1 / 60, 4, () => stepCloth(s.cloth, 1 / 60, -2.0, 4, 0.985));
        const c = s.cloth, n = c.n - 1;
        F = (u, v) => { const fu = clamp(u, 0, 1) * n, fv = clamp(v, 0, 1) * n, i = Math.min(n - 1, Math.floor(fu)), j = Math.min(n - 1, Math.floor(fv)), a = fu - i, b = fv - j;
          const p00 = c.P[c.id(i, j)].p, p10 = c.P[c.id(i + 1, j)].p, p01 = c.P[c.id(i, j + 1)].p, p11 = c.P[c.id(i + 1, j + 1)].p;
          return [0, 1, 2].map((k) => lerp(lerp(p00[k], p10[k], a), lerp(p01[k], p11[k], a), b)); };
        drawBase = !rc.pattern || rc.pattern === 'scatter';
      }
      if (ov('kangaroo') && rc.base !== 'mesh') {
        /* relax a net over the base: anchors at corners and centre lifted */
        const c = s.cloth, n = c.n - 1;
        c.P[c.id(6, 6)].pin = [0, 0, 0.4 + 0.15 * Math.sin(t * 0.6)];
        runPhysics(s, t, 1 / 60, 4, () => stepCloth(c, 1 / 60, -0.6, 3, 0.9));
        const F0 = F;
        F = (u, v) => { const base = F0(u, v); const fu = clamp(u, 0, 1) * n, fv = clamp(v, 0, 1) * n, i = Math.min(n - 1, Math.floor(fu)), j = Math.min(n - 1, Math.floor(fv)), a = fu - i, b = fv - j;
          const z = lerp(lerp(c.P[c.id(i, j)].p[2], c.P[c.id(i + 1, j)].p[2], a), lerp(c.P[c.id(i, j + 1)].p[2], c.P[c.id(i + 1, j + 1)].p[2], a), b);
          return [base[0], base[1], base[2] + z]; };
        for (const a of c.P) if (a.pin) out.push(D(F(a.i / n, a.j / n), { c: 'accent', r: 2.4 }));
      }
      N = (u, v) => { const e = 0.01, a = F(u + e, v), b = F(u - e, v), c2 = F(u, v + e), d = F(u, v - e); const du = [a[0] - b[0], a[1] - b[1], a[2] - b[2]], dv = [c2[0] - d[0], c2[1] - d[1], c2[2] - d[2]]; const nx = du[1] * dv[2] - du[2] * dv[1], ny = du[2] * dv[0] - du[0] * dv[2], nz = du[0] * dv[1] - du[1] * dv[0], l = Math.hypot(nx, ny, nz) || 1; return [nx / l, ny / l, nz / l]; };
      /* ----- draw the base ----- */
      if (rc.base === 'box') {
        out.push(...cubeLines([0, 0, 0.3], [1.2, 0.8, 0.6], { w: 1.2 }));
        for (let z = 0.15; z < 0.58; z += 0.15) out.push(L([[-0.6, -0.4, z], [0.6, -0.4, z], [0.6, 0.4, z], [-0.6, 0.4, z]], { closed: true, a: 0.25 }));
        if (has('array')) { out.push(...cubeLines([0.95, 0.1, 0.18], [0.5, 0.6, 0.36], { w: 0.9, a: 0.6 })); out.push(...cubeLines([-0.95, -0.05, 0.22], [0.5, 0.5, 0.44], { w: 0.9, a: 0.6 })); }
        out.push(...groundGrid(5, 2.6, { a: 0.1 }));
      } else if (drawBase) {
        const nu = rc.base === 'dome' ? 24 : 10, nv = rc.base === 'dome' ? 6 : 10;
        out.push(...surfaceLines(F, nu, nv, { a: rc.pattern ? 0.15 : 0.55, w: 0.8 }));
        if (rc.base !== 'dome' && rc.base !== 'ring') out.push(L([F(0, 0), F(1, 0), F(1, 1), F(0, 1)], { closed: true, w: 1.3 }));
        if (rc.base === 'ring') { out.push(L(Array.from({ length: 64 }, (_, i) => F(i / 64, 1)), { closed: true, w: 1.3 })); out.push(L(Array.from({ length: 64 }, (_, i) => F(i / 64, 0)), { closed: true, w: 1.1 })); }
        if (rc.base === 'curve') {
          const edge0 = Array.from({ length: 40 }, (_, i) => F(i / 39, 0)), edge1 = Array.from({ length: 40 }, (_, i) => F(i / 39, 1));
          out.push(L(edge0, { w: has('pipe') ? 1.8 : 1.3 })); out.push(L(edge1, { w: has('pipe') ? 1.8 : 1.3 }));
          if (has('extrude')) { /* a deck with thickness */
            const dz = 0.09; out.push(L(edge0.map((p) => [p[0], p[1], p[2] - dz]), { w: 1.0 })); out.push(L(edge1.map((p) => [p[0], p[1], p[2] - dz]), { w: 1.0 }));
            for (let i = 0; i < 40; i += 6) { out.push(L([edge0[i], [edge0[i][0], edge0[i][1], edge0[i][2] - dz]], { a: 0.7 })); out.push(L([edge1[i], [edge1[i][0], edge1[i][1], edge1[i][2] - dz]], { a: 0.7 })); }
          }
          if (has('offset')) { /* lane lines */
            for (const v of [0.25, 0.5, 0.75]) out.push(L(Array.from({ length: 40 }, (_, i) => F(i / 39, v)), { a: v === 0.5 ? 0.8 : 0.5, w: 0.9, dash: v === 0.5 ? [0.05, 0.035] : undefined, dashOff: -t * 0.08 }));
          }
          if (has('array') || has('rotate')) { /* piers */
            for (let u = 0.05; u < 1; u += 0.1) { const p = F(u, 0.5), p0 = F(u, 0.2), p1 = F(u, 0.8), zb = p[2] - (has('extrude') ? 0.09 : 0.02); out.push(L([[p[0], p[1], -0.35], [p[0], p[1], zb]], { w: 1.2 })); out.push(L([[p0[0], p0[1], zb], [p1[0], p1[1], zb]], { w: 1.0 })); }
          } else out.push(L(Array.from({ length: 40 }, (_, i) => { const p = F(i / 39, 0.5); return [p[0], p[1], -0.35]; }), { a: 0.25, dash: [0.02, 0.03] }));
        }
        if (has('array') && rc.base === 'plane') out.push(...surfaceLines((u, v) => { const p = F(u, v); return [p[0], p[1] + 0.5, p[2]]; }, 10, 10, { a: 0.15, w: 0.7 }));
        if (rc.base !== 'plane') out.push(...groundGrid(5, 2.6, { a: 0.08 }).map((l) => { l.pts = l.pts.map((p) => [p[0], p[1], -0.45]); return l; }));
      }
      /* ----- pattern cells in uv ----- */
      let cells = [], centers = [];
      const grid = (nx, ny, fn) => { for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) fn(i / nx, j / ny, (i + 1) / nx, (j + 1) / ny, (i + 0.5) / nx, (j + 0.5) / ny); };
      const uvBounds = rc.base === 'dome' ? [0, 0.15, 1, 0.95] : [0, 0, 1, 1];
      const tri = (x) => 1 - Math.abs(((x % 2) + 2) % 2 - 1); void tri;
      if (rc.pattern === 'grid') grid(s.n, s.m, (u0, v0, u1, v1, cu, cv) => { cells.push([[u0, v0], [u1, v0], [u1, v1], [u0, v1]]); centers.push([cu, cv]); });
      else if (rc.pattern === 'circles') grid(s.n, s.m, (u0, v0, u1, v1, cu, cv) => { const ru = (u1 - u0) * 0.42, rv = (v1 - v0) * 0.42, pts = []; for (let k = 0; k < 12; k++) { const a = (k / 12) * TAU; pts.push([cu + ru * Math.cos(a), cv + rv * Math.sin(a)]); } cells.push(pts); centers.push([cu, cv]); });
      else if (rc.pattern === 'diagrid') grid(s.n, s.m, (u0, v0, u1, v1, cu, cv) => { cells.push([[cu, v0], [u1, cv], [cu, v1], [u0, cv]]); centers.push([cu, cv]); });
      else if (rc.pattern === 'hex') { const a = s.hexA; for (let i = -1; i < 1 / (1.5 * a) + 1; i++) for (let j = -1; j < 1 / (Math.sqrt(3) * a) + 1; j++) { const cu = a * 1.5 * i + a, cv = a * Math.sqrt(3) * (j + 0.5 * (i & 1)) + a; if (cu < 0 || cu > 1 || cv < 0 || cv > 1) continue; const pts = []; for (let k = 0; k < 6; k++) { const an = (k / 6) * TAU; pts.push([cu + a * Math.cos(an), cv + a * Math.sin(an)]); } cells.push(pts); centers.push([cu, cv]); } }
      else if (rc.pattern === 'voronoi') { const sites = s.sites.map((p, i) => [clamp(p[0] + 0.05 * Math.sin(t * 0.3 + s.sph[i]), 0.01, 0.99), clamp(p[1] + 0.05 * Math.cos(t * 0.27 + s.sph[i] * 1.7), 0.01, 0.99)]); voronoi(sites, 0, 0, 1, 1).forEach((c, i) => { if (c.length > 2) { cells.push(c); centers.push(sites[i]); } }); }
      else if (rc.pattern === 'scatter') { s.sites.forEach((p, i) => { const q = [clamp(p[0] + 0.06 * Math.sin(t * 0.35 + s.sph[i]), 0, 1), clamp(p[1] + 0.06 * Math.cos(t * 0.3 + s.sph[i] * 2), 0, 1)]; centers.push(q); }); }
      else if (rc.pattern === 'contours') { for (let k = 1; k < 9; k++) { const v = k / 9; cells.push(Array.from({ length: 24 }, (_, i) => [i / 23, v])); centers.push([0.5, v]); } }
      else if (rc.pattern === 'stripes') { for (let k = 0; k <= s.n * 2; k++) { const u = k / (s.n * 2); cells.push([[u, 0], [u, 1]]); centers.push([u, 0.5]); } }
      const openPattern = rc.pattern === 'contours' || rc.pattern === 'stripes';
      /* ----- ops in uv ----- */
      const A = [0.5 + 0.38 * Math.sin(t * 0.42), 0.5 + 0.34 * Math.cos(t * 0.33 + 1)];
      const sc = has('scale') ? 0.75 + 0.2 * Math.sin(t * 0.5) : 1;
      const rot = has('rotate') ? 0.35 * Math.sin(t * 0.45) : 0;
      const jit = has('jitter') ? 0.03 : 0;
      cells = cells.map((c, i) => {
        if (openPattern) return c;
        const ce = centers[i]; let k = sc;
        if (has('attractor')) { const d = Math.hypot(ce[0] - A[0], ce[1] - A[1]); k *= clamp(0.45 + 0.8 * d, 0.45, 1); }
        const r = rot * (has('attractor') ? 2 - 2 * Math.hypot(ce[0] - A[0], ce[1] - A[1]) : 1), cr = Math.cos(r), sr = Math.sin(r);
        const jx = jit * Math.sin(t * 0.8 + i * 1.7), jy = jit * Math.cos(t * 0.7 + i * 0.9);
        return c.map((p) => { const dx = (p[0] - ce[0]) * k, dy = (p[1] - ce[1]) * k; return [ce[0] + dx * cr - dy * sr + jx, ce[1] + dx * sr + dy * cr + jy]; });
      });
      /* ----- draw cells on the base ----- */
      const toW0 = (p) => F(lerp(uvBounds[0], uvBounds[2], clamp(p[0], 0, 1)), lerp(uvBounds[1], uvBounds[3], clamp(p[1], 0, 1)));
      const foldAmp = has('fold') ? 0.07 + 0.05 * Math.sin(t * 0.6) : 0;
      let toW = toW0;
      if (foldAmp) {
        const nCol = Math.max(2, s.n);
        toW = (p) => { const b = toW0(p), nn = N(p[0], p[1]), sg = (Math.round(p[0] * nCol) % 2 ? 1 : -1) * foldAmp; return [b[0] + nn[0] * sg, b[1] + nn[1] * sg, b[2] + nn[2] * sg]; };
      }
      const reveal = ov('growth') ? frac(t / 9) * 1.3 : 2;
      const hRaise = has('extrude') ? 0.06 + 0.08 * (0.5 + 0.5 * Math.sin(t * 0.5)) : 0;
      const paths = [], tops = [], verts = [], inner = [];
      cells.forEach((c, i) => {
        const ce = centers[i];
        if (ov('growth') && Math.hypot(ce[0], ce[1]) / 1.42 > reveal) return;
        const w = c.map(toW); paths.push(w);
        if (has('offset') && !openPattern) inner.push(c.map((p) => [lerp(ce[0], p[0], 0.62), lerp(ce[1], p[1], 0.62)]).map(toW));
        if (hRaise > 0) {
          const nn = N(ce[0], ce[1]), h = hRaise * (has('attractor') ? clamp(1.6 - 1.4 * Math.hypot(ce[0] - A[0], ce[1] - A[1]), 0.2, 1.6) : 1);
          const top = w.map((p) => [p[0] + nn[0] * h, p[1] + nn[1] * h, p[2] + nn[2] * h]); tops.push(top);
          for (let k = 0; k < w.length; k += Math.max(1, Math.floor(w.length / 4))) verts.push([w[k], top[k]]);
        }
      });
      if (paths.length) out.push({ kind: 'multi', paths, closed: !openPattern, w: has('pipe') ? 1.6 : 1.0, a: 0.95 });
      if (inner.length) out.push({ kind: 'multi', paths: inner, closed: true, w: 0.8, a: 0.55 });
      if (tops.length) { out.push({ kind: 'multi', paths: tops, closed: !openPattern, w: 1.0, a: 0.9 }); out.push({ kind: 'multi', paths: verts, w: 0.8, a: 0.55 }); }
      if (has('loft') && centers.length > 2 && rc.pattern !== 'voronoi' && rc.pattern !== 'scatter') {
        const rows = new Map(); centers.forEach((ce, i) => { const key = Math.round(ce[1] * 100); if (!rows.has(key)) rows.set(key, []); rows.get(key).push(ce); });
        const rl = []; for (const r of rows.values()) if (r.length > 1) rl.push(r.sort((a, b) => a[0] - b[0]).map(toW));
        out.push({ kind: 'multi', paths: rl, w: 0.8, a: 0.4 });
      }
      if (rc.pattern === 'scatter') { for (const ce of centers) { const p = toW(ce); out.push(D(p, { r: 1.8, a: 0.85 })); if (has('extrude')) { const nn = N(ce[0], ce[1]), h = 0.12; out.push(L([p, [p[0] + nn[0] * h, p[1] + nn[1] * h, p[2] + nn[2] * h]], { w: 0.9 })); } } }
      if (has('attractor')) { const p = toW(A); out.push(D(p, { c: 'accent', r: 3 })); out.push(L(circlePts(p, 0.07, 20, rc.base === 'plane' ? 'y' : 'z'), { c: 'accent', closed: true, a: 0.7, w: 0.8 })); }
      /* ----- overlays ----- */
      if (ov('sun')) {
        const { sun } = sunPath(t, 11, 1.35, out);
        for (const uv of [[0.1, 0.9], [0.9, 0.9], [0.5, 0.5]]) out.push(L([sun, toW(uv)], { a: 0.18, dash: [0.03, 0.04] }));
      }
      if (ov('sensors')) {
        const a = frac(t / 11) * Math.PI, alt = Math.max(0.05, Math.sin(a));
        for (let i = 0; i < 7; i++) for (let j = 0; j < 4; j++) { const uv = [(i + 0.5) / 7, (j + 0.5) / 4], p = toW(uv), I = alt * Math.exp(-2 * uv[1]); out.push(D([p[0], p[1], p[2] + 0.012], { r: 0.7 + 3 * I, a: 0.5 + 0.4 * I })); }
      }
      if (ov('airflow')) {
        const dt = s.lastT === null ? 0.016 : clamp(t - s.lastT, 0, 0.05); s.lastT = t;
        for (const q of s.pt) {
          const v = [0.4 + 0.1 * Math.sin(q.p[1] * 4 + t), 0.15 * Math.sin(q.p[0] * 3 + t * 0.5), 0.08 * Math.cos(q.p[0] * 2.5 + q.p[2] * 6)];
          q.p[0] += v[0] * dt; q.p[1] += v[1] * dt; q.p[2] += v[2] * dt; q.age += dt;
          if (q.p[0] > 1.1 || q.age > 6) { q.p = [-1.1, Q() * 1.6 - 0.8, 0.1 + Q() * 0.5]; q.age = 0; }
          out.push(L([[q.p[0] - v[0] * 0.14, q.p[1] - v[1] * 0.14, q.p[2] - v[2] * 0.14], q.p], { a: 0.5 * Math.min(1, q.age * 3), w: 0.9 }));
        }
      }
      if (ov('search')) {
        const gen = frac(t / 6);
        s.cand.forEach((c, i) => { const k = smooth(gen) * 0.9; const p = toW([lerp(c[0], s.best[0], k), lerp(c[1], s.best[1], k)]); out.push(D([p[0], p[1], p[2] + 0.015], { r: 1.8, a: 0.7 })); out.push(L([p, toW(s.best)], { a: 0.2, dash: [0.02, 0.02] })); });
        const b = toW(s.best); out.push(D([b[0], b[1], b[2] + 0.02], { c: 'accent', r: 3 })); out.push(L(circlePts([b[0], b[1], b[2] + 0.02], 0.08, 20, 'z'), { c: 'accent', closed: true, a: 0.7, w: 0.8 }));
        if (gen > 0.98 && !s.jumped) { s.jumped = true; s.best = [0.2 + 0.6 * Q(), 0.2 + 0.6 * Q()]; s.cand = s.cand.map(() => [Q(), Q()]); } else if (gen < 0.5) s.jumped = false;
      }
      return { items: out, az: s.azOff };
    }
  };
  G.composed.bases = COMPOSE_BASES; G.composed.patterns = COMPOSE_PATTERNS; G.composed.ops = COMPOSE_OPS; G.composed.overlays = COMPOSE_OVERLAYS;

  /* Catalogue used by the add-a-card tool: every type, with its variants and a plain description. */
  const CATALOG = [
    ['surfVoronoi', null, 'Voronoi on a surface'], ['attrVoronoi', null, 'Voronoi with attractor'], ['volVoronoi', null, 'Volume Voronoi'],
    ['diagrid', null, 'Diagrid on a surface'], ['diagridExport', null, 'Diagrid flattening'], ['hex', null, 'Hexagons on a dome'],
    ['isoSurface', null, 'Surface with isocurves'], ['terrain', null, 'Terrain contours'], ['waffle', null, 'Waffle slices'],
    ['cloth', null, 'Mesh under gravity'], ['kAnchor', null, 'Mesh with moving anchors'], ['drape', null, 'Drape over a sphere'],
    ['saddle', null, 'Four-point tensile sail'], ['tent', null, 'Mast tensile canopy'], ['spaceTruss', null, 'Space truss'], ['vaultRibs', null, 'Vault ribs'],
    ['foldedPlate', null, 'Segmented folded plate'], ['circularFold', 1, 'Radial folded plate'], ['circularFold', 2, 'Radial folded plate, oculus'],
    ['shell', null, 'Shell segments'], ['twistTower', null, 'Twisting tower'], ['spiralStair', null, 'Spiral stair'], ['stadium', null, 'Stadium panels'],
    ['facadePanels', null, 'Opening facade panels'], ['jitter', null, 'Jittered panel grid'], ['attractorScreen', null, 'Perforated screen'],
    ['massing', 'box', 'Massing with sun: box'], ['massing', 'L', 'Massing with sun: L-shape'], ['massing', 'bar', 'Massing with sun: bar'],
    ['massing', 'tower', 'Massing with sun: tower'], ['massing', 'pitched', 'Massing with sun: pitched roof'],
    ['thermalWall', 'insulator', 'Wall section, insulation study'], ['thermalWall', 'workflow', 'Wall section, heat flow'],
    ['airflow', null, 'Indoor airflow'], ['daylight', null, 'Daylight fins and sensors'],
    ['path', null, 'Shortest path search'], ['printer', null, 'Best point on a floor plate'], ['connection', null, 'Best point on a line'],
    ['vectorField', null, 'Vector field particles'], ['branching', null, 'Branching growth'], ['units', null, 'Unit aggregation'],
    ['elevatedRoad', null, 'Elevated road'], ['elevatedRoad', 'piers', 'Pier placement'], ['lanes', null, 'Road lane marks'], ['osmMap', null, 'Street map reveal'],
    ['planExtrude', null, 'Plan extruding to massing'], ['auditorium', null, 'Auditorium sightlines']
  ];

  /* ---------- renderer ---------- */
  const DEF_VIEW = { az: -0.65, el: 0.5, spin: 0.1, zoom: 0.45, yc: 0.52, persp: 0 };
  const sketches = new Set();
  let colors = { ink: '#161616', accent: '#c8471f' };
  function readColors() {
    try {
      const cs = getComputedStyle(document.documentElement);
      colors = { ink: cs.getPropertyValue('--ink').trim() || colors.ink, accent: cs.getPropertyValue('--accent').trim() || colors.accent };
    } catch (e) { /* non-browser */ }
  }

  class Sketch {
    constructor(canvas, type, opts) {
      opts = opts || {};
      this.canvas = canvas; this.ctx = canvas.getContext('2d');
      this.gen = G[type] || G.diagrid; this.variant = opts.variant;
      this.R = rng((opts.seed || 1) * 7919 + 13);
      this.state = {}; if (this.gen.init) this.gen.init(this.state, this.R, opts, this);
      this.phase = opts.seed ? (opts.seed * 1.37) % 5 : 0;
      this.t0 = (typeof performance !== 'undefined' ? performance.now() : 0);
      this.active = false; this.w = 0; this.h = 0;
      this.resize();
    }
    resize() {
      const dpr = Math.min(2, (typeof devicePixelRatio === 'number' ? devicePixelRatio : 1) || 1);
      const r = this.canvas.getBoundingClientRect ? this.canvas.getBoundingClientRect() : { width: 400, height: 300 };
      const w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
      if (w === this.w && h === this.h && this.dpr === dpr) return;
      this.w = w; this.h = h; this.dpr = dpr;
      this.canvas.width = Math.round(w * dpr); this.canvas.height = Math.round(h * dpr);
    }
    frame(now) {
      const t = (now - this.t0) / 1000 + this.phase;
      this.render(t);
    }
    render(t) {
      const ctx = this.ctx, w = this.w, h = this.h, dpr = this.dpr || 1, v = Object.assign({}, DEF_VIEW, this.gen.view);
      const az0 = v.az + v.spin * t;
      const dir0 = [Math.sin(az0) * Math.cos(v.el), Math.cos(az0) * Math.cos(v.el), -Math.sin(v.el)];
      let res = this.gen.step(t, this.state, this.R, this.variant, { dir: dir0, w, h, zoom: Math.min(w, h) * v.zoom });
      let items = res, azExtra = 0;
      if (res && !Array.isArray(res)) { items = res.items; azExtra = res.az || 0; }
      const cam = { az: az0 + azExtra, el: v.el, zoom: Math.min(w, h) * v.zoom, cx: w / 2, cy: h * v.yc, persp: v.persp };
      const ca = Math.cos(cam.az), sa = Math.sin(cam.az), ce = Math.cos(cam.el), se = Math.sin(cam.el);
      const pr = (p) => { const x1 = p[0] * ca - p[1] * sa, y1 = p[0] * sa + p[1] * ca; const up = p[2] * ce + y1 * se; return [cam.cx + x1 * cam.zoom, cam.cy - up * cam.zoom]; };
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      for (const it of items) {
        const col = it.c === 'accent' ? colors.accent : colors.ink;
        ctx.globalAlpha = it.a === undefined ? 0.92 : it.a;
        if (it.kind === 'dot') {
          const q = pr(it.p);
          ctx.beginPath(); ctx.arc(q[0], q[1], it.r || 2, 0, TAU);
          ctx.fillStyle = col; ctx.fill();
          continue;
        }
        if (it.kind === 'multi') {
          ctx.beginPath();
          for (const pl of it.paths) { if (pl.length < 2) continue; const a = pr(pl[0]); ctx.moveTo(a[0], a[1]); for (let i = 1; i < pl.length; i++) { const b = pr(pl[i]); ctx.lineTo(b[0], b[1]); } if (it.closed) ctx.closePath(); }
          ctx.strokeStyle = col; ctx.lineWidth = it.w || 1; ctx.setLineDash([]); ctx.stroke();
          continue;
        }
        if (it.kind === 'segs') {
          ctx.beginPath();
          for (const sg of it.segs) { const a = pr(sg[0]), b = pr(sg[1]); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); }
          ctx.strokeStyle = col; ctx.lineWidth = it.w || 1; ctx.setLineDash([]); ctx.stroke();
          continue;
        }
        const pts = it.pts; if (!pts || pts.length < 2) continue;
        ctx.beginPath();
        const p0 = pr(pts[0]); ctx.moveTo(p0[0], p0[1]);
        for (let i = 1; i < pts.length; i++) { const q = pr(pts[i]); ctx.lineTo(q[0], q[1]); }
        if (it.closed) ctx.closePath();
        ctx.strokeStyle = col; ctx.lineWidth = it.w || 1;
        if (it.dash) { ctx.setLineDash(it.dash.map((d) => d * cam.zoom)); ctx.lineDashOffset = (it.dashOff || 0) * cam.zoom; } else ctx.setLineDash([]);
        ctx.stroke();
      }
      ctx.setLineDash([]); ctx.globalAlpha = 1;
    }
  }

  /* Previews always animate while they are on screen, whatever the device or
     its motion settings. Resting a mouse on a preview pauses it; moving the
     mouse off resumes it from the same moment. */
  let raf = null;
  function loop(now) {
    raf = null;
    let any = false;
    for (const s of sketches) if (s.active && !s.paused) { any = true; s.frame(now); }
    if (any) raf = requestAnimationFrame(loop);
  }
  function kick() { if (!raf && typeof requestAnimationFrame === 'function') raf = requestAnimationFrame(loop); }
  function drawOnce(s) { s.resize(); try { s.frame(performance.now()); } catch (e) { /* keep going */ } }

  const io = (typeof IntersectionObserver === 'function') ? new IntersectionObserver((entries) => {
    for (const en of entries) {
      const s = en.target.__sketch; if (!s) continue;
      s.active = en.isIntersecting;
      if (s.active) { s.resize(); kick(); }
    }
  }, { rootMargin: '80px' }) : null;

  function mount(canvas, type, opts) {
    readColors();
    const s = new Sketch(canvas, type, opts);
    canvas.__sketch = s; sketches.add(s);
    s.paused = false; s.pausedAt = 0;
    if (canvas.addEventListener) {
      canvas.addEventListener('pointerenter', (e) => {
        if (e.pointerType && e.pointerType !== 'mouse') return; /* a tap on a phone should not freeze the card */
        s.paused = true; s.pausedAt = performance.now();
      });
      canvas.addEventListener('pointerleave', (e) => {
        if (!s.paused) return;
        if (e.pointerType && e.pointerType !== 'mouse') return;
        s.t0 += performance.now() - s.pausedAt; /* resume where it stopped */
        s.paused = false; kick();
      });
    }
    drawOnce(s); /* a first frame right away, before the observer reports in */
    if (io) io.observe(canvas); else { s.active = true; kick(); }
    return s;
  }

  function setMotion() { kick(); }
  function unmount(canvas) {
    const s = canvas.__sketch; if (!s) return;
    sketches.delete(s); if (io) io.unobserve(canvas); canvas.__sketch = null;
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('resize', () => { for (const s of sketches) s.resize(); kick(); });
    window.addEventListener('scroll', kick, { passive: true });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) kick(); });
    if (typeof matchMedia === 'function') {
      try { matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { readColors(); kick(); }); } catch (e) { /* older browsers */ }
    }
  }

  const api = { mount, unmount, setMotion, reducedMotion: () => false, types: Object.keys(G), catalog: CATALOG, G, Sketch, readColors };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.GHPreviews = api;
})();
