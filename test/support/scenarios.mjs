import { rng, identity } from '../../src/models/identity.mjs';
import { createApp } from '../../src/app.mjs';
import { Screen } from '../../src/render/screen.mjs';
import { AgentStore } from '../../src/agents/store.mjs';
import { step } from '../../src/agents/motion.mjs';

const seedRandom = seed => { Math.random = rng(seed); };

// seven bots with every face, ears and antenna; states change at frames 20 and 200, one leaves at 400
const LOOKS = [
  ['dots', 'headphones', 'single', true, 0.9, 'work'], ['visor', 'bolts', 'double', false, 0.95, 'wait'],
  ['cyclops', 'bear', 'bulb', true, 0.86, 'done'], ['screen', 'none', 'single', false, 0.99, 'work'],
  ['cyclops', 'headphones', 'none', false, 0.88, 'wait'], ['dots', 'bear', 'double', true, 0.92, 'done'],
  ['screen', 'bolts', 'bulb', true, 0.97, 'work'],
];
export function renderScene(w, h) {
  const store = new AgentStore(), screen = new Screen(), later = [];
  screen.resize(w, h);
  LOOKS.forEach(([face, ears, antenna, ring, albedo, state], i) => {
    const a = store.upsert('s' + i, 'b' + i);
    Object.assign(a, { style: { face, ears, antenna, ring, albedo }, task: `Fake task number ${i} cafe`, hasStatus: true, nextBlink: 2 + i * 0.7 });
    a.name = store.nameFor(a);
    later.push([a, state]);
  });
  store.showToast('dots-bot connected');
  seedRandom(12345);
  const tick = f => {
    if (f === 20) for (const [a, state] of later) store.setState(a, state);
    if (f === 200) { store.setState(store.list[3], 'wait'); store.setState(store.list[1], 'done'); }
    if (f === 400) store.drop('b2');
    step(store, 1 / 30);
  };
  return { store, screen, tick };
}

// stretched by exactly PX, so the terminal model needs no resampling
export const PANE = { cols: 126, rows: 54, cellW: 8, cellH: 16 };
const NAMES = ['rex-con-stream-deck', 'bots-transport', 'render-opt', 'kitty-graphics', 'fix-login-bug', 'docs', 'release-notes'];
const MIXED = ['work', 'wait', 'done', 'work', 'done', 'work', 'done'];
export function transportScene(scenario) {
  const app = createApp();
  if (scenario !== 'none') for (let i = 0; i < 7; i++) {
    const a = app.store.upsert('s', 'b' + i);
    Object.assign(a, { name: NAMES[i], style: identity('blk' + i), state: MIXED[i], since: -i * 7,
      hasStatus: true, enter: 1, appear: 1, nextBlink: 2 });
  }
  seedRandom(12345);
  return app;
}
