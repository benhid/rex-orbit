import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AgentStore, slug, SETTLE } from '../src/agents/store.mjs';
import { applyEvent, applyScan } from '../src/agents/rex.mjs';
import { step } from '../src/agents/motion.mjs';

const SPIN = '⠂', IDLE = '✳';
const blockEvent = (name, payload, block_id = 'b1') =>
  ({ type: 'session_event', payload: { session_id: 's1', event: { type: 'block_event', payload: { block_id, name, payload } } } });
function agent(title = `${SPIN} Fix login bug`) {
  const store = new AgentStore(), a = store.upsert('s1', 'b1');
  store.applyTitle(a, title);
  return { store, a };
}

test('names: short dashed slugs of the conversation title', () => {
  assert.equal(slug('Rex con stream deck'), 'rex-con-stream-deck');
  assert.equal(slug('Corrección del café'), 'correccion-del-cafe');
  assert.equal(slug('Refactor the whole rendering pipeline'), 'refactor-the-whole');   // at most 20 chars, on a word
  assert.equal(slug('  ¿¡ !!'), '');
});

test('title: a spinner means working, ✳ means done', () => {
  const { store, a } = agent();
  assert.equal(a.state, 'work');
  assert.equal(a.name, 'fix-login-bug');
  store.time = 3;
  store.applyTitle(a, `${IDLE} Fix login bug`);
  assert.equal(a.state, 'done');
  assert.equal(a.since, 3);
});

test(`needs you: a notification or a bell, ended by the first busy/idle change after ${SETTLE} s`, () => {
  const { store, a } = agent();
  applyEvent(store, blockEvent('bell', {}));
  assert.equal(a.state, 'wait');
  store.time = 10;
  applyEvent(store, blockEvent('desktop_notification', { title: 'Claude Code', body: 'Claude needs your permission' }));
  store.applyTitle(a, `${SPIN} Fix login bug`);                   // a spinner frame doesn't end it
  store.time = 10 + SETTLE / 2;
  store.applyTitle(a, `${IDLE} Fix login bug`);                   // nor does going idle while it asks
  assert.equal(a.state, 'wait');
  store.time = 10 + SETTLE + 1;
  store.applyTitle(a, `${SPIN} Fix login bug`);                   // answered: back to work
  assert.equal(a.state, 'work');
});

test('OSC 7501 status wins over the title and notifications', () => {
  const { store, a } = agent();
  applyEvent(store, blockEvent('program_status_changed', { record: { state: 'blocked' } }));
  store.applyTitle(a, `${IDLE} Fix login bug`);
  assert.equal(a.state, 'wait');
  applyEvent(store, blockEvent('program_status_changed', { state: 'idle', title: 'Ship the release' }));
  store.needsYou(a);
  assert.equal(a.state, 'done');
  assert.equal(a.name, 'ship-the-release');
  store.applyTitle(a, `${SPIN} Fix login bug`);
  applyEvent(store, blockEvent('program_status_removed', {}));
  assert.equal(a.state, 'work');
});

test('rex: scans and events add, update and drop bots', () => {
  const store = new AgentStore();
  const pane = (block_id, owner, title, records) => ({ block_id, title: { owner: { name: owner }, title }, status: { records } });
  applyScan(store, { sessions: [{ session_id: 's0', blocks: {} }, { session_id: 's1', label: 'work', blocks: [   // Lua sends [] as {}
    pane('b1', 'claude', `${SPIN} Fix login bug`, {}),
    pane('b2', 'claude', `${IDLE} Write docs`, [{ state: 'blocked' }]),
    pane('b3', 'zsh', 'zsh', {}),
  ] }] });
  assert.deepEqual(store.live().map(a => [a.block, a.state]), [['b1', 'work'], ['b2', 'wait']]);
  applyScan(store, { sessions: [{ session_id: 's1', label: 'work', blocks: [pane('b2', 'claude', `${IDLE} Write docs`, [{ state: 'idle' }])] }] });
  assert.deepEqual(store.live().map(a => [a.block, a.state]), [['b2', 'done']]);
  applyScan(store, { sessions: [{ session_id: 's1', blocks: [pane('b2', 'claude', `${IDLE} Old title`, [{ state: 'idle', title: 'Write docs' }])] }] });
  assert.equal(store.byBlock.get('b2').name, 'write-docs');        // the status title wins over a later pane title

  assert.equal(applyEvent(store, { type: 'session_created' }), true);
  assert.equal(applyEvent(store, { type: 'client_joined' }), false);   // our own rex calls
  applyEvent(store, blockEvent('title_changed', { owner: { name: 'claude' }, title: `${SPIN} Write tests` }, 'b9'));
  assert.equal(store.byBlock.get('b9').state, 'work');
  applyEvent(store, blockEvent('child_exited', {}, 'b9'));
  for (let i = 0; i < 60; i++) step(store, 1 / 30);
  assert.deepEqual(store.list.map(a => a.block), ['b2']);
});

test('ids: unique among bots on screen, dissolving ones included, and reused once they are gone', () => {
  const store = new AgentStore();
  for (const b of ['b0', 'b1', 'b2']) store.upsert('s', b);
  store.drop('b1');
  const ids = () => store.list.map(a => a.id);
  store.upsert('s', 'b3');                                        // b1 is still fading out
  assert.equal(new Set(ids()).size, store.list.length, String(ids()));
  for (let i = 0; i < 60; i++) step(store, 1 / 30);
  assert.equal(store.upsert('s', 'b4').id, 1);
});
