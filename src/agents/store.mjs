import { identity, hash } from '../models/identity.mjs';
import { stripAccents } from '../render/font.mjs';

const STATUS = { working: 'work', blocked: 'wait', error: 'wait', done: 'done', idle: 'done' };   // OSC 7501 → state

// "Needs you" ends at the first busy/idle change after the notification settles; spinner frames don't count.
export const SETTLE = 1.5;                                        // seconds
const TOAST_SECONDS = 2.2;

// "Rex con stream deck" → rex-con-stream-deck
export function slug(text) {
  const words = stripAccents(text).toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').trim().split(/\s+/).filter(Boolean);

  let out = '';
  for (const w of words) {
    const next = out ? `${out}-${w}` : w;
    if (next.length > 20) break;
    out = next;
  }

  return out || words[0]?.slice(0, 20) || '';
}

// Claude Code prefixes the pane title with a spinner while it works and ✳ when idle
export function fromTitle(title) {
  const t = (title || '').trim(), first = [...t][0];
  if (!first) return { busy: false, text: '' };
  if (/[\p{L}\p{N}]/u.test(first)) return { busy: false, text: t };
  return { busy: first !== '✳', text: t.slice(first.length).trim() };
}

export class AgentStore {
  #inks;

  constructor({ inks = 8 } = {}) { this.#inks = inks; }

  time = 0;
  orbitRot = 0;
  list = [];                        // includes bots still dissolving
  byBlock = new Map();
  sessionLabels = new Map();
  toast = null;

  // reused, so ids stay small and never reach DINO_ID
  #freeId() {
    const used = new Set(this.list.map(a => a.id));
    let id = 0;
    while (used.has(id)) id++;
    return id;
  }

  live() { return this.list.filter(a => !a.leaving); }

  topWaiting() { return this.live().filter(a => a.state === 'wait').sort((x, y) => x.since - y.since)[0] || null; }

  showToast(text) { this.toast = { text, until: this.time + TOAST_SECONDS }; }

  nameFor(a) {
    const label = this.sessionLabels.get(a.session) || '';
    return slug(a.task) || slug(label) || label.slice(0, 20) || a.session.slice(-6);
  }

  // from a hash of the pane, skipping inks that bots on screen already use
  #pickInk(block) {
    const n = this.#inks, used = new Set(this.live().map(a => a.ink)), start = hash(block + ':ink') % n;
    for (let i = 0; i < n; i++) {
      const ink = 1 + (start + i) % n;
      if (!used.has(ink)) return ink;
    }
    return 1 + start;
  }

  upsert(session, block) {
    let a = this.byBlock.get(block);
    if (a && !a.leaving) return a;

    const time = this.time;
    a = {
      id: this.#freeId(), session, block, name: '', task: '', style: identity(block),
      announce: true,
      state: 'new', since: time, busy: null, waitBusy: null, waitAt: 0, hasStatus: false,
      phase: null, enter: 0, leaving: false, appear: 0,
      yaw: 0, pitch: 0, look: 0, open: 1, nextBlink: time + 2 + Math.random() * 3, blinkUntil: 0,
      scale: 1, pulse: 0, sx: 0, sy: 0, sc: 0, z: 0, ts: 2,
    };
    a.name = this.nameFor(a);
    a.ink = this.#pickInk(block);

    this.byBlock.set(block, a);
    this.list.push(a);
    return a;
  }

  drop(block) {
    const a = this.byBlock.get(block);
    if (a && !a.leaving) {
      a.leaving = true;
      this.byBlock.delete(block);
    }
  }

  setState(a, s) {
    if (a.state !== s) {
      a.state = s;
      a.since = this.time;
    }
  }

  // OSC 7501 records; the one without an id is the program's own
  applyStatus(a, records) {
    const rec = (Array.isArray(records) ? records : []).find(r => !r.id) || records?.[0];
    a.hasStatus = !!rec;
    if (!rec) return;

    this.setState(a, STATUS[rec.state] || 'done');
    if (rec.title) {
      a.task = rec.title;
      a.name = this.nameFor(a);
    }
  }

  statusRemoved(a) {
    a.hasStatus = false;
    this.setState(a, a.busy ? 'work' : 'done');
  }

  applyTitle(a, title) {
    const { busy, text } = fromTitle(title);
    if (text) {
      a.task = text;
      a.name = this.nameFor(a);
    }
    if (a.announce && a.name) {
      a.announce = false;
      this.showToast(`${a.name} connected`);
    }

    a.busy = busy;
    if (a.hasStatus) return;

    if (a.state === 'wait') {
      if (this.time - a.waitAt < SETTLE) {
        a.waitBusy = busy;
        return;
      }
      if (busy === a.waitBusy) return;
    }
    this.setState(a, busy ? 'work' : 'done');
  }

  needsYou(a) {
    if (a.hasStatus) return;
    a.waitAt = this.time;
    a.waitBusy = a.busy;
    this.setState(a, 'wait');
  }
}
