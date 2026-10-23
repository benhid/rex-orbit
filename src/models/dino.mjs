import { Worker } from 'node:worker_threads';
import { KIND_BODY, KIND_INK, KIND_BRIGHT, LIGHT } from '../render/screen.mjs';

export const DINO_ID = 2000;
export const POSES = 140;
const LOOP = 14;                                                  // seconds per somersault
const PIVOT_Y = -0.35, REACH = 1.85;                              // turning point and model radius

// Math.hypot(a, b, c) step for step (V8's scaled Kahan sum), so every pose stays bit-identical, but
// about 4x faster: the builtin is most of the baking time.
function hypot3(a, b, c) {
  a = Math.abs(a); b = Math.abs(b); c = Math.abs(c);
  if (a === Infinity || b === Infinity || c === Infinity) return Infinity;
  const m = Math.max(a, b, c);
  if (m === 0) return 0;

  let sum = 0, comp = 0, n, s, p;
  n = a / m; s = n * n - comp; p = sum + s; comp = (p - sum) - s; sum = p;
  n = b / m; s = n * n - comp; p = sum + s; comp = (p - sum) - s; sum = p;
  n = c / m; s = n * n - comp; p = sum + s;
  return Math.sqrt(p) * m;
}

// Model space: snout towards +x, up is +y, units about half a head.
const smin = (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; };
const sphere = (x, y, z, cx, cy, cz, r) => hypot3(x - cx, y - cy, z - cz) - r;

function capsule(x, y, z, ax, ay, az, bx, by, bz, r) {
  const pax = x - ax, pay = y - ay, paz = z - az, bax = bx - ax, bay = by - ay, baz = bz - az;
  const h = Math.max(0, Math.min(1, (pax * bax + pay * bay + paz * baz) / (bax * bax + bay * bay + baz * baz)));
  return hypot3(pax - bax * h, pay - bay * h, paz - baz * h) - r;
}

function ellipsoid(x, y, z, cx, cy, cz, rx, ry, rz) {
  const px = (x - cx) / rx, py = (y - cy) / ry, pz = (z - cz) / rz, k0 = hypot3(px, py, pz), k1 = hypot3(px / rx, py / ry, pz / rz);
  return k1 > 0 ? k0 * (k0 - 1) / k1 : -Math.min(rx, ry, rz);
}

const CREST = [];
for (let i = 0; i < 7; i++) {
  const t = (62 + i * 23) * Math.PI / 180;
  CREST.push([-0.02 + Math.cos(t) * 0.74, 0.36 + Math.sin(t) * 0.74, 0.14]);
}
CREST.push([-0.5, -0.42, 0.12], [-0.68, -0.72, 0.12], [-0.82, -1.0, 0.11], [-1.0, -1.25, 0.09]);

function sdf(x, y, z, pose) {
  let d = sphere(x, y, z, 0, 0.36, 0, 0.72);                                                    // cranium
  d = smin(d, capsule(x, y, z * 1.15, 0.15, 0.24, 0, 0.92, 0.14, 0, 0.55) / 1.15, 0.3);         // big round snout

  if (y < 0.2) {
    d = smin(d, capsule(x, y, z * 1.1, -0.12, -0.15, 0, -0.18, -0.6, 0, 0.33) / 1.1, 0.25);     // short neck
    d = smin(d, ellipsoid(x, y, z, -0.18, -1.02, 0, 0.62, 0.56, 0.5), 0.25);                    // round belly

    const ts = pose.tail;
    d = smin(d, capsule(x, y, z, -0.62, -1.12, 0, -1.22, -1.4 + 0.2 * ts, 0.3 * ts, 0.17), 0.22);   // tail

    const side = z < 0 ? -1 : 1, zz = z * side, arm = side > 0 ? pose.armR : pose.armL, kick = side * pose.kick;
    d = smin(d, capsule(x, y, zz, 0.28, -0.85, 0.3, 0.28 + 0.25 * Math.cos(arm), -0.85 + 0.25 * Math.sin(arm), 0.36, 0.075), 0.06);  // tiny arms
    d = smin(d, capsule(x, y, zz, -0.12, -1.45, 0.27, -0.05 + 0.14 * kick, -1.7, 0.3, 0.16), 0.12);   // stubby legs
    d = smin(d, ellipsoid(x, y, zz, 0.04 + 0.14 * kick, -1.76, 0.3, 0.24, 0.1, 0.17), 0.08);         // feet
  }

  if (x < 0.4) for (const [cx, cy, r] of CREST) {                // skip bumps too far away to matter
    const ex = x - cx, ey = y - cy, reach = d + r + 0.05;
    if (reach > 0 && ex * ex + ey * ey + z * z < reach * reach) d = smin(d, hypot3(ex, ey, z) - r, 0.05);
  }
  return d;
}

// eye and mouth, placed like the logo's
const EYE = (() => { const v = [0.08, 0.17, 0.98], l = Math.hypot(...v); return [0.72 * v[0] / l, 0.36 + 0.72 * v[1] / l, 0.72 * v[2] / l]; })();

function surfaceKind(x, y, z) {
  const ex = (x - EYE[0]) / 0.12, ey = (y - EYE[1]) / 0.18;
  if (Math.abs(Math.abs(z) - EYE[2]) < 0.3 && ex * ex + ey * ey < 1) {
    const hx = (x - EYE[0] - 0.035) / 0.04, hy = (y - EYE[1] - 0.06) / 0.05;
    return hx * hx + hy * hy < 1 ? KIND_BRIGHT : KIND_INK;
  }

  if (x > 0.22 && x < 0.82 && Math.abs(z) > 0.25) {
    const u = (x - 0.22) / 0.6, ym = -0.28 + 0.1 * u * u, th = 0.048 - 0.022 * u;
    if (Math.abs(y - ym) < th) return KIND_INK;
  }
  return KIND_BODY;
}

function poseAt(p) {
  const T = Math.PI * 2;
  return {
    roll: T * p, pitch: 0.35 * Math.sin(T * p * 2), yaw: 0.7 * Math.sin(T * p + 1),
    armR: 0.4 + 0.9 * Math.sin(T * p * 5), armL: 0.4 + 0.9 * Math.sin(T * p * 5 + 2.2),
    kick: Math.sin(T * p * 4), tail: Math.sin(T * p * 3),
  };
}

// Rz(roll) · Rx(pitch) · Ry(yaw)
function rotation({ roll, pitch, yaw }) {
  const cr = Math.cos(roll), sr = Math.sin(roll), cp = Math.cos(pitch), sp = Math.sin(pitch), cy = Math.cos(yaw), sy = Math.sin(yaw);
  const ry = [[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]], rx = [[1, 0, 0], [0, cp, -sp], [0, sp, cp]], rz = [[cr, -sr, 0], [sr, cr, 0], [0, 0, 1]];

  const mul = (a, b) => a.map(r => [0, 1, 2].map(c => r[0] * b[0][c] + r[1] * b[1][c] + r[2] * b[2][c]));
  return mul(rz, mul(rx, ry));
}

// Ray-marches one pose without its roll, which draw() applies in 2D every frame (and lights after, so the
// light stays put). grid counts within each row so it fits in 16 bits on big panes.
export function bake(U, f) {
  const pose = { ...poseAt(f / POSES), roll: 0 }, M = rotation(pose), f3 = (x, y, z) => sdf(x, y, z, pose);
  const half = Math.ceil(REACH * U), w = half * 2;
  const grid = new Uint16Array(w * w), rowStart = new Int32Array(w), normal = [], depth = [], kind = [];
  const dx = -M[2][0], dy = -M[2][1], dz = -M[2][2];             // view ray in model space

  for (let py = 0; py < w; py++) for (let px = 0; px < w; px++) {
    if (px === 0) rowStart[py] = depth.length;
    const wx = (px + 0.5 - half) / U, wy = -(py + 0.5 - half) / U;
    if (wx * wx + wy * wy > REACH * REACH) continue;

    const ox = M[0][0] * wx + M[1][0] * wy + M[2][0] * REACH, oy = M[0][1] * wx + M[1][1] * wy + M[2][1] * REACH + PIVOT_Y, oz = M[0][2] * wx + M[1][2] * wy + M[2][2] * REACH;
    let t = 0, x = ox, y = oy, z = oz, hit = false;
    for (let i = 0; i < 60 && t < REACH * 2; i++) {
      x = ox + dx * t; y = oy + dy * t; z = oz + dz * t;
      const d = f3(x, y, z);
      if (d < 0.004) { hit = true; break; }
      t += d * 0.95;
    }
    if (!hit) continue;

    const e = 0.01, a = f3(x + e, y - e, z - e), b = f3(x - e, y - e, z + e), c = f3(x - e, y + e, z - e), d = f3(x + e, y + e, z + e);
    let nx = a - b - c + d, ny = -a - b + c + d, nz = -a + b - c + d;   // tetrahedral normal: 4 samples, not 6
    const l = hypot3(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    const vx = M[0][0] * nx + M[0][1] * ny + M[0][2] * nz, vy = M[1][0] * nx + M[1][1] * ny + M[1][2] * nz, vz = M[2][0] * nx + M[2][1] * ny + M[2][2] * nz;

    grid[py * w + px] = depth.length - rowStart[py] + 1;
    depth.push(REACH - t);
    kind.push(surfaceKind(x, y, z));
    normal.push(vx * 127, vy * 127, vz * 127);
  }

  return { w, half, grid, rowStart, normal: Int8Array.from(normal), depth: Float32Array.from(depth), kind: Uint8Array.from(kind) };
}

// Poses take tens of ms each, so a worker bakes them while the nearest baked one is shown.
export class Dino {
  #U = 0;
  #poses = [];
  #bakedAt = -1;
  #job = 0;
  #worker = null;

  constructor({ background = true } = {}) {
    if (!background) return;

    this.#worker = new Worker(new URL('./dino-worker.mjs', import.meta.url));
    this.#worker.on('message', m => { if (m.job === this.#job) this.#poses[m.f] = m.sprite; });
    this.#worker.on('error', () => { this.#worker = null; });
    this.#worker.unref();                                         // after on('message'), which refs it again
  }

  draw(scr, cx, cy, U, time) {
    const p = (time / LOOP) % 1, f = Math.floor(p * POSES);

    if (U !== this.#U) {
      this.#U = U;
      this.#poses = new Array(POSES);
      this.#bakedAt = -1;
      this.#job++;
      this.#worker?.postMessage({ job: this.#job, U, from: f });
    }

    let sp = this.#poses[f];
    if (!sp && !this.#worker && this.#bakedAt !== time) {
      this.#bakedAt = time;
      sp = this.#poses[f] = bake(U, f);
    }
    for (let k = 1; !sp && k < POSES; k++) sp = this.#poses[(f - k + POSES) % POSES];
    if (!sp) return;

    cx += U * 0.35 * Math.sin(p * Math.PI * 2);
    cy += U * 0.2 * Math.sin(p * Math.PI * 4);
    const roll = p * Math.PI * 2, c = Math.cos(roll), sn = Math.sin(roll);
    const { W, H, depth, owner, lum, kind, tint } = scr, { w, half, grid, rowStart, normal } = sp, id = DINO_ID * 16;
    const X = Math.round(cx), Y = Math.round(cy);

    scr.group();
    scr.mark(X - half, Y - half, X + half, Y + half);
    for (let oy = -half; oy <= half; oy++) {
      const y = Y + oy;
      if (y < 0 || y >= H) continue;

      for (let ox = -half; ox <= half; ox++) {
        const x = X + ox;
        if (x < 0 || x >= W) continue;

        const wy = -oy, sx = Math.round(c * ox + sn * wy + half - 0.5), sy = Math.round(half - 0.5 - (-sn * ox + c * wy));
        if (sx < 0 || sy < 0 || sx >= w || sy >= w) continue;
        const g = grid[sy * w + sx];
        if (!g) continue;

        const i = rowStart[sy] + g - 1;
        const o = y * W + x, z = sp.depth[i];
        if (z <= depth[o]) continue;

        const nx = normal[i * 3], ny = normal[i * 3 + 1], nz = normal[i * 3 + 2];
        const lx = c * nx - sn * ny, ly = sn * nx + c * ny;
        depth[o] = z; owner[o] = id; kind[o] = sp.kind[i];
        tint[o] = Math.max(0, Math.min(255, 128 + (ox - oy) * 64 / half));                     // diagonal, like the icon
        lum[o] = (0.05 + 0.95 * Math.max(0, (lx * LIGHT[0] + ly * LIGHT[1] + nz * LIGHT[2]) / 127)) * 0.78;
      }
    }
  }
}

// dust and Alice things floating up past the dinosaur
const DUST = Array.from({ length: 18 }, (_, i) => ({ x: (i * 0.618) % 1, y: (i * 0.377) % 1, v: 0.25 + ((i * 0.71) % 1) * 0.5, len: 2 + (i % 4) }));
const THINGS = [
  { kind: 'watch', x: 0.18, period: 11, offset: 0 }, { kind: 'card', x: 0.8, period: 13, offset: 4.5 },
  { kind: 'cup', x: 0.3, period: 15, offset: 9 }, { kind: 'card', x: 0.68, period: 17, offset: 13 },
];

function line(scr, x0, y0, x1, y1) {
  const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0)));
  for (let i = 0; i <= n; i++) scr.decoDot(x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n, 0.97);
}

function thing(scr, kind, x, y, a, sz) {
  const c = Math.cos(a), s = Math.sin(a), P = (u, v) => [x + (u * c - v * s) * sz, y + (u * s + v * c) * sz];
  const seg = (u0, v0, u1, v1) => {
    const [ax, ay] = P(u0, v0), [bx, by] = P(u1, v1);
    line(scr, ax, ay, bx, by);
  };
  const arc = (r, a0, a1, n, sy = 1, oy = 0) => {
    for (let i = 0; i < n; i++) {
      const t0 = a0 + (a1 - a0) * i / n, t1 = a0 + (a1 - a0) * (i + 1) / n;
      seg(r * Math.cos(t0), oy + sy * r * Math.sin(t0), r * Math.cos(t1), oy + sy * r * Math.sin(t1));
    }
  };

  if (kind === 'watch') {
    arc(1, 0, Math.PI * 2, 24);
    seg(0, -1, 0, -1.35); seg(-0.2, -1.35, 0.2, -1.35);
    seg(0, 0, 0, -0.65); seg(0, 0, 0.5, 0.15);
  } else if (kind === 'card') {
    seg(-0.7, -1, 0.7, -1); seg(0.7, -1, 0.7, 1); seg(0.7, 1, -0.7, 1); seg(-0.7, 1, -0.7, -1);
    seg(0, 0.35, -0.3, 0); seg(-0.3, 0, -0.2, -0.25); seg(-0.2, -0.25, 0, -0.1); seg(0, -0.1, 0.2, -0.25); seg(0.2, -0.25, 0.3, 0); seg(0.3, 0, 0, 0.35);
  } else {
    arc(1, 0, Math.PI, 12, 0.8, -0.2); seg(-1, -0.2, 1, -0.2);
    seg(1, 0, 1.35, 0.05); seg(1.35, 0.05, 1.3, 0.35); seg(1.3, 0.35, 0.85, 0.35);
    seg(-1.3, 0.75, 1.3, 0.75);
  }
}

export function drawFall(scr, S, time) {
  const { W, H } = scr;
  scr.group();

  for (const d of DUST) {
    const y = ((d.y - time * d.v * 0.18) % 1 + 1) % 1 * H, x = d.x * W;
    for (let i = 0; i < d.len; i++) scr.decoDot(x, y + i, 0.55);
  }

  for (const t of THINGS) {
    const q = ((time + t.offset) % t.period) / t.period;
    thing(scr, t.kind, W * t.x + W * 0.03 * Math.sin(time * 0.7 + t.offset), H * (1.15 - 1.3 * q), Math.sin(time * 0.6 + t.offset) * 0.6, S * 0.03);
  }
}
