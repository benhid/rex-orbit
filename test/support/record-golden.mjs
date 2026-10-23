import crypto from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { drawScene } from '../../src/scene.mjs';
import { Dino } from '../../src/models/dino.mjs';
import { composite } from './reference.mjs';
import { renderScene, transportScene, PANE } from './scenarios.mjs';

const file = new URL('./golden.json', import.meta.url);
const golden = JSON.parse(readFileSync(file, 'utf8')), before = JSON.stringify(golden);

for (const g of Object.values(golden.render)) {
  const { store, screen, tick } = renderScene(g.w, g.h), dino = g.dino ? new Dino({ background: false }) : null;
  const all = crypto.createHash('sha256');
  for (let f = 0; f < g.frames; f++) { tick(f); drawScene(screen, store, dino); all.update(crypto.createHash('md5').update(composite(screen)).digest('hex')); }
  g.sha256 = all.digest('hex');
}
for (const [scenario, g] of Object.entries(golden.transport)) {
  const app = transportScene(scenario), all = crypto.createHash('sha256');
  let sent = 0, bytes = 0;
  for (let i = 0; i < g.frames; i++) {
    app.step(1 / 30);
    const s = app.frame(PANE.cols, PANE.rows);
    all.update(s); all.update('\0');
    if (s) sent++;
    bytes += Buffer.byteLength(s);
  }
  Object.assign(g, { framesSent: sent, bytes, sha256: all.digest('hex') });
}
const was = JSON.parse(before), changed = [];
for (const group of ['render', 'transport']) for (const [name, g] of Object.entries(golden[group]))
  if (g.sha256 !== was[group][name].sha256) changed.push(`${group}/${name}` + (g.bytes ? ` (${was[group][name].bytes} -> ${g.bytes} bytes)` : ''));
writeFileSync(file, JSON.stringify(golden, null, 2) + '\n');
console.log(changed.length ? `golden.json updated: ${changed.join(', ')}` : 'golden.json unchanged');
