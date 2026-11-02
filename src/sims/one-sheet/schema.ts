import { z } from 'zod'

/** A point mass on the sheet's (x, y) plane. */
export const PointMass = z.object({
  x: z.number(),
  y: z.number(),
  /** mass in arbitrary units; the well depth at the centre is m / softening */
  m: z.number().positive(),
})
export type PointMass = z.infer<typeof PointMass>

/**
 * One sheet, two sides. Our universe is the topside, the dark universe the underside of the same
 * surface: a well on top is a hill underneath for free. Height field h(x, y) in model.ts.
 */
export const OneSheetConfig = z.object({
  masses: z.array(PointMass).max(500).default(() => [
    { x: -4, y: -2, m: 3 },
    { x: 5, y: 3, m: 1.5 },
    { x: 0, y: 4.5, m: 0.8 },
  ]),
  /** side length of the square sheet */
  sheetSize: z.number().min(2).max(200).default(24),
  /** vertices per side of the height-field grid */
  resolution: z.number().int().min(8).max(512).default(160),
  /** Plummer softening length; keeps the well finite at a mass */
  softening: z.number().min(0.05).max(20).default(0.8),
  /** vertical scale of the displacement, h = −exaggeration · Φ */
  exaggeration: z.number().min(0).max(20).default(1),
  /** how transparent the sheet becomes where it is stretched thin (|∇h| high); 0 = opaque everywhere */
  translucency: z.number().min(0).max(1).default(0.8),
  /** masses at or above this are black holes: the sheet tears and drains topside → underside */
  bhThreshold: z.number().positive().default(2),
  /** throat radius of a drain, in units of the softening length */
  throat: z.number().min(0.05).max(3).default(0.45),
  /** drained particles per second per black hole */
  leakRate: z.number().min(1).max(100000).default(800),
  /** total GPU particles shared by all drains (1k–200k) */
  particles: z.number().int().min(1000).max(200000).default(60000),
  /** how far drained energy spreads on the underside before it pools (ring radius) */
  spread: z.number().min(0.5).max(50).default(5),
  /** 0–1: how much underside energy has pooled so far; scales the topside ridge */
  pooled: z.number().min(0).max(1).default(0.5),
  /** height of the topside ridge raised by a fully pooled drain, per unit black-hole mass */
  ridge: z.number().min(0).max(5).default(0.25),
  /** expansion: fractional growth of the scale factor per second while playing (0 = static) */
  expandRate: z.number().min(0).max(1).default(0),
  /** how fast `pooled` rises per second while playing (0 = static) */
  poolRate: z.number().min(0).max(1).default(0),
  /** nested universes: how many child sheets the cycle spawns while playing (0 = off) */
  cycleDepth: z.number().int().min(0).max(6).default(0),
  /** seconds per cycle: ocean pools, bursts up, a child sheet unfurls */
  cyclePeriod: z.number().min(2).max(60).default(8),
  /** each child sheet's size relative to its parent */
  cycleShrink: z.number().min(0.2).max(0.8).default(0.45),
})
export type OneSheetConfig = z.infer<typeof OneSheetConfig>
