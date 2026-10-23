import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { drawScene } from '../src/scene.mjs';
import { Dino } from '../src/models/dino.mjs';
import { Screen } from '../src/render/screen.mjs';
import { composite } from './support/reference.mjs';
import { renderScene } from './support/scenarios.mjs';

const golden = JSON.parse(readFileSync(new URL('./support/golden.json', import.meta.url), 'utf8'));

for (const [name, { w, h, frames, dino, sha256 }] of Object.entries(golden.render)) {
  test(`render: ${name} looks exactly as recorded`, () => {
    const { store, screen, tick } = renderScene(w, h), d = dino ? new Dino({ background: false }) : null;
    const all = crypto.createHash('sha256');
    for (let f = 0; f < frames; f++) {
      tick(f);
      drawScene(screen, store, d);
      all.update(crypto.createHash('md5').update(composite(screen)).digest('hex'));
    }
    assert.equal(all.digest('hex'), sha256);
  });
}

test('render: redrawing only what moved matches drawing from scratch', () => {
  const { store, screen, tick } = renderScene(160, 120), dino = new Dino({ background: false });
  for (let f = 0; f < 420; f++) {
    tick(f);
    if (f === 250) for (const a of store.live()) store.drop(a.block);   // the orbit goes...
    if (f === 330) store.upsert('s9', 'b9');                             // ...and comes back
    drawScene(screen, store, dino);
    const fresh = new Screen(); fresh.resize(screen.W, screen.H); drawScene(fresh, store, dino);
    assert.ok(fresh.lit.every((v, o) => v === screen.lit[o]) && fresh.rgb.equals(screen.rgb), `frame ${f} differs`);
  }
});
