#!/usr/bin/env node
import { parseArgs, preflight, onExit } from '../src/cli.mjs';
import { enter, clear, RESTORE, queryCellSize, queryBackground } from '../src/terminal/tty.mjs';
import { setTheme } from '../src/render/palette.mjs';
import { createApp, imageArea } from '../src/app.mjs';
import { followRex } from '../src/agents/rex.mjs';

const opts = parseArgs(process.argv.slice(2));
await preflight();

const { stdin, stdout: out } = process;
let theme = opts.theme === 'auto' ? (await queryBackground(stdin, out)) || 'light' : opts.theme;
setTheme(theme);
const app = createApp({ dino: opts.dino });

const updateCellSize = async () => {
  const size = await queryCellSize(stdin, out);
  if (size) Object.assign(app.cell, size);
};

let stopRex = () => {};
onExit(() => { stopRex(); out.write(app.kitty.release() + RESTORE); });
out.write(enter());
await updateCellSize();

stdin.on('data', d => {
  const k = d.toString();
  if (/^[qQ]+$/.test(k) || k.includes('\x03')) process.exit(0);
  if (/^[tT]+$/.test(k) && k.length % 2) {                     // presses can arrive together: an even count is no change
    app.setTheme(theme = theme === 'dark' ? 'light' : 'dark');
    out.write(clear());
  }
});

// 'resize' fires only when columns or rows change, not when the cell size in pixels does
process.on('SIGWINCH', () => {
  out.write(clear());
  app.kitty.invalidate();
  updateCellSize();                                               // a new cell size changes frame()'s key, which invalidates again
});

stopRex = followRex(app.store);

let last = performance.now(), busy = false;
setInterval(() => {
  const now = performance.now(), dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  app.step(dt);
  if (busy || !(out.columns > 0 && out.rows > 0)) return;        // a pane still being laid out reports 0×0

  const { cols, rows } = imageArea(out.columns, out.rows);
  const f = app.frame(cols, rows);
  if (!f) return;

  busy = !out.write(f);
  if (busy) out.once('drain', () => { busy = false; });
}, 1000 / opts.fps);
