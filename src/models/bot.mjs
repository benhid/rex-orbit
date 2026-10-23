import { KIND_BODY, KIND_INK, KIND_BRIGHT, KIND_STROKE, LIGHT } from '../render/screen.mjs';

function sphere(scr, cx, cy, rp, zBase, rUnits, ownId, albedo, k, kind, face) {
  const { W, H, depth, owner, lum } = scr, kinds = scr.kind;
  const xa = Math.max(0, Math.floor(cx - rp)), xb = Math.min(W - 1, Math.ceil(cx + rp));
  const ya = Math.max(0, Math.floor(cy - rp)), yb = Math.min(H - 1, Math.ceil(cy + rp));
  scr.mark(xa, ya, xb, yb);

  for (let y = ya; y <= yb; y++) for (let x = xa; x <= xb; x++) {
    const dx = (x + 0.5 - cx) / rp, dy = -(y + 0.5 - cy) / rp, d2 = dx * dx + dy * dy;
    if (d2 >= 1) continue;

    const nz = Math.sqrt(1 - d2), z = zBase + nz * rUnits, o = y * W + x;
    if (z <= depth[o]) continue;

    depth[o] = z; owner[o] = ownId;
    const lit = 0.05 + 0.95 * Math.max(0, dx * LIGHT[0] + dy * LIGHT[1] + nz * LIGHT[2]);
    lum[o] = lit * albedo * k; kinds[o] = face ? face(dx, dy, nz) : kind;
  }
}

function inkDot(scr, px, py, z, size, ownId) {
  const { W, H, depth, owner, lum, kind } = scr, h = size / 2;
  const xa = Math.round(px - h), xb = Math.round(px + h), ya = Math.round(py - h), yb = Math.round(py + h);
  scr.mark(xa, ya, xb - 1, yb - 1);

  for (let y = ya; y < yb; y++) for (let x = xa; x < xb; x++) {
    if (x < 0 || y < 0 || x >= W || y >= H) continue;
    const o = y * W + x;
    if (z > depth[o]) { depth[o] = z; owner[o] = ownId; kind[o] = KIND_STROKE; lum[o] = 0; }
  }
}

const ellipse = (du, dv, rx, ry) => (du * du) / (rx * rx) + (dv * dv) / (ry * ry) < 1;
const chevron = (du, dv, er) => Math.abs(du) < er * 1.1 && Math.abs(dv - (er * 0.45 - Math.abs(du) * 0.9)) < 0.06;   // ^ eye

function mouth(a, u, v, y0 = -0.3) {
  if (a.state === 'wait') return ellipse(u, v - y0, 0.075, 0.085);                                       // "o"
  if (a.state === 'done') return Math.abs(u) < 0.17 && Math.abs(v - (y0 - 0.03 + 2.4 * u * u)) < 0.035;   // smile
  return Math.abs(u) < 0.13 && Math.abs(v - y0) < 0.028;                                                 // flat
}

function eyeShape(a, du, dv, er) {
  if (a.state === 'done') return chevron(du, dv, er);
  return ellipse(du, dv, er, Math.max(0.02, er * a.open));
}

function faceKind(a, u, v) {
  const look = a.look, big = a.state === 'wait' ? 1.35 : 1;

  switch (a.style.face) {
    case 'dots': {
      for (const s of [-1, 1]) if (eyeShape(a, u - (s * 0.31 + look), v - 0.1, 0.12 * big)) return KIND_INK;
      return mouth(a, u - look * 0.5, v) ? KIND_INK : KIND_BODY;
    }

    case 'visor': {
      if (Math.abs(v - 0.1) < 0.2 && Math.abs(u) < 0.8) {
        for (const s of [-1, 1]) if (eyeShape(a, (u - (s * 0.3 + look)) / 1.4, v - 0.1, 0.1 * big)) return KIND_BRIGHT;
        return KIND_INK;
      }
      return mouth(a, u, v, -0.33) ? KIND_INK : KIND_BODY;
    }

    case 'cyclops': {
      const du = u - look * 0.4, dv = v - 0.12, r = 0.27 * (a.state === 'wait' ? 1.15 : 1);
      if (a.state === 'done') return chevron(du, dv, r) ? KIND_INK : (mouth(a, u, v, -0.36) ? KIND_INK : KIND_BODY);

      if (ellipse(du, dv, r, r * a.open)) {
        if (a.open < 0.4) return KIND_INK;
        return ellipse(du - look * 1.2, dv, 0.11 * big, 0.11 * big) ? KIND_INK : KIND_BRIGHT;
      }
      if (ellipse(du, dv, r + 0.05, (r + 0.05) * a.open)) return KIND_INK;
      return mouth(a, u, v, -0.36) ? KIND_INK : KIND_BODY;
    }

    case 'screen': {
      const sx = Math.abs(u) - 0.5, sy = Math.abs(v - 0.02) - 0.34;
      const inScreen = sx < 0 && sy < 0 || Math.hypot(Math.max(sx, 0), Math.max(sy, 0)) < 0.08;
      if (!inScreen) return KIND_BODY;

      for (const s of [-1, 1]) {
        const du = u - (s * 0.22 + look), dv = v - 0.1, e = 0.08 * big;
        if (a.state === 'done' ? chevron(du, dv, e) : Math.abs(du) < e && Math.abs(dv) < e * a.open) return KIND_BRIGHT;
      }
      return mouth(a, u - look * 0.5, v, -0.17) ? KIND_BRIGHT : KIND_INK;
    }
  }
  return KIND_BODY;
}

/** Draw agent `a` centred at (cx, cy) with head radius R scene pixels; depth is its place on the orbit (-1..1). */
export function drawBot(scr, a, cx, cy, R, depth, time) {
  const cyw = Math.cos(a.yaw), syw = Math.sin(a.yaw), cpt = Math.cos(a.pitch), spt = Math.sin(a.pitch);
  const base = depth * 100, idBase = a.id * 16, albedo = a.style.albedo;
  const project = (x, y, z) => {
    const y1 = y * cpt - z * spt, z1 = y * spt + z * cpt;
    return [cx + (x * cyw + z1 * syw) * R, cy - y1 * R, base + (-x * syw + z1 * cyw)];
  };

  const bodyShade = (k = 1) => [k, KIND_BODY];
  const blinkOn = a.state === 'wait' && Math.floor(time * 3) % 2 === 0;
  const ballShade = [1, blinkOn ? KIND_STROKE : KIND_BODY];

  sphere(scr, cx, cy, R, base, 1, idBase, albedo, 1, KIND_BODY, a.enter < 0.75 ? null : (dx, dy, nz) => {   // no face until it has arrived
    const n0 = dx * cyw - nz * syw, z1 = dx * syw + nz * cyw, n1 = dy * cpt + z1 * spt, n2 = -dy * spt + z1 * cpt;
    // features lie within |u| < 0.8, |v| < 0.6: skip atan2/asin elsewhere
    if (n2 <= 0 || Math.abs(n0) >= n2 * 1.1 || Math.abs(n1) >= 0.6) return KIND_BODY;
    return faceKind(a, Math.atan2(n0, n2), Math.asin(n1));
  });

  const part = (x, y, z, r, k, shade) => {
    const [px, py, pz] = project(x, y, z);
    sphere(scr, px, py, r * R, pz, r, idBase + k, albedo, shade[0], shade[1], null);
  };
  const stick = (x0, y0, x1, y1, k) => {
    const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0) * R * 1.5);
    for (let s = 0; s <= n; s++) {
      const t = s / n, [px, py, pz] = project(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, 0);
      inkDot(scr, px, py, pz, Math.max(2, R * 0.08), idBase + k);
    }
  };

  switch (a.style.ears) {
    case 'headphones':
      part(-1.0, 0, 0, 0.3, 1, bodyShade(0.8));
      part(1.0, 0, 0, 0.3, 2, bodyShade(0.8));
      for (let s = 0; s <= 40; s++) {
        const t = Math.PI * s / 40, [px, py, pz] = project(Math.cos(t) * 1.12, Math.sin(t) * 1.12, 0);
        inkDot(scr, px, py, pz, Math.max(2, R * 0.09), idBase + 3);
      }
      break;
    case 'bolts':
      part(-1.04, 0.02, 0, 0.15, 1, bodyShade(0.7));
      part(1.04, 0.02, 0, 0.15, 2, bodyShade(0.7));
      break;
    case 'bear':
      part(-0.66, 0.74, 0, 0.3, 1, bodyShade());
      part(0.66, 0.74, 0, 0.3, 2, bodyShade());
      break;
  }

  switch (a.style.antenna) {
    case 'single':
      stick(0, 0.98, 0, 1.42, 4);
      part(0, 1.52, 0, 0.14, 5, ballShade);
      break;
    case 'double':
      stick(-0.3, 0.94, -0.46, 1.32, 4);
      stick(0.3, 0.94, 0.46, 1.32, 6);
      part(-0.48, 1.4, 0, 0.11, 5, ballShade);
      part(0.48, 1.4, 0, 0.11, 7, ballShade);
      break;
    case 'bulb':
      stick(0, 0.98, 0, 1.18, 4);
      part(0, 1.36, 0, 0.21, 5, ballShade);
      break;
  }

  if (a.style.ring) {
    // its own tilt, not the head's, so it never looks like a line
    const TIP = 0.45, ROLL = -0.25, ct = Math.cos(TIP), st = Math.sin(TIP), cr = Math.cos(ROLL), sr = Math.sin(ROLL);
    for (let s = 0; s < 140; s++) {
      if (s % 3 === 2) continue;
      const t = (s / 140) * Math.PI * 2 + time * 0.4, rx = Math.cos(t) * 1.6, rz = Math.sin(t) * 1.6;
      const y = -rz * st, z = rz * ct;
      const x = rx * cr - y * sr, yy = rx * sr + y * cr;
      inkDot(scr, cx + x * R, cy - yy * R, base + z, Math.max(2, R * 0.07), idBase + 8);
    }
  }
}
