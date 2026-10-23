import { LCD_BG } from '../render/palette.mjs';

export const ESC = '\x1b';
export const fg = c => `${ESC}[38;2;${c[0]};${c[1]};${c[2]}m`;
export const bg = c => `${ESC}[48;2;${c[0]};${c[1]};${c[2]}m`;

export const clear = () => `${bg(LCD_BG)}${ESC}[2J`;
export const enter = () => `${ESC}[?1049h${ESC}[?25l${clear()}`;   // alternate screen, hidden cursor
export const RESTORE = `${ESC}[0m${ESC}[2J${ESC}[?25h${ESC}[?1049l`;

// Write a query and resolve with what parse() makes of the reply, or null after timeoutMs.
function ask(stdin, stdout, query, parse, timeoutMs) {
  return new Promise(resolve => {
    let buf = '';

    const done = v => { stdin.off('data', onData); clearTimeout(timer); resolve(v); };
    const onData = d => {
      buf += d.toString('latin1');
      const v = parse(buf);
      if (v != null) done(v);
    };
    const timer = setTimeout(() => done(null), timeoutMs);

    stdin.on('data', onData);
    stdout.write(query);
  });
}

// 'dark' or 'light' from the terminal's background colour (OSC 11)
export function queryBackground(stdin, stdout, timeoutMs = 300) {
  return ask(stdin, stdout, `${ESC}]11;?${ESC}\\`, buf => {
    const m = /\x1b\]11;rgb:([0-9a-f]+)\/([0-9a-f]+)\/([0-9a-f]+)/i.exec(buf);
    if (!m) return null;

    const [r, g, b] = m.slice(1).map(h => parseInt(h, 16) / (16 ** h.length - 1));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b < 0.45 ? 'dark' : 'light';
  }, timeoutMs);
}

// { w, h } of a cell in pixels (CSI 16 t)
export function queryCellSize(stdin, stdout, timeoutMs = 400) {
  return ask(stdin, stdout, `${ESC}[16t`, buf => {
    const m = /\x1b\[6;(\d+);(\d+)t/.exec(buf);
    return m && +m[1] > 0 && +m[2] > 0 ? { h: +m[1], w: +m[2] } : null;   // some terminals answer 0;0
  }, timeoutMs);
}
