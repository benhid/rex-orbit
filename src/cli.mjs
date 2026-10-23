import { readFileSync } from 'node:fs';
import { constants } from 'node:os';
import { detectKittyGraphics } from './terminal/kitty.mjs';
import { findRex } from './agents/rex.mjs';

const NAME = 'rex-orbit';

const VERSION = (() => {
  try { return JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version; }
  catch { return '0.0.0'; }
})();

const HELP = `${NAME} ${VERSION}
Every Claude Code session running in Rex, as a little 3D bot orbiting on a pixel LCD.

Usage
  ${NAME} [options]

Options
  --fps <n>     frames per second, 1-120 (default 30)
  --theme <t>   auto (follow the terminal's background, the default), light or dark
  --no-dino     leave out the Rex dinosaur falling in the middle (saves some CPU)
  -h, --help    show this help
  -v, --version print the version

Keys
  t             switch between the light and dark theme
  q             quit

Runs inside Rex, which provides the Kitty graphics protocol it draws with.
`;

function fail(msg) {
  try { process.stdin.setRawMode?.(false); } catch {}
  process.stderr.write(`${NAME}: ${msg}\n`);
  process.exit(1);
}

export function parseArgs(argv) {
  const opts = { fps: 30, dino: true, theme: 'auto' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];

    const eq = a.startsWith('--') ? a.indexOf('=') : -1;
    const [flag, inline] = eq > 0 ? [a.slice(0, eq), a.slice(eq + 1)] : [a, undefined];
    if (inline !== undefined && flag !== '--fps' && flag !== '--theme') fail(`${flag} takes no value (got ${a})`);

    if (flag === '--no-dino') opts.dino = false;
    else if (flag === '--fps') {
      const v = inline ?? argv[++i], n = Number(v);
      if (!Number.isFinite(n) || n < 1 || n > 120) fail(`--fps needs a number between 1 and 120 (got ${v ?? 'nothing'})`);
      opts.fps = n;
    }
    else if (flag === '--theme') {
      const v = inline ?? argv[++i];
      if (!['auto', 'light', 'dark'].includes(v)) fail(`--theme needs auto, light or dark (got ${v ?? 'nothing'})`);
      opts.theme = v;
    }
    else if (flag === '-h' || flag === '--help') { process.stdout.write(HELP); process.exit(0); }
    else if (flag === '-v' || flag === '--version') { process.stdout.write(`${VERSION}\n`); process.exit(0); }
    else fail(`unknown option ${a} (try --help)`);
  }

  return opts;
}

const insideRex = () => process.env.TERM_PROGRAM === 'rex' || !!process.env.REX_SESSION;

export async function preflight() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) fail('needs an interactive terminal (stdin and stdout must be a TTY)');
  if (!insideRex()) fail('not running inside Rex; open it in a Rex pane');
  if (!findRex()) fail('cannot find the `rex` CLI on your PATH (it ships with Rex)');
  if (!(await detectKittyGraphics(process.stdin, process.stdout))) fail('no answer to the Kitty graphics query; rex-orbit needs a Rex version with Kitty graphics support');
}

// restore the terminal exactly once, however the process ends
export function onExit(restore) {
  let restored = false;
  const once = () => {
    if (restored) return;
    restored = true;
    try { restore(); } catch {}
    try { process.stdin.setRawMode?.(false); } catch {}
  };

  process.on('exit', once);
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => process.exit(128 + constants.signals[sig]));

  const crash = err => { once(); process.stderr.write(`${NAME}: ${err?.stack || err}\n`); process.exit(1); };
  process.on('uncaughtException', crash);
  process.on('unhandledRejection', crash);
}
