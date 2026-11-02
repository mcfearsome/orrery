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
})
export type OneSheetConfig = z.infer<typeof OneSheetConfig>
