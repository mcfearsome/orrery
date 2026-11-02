import { describe, expect, it } from 'vitest'
import { crossSection, drains, heightAt, heightField, slopeAt, undersideDensity } from './model'
import { OneSheetConfig } from './schema'

// bhThreshold above every mass here so no ridge term enters the pure-well tests
const one = (m = 2, softening = 0.5) => OneSheetConfig.parse({ masses: [{ x: 1, y: -1, m }], softening, exaggeration: 1, bhThreshold: 100 })

describe('one-sheet height field', () => {
  it('is a softened well: deepest exactly at the mass, depth m/ε, and symmetric around it', () => {
    const c = one()
    expect(heightAt(c.masses, c.softening, c.exaggeration, 1, -1)).toBeCloseTo(-4, 10)
    expect(heightAt(c.masses, c.softening, c.exaggeration, 4, -1)).toBeCloseTo(heightAt(c.masses, c.softening, c.exaggeration, -2, -1), 10)
    expect(heightAt(c.masses, c.softening, c.exaggeration, 4, -1)).toBeGreaterThan(-4)
  })

  it('adds wells linearly and scales with exaggeration', () => {
    const a = OneSheetConfig.parse({ masses: [{ x: 0, y: 0, m: 1 }], softening: 1 })
    const b = OneSheetConfig.parse({ masses: [{ x: 0, y: 0, m: 1 }, { x: 0, y: 0, m: 1 }], softening: 1, exaggeration: 2 })
    const ha = heightAt(a.masses, a.softening, a.exaggeration, 0.3, 0.4)
    const hb = heightAt(b.masses, b.softening, b.exaggeration, 0.3, 0.4)
    expect(hb).toBeCloseTo(4 * ha, 10)
  })

  it('analytic slope matches a finite difference and vanishes at the mass', () => {
    const c = one()
    const f = (x: number, y: number) => heightAt(c.masses, c.softening, c.exaggeration, x, y)
    const d = 1e-5
    const fd = Math.hypot((f(2.3 + d, 0.4) - f(2.3 - d, 0.4)) / (2 * d), (f(2.3, 0.4 + d) - f(2.3, 0.4 - d)) / (2 * d))
    expect(slopeAt(c.masses, c.softening, c.exaggeration, 2.3, 0.4)).toBeCloseTo(fd, 6)
    expect(slopeAt(c.masses, c.softening, c.exaggeration, 1, -1)).toBeCloseTo(0, 10)
  })

  it('grid matches the point function and reports the extrema', () => {
    const c = OneSheetConfig.parse({ masses: [{ x: 0, y: 0, m: 1 }], resolution: 33, sheetSize: 8, softening: 0.5, bhThreshold: 100 })
    const f = heightField(c)
    expect(f.h.length).toBe(33 * 33)
    expect(f.h[16 * 33 + 16]).toBeCloseTo(-2, 5) // centre vertex sits on the mass
    expect(f.min).toBeCloseTo(-2, 5)
    expect(f.h[0]).toBeCloseTo(heightAt(c.masses, c.softening, c.exaggeration, -4, -4), 5)
    expect(f.maxSlope).toBeGreaterThan(0)
    expect(f.slope[16 * 33 + 16]).toBeCloseTo(0, 5)
  })

  it('cross-section spans the sheet and is ≤ 0 everywhere', () => {
    const c = one()
    const s = crossSection(c, -1, 241) // step 0.1, so x = 1 is sampled
    expect(s.x[0]).toBe(-c.sheetSize / 2)
    expect(s.x[240]).toBe(c.sheetSize / 2)
    for (const v of s.h) expect(v).toBeLessThanOrEqual(0)
    expect(Math.min(...s.h)).toBeCloseTo(-4, 4)
  })

  it('drains are the masses at or above the threshold, and pooled energy raises a ridge between two of them', () => {
    const c = OneSheetConfig.parse({ masses: [{ x: -5, y: 0, m: 3 }, { x: 5, y: 0, m: 3 }, { x: 0, y: 6, m: 0.5 }], bhThreshold: 2, spread: 5, pooled: 1, ridge: 0.25, softening: 0.8 })
    const ds = drains(c)
    expect(ds.map((d) => d.x)).toEqual([-5, 5])
    expect(ds[0].throat).toBeCloseTo(0.45 * 0.8, 10)
    // the ring density peaks at `spread` from a drain and overlaps midway between the two
    expect(undersideDensity(ds, 5, 0, 0)).toBeCloseTo(6, 6)
    expect(undersideDensity(ds, 5, 0, 0)).toBeGreaterThan(undersideDensity(ds, 5, 0, 8))
    // midway, the ridge term lifts the sheet relative to the same masses with nothing pooled
    const flat = OneSheetConfig.parse({ ...c, pooled: 0 })
    const mid = crossSection(c, 0, 101).h[50], midFlat = crossSection(flat, 0, 101).h[50]
    expect(mid - midFlat).toBeCloseTo(0.25 * 6, 6)
  })
})
