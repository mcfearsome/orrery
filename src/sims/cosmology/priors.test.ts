import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { sampleFromJson, type SNEJson } from './data'
import { baoChi2, baoPredict, chi2Gaussian2, chi2Marginalised, earlyUniverse, lcdmDistanceTable, lcdmE, modelMu, nelderMead, omegaRadiation, PLANCK18_FIDUCIAL as F } from './model'
import { DESI_DR2_BAO, DESI_DR2_LCDM_OM, PLANCK18_DISTANCE_PRIORS as P18 } from './priors'

describe('early universe anchoring', () => {
  it('reproduces Planck 2018 R, l_A, r_d at the fiducial cosmology', () => {
    const h = F.H0 / 100
    const E = lcdmE({ H0: F.H0, Om: F.Om, Or: omegaRadiation(F.H0), Ok: 0 })
    const e = earlyUniverse(E, F.H0, F.Om * h * h, F.omegaB)
    expect(e.zStar).toBeCloseTo(F.zStar, 6)
    expect(e.rd).toBeCloseTo(F.rd, 2) // one anchor factor serves both horizons to 0.001%
    expect(e.rsStar).toBeCloseTo(F.rsStar, 6)
    expect(e.lA).toBeCloseTo(P18.lA, 2)
    expect(Math.abs(e.R - P18.R)).toBeLessThan(0.002) // 0.3σ: Planck's R and l_A means are not exactly consistent with one D_M
    expect(chi2Gaussian2(e.R - P18.R, P18.Rerr, e.lA - P18.lA, P18.lAerr, P18.rho)).toBeLessThan(0.3)
  })
  it('r_d scales with ω_m like the Aubourg et al. 2015 fit (∝ ω_m^-0.2535)', () => {
    const h = F.H0 / 100
    const Om2 = F.Om * 1.08
    const E = lcdmE({ H0: F.H0, Om: Om2, Or: omegaRadiation(F.H0), Ok: 0 })
    const e = earlyUniverse(E, F.H0, Om2 * h * h, F.omegaB)
    expect(Math.abs(e.rd / F.rd - 1.08 ** -0.2535)).toBeLessThan(1e-3)
  })
})

describe('DESI DR2 BAO', () => {
  it('BAO-alone flat ΛCDM fit reproduces the published Ωm = 0.2975 ± 0.0086', () => {
    const f = ([Om, H0]: number[]) => {
      const E = lcdmE({ H0, Om, Or: omegaRadiation(H0), Ok: 0 })
      const e = earlyUniverse(E, H0, Om * (H0 / 100) ** 2, F.omegaB)
      return baoChi2(DESI_DR2_BAO, DESI_DR2_BAO.map((p) => baoPredict(E, H0, e.rd, p.z)))
    }
    const r = nelderMead(f, [0.3, 68], { bounds: [[0.1, 0.6], [50, 90]], initialStep: [0.03, 2], tolF: 1e-8, tolX: 1e-5 })
    expect(Math.abs(r.x[0] - DESI_DR2_LCDM_OM.value)).toBeLessThan(DESI_DR2_LCDM_OM.err / 2)
    // 13 numbers, 2 parameters: DESI quote χ²_min ≈ 10.4 for ΛCDM
    expect(r.f).toBeGreaterThan(4)
    expect(r.f).toBeLessThan(20)
  })
})

describe('SN + CMB + BAO ΛCDM', () => {
  it('joint flat ΛCDM fit lands near the DESI+CMB Ωm = 0.3027 ± 0.0036, H0 = 68.17 ± 0.28', () => {
    const j = JSON.parse(readFileSync('data/pantheon_plus/sne.json', 'utf8')) as SNEJson
    const buf = readFileSync('data/pantheon_plus/chol_lower.f32')
    const s = sampleFromJson(j, buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))
    const f = ([Om, H0]: number[]) => {
      const p = { H0, Om, Or: omegaRadiation(H0), Ok: 0 }
      const E = lcdmE(p)
      const e = earlyUniverse(E, H0, Om * (H0 / 100) ** 2, F.omegaB)
      const sn = chi2Marginalised(s, modelMu(lcdmDistanceTable(p), s), true).chi2
      const cmb = chi2Gaussian2(e.R - P18.R, P18.Rerr, e.lA - P18.lA, P18.lAerr, P18.rho)
      const bao = baoChi2(DESI_DR2_BAO, DESI_DR2_BAO.map((q) => baoPredict(E, H0, e.rd, q.z)))
      return sn + cmb + bao
    }
    const r = nelderMead(f, [0.31, 68], { bounds: [[0.1, 0.6], [50, 90]], initialStep: [0.02, 1], tolF: 1e-8, tolX: 1e-5 })
    expect(Math.abs(r.x[0] - 0.3027)).toBeLessThan(0.012) // we lack the full Planck likelihood; a few σ is the honest tolerance
    expect(Math.abs(r.x[1] - 68.17)).toBeLessThan(1.0)
  })
})
