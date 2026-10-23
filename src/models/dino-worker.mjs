import { parentPort } from 'node:worker_threads';
import { bake, POSES } from './dino.mjs';

let current = 0;

parentPort.on('message', ({ job, U, from }) => {
  current = job;
  let k = 0;
  const next = () => {
    if (job !== current || k >= POSES) return;
    const f = (from + k++) % POSES, sprite = bake(U, f);
    parentPort.postMessage({ job, f, sprite }, [sprite.grid.buffer, sprite.rowStart.buffer, sprite.normal.buffer, sprite.depth.buffer, sprite.kind.buffer]);
    setImmediate(next);                                           // let a newer job in
  };
  next();
});
