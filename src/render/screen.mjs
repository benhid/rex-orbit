import { glyph, toFontText } from './font.mjs';
import { LCD_BG, INKS, PALETTE, REX_INK, GRADIENT, GRAD_FIRST, GRAD_LAST, DARK } from './palette.mjs';

export const PX = 2;                                              // screen pixels per LCD pixel

export const KIND_BODY = 0, KIND_INK = 1, KIND_BRIGHT = 2, KIND_STROKE = 3;   // ink and bright swap in the dark theme; strokes don't
export const LIGHT = (() => { const v = [-0.55, 0.7, 0.55], l = Math.hypot(...v); return v.map(x => x / l); })();   // upper left

// 8×8 Bayer thresholds in (0, 1)
const BAYER = (() => {
  let m = [[0]];
  for (let n = 1; n < 8; n *= 2) {
    const next = [];
    for (let y = 0; y < n * 2; y++) {
      next.push([]);
      for (let x = 0; x < n * 2; x++) next[y].push(m[y % n][x % n] * 4 + [[0, 2], [3, 1]][Math.floor(y / n)][Math.floor(x / n)]);
    }
    m = next;
  }
  return m.map(r => r.map(v => (v + 0.5) / 64));
})();

export function labelBox(t) {
  const w = (t.s.length * 6 - 1) * t.sc;
  const x0 = Math.round(t.x * PX - (t.align === 'center' ? w / 2 : t.align === 'right' ? w : 0)), y0 = Math.round(t.y * PX);
  return { x0, y0, w };
}

export const haloOf = sc => Math.max(1, sc >> 1);

// 0 when off, else 1 + ink. Fading in and out uses a second, offset Bayer pattern.
function onOff(W, owner, kind, lum, deco, decoInk, appearById, inkById, tint, o, x, brow, drow) {
  const id = owner[o];
  if (id >= 0) {
    if (!(drow[(x + 5) & 7] < appearById[id >> 4])) return 0;

    const k = kind[o], on = k === KIND_STROKE || k === (DARK ? KIND_BRIGHT : KIND_INK) || k === KIND_BODY && (x === 0 || x === W - 1 || owner[o - 1] !== id ||
      owner[o + 1] !== id || owner[o - W] !== id || owner[o + W] !== id || 0.06 + 0.7 * (DARK ? lum[o] : 1 - lum[o]) > brow[x & 7]);
    if (!on) return 0;

    let ink = inkById[id >> 4];
    if (ink === GRADIENT) {                                       // dither between the two nearest gradient inks
      if (k === KIND_INK) ink = REX_INK;
      else {
        const t = tint[o] / 255 * (GRAD_LAST - GRAD_FIRST), i = t | 0;
        ink = GRAD_FIRST + i + (t - i > brow[(x + 3) & 7] ? 1 : 0);
      }
    }
    return 1 + ink;
  }

  return deco[o] > 0 && deco[o] > brow[x & 7] ? 1 + decoInk[o] : 0;
}

// boxes: { x0, y0, x1, y1 }, end-exclusive
const touches = (a, b) => a.x0 <= b.x1 && b.x0 <= a.x1 && a.y0 <= b.y1 && b.y0 <= a.y1;

function merge(boxes) {
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i], b = boxes[j];
    if (!touches(a, b)) continue;
    a.x0 = Math.min(a.x0, b.x0); a.y0 = Math.min(a.y0, b.y0);
    a.x1 = Math.max(a.x1, b.x1); a.y1 = Math.max(a.y1, b.y1);
    boxes.splice(j, 1);
    j = i;
  }
  return boxes;
}

// Each frame only clears and re-dithers what moved; the orbit is a static layer drawn once.
export class Screen {
  W = 0; H = 0; HW = 0; HH = 0;
  lum = null;
  depth = null;
  owner = null;                     // agent id * 16 + part, -1 = empty
  kind = null;
  deco = null;                      // orbit and ring dots, as dither strength
  decoInk = null;
  base = null; baseInk = null;      // the static layer
  tint = null;                      // position on the gradient, 0..255
  lit = null;
  rgb = null;
  texts = [];
  #static;
  #boxes = []; #box = null; #prev = [];
  #dots = []; #dotEnds = [];        // ring dots, kept as pixels: their box would be mostly empty
  #prevDots = []; #prevDotEnds = [];
  #changed = [];
  #tile = Buffer.alloc(0);
  #clean = new Map();               // rasters of labels nothing covers

  resize(w, h) {
    if (w === this.W && h === this.H) return;
    const n = w * h;
    this.W = w; this.H = h; this.HW = w * PX; this.HH = h * PX;

    this.lum = new Float32Array(n); this.depth = new Float32Array(n); this.owner = new Int32Array(n);
    this.kind = new Uint8Array(n); this.deco = new Float32Array(n); this.decoInk = new Uint8Array(n); this.lit = new Uint8Array(n);
    this.base = new Float32Array(n); this.baseInk = new Uint8Array(n); this.tint = new Uint8Array(n);
    this.rgb = Buffer.alloc(n * 3);
    for (let k = 0; k < n * 3; k += 3) { this.rgb[k] = LCD_BG[0]; this.rgb[k + 1] = LCD_BG[1]; this.rgb[k + 2] = LCD_BG[2]; }

    this.#static = undefined; this.#boxes = []; this.#box = null; this.#prev = []; this.#changed = [];
    this.#dots = []; this.#dotEnds = []; this.#prevDots = []; this.#prevDotEnds = [];
  }

  // after a theme change: redraw and recolour every pixel
  invalidate() {
    this.#static = undefined;
    this.lit?.fill(255);
    this.#clean.clear();
  }

  // true when the static layer has to be drawn again
  begin(key) {
    const { W, H, depth, owner, deco, decoInk, base, baseInk } = this;
    this.texts.length = 0; this.#boxes = []; this.#box = null;
    [this.#prevDots, this.#dots] = [this.#dots, this.#prevDots];
    [this.#prevDotEnds, this.#dotEnds] = [this.#dotEnds, this.#prevDotEnds];
    this.#dots.length = 0; this.#dotEnds.length = 0;

    if (key !== this.#static) {
      this.#static = key;
      depth.fill(-1e9); owner.fill(-1); deco.fill(0); base.fill(0);
      this.#prev = [{ x0: 0, y0: 0, x1: W, y1: H }];
      this.#prevDots.length = 0; this.#prevDotEnds.length = 0;
      return true;
    }

    for (const b of this.#prev) for (let y = b.y0; y < b.y1; y++) {
      const o = y * W + b.x0, e = y * W + b.x1;
      depth.fill(-1e9, o, e); owner.fill(-1, o, e);
      deco.set(base.subarray(o, e), o); decoInk.set(baseInk.subarray(o, e), o);
    }
    for (const o of this.#prevDots) { deco[o] = base[o]; decoInk[o] = baseInk[o]; }
    return false;
  }

  // what is drawn until the next group() shares one dirty box
  group() {
    if (this.#box) this.#boxes.push(this.#box);
    this.#box = null;
    if (this.#dots.length > (this.#dotEnds.at(-1) ?? 0)) this.#dotEnds.push(this.#dots.length);
  }

  mark(xa, ya, xb, yb) {
    xa = Math.max(0, xa); ya = Math.max(0, ya); xb = Math.min(this.W, xb + 1); yb = Math.min(this.H, yb + 1);
    if (xa >= xb || ya >= yb) return;

    const b = this.#box;
    if (!b) { this.#box = { x0: xa, y0: ya, x1: xb, y1: yb }; return; }
    if (xa < b.x0) b.x0 = xa; if (ya < b.y0) b.y0 = ya; if (xb > b.x1) b.x1 = xb; if (yb > b.y1) b.y1 = yb;
  }

  baseDot(x, y, v, ink = 0) {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || y < 0 || x >= this.W || y >= this.H) return;
    const o = y * this.W + x;
    if (v > this.base[o]) { this.base[o] = this.deco[o] = v; this.baseInk[o] = this.decoInk[o] = ink; }
  }

  decoDot(x, y, v, ink = 0) {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || y < 0 || x >= this.W || y >= this.H) return;
    const o = y * this.W + x;
    this.#dots.push(o);
    if (v > this.deco[o]) { this.deco[o] = v; this.decoInk[o] = ink; }
  }

  // labels are drawn at screen resolution with whole-number scales, so they stay crisp while moving
  text(s, x, y, sc = 2, align = 'center', z = 1e9, ink = 0) {
    this.texts.push({ s: toFontText(s), x, y, sc, align, z, ink });
  }

  dither(appearById, inkById) {
    const { W, H, owner, kind, lum, deco, decoInk, lit, tint } = this;
    this.group();
    const boxes = this.#boxes, changed = this.#changed;

    for (const b of merge([...this.#prev, ...boxes.map(b => ({ ...b }))])) {
      let cx0 = W, cy0 = b.y1, cx1 = 0, cy1 = 0;
      for (let y = b.y0; y < b.y1; y++) {
        const brow = BAYER[y & 7], drow = BAYER[(y + 3) & 7];
        for (let x = b.x0, o = y * W + x; x < b.x1; x++, o++) {
          const v = onOff(W, owner, kind, lum, deco, decoInk, appearById, inkById, tint, o, x, brow, drow);
          if (v === lit[o]) continue;
          this.#set(o, v);
          if (x < cx0) cx0 = x; if (x >= cx1) cx1 = x + 1; if (y < cy0) cy0 = y; cy1 = y + 1;
        }
      }
      if (cx0 < cx1) changed.push({ x0: cx0, y0: cy0, x1: cx1, y1: cy1 });
    }

    for (const [dots, ends] of [[this.#prevDots, this.#prevDotEnds], [this.#dots, this.#dotEnds]]) {
      for (let g = 0, i = 0; g < ends.length; g++) {
        let cx0 = W, cy0 = H, cx1 = 0, cy1 = 0;
        for (; i < ends[g]; i++) {
          const o = dots[i], y = (o / W) | 0, x = o - y * W;
          const v = onOff(W, owner, kind, lum, deco, decoInk, appearById, inkById, tint, o, x, BAYER[y & 7], BAYER[(y + 3) & 7]);
          if (v === lit[o]) continue;
          this.#set(o, v);
          if (x < cx0) cx0 = x; if (x >= cx1) cx1 = x + 1; if (y < cy0) cy0 = y; if (y >= cy1) cy1 = y + 1;
        }
        if (cx0 < cx1) changed.push({ x0: cx0, y0: cy0, x1: cx1, y1: cy1 });
      }
    }

    merge(changed);
    this.#prev = boxes;
  }

  #set(o, v) {
    this.lit[o] = v;
    const c = PALETTE[v], k = o * 3;
    this.rgb[k] = c[0]; this.rgb[k + 1] = c[1]; this.rgb[k + 2] = c[2];
  }

  takeChanges() {
    const c = this.#changed;
    this.#changed = [];
    return c;
  }

  // RGBA tile, transparent where a bot covers it. buf is reused: copy it to keep it.
  rasterLabel(t) {
    const { W, HW, HH, depth } = this;

    const { x0, y0, w } = labelBox(t), halo = haloOf(t.sc);
    const ax = Math.max(0, x0 - halo), ay = Math.max(0, y0 - halo);
    const bx = Math.min(HW, x0 + w + halo), by = Math.min(HH, y0 + 7 * t.sc + halo);
    const tw = bx - ax, th = by - ay;
    if (tw <= 0 || th <= 0) return null;

    let open = ax === x0 - halo && ay === y0 - halo && bx === x0 + w + halo && by === y0 + 7 * t.sc + halo;
    for (let sy = (ay / PX) | 0, ey = ((by - 1) / PX) | 0; open && sy <= ey; sy++)
      for (let o = sy * W + ((ax / PX) | 0), e = sy * W + (((bx - 1) / PX) | 0); o <= e; o++) if (t.z < depth[o]) { open = false; break; }
    const key = open && `${t.sc}|${t.ink}|${t.s}`, kept = open && this.#clean.get(key);
    if (kept) return { x: ax, y: ay, w: tw, h: th, buf: kept };

    const n = tw * th * 4;
    if (this.#tile.length < n) this.#tile = Buffer.alloc(n * 2);
    const buf = this.#tile.subarray(0, n); buf.fill(0);

    let any = false;
    const fill = (xa, ya, xb, yb, c) => {
      xa = Math.max(xa, ax); ya = Math.max(ya, ay); xb = Math.min(xb, bx); yb = Math.min(yb, by);
      for (let y = ya; y < yb; y++) {
        const zrow = ((y / PX) | 0) * W;
        for (let x = xa; x < xb; x++) {
          if (t.z < depth[zrow + ((x / PX) | 0)]) continue;
          const k = ((y - ay) * tw + (x - ax)) * 4;
          buf[k] = c[0]; buf[k + 1] = c[1]; buf[k + 2] = c[2]; buf[k + 3] = 255;
          any = true;
        }
      }
    };

    for (const pass of [0, 1]) for (let ci = 0; ci < t.s.length; ci++) {  // halos, then ink
      const g = glyph(t.s[ci]);
      for (let r = 0; r < 7; r++) for (let c = 0; c < 5; c++) {
        if (!g[r][c]) continue;
        const gx = x0 + (ci * 6 + c) * t.sc, gy = y0 + r * t.sc;
        if (pass === 0) fill(gx - halo, gy - halo, gx + t.sc + halo, gy + t.sc + halo, LCD_BG);
        else fill(gx, gy, gx + t.sc, gy + t.sc, INKS[t.ink]);
      }
    }

    if (!any) return null;
    if (open) {
      if (this.#clean.size >= 64) this.#clean.clear();            // timers make new texts every second
      this.#clean.set(key, Buffer.from(buf));
    }
    return { x: ax, y: ay, w: tw, h: th, buf };
  }
}
