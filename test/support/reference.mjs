import { PX, labelBox, haloOf } from '../../src/render/screen.mjs';
import { LCD_BG, INKS } from '../../src/render/palette.mjs';
import { glyph } from '../../src/render/font.mjs';

// a label at screen resolution: 0 = untouched, 1 = halo (background), 2 = ink
const masks = new Map();
function labelMask(s, sc) {
  const key = sc + '|' + s;
  let m = masks.get(key);
  if (m) return m;
  const halo = haloOf(sc), mw = (s.length * 6 - 1) * sc + 2 * halo, mh = 7 * sc + 2 * halo, mask = new Uint8Array(mw * mh);
  for (const pass of [1, 2]) [...s].forEach((ch, ci) => {
    const g = glyph(ch);
    for (let r = 0; r < 7; r++) for (let c = 0; c < 5; c++) {
      if (!g[r][c]) continue;
      const bx = halo + (ci * 6 + c) * sc, by = halo + r * sc, e = pass === 1 ? halo : 0;
      for (let y = by - e; y < by + sc + e; y++) mask.fill(pass, y * mw + bx - e, y * mw + bx + sc + e);
    }
  });
  if (masks.size > 256) masks.clear();
  m = { mask, mw, mh, halo };
  masks.set(key, m);
  return m;
}

let img = Buffer.alloc(0), rows, rowsFor = '';
export function composite(scr) {
  const { W, H, HW, HH, lit, depth } = scr, RB = HW * 3, CB = PX * 3;
  const palette = String([LCD_BG, ...INKS]);
  if (img.length !== HW * HH * 3 || palette !== rowsFor) {
    img = Buffer.alloc(HW * HH * 3); rowsFor = palette;
    rows = [LCD_BG, ...INKS].map(c => { const r = Buffer.alloc(RB); for (let i = 0; i < RB; i++) r[i] = c[i % 3]; return r; });
  }
  for (let y = 0; y < H; y++) {
    const o = y * W, q = y * PX * RB;
    for (let x = 0; x < W;) {
      const v = lit[o + x]; let e = x + 1;
      while (e < W && lit[o + e] === v) e++;
      rows[v].copy(img, q + x * CB, x * CB, e * CB);
      x = e;
    }
    for (let r = 1; r < PX; r++) img.copyWithin(q + r * RB, q, q + RB);
  }
  const texts = [...scr.texts].sort((a, b) => a.z - b.z);
  for (const t of texts) {
    const { x0, y0 } = labelBox(t), { mask, mw, mh, halo } = labelMask(t.s, t.sc), mx = x0 - halo, my = y0 - halo;
    const xa = Math.max(0, mx), xb = Math.min(HW, mx + mw), ya = Math.max(0, my), yb = Math.min(HH, my + mh);
    for (let py = ya; py < yb; py++) {
      const mrow = (py - my) * mw - mx, zrow = ((py / PX) | 0) * W;
      for (let sx = (xa / PX) | 0; sx * PX < xb; sx++) {
        if (t.z < depth[zrow + sx]) continue;
        for (let px = Math.max(xa, sx * PX), pe = Math.min(xb, sx * PX + PX); px < pe; px++) {
          const v = mask[mrow + px];
          if (!v) continue;
          const c = v === 2 ? INKS[t.ink] : LCD_BG, k = (py * HW + px) * 3; img[k] = c[0]; img[k + 1] = c[1]; img[k + 2] = c[2];
        }
      }
    }
  }
  return img;
}

// the first pixel where the terminal model differs from the reference image, or null
export function firstDifference(scr, term) {
  const ref = composite(scr), { HW, HH } = scr, { scr: shown, DW } = term.screen();
  for (let y = 0; y < HH; y++) for (let x = 0; x < HW; x++) {
    const a = (y * HW + x) * 3, b = (y * DW + x) * 3;
    if (ref[a] !== shown[b] || ref[a + 1] !== shown[b + 1] || ref[a + 2] !== shown[b + 2]) return `${x},${y}`;
  }
  return null;
}
