import { execFile, spawn } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

// on PATH, or in REX_BIN_DIR, which Rex sets in its panes
export function findRex(env = process.env) {
  const dirs = [...(env.PATH || '').split(path.delimiter), env.REX_BIN_DIR].filter(Boolean);
  for (const dir of dirs) {
    const file = path.join(dir, 'rex');
    try { accessSync(file, constants.X_OK); return file; } catch {}
  }
  return null;
}

let REX = 'rex';

// every terminal pane in every session, in one call
const SCAN_LUA = `
local out = {}
for _, s in ipairs(rex.call("session.list").sessions or {}) do
  local blocks = {}
  for _, b in ipairs(rex.call("session.list_blocks", { session_id = s.session_id }).blocks or {}) do
    if b.creator_name == "com.superlogical.terminal" then
      local function m(name)
        local ok, r = pcall(rex.call, "block.method", { session_id = s.session_id, block_id = b.block_id, method = name })
        return ok and r or nil
      end
      table.insert(blocks, { block_id = b.block_id, title = m("title"), status = m("program_status") })
    end
  end
  table.insert(out, { session_id = s.session_id, label = s.label, blocks = blocks })
end
return { sessions = out }`;

// our own rex calls show up as client events, so only layout changes trigger a rescan
const LAYOUT_EVENTS = /^(session_(created|destroyed|label_changed)|block_(created|closed)|window_(created|closed))$/;
const RESCAN_DELAY = 300, SAFETY_RESCAN = 60000, RECONNECT_DELAY = 2000;   // ms

// Lua sends an empty list as {}
const list = v => Array.isArray(v) ? v : [];

export function applyScan(store, res) {
  const seen = new Set();
  store.sessionLabels.clear();                                    // only sessions that still exist

  for (const s of list(res.sessions)) {
    store.sessionLabels.set(s.session_id, s.label || s.session_id.slice(-6));
    for (const b of list(s.blocks)) {
      if (b.title?.owner?.name !== 'claude') continue;
      seen.add(b.block_id);
      const isNew = !store.byBlock.has(b.block_id);
      const a = store.upsert(s.session_id, b.block_id);
      a.session = s.session_id;
      store.applyStatus(a, b.status?.records);
      if (isNew || !a.hasStatus) store.applyTitle(a, b.title.title);
    }
  }

  for (const a of store.live()) if (!seen.has(a.block)) store.drop(a.block);
}

// true when a scan should decide
export function applyEvent(store, e) {
  if (e.type !== 'session_event') return LAYOUT_EVENTS.test(e.type);

  const sid = e.payload?.session_id, ev = e.payload?.event;
  if (ev?.type !== 'block_event') return LAYOUT_EVENTS.test(ev?.type || '');

  const { block_id: bid, name, payload: pl = {} } = ev.payload || {};
  const a = store.byBlock.get(bid);
  switch (name) {
    case 'title_changed':
      if (pl.owner?.name === 'claude') { store.applyTitle(store.upsert(sid, bid), pl.title); return false; }
      return !!a;                                                 // maybe claude quit
    case 'desktop_notification': case 'bell': if (a) store.needsYou(a); return false;
    case 'program_status_changed': if (a) store.applyStatus(a, [pl.record || pl].filter(r => r && r.state)); return false;
    case 'program_status_removed': if (a) store.statusRemoved(a); return false;
    case 'process_changed': return !!a && pl.foreground?.name !== 'claude';
    case 'child_exited': if (a) store.drop(bid); return false;
  }
  return false;
}

const rex = args => new Promise(res => execFile(REX, args, { timeout: 8000 }, (err, so) => res(err ? null : so)));

/** Keep `store` in sync with the Claude Code panes in Rex; returns a function that stops (call it on exit). */
export function followRex(store, bin = findRex() || 'rex') {
  REX = bin;
  let scanning = false, scanAgain = false, rescanTimer = null, events = null, stopped = false;

  async function rescan() {
    if (scanning) {
      scanAgain = true;
      return;
    }
    scanning = true;
    try {
      const so = await rex(['do', '-e', SCAN_LUA, '--json']);
      if (stopped) return;
      let res;
      try { res = JSON.parse(so); } catch { return; }
      try { if (res) applyScan(store, res); } catch {}
    } finally {
      scanning = false;
      if (scanAgain && !stopped) {
        scanAgain = false;
        scheduleRescan();
      }
    }
  }

  function scheduleRescan() {
    clearTimeout(rescanTimer);
    rescanTimer = setTimeout(rescan, RESCAN_DELAY);
  }

  function follow() {
    if (stopped) return;
    const p = events = spawn(REX, ['events', '--all', '--json'], { stdio: ['ignore', 'pipe', 'ignore'] });
    p.on('error', () => {});
    readline.createInterface({ input: p.stdout }).on('line', line => {
      let e;
      try { e = JSON.parse(line); } catch { return; }
      try { if (e && applyEvent(store, e)) scheduleRescan(); } catch {}
    });
    p.on('close', () => setTimeout(() => { if (!stopped) { follow(); rescan(); } }, RECONNECT_DELAY));
  }

  follow();
  rescan();
  const safety = setInterval(rescan, SAFETY_RESCAN);

  // children outlive us unless killed
  return () => {
    stopped = true;
    clearInterval(safety);
    clearTimeout(rescanTimer);
    events?.kill();
  };
}
