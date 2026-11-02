import type { OneSheetConfig, PointMass } from './schema'

/**
 * Height field of the sheet.
 *
 * ponytail: this is a softened Newtonian potential, NOT general relativity. Each mass contributes a
 * Plummer well Φ_k = −m_k / sqrt(r² + ε²); the sheet height is h = exaggeration · Σ Φ_k, so h ≤ 0,
 * deepest at the masses. Seen from the topside it is a well; the underside of the same surface is
 * the mirrored hill, so "equal and opposite" needs no second surface. Swap this function for an
 * embedding-diagram profile if the visual ever needs the GR shape.
 */
export function heightAt(masses: readonly PointMass[], softening: number, exaggeration: number, x: number, y: number): number {
  const e2 = softening * softening
  let phi = 0
  for (const k of masses) {
    const dx = x - k.x, dy = y - k.y
    phi -= k.m / Math.sqrt(dx * dx + dy * dy + e2)
  }
  return exaggeration * phi
}

/** |∇h| at (x, y): how stretched the sheet is. Analytic, ∂Φ_k/∂x = m_k·dx / (r² + ε²)^{3/2}. */
export function slopeAt(masses: readonly PointMass[], softening: number, exaggeration: number, x: number, y: number): number {
  const e2 = softening * softening
  let gx = 0, gy = 0
  for (const k of masses) {
    const dx = x - k.x, dy = y - k.y
    const inv = k.m / (dx * dx + dy * dy + e2) ** 1.5
    gx += dx * inv
    gy += dy * inv
  }
  return exaggeration * Math.hypot(gx, gy)
}

export interface HeightField {
  /** vertices per side */
  n: number
  /** side length; vertex (i, j) sits at x = −size/2 + i·size/(n−1), y likewise with j */
  size: number
  /** row-major h[j * n + i] */
  h: Float32Array
  /** row-major |∇h|, same layout */
  slope: Float32Array
  /** most negative h, for colour and camera scaling */
  min: number
  /** largest |∇h| */
  maxSlope: number
}

export function heightField(cfg: OneSheetConfig): HeightField {
  const { resolution: n, sheetSize: size, masses, softening, exaggeration } = cfg
  const h = new Float32Array(n * n)
  const slope = new Float32Array(n * n)
  const step = size / (n - 1)
  let min = 0, maxSlope = 0
  for (let j = 0; j < n; j++) {
    const y = -size / 2 + j * step
    for (let i = 0; i < n; i++) {
      const x = -size / 2 + i * step
      const v = heightAt(masses, softening, exaggeration, x, y)
      const s = slopeAt(masses, softening, exaggeration, x, y)
      h[j * n + i] = v
      slope[j * n + i] = s
      if (v < min) min = v
      if (s > maxSlope) maxSlope = s
    }
  }
  return { n, size, h, slope, min, maxSlope }
}

/** h along the line y = y0, sampled at `n` points across the sheet. Above the curve is topside, below is underside. */
export function crossSection(cfg: OneSheetConfig, y0: number, n = 256): { x: number[]; h: number[] } {
  const x: number[] = [], h: number[] = []
  for (let i = 0; i < n; i++) {
    const xi = -cfg.sheetSize / 2 + (i * cfg.sheetSize) / (n - 1)
    x.push(xi)
    h.push(heightAt(cfg.masses, cfg.softening, cfg.exaggeration, xi, y0))
  }
  return { x, h }
}
