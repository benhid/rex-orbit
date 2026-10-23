// FNV-1a
export function hash(str) {
  let h = 2166136261;
  for (const c of str) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// mulberry32
export function rng(seed) {
  return () => {
    seed = (seed + 0x6D2B79F5) >>> 0;
    let t = seed;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

const FACES = ['dots', 'visor', 'cyclops', 'screen'];
const EARS = ['none', 'headphones', 'bolts', 'bear'];
const ANTENNAS = ['none', 'single', 'double', 'bulb'];

export function identity(id) {
  const r = rng(hash(id)), pick = list => list[Math.floor(r() * list.length)];
  return { face: pick(FACES), ears: pick(EARS), antenna: pick(ANTENNAS), ring: r() < 0.25, albedo: 0.84 + r() * 0.16 };
}
