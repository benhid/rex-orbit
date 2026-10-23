const ORBIT_SPEED = 0.12;                                         // radians per second
const GROW = 0.7;                                                 // extra size after 45 s of needing you

export function step(store, dt) {
  const time = store.time += dt;
  store.orbitRot += dt * ORBIT_SPEED;

  const live = store.live();
  live.forEach((a, i) => {
    const target = (2 * Math.PI * i) / live.length;
    if (a.phase === null) a.phase = target;
    let d = target - a.phase;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    a.phase += d * (1 - Math.exp(-dt * 2));
  });

  for (const a of store.list) {
    a.enter = Math.min(1, a.enter + dt / 1.4);
    a.appear = a.leaving ? Math.max(0, a.appear - dt / 0.9) : Math.min(1, a.enter * 1.2);

    const k = 1 - Math.exp(-dt * 3), wait = a.state === 'wait', done = a.state === 'done', work = a.state === 'work';
    const scale = wait ? 1.1 + GROW * Math.min(1, (time - a.since) / 45) : done ? 0.8 : 1.35;
    a.scale += (scale - a.scale) * k;

    const yaw = work ? Math.sin(time * 0.55 + a.id * 1.7) * 0.6 : wait ? 0 : Math.sin(time * 0.25 + a.id) * 0.2;
    const pitch = wait ? 0.12 : done ? -0.05 : 0.04 * Math.sin(time * 0.8 + a.id);
    a.yaw += (yaw - a.yaw) * k;
    a.pitch += (pitch - a.pitch) * k;

    const look = work ? Math.sin(time * 1.4 + a.id * 2.3) * 0.07 : 0;
    a.look += (look - a.look) * k;

    if (time > a.nextBlink) {
      a.blinkUntil = time + 0.13;
      a.nextBlink = time + 2.5 + Math.random() * 3.5;
    }
    a.open = !wait && time < a.blinkUntil ? 0.1 : 1;
    a.pulse = wait ? Math.sin(time * 6) : 0;
  }

  store.list = store.list.filter(a => !(a.leaving && a.appear <= 0));
}
