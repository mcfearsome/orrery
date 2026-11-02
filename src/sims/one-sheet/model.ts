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

/** A black hole: a mass at or above the threshold, with its throat radius. */
export interface Drain { x: number; y: number; m: number; throat: number }

export function drains(cfg: OneSheetConfig): Drain[] {
  return cfg.masses.filter((m) => m.m >= cfg.bhThreshold).map((m) => ({ x: m.x, y: m.y, m: m.m, throat: cfg.throat * cfg.softening }))
}

/**
 * Underside energy pooled by the drains, as a smooth density on the sheet. Energy drains at a
 * black hole, drifts outward on the underside and settles at about `spread` from it, so each drain
 * contributes a ring (Gaussian in distance around radius `spread`, width spread/2) weighted by its
 * mass. Rings from neighbouring galaxies overlap between them: that is where the pool is deepest.
 */
export function undersideDensity(ds: readonly Drain[], spread: number, x: number, y: number): number {
  const w2 = 2 * (spread / 2) ** 2
  let rho = 0
  for (const d of ds) {
    const r = Math.hypot(x - d.x, y - d.y) - spread
    rho += d.m * Math.exp(-(r * r) / w2)
  }
  return rho
}

/**
 * Pooled underside energy as it shows on the topside. Underside matter pulls the sheet toward the
 * underside's own "down", which is our up, so the term is POSITIVE in h: a ridge between galaxies.
 */
export function ridgeAt(cfg: OneSheetConfig, ds: readonly Drain[], x: number, y: number): number {
  return cfg.ridge * cfg.pooled * undersideDensity(ds, cfg.spread, x, y)
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
  const ds = drains(cfg)
  const h = new Float32Array(n * n)
  const slope = new Float32Array(n * n)
  const step = size / (n - 1)
  let min = 0, maxSlope = 0
  for (let j = 0; j < n; j++) {
    const y = -size / 2 + j * step
    for (let i = 0; i < n; i++) {
      const x = -size / 2 + i * step
      const v = heightAt(masses, softening, exaggeration, x, y) + ridgeAt(cfg, ds, x, y)
      const s = slopeAt(masses, softening, exaggeration, x, y)
      h[j * n + i] = v
      slope[j * n + i] = s
      if (v < min) min = v
      if (s > maxSlope) maxSlope = s
    }
  }
  return { n, size, h, slope, min, maxSlope }
}

/**
 * The field as it stands at scale factor `scale` with `pooled` underside energy: galaxy positions and
 * the sheet scale with space, the wells (softening) and throats do not. Positions only; no dynamics.
 */
export function expanded(cfg: OneSheetConfig, scale: number, pooled: number): OneSheetConfig {
  if (scale === 1 && pooled === cfg.pooled) return cfg
  return { ...cfg, masses: cfg.masses.map((m) => ({ ...m, x: m.x * scale, y: m.y * scale })), sheetSize: cfg.sheetSize * scale, pooled }
}

/** Total sheet height at a point: wells from the masses plus the ridge from pooled underside energy. */
export function totalHeightAt(cfg: OneSheetConfig, ds: readonly Drain[], x: number, y: number): number {
  return heightAt(cfg.masses, cfg.softening, cfg.exaggeration, x, y) + ridgeAt(cfg, ds, x, y)
}

/** h along the line y = y0, sampled at `n` points across the sheet. Above the curve is topside, below is underside. */
export function crossSection(cfg: OneSheetConfig, y0: number, n = 256): { x: number[]; h: number[] } {
  const ds = drains(cfg)
  const x: number[] = [], h: number[] = []
  for (let i = 0; i < n; i++) {
    const xi = -cfg.sheetSize / 2 + (i * cfg.sheetSize) / (n - 1)
    x.push(xi)
    h.push(totalHeightAt(cfg, ds, xi, y0))
  }
  return { x, h }
}

/**
 * Where the nested-universe cycle stands at time t: `level` is the child being born (1-based, 0 before
 * the first), `phase` its progress in [0, 1]; finished levels stay. Pure animation timing, no physics.
 */
export function cyclePhase(t: number, period: number, depth: number): { level: number; phase: number } {
  if (depth <= 0 || t <= 0) return { level: 0, phase: 0 }
  const level = Math.min(depth, Math.floor(t / period) + 1)
  return { level, phase: Math.min(1, (t - (level - 1) * period) / period) }
}

/** Size and lift of child sheet k (k ≥ 1) relative to the root sheet, so each nests inside and just above its parent. */
export function nestedSheet(k: number, shrink: number, lift: number): { scale: number; y: number } {
  let y = 0
  for (let j = 0; j < k; j++) y += lift * shrink ** j
  return { scale: shrink ** k, y }
}
