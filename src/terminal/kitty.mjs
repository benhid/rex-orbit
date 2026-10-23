import zlib from 'node:zlib';
import { LCD_BG, LCD_INK } from '../render/palette.mjs';
import { ESC, bg, fg } from './tty.mjs';

const CHUNK = 4096;
const TILE_KEEP = 3;                                              // seconds a hidden label image is kept for reuse
const FIRST_TILE_ID = 10;                                         // 1 and 2 are the scene's

const deleteImage = id => `${ESC}_Ga=d,d=I,i=${id},q=2${ESC}\\`;
const hidePlacement = id => `${ESC}_Ga=d,d=i,i=${id},p=1,q=2${ESC}\\`;
const DELETE_ALL_IMAGES = `${ESC}_Ga=d,d=A,q=2${ESC}\\`;

// transmit and place, deflated, in base64 chunks
function put(parts, head, raw) {
  const data = zlib.deflateSync(raw, { level: 1 }).toString('base64');
  for (let i = 0; i < data.length; i += CHUNK) {
    const more = i + CHUNK < data.length ? 1 : 0;
    parts.push(`${ESC}_G${i === 0 ? `a=T,o=z,q=2,${head},` : ''}m=${more};${data.slice(i, i + CHUNK)}${ESC}\\`);
  }
}

// Asks the terminal whether it has Kitty graphics, then waits for the DA1 reply so nothing is left over.
export function detectKittyGraphics(stdin, stdout, timeoutMs = 300) {
  stdin.setRawMode?.(true);
  stdin.resume();

  return new Promise(resolve => {
    let buf = '';
    const ok = /\x1b_Gi=31(?:,[^;\x1b]*)?;OK/, da1 = /\x1b\[\?[\d;]*c/;

    const finish = () => { clearTimeout(timer); stdin.off('data', onData); resolve(ok.test(buf)); };
    const onData = d => { buf += d.toString('latin1'); if (da1.test(buf)) finish(); };
    const timer = setTimeout(finish, timeoutMs);

    stdin.on('data', onData);
    stdout.write(`${ESC}_Gi=31,s=1,v=1,a=q,t=d,f=24;AAAA${ESC}\\${ESC}[c`);
  });
}

// The scene as one image scaled to the pane, each label as a small image on top. Every new image gets an
// id no image on screen has, and the old one is deleted only after it, inside synchronized output, so
// nothing flickers.
export class KittyLayers {
  #lastKey = '';
  #statusDirty = true;
  #wipe = '';
  #sceneSent = false;
  #sceneId = 1;
  #tiles = [];                      // { key, id, w, h, buf, placed, claimed, seen }
  #nextTileId = FIRST_TILE_ID;
  #freeIds = [];                    // label ids deleted in an earlier frame, safe to reuse
  #freeing = [];                    // deleted in this frame

  // after a resize or clear the terminal may have dropped image data, so start over
  invalidate() {
    this.#lastKey = '';
    this.#statusDirty = true;
    this.#sceneSent = false;
    this.#wipe = this.release();                                  // keeps an unsent wipe: frame() calls this again right after
    this.#tiles = [];
    this.#nextTileId = FIRST_TILE_ID;                             // the wipe deletes every id before anything is sent
    this.#freeIds = [];
    this.#freeing = [];
  }

  // d=A frees only images on screen, so hidden labels are freed by id, along with a wipe not sent yet
  release() {
    const bytes = this.#wipe + this.#tiles.map(e => deleteImage(e.id)).join('') + DELETE_ALL_IMAGES;
    this.#wipe = '';
    return bytes;
  }

  // the bytes that bring the terminal up to date, or '' when nothing changed
  frame(scr, cols, rows, cell, time) {
    const key = `${cols}x${rows}:${cell.w}x${cell.h}`;
    if (key !== this.#lastKey) { this.invalidate(); this.#lastKey = key; }

    const parts = [], drops = [];
    if (this.#wipe) { parts.push(this.#wipe); this.#wipe = ''; }
    this.#freeIds.push(...this.#freeing);
    this.#freeing = [];

    this.#scene(scr, cols, rows, parts, drops);
    this.#labels(scr, cols, rows, cell, time, parts, drops);
    parts.push(...drops);

    if (this.#statusDirty) {
      this.#statusDirty = false;
      parts.push(`${ESC}[${rows + 1};1H${bg(LCD_BG)}${fg(LCD_INK)}${'t theme  q quit'.slice(0, cols).padEnd(cols)}`);
    }

    return parts.length ? `${ESC}[?2026h${parts.join('')}${ESC}[?2026l` : '';
  }

  #scene(scr, cols, rows, parts, drops) {
    if (!scr.takeChanges().length && this.#sceneSent) return;
    this.#sceneSent = true;

    const id = this.#sceneId = 3 - this.#sceneId;
    parts.push(`${ESC}[H`);
    put(parts, `f=24,s=${scr.W},v=${scr.H},i=${id},p=1,c=${cols},r=${rows},C=1,z=0`, scr.rgb);
    drops.push(deleteImage(3 - id));
  }

  // reuse ids freed in earlier frames: some terminals (Konsole) never free image data, so ids stay few
  #newTileId() {
    return this.#freeIds.pop() ?? this.#nextTileId++;
  }

  #drop(drops, id) {
    drops.push(deleteImage(id));
    this.#freeing.push(id);
  }

  #labels(scr, cols, rows, cell, time, parts, drops) {
    const tiles = this.#tiles;
    const order = [...scr.texts].sort((a, b) => a.z - b.z);       // nearer labels on top
    const fx = cols * cell.w / scr.HW, fy = rows * cell.h / scr.HH;
    for (const e of tiles) e.claimed = false;

    order.forEach((t, rank) => {
      const r = scr.rasterLabel(t);
      if (!r) return;

      const key = `${t.sc}|${t.ink}|${t.s}`;
      const same = e => e.w === r.w && e.h === r.h && e.buf.equals(r.buf);
      let e = tiles.find(e => !e.claimed && e.key === key && same(e)) || tiles.find(e => !e.claimed && e.key === key);

      const dx = Math.round(r.x * fx), dy = Math.round(r.y * fy);
      if (dx + r.w > cols * cell.w || dy + r.h > rows * cell.h) return;   // in a tiny pane labels would cover the status line

      const col = Math.floor(dx / cell.w), row = Math.floor(dy / cell.h), X = dx - col * cell.w, Y = dy - row * cell.h;
      const at = `${ESC}[${row + 1};${col + 1}H`, place = `X=${X},Y=${Y},z=${1 + rank},C=1`;

      if (e && same(e)) {
        if (e.placed !== at + place) parts.push(`${at}${ESC}_Ga=p,i=${e.id},p=1,${place},q=2${ESC}\\`);
      } else {
        if (!e) { e = { key }; tiles.push(e); }
        else this.#drop(drops, e.id);
        e.id = this.#newTileId();
        e.w = r.w; e.h = r.h; e.buf = Buffer.from(r.buf);
        parts.push(at);
        put(parts, `f=32,s=${r.w},v=${r.h},i=${e.id},p=1,${place}`, r.buf);
      }

      e.placed = at + place;
      e.claimed = true;
      e.seen = time;
    });

    for (let i = tiles.length - 1; i >= 0; i--) {
      const e = tiles[i];
      if (e.claimed) continue;
      if (time - e.seen > TILE_KEEP) { this.#drop(drops, e.id); tiles.splice(i, 1); }
      else if (e.placed) { drops.push(hidePlacement(e.id)); e.placed = ''; }
    }
  }
}
