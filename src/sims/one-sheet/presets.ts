import type { OneSheetConfig, PointMass } from './schema'

/** mulberry32: a seeded PRNG so a preset is the same field every time */
function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** `n` galaxies scattered over a square of side `size`, no two closer than `minSep`. */
export function galaxyField(n: number, size: number, minSep: number, seed = 7): PointMass[] {
  const r = rng(seed)
  const out: PointMass[] = []
  for (let tries = 0; out.length < n && tries < n * 200; tries++) {
    const x = (r() - 0.5) * size * 0.85, y = (r() - 0.5) * size * 0.85
    if (out.some((m) => Math.hypot(m.x - x, m.y - y) < minSep)) continue
    out.push({ x, y, m: 0.8 + 2.4 * r() * r() })
  }
  return out
}

export const PRESETS: Record<string, Partial<OneSheetConfig>> = {
  /** step 1: three masses, no black hole */
  sheet: { bhThreshold: 100 },
  /** step 2: the same three masses, the heavy one a drain */
  drain: {},
  /** s03: a galaxy field, every galaxy a drain, space expanding and the underside pooling */
  cosmic: {
    masses: galaxyField(40, 60, 6),
    sheetSize: 60,
    resolution: 192,
    softening: 0.6,
    exaggeration: 0.7,
    translucency: 0.7,
    bhThreshold: 0.5,
    throat: 0.45,
    leakRate: 300,
    particles: 120000,
    spread: 4.5,
    pooled: 0,
    ridge: 0.18,
    expandRate: 0.04,
    poolRate: 0.05,
  },
  /** s12: the underside ocean bursts up and a smaller universe unfurls inside this one, three deep */
  cycle: {
    masses: galaxyField(18, 40, 5, 11),
    sheetSize: 40,
    resolution: 160,
    softening: 0.6,
    exaggeration: 0.7,
    translucency: 0.7,
    bhThreshold: 0.5,
    leakRate: 300,
    particles: 60000,
    spread: 4,
    pooled: 1,
    ridge: 0.15,
    cycleDepth: 3,
    cyclePeriod: 8,
    cycleShrink: 0.45,
  },
}
export type PresetId = keyof typeof PRESETS
