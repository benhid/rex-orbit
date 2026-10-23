import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import { KIND_STROKE } from '../src/render/screen.mjs';
import { setTheme } from '../src/render/palette.mjs';
import { detectKittyGraphics } from '../src/terminal/kitty.mjs';
import { KittyModel } from './support/kitty-model.mjs';
import { firstDifference } from './support/reference.mjs';
import { transportScene, PANE } from './support/scenarios.mjs';

const golden = JSON.parse(readFileSync(new URL('./support/golden.json', import.meta.url), 'utf8'));
const run = (app, term, frames) => { for (let i = 0; i < frames; i++) { app.step(1 / 30); term.feed(app.frame(PANE.cols, PANE.rows)); } };

test('kitty: the terminal rebuilds the scene pixel for pixel, double-buffered, from the recorded stream', () => {
  const app = transportScene('mixed'), term = new KittyModel(PANE), { frames, sha256 } = golden.transport.mixed;
  const all = crypto.createHash('sha256');
  for (let i = 0; i < frames; i++) {
    app.step(1 / 30);
    const s = app.frame(PANE.cols, PANE.rows);
    all.update(s); all.update('\0');
    const log = term.feed(s), firstDel = log.findIndex(e => e[0] === 'del'), lastTx = log.map(e => e[0]).lastIndexOf('tx');
    assert.ok(firstDel < 0 || lastTx < firstDel, `frame ${i}: delete before transmit`);
    if (i % 10 === 0) assert.equal(firstDifference(app.screen, term), null, `frame ${i}`);
  }
  assert.equal(all.digest('hex'), sha256, 'stream bytes');
  assert.ok(term.images.size <= 40, `images kept: ${term.images.size}`);
});

test('kitty: label ids are reused, so they stay few however long it runs', () => {
  const app = transportScene('mixed');
  let highest = 0;
  for (let i = 0; i < 900; i++) {
    app.step(1 / 30);
    for (const m of app.frame(PANE.cols, PANE.rows).matchAll(/a=T,[^;]*?i=(\d+)/g)) highest = Math.max(highest, +m[1]);
  }
  assert.ok(highest < 100, `highest id ${highest}`);
});

test('kitty: nothing is sent when nothing changed', () => {
  const app = transportScene('none');
  app.step(0); assert.match(app.frame(PANE.cols, PANE.rows), /a=T/);
  assert.equal(app.frame(PANE.cols, PANE.rows), '');
});

test('kitty: after a resize everything comes back in one frame', () => {
  const app = transportScene('mixed'), term = new KittyModel(PANE);
  run(app, term, 10);
  term.feed('\x1b[?2026h\x1b_Ga=d,d=A,q=2\x1b\\\x1b[?2026l');   // a clear can drop every image
  app.kitty.invalidate();
  run(app, term, 1);
  assert.equal(firstDifference(app.screen, term), null);
});

test('kitty: quitting right after an invalidate still frees every image', () => {
  const app = transportScene('mixed'), term = new KittyModel(PANE);
  run(app, term, 16);                                             // the blinking '!' label is hidden, its image kept
  app.kitty.invalidate();                                         // 't' or a resize, then 'q' before the next frame
  term.feed(`\x1b[?2026h${app.kitty.release()}\x1b[?2026l`);
  assert.equal(term.images.size, 0);
});

test('kitty: switching to the dark theme repaints everything, strokes included', () => {
  try {
    const app = transportScene('mixed'), term = new KittyModel(PANE);
    run(app, term, 20);
    app.setTheme('dark');
    term.feed('\x1b[?2026h\x1b_Ga=d,d=A,q=2\x1b\\\x1b[?2026l');   // the bin also clears the screen
    app.step(1 / 30);
    const f = app.frame(PANE.cols, PANE.rows);
    term.feed(f);
    assert.match(f, /t theme {2}q quit/, 'the cleared status line comes back');
    run(app, term, 2);
    assert.equal(firstDifference(app.screen, term), null);
    const { kind, lit } = app.screen;
    assert.ok(kind.some((k, o) => k === KIND_STROKE && lit[o] > 0), 'rings and antennas stay lit');
  } finally { setTheme('light'); }
});

test('kitty: support is detected only from an OK reply before DA1', async () => {
  const probe = reply => {
    const stdin = Object.assign(new EventEmitter(), { resume() {} });
    const stdout = { write: () => setImmediate(() => reply && stdin.emit('data', Buffer.from(reply))) };
    return detectKittyGraphics(stdin, stdout, 50);
  };
  assert.equal(await probe('\x1b_Gi=31;OK\x1b\\\x1b[?62;22c'), true);
  assert.equal(await probe('\x1b_Gi=31,p=1;OK\x1b\\\x1b[?62;22c'), true);
  assert.equal(await probe('\x1b_Gi=31;EINVAL:bad\x1b\\\x1b[?62;22c'), false);
  assert.equal(await probe('\x1b[?62;22c'), false);
});
