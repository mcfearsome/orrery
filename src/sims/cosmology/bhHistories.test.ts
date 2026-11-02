import { describe, expect, it } from 'vitest'
import { BH_HISTORY_IDS, HISTORY_TABLES, Pchip, tabulatedHistory } from './bhHistories'
import { bhHistory, integrateLeak } from './model'

describe('Pchip', () => {
  it('passes through the nodes and preserves monotonicity', () => {
    const p = new Pchip([0, 1, 2, 3], [5, 4, 4, 1])
    expect(p.eval(1)[0]).toBeCloseTo(4)
    for (let x = 0; x < 3; x += 0.05) expect(p.eval(x + 0.05)[0]).toBeLessThanOrEqual(p.eval(x)[0] + 1e-12)
    expect(p.eval(1.5)[1]).toBe(0) // flat segment keeps a zero slope
  })
})

describe('tabulated BH histories', () => {
  for (const id of ['shankar2009_smbh', 'sicilia2022_smbh', 'sicilia2022_stellar', 'sicilia2022_total'] as const) {
    it(`${id}: f(0)=1, decreasing, rate ≥ 0 and integrates to ≈ 1`, () => {
      const h = tabulatedHistory(id)
      expect(h.fraction(0)).toBeCloseTo(1, 6)
      let prev = 1
      for (let z = 0.1; z <= 12; z += 0.1) { const f = h.fraction(z); expect(f).toBeLessThanOrEqual(prev + 1e-9); expect(h.ratePerLnA(z)).toBeGreaterThanOrEqual(0); prev = f }
      expect(h.fraction(12)).toBeLessThan(0.05)
      // ∫ rate d(ln a) from z = 30 to 0 should equal f(0) − f(30) ≈ 1
      const xMin = -Math.log(31), n = 6000, dx = -xMin / n
      let s = 0
      for (let i = 0; i <= n; i++) s += (i === 0 || i === n ? 1 : i % 2 ? 4 : 2) * h.ratePerLnA(Math.exp(-(xMin + i * dx)) - 1)
      expect((s * dx) / 3).toBeCloseTo(1, 2)
    })
  }
  it('tables keep their digitised anchor values', () => {
    expect(10 ** HISTORY_TABLES.shankar2009_smbh.logRho0).toBeCloseTo(4.498e5, -3)
    expect(HISTORY_TABLES.shankar2009_smbh.z.at(-1)).toBe(6)
    expect(HISTORY_TABLES.sicilia2022_stellar.z.at(-1)).toBe(10)
  })
  it('every id resolves and the SFR proxy is the default', () => {
    for (const id of BH_HISTORY_IDS) expect(bhHistory(id).id).toBe(id)
    const a = integrateLeak({ alpha: 0.03, beta: 0, gamma: 0 })
    const b = integrateLeak({ alpha: 0.03, beta: 0, gamma: 0 }, 3000, bhHistory('sfr_proxy'))
    expect(a.omega0).toBe(b.omega0)
  })
})
