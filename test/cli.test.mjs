import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const BIN = fileURLToPath(new URL('../bin/rex-orbit.mjs', import.meta.url));
const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const run = (...args) => spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8' });

test('cli: help, version, bad flags and no TTY', () => {
  assert.match(run('--help').stdout, /^rex-orbit .*\n[\s\S]*--theme <t>/);
  assert.equal(run('--version').stdout, `${version}\n`);
  for (const [args, msg] of [[['--fps', '0'], /between 1 and 120/], [['--theme', 'pink'], /auto, light or dark/], [['--bogus'], /unknown option/]]) {
    const r = run(...args);
    assert.equal(r.status, 1); assert.equal(r.stdout, ''); assert.match(r.stderr, msg);
  }
  const r = run();                                                // stdout is a pipe here, not a TTY
  assert.equal(r.status, 1); assert.equal(r.stdout, ''); assert.match(r.stderr, /needs an interactive terminal/);
});

// process.emit runs the handlers without sending a real signal
test('cli: the terminal is restored exactly once on SIGTERM, Ctrl-C and a crash', () => {
  const CLI = new URL('../src/cli.mjs', import.meta.url).href;
  const end = (how, code, stderr) => {
    const src = `import { onExit } from ${JSON.stringify(CLI)};
      onExit(() => process.stdout.write('restored;'));
      setTimeout(() => {}, 1500);                             // exits by itself if nothing ends it
      ${how}`;
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', src], { encoding: 'utf8', timeout: 10000 });
    assert.equal(r.stdout, 'restored;', how);
    assert.equal(r.status, code, how);
    if (stderr) assert.match(r.stderr, stderr);
  };
  end("process.emit('SIGTERM');", 143);
  end("process.emit('SIGINT');", 130);
  end("setImmediate(() => { throw new Error('boom'); });", 1, /rex-orbit: Error: boom/);
  end("Promise.reject(new Error('later'));", 1, /later/);
});
