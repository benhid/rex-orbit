import { PX } from './render/screen.mjs';
import { GRADIENT } from './render/palette.mjs';
import { drawBot } from './models/bot.mjs';
import { DINO_ID, drawFall } from './models/dino.mjs';

let appearById = new Float64Array(0), inkById = new Uint8Array(0);

export const clock = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** Draw the agents in `store` into `scr` (already sized): fills scr.lit and scr.texts. dino: a Dino, or null. */
export function drawScene(scr, store, dino = null) {
  const { W, H, HH } = scr, { time, list: agents } = store;
  const fresh = scr.begin(agents.length > 0);
  const S = Math.min(H, W * 0.62);                                // size unit for wide and tall panes
  const CX = W / 2, CY = H * 0.47, RX = Math.min(W * 0.36, S * 0.95), RY = S * 0.19;
  const top = store.topWaiting();

  if (fresh && agents.length) for (let s = 0; s < 360; s++) {     // orbit, darker at the front
    const ang = (s / 360) * Math.PI * 2, z = Math.cos(ang);
    scr.baseDot(CX + RX * Math.sin(ang), CY + RY * z, 0.22 + 0.25 * (z + 1) / 2);
  }

  if (dino) {
    drawFall(scr, S, time);
    dino.draw(scr, CX, CY - S * 0.05, Math.round(S * 0.11), time);
  }

  for (const a of agents) {
    const enterE = 1 - Math.pow(1 - a.enter, 3);
    const rad = 1 + (1 - enterE) * 0.9, ang = a.phase + store.orbitRot + (1 - enterE) * 1.6, z = Math.cos(ang);
    const persp = 0.74 + 0.26 * z;                                // back ≈ half the size of front
    a.sx = CX + RX * rad * Math.sin(ang);
    a.sy = CY + RY * rad * z - S * 0.01 * Math.sin(time * 1.3 + a.id) - (a.state === 'wait' ? S * 0.02 + Math.abs(Math.sin(time * 4)) * S * 0.013 : 0);
    a.sc = S * 0.1 * persp * a.scale * (1 + 0.04 * a.pulse) * (0.4 + 0.6 * enterE);
    a.z = z;

    scr.group();
    drawBot(scr, a, a.sx, a.sy, a.sc, z, time);

    if (a.state === 'wait' && a.appear > 0.5) drawWaitRings(scr, a, time, a === top);
  }

  const hud = HH >= 900 ? 3 : 2;
  if (!agents.length) scr.text('WAITING FOR AGENTS' + (Math.floor(time * 2) % 2 ? '_' : ' '), W / 2, H / 2 - 4, hud);

  for (const a of agents) {
    if (a.appear < 0.6) continue;
    const depth = a.z * 100 + 2;                                  // just in front of its own bot
    const near = (a.z + 1) / 2;
    if (near > 0.62) a.ts = 3; else if (near < 0.38) a.ts = 2;    // hysteresis

    drawCaption(scr, a, a.sx, a.sy + a.sc * (a.state === 'wait' ? 2.4 : 1.6), a.ts, depth, time);
  }

  const n = store.live().length;
  if (n) scr.text(`${n} AGENT${n > 1 ? 'S' : ''}`, 5, 4, hud, 'left');
  const toast = store.toast;
  if (toast && time < toast.until) scr.text(`> ${toast.text}`, W / 2, H - (7 * hud + 12) / PX - 4, hud);

  ditherAgents(scr, agents);
}

// The pieces below are shared with scripts/readme-shot.mjs, which lays the same bots out in a row.

/** Dotted rings around a waiting bot; `double` adds a second, counter-rotating one. */
export function drawWaitRings(scr, a, time, double = false) {
  (double ? [2.0, 2.35] : [2.0]).forEach((rk, ri) => {
    const rr = a.sc * (rk + 0.08 * a.pulse), n = Math.ceil(rr * 6);
    for (let s = 0; s < n; s++) {
      const t = (s / n) * Math.PI * 2;
      if (Math.floor((t + time * (ri ? -1.2 : 1.6)) * 8 / Math.PI) % 2) continue;
      scr.decoDot(a.sx + Math.cos(t) * rr, a.sy - a.sc * 0.15 + Math.sin(t) * rr, 0.95, a.ink);
    }
  });
}

/** Name and state under a bot (top edge at y), and the blinking '!' over a waiting one. */
export function drawCaption(scr, a, x, y, ts, depth, time) {
  scr.text(a.name, x, y, ts, 'center', depth, a.ink);
  const sub = a.state === 'wait' ? `needs you · ${clock(time - a.since)}` : a.state === 'work' ? 'working' : 'done';
  scr.text(sub, x, y + (7 * ts + 5) / PX, 2, 'center', depth, a.ink);
  if (a.state === 'wait' && Math.floor(time * 2) % 2 === 0) scr.text('!', a.sx + a.sc * 1.35, a.sy - a.sc * 2.4, ts * 2, 'center', depth, a.ink);
}

/** Dither scr with each agent's fade and ink, and the dinosaur's gradient. */
export function ditherAgents(scr, agents) {
  // typed: a plain array with index DINO_ID set goes into slow dictionary mode
  let ids = DINO_ID + 1;
  for (const a of agents) if (a.id >= ids) ids = a.id + 1;
  if (appearById.length < ids) {
    appearById = new Float64Array(ids * 2);
    inkById = new Uint8Array(ids * 2);
  } else {
    appearById.fill(0);
    inkById.fill(0);
  }
  for (const a of agents) { appearById[a.id] = a.appear; inkById[a.id] = a.ink; }
  appearById[DINO_ID] = 1; inkById[DINO_ID] = GRADIENT;

  scr.dither(appearById, inkById);
}
