// The LCD's colours and the two themes. Everything that paints reads these arrays, so setTheme() recolours in place.
export const LCD_BG = [0xAA, 0xB5, 0x9A], LCD_INK = [0x3A, 0x44, 0x33];

// 0 is the screen's own ink, 1..8 go to bots
export const INKS = [
  LCD_INK,
  [0x1E, 0x55, 0x62],               // teal
  [0x6A, 0x2C, 0x5E],               // plum
  [0x8C, 0x3A, 0x1C],               // rust
  [0x23, 0x36, 0x78],               // navy
  [0x7C, 0x1E, 0x36],               // wine
  [0x6A, 0x4C, 0x10],               // ochre
  [0x2C, 0x5A, 0x22],               // leaf
  [0x48, 0x34, 0x7A],               // violet
  [0x8E, 0x2B, 0x6A],               // the dinosaur's eye and mouth
  // the dinosaur's gradient, like the Rex icon
  [0x5A, 0x38, 0xA6], [0x9C, 0x2E, 0x82], [0xC0, 0x34, 0x5C], [0xC4, 0x5A, 0x1E], [0xA8, 0x74, 0x0C],
];

export const BOT_INKS = 8;
export const REX_INK = 9;
export const GRADIENT = 255;                                      // inkById value for the dinosaur
export const GRAD_FIRST = 10, GRAD_LAST = 14;
export const PALETTE = [LCD_BG, ...INKS];

// Dark is a backlit LCD: light inks, and the dither flips so lit areas glow. setTheme() edits the
// colours in place: after the first frame, follow it with screen.invalidate() and kitty.invalidate() (app.setTheme does).
const THEMES = {
  light: [LCD_BG, ...INKS].map(c => [...c]),
  dark: [
    [0x16, 0x1C, 0x17],
    [0x9C, 0xC4, 0x8C],
    [0x6C, 0xC8, 0xD8], [0xD8, 0x8C, 0xCC], [0xF0, 0x96, 0x64], [0x92, 0xA8, 0xF5],
    [0xF2, 0x80, 0x9C], [0xE6, 0xC2, 0x5E], [0x9C, 0xD8, 0x7C], [0xB8, 0x9C, 0xF5],
    [0xF2, 0x8C, 0xC6],
    [0xA8, 0x8C, 0xF5], [0xE0, 0x7C, 0xCC], [0xF2, 0x7C, 0x9C], [0xF5, 0xA2, 0x5C], [0xF5, 0xD2, 0x6C],
  ],
};

export let DARK = false;                                          // live binding: read by the dither

export function setTheme(name) {
  const colours = THEMES[name] || THEMES.light;
  PALETTE.forEach((c, i) => c.splice(0, 3, ...colours[i]));
  DARK = name === 'dark';
}
