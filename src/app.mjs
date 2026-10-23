import { AgentStore } from './agents/store.mjs';
import { step } from './agents/motion.mjs';
import { Screen, PX } from './render/screen.mjs';
import { BOT_INKS, setTheme } from './render/palette.mjs';
import { drawScene } from './scene.mjs';
import { KittyLayers } from './terminal/kitty.mjs';
import { Dino } from './models/dino.mjs';

const MIN_ROWS = 4, MIN_W = 64, MIN_H = 48;                       // smallest image area (cells) and scene (LCD pixels)

// the last row is the status line
export const imageArea = (columns, rows) => ({ cols: columns, rows: Math.max(MIN_ROWS, rows - 1) });

// size the scene, in LCD pixels, to an image area of cols×rows cells
export const fitScreen = (screen, cols, rows, cell) =>
  screen.resize(Math.max(MIN_W, Math.floor(cols * cell.w / PX)), Math.max(MIN_H, Math.floor(rows * cell.h / PX)));

// Everything but the I/O, for a pane of a given size: the bin connects it to the terminal and to Rex.
export function createApp({ dino = false } = {}) {
  const store = new AgentStore({ inks: BOT_INKS }), screen = new Screen(), kitty = new KittyLayers(), model = dino ? new Dino() : null;
  const cell = { w: 8, h: 16 };                                   // pixels, until the terminal tells us

  return {
    store, screen, kitty, cell,
    step: dt => step(store, dt),

    // the palette changes in place, so every pixel and label has to be sent again
    setTheme(name) {
      setTheme(name);
      screen.invalidate();
      kitty.invalidate();
    },

    frame(cols, rows) {
      fitScreen(screen, cols, rows, cell);
      drawScene(screen, store, model);
      return kitty.frame(screen, cols, rows, cell, store.time);
    },
  };
}
