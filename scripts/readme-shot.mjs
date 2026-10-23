#!/usr/bin/env node
// For the README screenshot: four bots and the dinosaur in a row, with fixed names and states.
// Needs a terminal with Kitty graphics (no Rex or Claude Code). t switches the theme, q quits.
import { onExit } from '../src/cli.mjs';
import { detectKittyGraphics, KittyLayers } from '../src/terminal/kitty.mjs';
import { enter, clear, RESTORE, queryCellSize, queryBackground } from '../src/terminal/tty.mjs';
import { Screen } from '../src/render/screen.mjs';
import { BOT_INKS, setTheme } from '../src/render/palette.mjs';
import { AgentStore } from '../src/agents/store.mjs';
import { step } from '../src/agents/motion.mjs';
import { drawBot } from '../src/models/bot.mjs';
import { Dino } from '../src/models/dino.mjs';
import { drawWaitRings, drawCaption, ditherAgents } from '../src/scene.mjs';
import { fitScreen, imageArea } from '../src/app.mjs';

const ROW = [
  { name: 'fix-payments', state: 'done', style: { face: 'dots', ears: 'headphones', antenna: 'single', ring: false, albedo: 0.92 } },
  { name: 'api-auth', state: 'work', style: { face: 'visor', ears: 'bolts', antenna: 'double', ring: true, albedo: 0.95 } },
  'dino',
  { name: 'landing-v2', state: 'done', style: { face: 'screen', ears: 'bear', antenna: 'bulb', ring: false, albedo: 0.9 } },
  { name: 'db-migration', state: 'wait', style: { face: 'cyclops', ears: 'none', antenna: 'single', ring: false, albedo: 0.97 } },
];

const { stdin, stdout: out } = process;
if (!stdin.isTTY || !out.isTTY) { console.error('readme-shot: run it in a terminal'); process.exit(1); }
if (!(await detectKittyGraphics(stdin, out))) { console.error('readme-shot: this terminal has no Kitty graphics'); process.exit(1); }

let theme = process.argv.includes('--dark') ? 'dark' : process.argv.includes('--light') ? 'light' : (await queryBackground(stdin, out)) || 'light';
setTheme(theme);

const store = new AgentStore({ inks: BOT_INKS }), screen = new Screen(), kitty = new KittyLayers(), dino = new Dino(), cell = { w: 8, h: 16 };
const bots = ROW.map((r, i) => {
  if (r === 'dino') return null;
  const a = store.upsert('readme', 'bot' + i);
  Object.assign(a, { name: r.name, style: r.style, state: r.state, since: r.state === 'wait' ? -42 : 0, hasStatus: true, enter: 1, appear: 1, phase: 0 });
  return a;
});

onExit(() => out.write(kitty.release() + RESTORE));
out.write(enter());
const size = await queryCellSize(stdin, out);
if (size) Object.assign(cell, size);

stdin.on('data', d => {
  const k = d.toString();
  if (/^[qQ]+$/.test(k) || k.includes('\x03')) process.exit(0);
  if (/^[tT]+$/.test(k)) {
    setTheme(theme = theme === 'dark' ? 'light' : 'dark');
    out.write(clear());
    screen.invalidate();
    kitty.invalidate();
  }
});
process.on('SIGWINCH', () => {
  out.write(clear());
  kitty.invalidate();
  queryCellSize(stdin, out).then(s => { if (s) Object.assign(cell, s); });   // the font size may have changed
});

function draw() {
  const { cols, rows } = imageArea(out.columns, out.rows);
  fitScreen(screen, cols, rows, cell);
  const { W, H } = screen, slot = W / ROW.length, R = Math.min(slot * 0.22, H * 0.13), cy = H * 0.5, time = store.time;
  screen.begin(false);

  ROW.forEach((r, i) => {
    const cx = slot * (i + 0.5);
    if (r === 'dino') { dino.draw(screen, cx, cy - R * 0.1, Math.round(R * 1.15), time); return; }

    const a = bots[i], hop = a.state === 'wait' ? R * 0.15 + Math.abs(Math.sin(time * 4)) * R * 0.12 : 0;
    a.sx = cx; a.sy = cy - hop; a.sc = R * a.scale * (1 + 0.04 * a.pulse); a.z = 1;
    screen.group();
    drawBot(screen, a, a.sx, a.sy, a.sc, 1, time);

    if (a.state === 'wait') drawWaitRings(screen, a, time);
    drawCaption(screen, a, cx, cy + R * 2.1, 3, 200, time);
  });

  ditherAgents(screen, bots.filter(Boolean));

  return kitty.frame(screen, cols, rows, cell, time);
}

let last = performance.now();
setInterval(() => {
  const now = performance.now();
  step(store, Math.min(0.1, (now - last) / 1000));
  last = now;

  for (const a of bots) if (a) { a.enter = 1; a.appear = 1; if (a.state === 'wait') a.scale = 1.15; }   // don't let it grow off screen

  const f = draw();
  if (f) out.write(f);
}, 1000 / 30);
