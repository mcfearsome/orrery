import { describe, expect, it } from 'vitest'
import {
  bhMassFraction,
  bhFormationRateNormalised,
  chi2Marginalised,
  distanceModulus,
  forwardSubstitute,
  integrateLeak,
  lcdmDistanceTable,
  leakDistanceTable,
  luminosityDistanceMpc,
  nelderMead,
  type SNSample,
} from './model'
import { LCDMParams, LeakModelParams } from './schema'

// Reference values computed once with astropy 8.0.2:
//   FlatLambdaCDM(H0=67.4, Om0=0.315, Tcmb0=0).distmod(z)
//   LambdaCDM(H0=67.4, Om0=0.315, Ode0=0.6,  Tcmb0=0)  -> Ok = +0.085
//   LambdaCDM(H0=67.4, Om0=0.315, Ode0=0.75, Tcmb0=0)  -> Ok = -0.065
//   FlatLambdaCDM(H0=67.4, Om0=0.315, Tcmb0=2.7255, Neff=3.046, m_nu=0) -> Or = 9.209605e-5
const ASTROPY = {
  flat: { 0.1: 38.39497, 0.5: 42.33217, 1.0: 44.16335, 2.0: 46.01193 },
  flatDLAtZ1Mpc: 6802.5258,
  open: { 0.5: 42.30269, 1.0: 44.12811 },
  closed: { 0.5: 42.3556, 1.0: 44.19148 },
  withRadiationZ1: 44.16314,
}

describe('ΛCDM distances vs astropy', () => {
  it('flat Planck-18 distance modulus within 0.01 mag (brief) and actually within 0.001', () => {
    const t = lcdmDistanceTable(LCDMParams.parse({}))
    for (const [z, mu] of Object.entries(ASTROPY.flat)) {
      expect(Math.abs(distanceModulus(t, Number(z)) - mu)).toBeLessThan(0.001)
    }
    expect(luminosityDistanceMpc(t, 1)).toBeCloseTo(ASTROPY.flatDLAtZ1Mpc, 1)
  })
  it('open universe (sinh) matches', () => {
    const t = lcdmDistanceTable(LCDMParams.parse({ Ok: 0.085 }))
    for (const [z, mu] of Object.entries(ASTROPY.open)) expect(distanceModulus(t, Number(z))).toBeCloseTo(mu, 3)
  })
  it('closed universe (sin) matches', () => {
    const t = lcdmDistanceTable(LCDMParams.parse({ Ok: -0.065 }))
    for (const [z, mu] of Object.entries(ASTROPY.closed)) expect(distanceModulus(t, Number(z))).toBeCloseTo(mu, 3)
  })
  it('radiation term matches', () => {
    const t = lcdmDistanceTable(LCDMParams.parse({ Or: 9.209605e-5 }))
    expect(distanceModulus(t, 1)).toBeCloseTo(ASTROPY.withRadiationZ1, 3)
  })
})

describe('black-hole formation history', () => {
  it('is a normalised rate whose cumulative reaches 1 today and is ~0 at z=30', () => {
    expect(bhMassFraction(0)).toBeCloseTo(1, 4)
    expect(bhMassFraction(29.9)).toBeLessThan(1e-3)
    expect(bhMassFraction(2)).toBeGreaterThan(0.2)
    expect(bhMassFraction(2)).toBeLessThan(0.8)
    expect(bhFormationRateNormalised(1.9)).toBeGreaterThan(bhFormationRateNormalised(0))
  })
})

describe('leak model', () => {
  it('with no source is Einstein–de Sitter with H0_eff = H0·√Ωm', () => {
    const p = LeakModelParams.parse({ leak: { alpha: 0, beta: 0, gamma: 0 } })
    const h = integrateLeak(p.leak)
    expect(h.omega0).toBe(0)
    const t = leakDistanceTable(p)
    const ref = lcdmDistanceTable(LCDMParams.parse({ H0: 67.4 * Math.sqrt(0.315), Om: 1, Ok: 0 }))
    for (const z of [0.05, 0.5, 1.5]) expect(distanceModulus(t, z)).toBeCloseTo(distanceModulus(ref, z), 6)
  })
  it('γ = 0 keeps the leaked energy constant once formed; γ = 3 dilutes it like matter', () => {
    const base = { alpha: 0.03, beta: 0 }
    const l0 = integrateLeak({ ...base, gamma: 0 })
    const l3 = integrateLeak({ ...base, gamma: 3 })
    expect(l3.omega0).toBeLessThan(l0.omega0)
    // Ω_leak is monotonically non-decreasing with γ = 0
    for (let i = 1; i < l0.omega.length; i++) expect(l0.omega[i]).toBeGreaterThanOrEqual(l0.omega[i - 1] - 1e-15)
  })
})

describe('likelihood', () => {
  it('forward substitution inverts a packed Cholesky factor', () => {
    // C = [[4,2],[2,3]] -> L = [[2,0],[1,sqrt(2)]]
    const L = new Float32Array([2, 1, Math.SQRT2])
    const y = forwardSubstitute(L, new Float64Array([2, 3]))
    expect(y[0]).toBeCloseTo(1)
    expect(y[1]).toBeCloseTo(2 / Math.SQRT2)
  })
  it('marginalised χ² is zero for data offset by a constant', () => {
    const n = 50
    const sample: SNSample = {
      cid: [], z: new Float64Array(n), zHel: new Float64Array(n),
      mu: new Float64Array(n), muErr: new Float64Array(n).fill(0.1), cholLower: null,
    }
    const model = new Float64Array(n)
    for (let i = 0; i < n; i++) { model[i] = 40 + i * 0.1; sample.mu[i] = model[i] + 0.37 }
    const r = chi2Marginalised(sample, model, false)
    expect(r.chi2).toBeCloseTo(0, 8)
    expect(r.deltaM).toBeCloseTo(0.37, 8)
  })
})

describe('Nelder–Mead', () => {
  it('minimises Rosenbrock', () => {
    const r = nelderMead(([x, y]) => (1 - x) ** 2 + 100 * (y - x * x) ** 2, [-1.2, 1], { maxIter: 2000, tolF: 1e-10, tolX: 1e-8 })
    expect(r.x[0]).toBeCloseTo(1, 3)
    expect(r.x[1]).toBeCloseTo(1, 3)
  })
  it('respects bounds', () => {
    const r = nelderMead(([x]) => (x - 5) ** 2, [0.5], { bounds: [[0, 1]] })
    expect(r.x[0]).toBeCloseTo(1, 3)
  })
})

describe('w0wa (CPL)', () => {
  it('reduces to ΛCDM at w0 = −1, wa = 0', async () => {
    const { cplDistanceTable, cplDensityRatio } = await import('./model')
    const t = cplDistanceTable({ H0: 67.4, Om: 0.315, Or: 0, w0: -1, wa: 0 })
    const l = lcdmDistanceTable(LCDMParams.parse({}))
    for (const z of [0.3, 1, 2]) expect(distanceModulus(t, z)).toBeCloseTo(distanceModulus(l, z), 8)
    expect(cplDensityRatio(1.5, -1, 0)).toBeCloseTo(1, 12)
    expect(cplDensityRatio(1, 0, 0)).toBeCloseTo(8, 10) // w = 0 dilutes like matter: (1+z)^3
  })
})
