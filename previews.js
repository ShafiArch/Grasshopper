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
      this.state = {}; if (this.gen.init) this.gen.init(this.state, this.R);
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
      let res = this.gen.step(t, this.state, this.R, this.variant, { dir: dir0 });
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

  if (typeof window !== 'undefined') {
    window.addEventListener('resize', () => { for (const s of sketches) s.resize(); kick(); });
    window.addEventListener('scroll', kick, { passive: true });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) kick(); });
    if (typeof matchMedia === 'function') {
      try { matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { readColors(); kick(); }); } catch (e) { /* older browsers */ }
    }
  }

  const api = { mount, setMotion, reducedMotion: () => false, types: Object.keys(G), G, Sketch, readColors };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.GHPreviews = api;
})();
