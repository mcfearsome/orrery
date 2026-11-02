import { describe, expect, it } from 'vitest'
import { EnsembleSampler, autocorrTime, histogram, mulberry32, quantile, summarise } from './mcmc'

describe('ensemble sampler', () => {
  it('recovers a correlated 2-D Gaussian', () => {
    // target: mean (1, -2), σ = (0.5, 2), ρ = 0.8
    const s1 = 0.5, s2 = 2, rho = 0.8
    const logProb = ([x, y]: number[]) => {
      const u = (x - 1) / s1, v = (y + 2) / s2
      return -(u * u - 2 * rho * u * v + v * v) / (2 * (1 - rho * rho))
    }
    const rng = mulberry32(7)
    const nW = 24
    const x0 = Array.from({ length: nW }, () => [1 + (rng() - 0.5), -2 + (rng() - 0.5)])
    const samp = new EnsembleSampler(logProb, x0, { nWalkers: nW, seed: 3 })
    samp.step(1500)
    const flat = samp.flat(300)
    const a = summarise(flat, samp.chain, 0), b = summarise(flat, samp.chain, 1)
    expect(a.mean).toBeCloseTo(1, 1)
    expect(b.mean).toBeCloseTo(-2, 0)
    expect(a.std).toBeCloseTo(s1, 1)
    expect(Math.abs(b.std - s2)).toBeLessThan(0.3)
    const cov = flat.reduce((s, [x, y]) => s + (x - a.mean) * (y - b.mean), 0) / flat.length
    expect(cov / (a.std * b.std)).toBeCloseTo(rho, 1)
    expect(samp.acceptanceRate).toBeGreaterThan(0.2)
    expect(samp.acceptanceRate).toBeLessThan(0.8)
    expect(a.tau).toBeLessThan(60)
  })
  it('is reproducible from the seed', () => {
    const lp = ([x]: number[]) => -x * x / 2
    const mk = () => { const s = new EnsembleSampler(lp, [[0.1], [-0.2], [0.3], [0.05]], { nWalkers: 4, seed: 99 }); s.step(50); return s.flat(10) }
    expect(mk()).toEqual(mk())
  })
})

describe('stats helpers', () => {
  it('quantile and histogram', () => {
    expect(quantile([1, 2, 3, 4, 5], 0.5)).toBe(3)
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5)
    const h = histogram([0, 0.5, 1, 1, 2], 2, 0, 2)
    expect(h.counts).toEqual([2, 3])
  })
  it('autocorrelation time of white noise is ≈ 1', () => {
    const rng = mulberry32(1)
    const chain = Array.from({ length: 2000 }, () => [[rng()], [rng()]])
    expect(autocorrTime(chain, 0)).toBeLessThan(3)
  })
})
