import zlib from 'node:zlib';

export class KittyModel {
  images = new Map();               // id → { w, h, bpp, px }
  placements = new Map();           // `${id}:${p}` → { id, row, col, X, Y, z, c, r, seq }
  #cur = { row: 0, col: 0 };
  #pending = null;
  #seq = 0;

  constructor({ cols, rows, cellW, cellH }) { Object.assign(this, { cols, rows, cellW, cellH }); }

  // returns the frame's log of ['tx' | 'place' | 'del', id], in stream order
  feed(s) {
    const log = [];
    if (!s) return log;
    if (!s.startsWith('\x1b[?2026h') || !s.endsWith('\x1b[?2026l')) throw new Error('frame not wrapped in sync output');
    const re = /\x1b_G([^\x1b]*)\x1b\\|\x1b\[(\d*);?(\d*)H|\x1b\[\?2026[hl]|\x1b\[[0-9;]*m|[^\x1b]+/g;
    for (let m; (m = re.exec(s));) {
      if (m[1] !== undefined) this.#apc(m[1], log);
      else if (m[0].endsWith('H') && m[0].startsWith('\x1b[') && !m[0].startsWith('\x1b[?')) this.#cur = { row: (+m[2] || 1) - 1, col: (+m[3] || 1) - 1 };
    }
    if (this.#pending) throw new Error('frame ended mid-transfer');
    return log;
  }

  #apc(body, log) {
    const semi = body.indexOf(';'), ctl = semi < 0 ? body : body.slice(0, semi), payload = semi < 0 ? '' : body.slice(semi + 1);
    const k = Object.fromEntries(ctl.split(',').filter(Boolean).map(kv => kv.split('=')));
    if (payload.length > 4096) throw new Error('chunk > 4096');
    if (this.#pending) {
      if (Object.keys(k).some(x => x !== 'm' && x !== 'q')) throw new Error('extra keys in continuation ' + ctl);
      this.#pending.data += payload;
      if (k.m === '1') return;
      const p = this.#pending; this.#pending = null;
      return this.#finish(p, log);
    }
    if (k.a === 'T' || k.a === 't') {
      if (k.q !== '2') throw new Error('missing q=2');
      const p = { k, data: payload, row: this.#cur.row, col: this.#cur.col };
      if (k.m === '1') { this.#pending = p; return; }
      return this.#finish(p, log);
    }
    if (k.a === 'p') {
      if (!this.images.has(+k.i)) throw new Error('place of unknown image ' + k.i);
      return this.#place(+k.i, k, log);
    }
    if (k.a === 'd') {
      const keys = [...this.placements.keys()];
      if (k.d === 'I') { this.images.delete(+k.i); for (const key of keys) if (key.startsWith(k.i + ':')) this.placements.delete(key); log.push(['del', +k.i]); }
      else if (k.d === 'i') { for (const key of keys) if (key === `${k.i}:${k.p || 0}` || (!k.p && key.startsWith(k.i + ':'))) this.placements.delete(key); }
      else if (k.d === 'A') {                                      // like kitty: frees only images that were on screen
        const shown = new Set([...this.placements.values()].map(p => p.id));
        for (const id of shown) this.images.delete(id);
        this.placements.clear();
      }
      else throw new Error('unknown delete ' + ctl);
      return;
    }
    throw new Error('unknown action ' + ctl);
  }

  #finish(p, log) {
    const k = p.k, data = Buffer.from(p.data, 'base64');
    const raw = k.o === 'z' ? zlib.inflateSync(data) : data;
    const bpp = k.f === '32' ? 4 : 3;
    if (raw.length !== +k.s * +k.v * bpp) throw new Error(`size mismatch ${raw.length} vs ${k.s}x${k.v}x${bpp}`);
    if (this.images.has(+k.i)) throw new Error('transmit to id in use ' + k.i);
    this.images.set(+k.i, { w: +k.s, h: +k.v, bpp, px: raw });
    log.push(['tx', +k.i]);
    if (k.a === 'T') { this.#cur = { row: p.row, col: p.col }; this.#place(+k.i, k, log); }
  }

  #place(id, k, log) {
    const X = +(k.X || 0), Y = +(k.Y || 0);
    if (k.C !== '1') throw new Error('placement without C=1 moves the cursor (and can scroll the screen)');
    if (X >= this.cellW || Y >= this.cellH) throw new Error('X/Y beyond cell');
    this.placements.set(`${id}:${k.p || 0}`, { id, row: this.#cur.row, col: this.#cur.col, X, Y, z: +(k.z || 0), c: k.c ? +k.c : 0, r: k.r ? +k.r : 0, seq: this.#seq++ });
    log.push(['place', id]);
  }

  // the image area as RGB, DW pixels wide
  screen() {
    const { cols, rows, cellW, cellH } = this, DW = cols * cellW, DH = rows * cellH, scr = Buffer.alloc(DW * DH * 3);
    const ps = [...this.placements.values()].sort((a, b) => a.z - b.z || a.seq - b.seq);
    for (const p of ps) {
      const im = this.images.get(p.id), ox = p.col * cellW + p.X, oy = p.row * cellH + p.Y;
      const dw = p.c ? p.c * cellW : im.w, dh = p.r ? p.r * cellH : im.h;
      for (let y = 0; y < dh; y++) for (let x = 0; x < dw; x++) {
        const sx = Math.floor(x * im.w / dw), sy = Math.floor(y * im.h / dh), si = (sy * im.w + sx) * im.bpp;
        const X = ox + x, Y = oy + y; if (X >= DW || Y >= DH) continue;
        if (im.bpp === 4 && im.px[si + 3] === 0) continue;
        if (im.bpp === 4 && im.px[si + 3] !== 255) throw new Error('partial alpha');
        const di = (Y * DW + X) * 3; scr[di] = im.px[si]; scr[di + 1] = im.px[si + 1]; scr[di + 2] = im.px[si + 2];
      }
    }
    return { scr, DW };
  }
}
