/**
 * Reproduces the textbook Pantheon+ flat-ΛCDM fit through the TypeScript pipeline.
 * Reference numbers from an independent numpy/astropy computation on the same files:
 *   full STAT+SYS covariance, zHD > 0.01 (n = 1590), M marginalised,
 *   d_L = (1 + zHEL) · D_M(zHD) as in the Pantheon+ likelihood:
 *     χ²(Ωm = 0.315) = 1403.769 (diagonal-only 1333.324)
 *     best-fit Ωm = 0.33158 with χ² = 1402.919
 *   Brout et al. 2022 (ApJ 938, 110) report Ωm = 0.334 ± 0.018 for SN-only flat ΛCDM.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { sampleFromJson, type SNEJson } from './data'
import { chi2Marginalised, lcdmDistanceTable, modelMu, nelderMead } from './model'
import { LCDMParams } from './schema'

function loadSample() {
  const j = JSON.parse(readFileSync('data/pantheon_plus/sne.json', 'utf8')) as SNEJson
  const buf = readFileSync('data/pantheon_plus/chol_lower.f32')
  return sampleFromJson(j, buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))
}

describe('Pantheon+ ΛCDM', () => {
  const sample = loadSample()
  it('has the cut sample', () => {
    expect(sample.z.length).toBe(1590)
    expect(sample.cholLower).not.toBeNull()
  })
  it('χ² at Planck Ωm matches the numpy reference', () => {
    const t = lcdmDistanceTable(LCDMParams.parse({ Om: 0.315 }))
    const r = chi2Marginalised(sample, modelMu(t, sample), true)
    expect(Math.abs(r.chi2 - 1403.769)).toBeLessThan(0.05)
    expect(Math.abs(r.chi2Diag - 1333.324)).toBeLessThan(0.05)
  })
  it('best-fit Ωm reproduces the published SN-only value', () => {
    const fit = nelderMead(
      ([Om]) => chi2Marginalised(sample, modelMu(lcdmDistanceTable(LCDMParams.parse({ Om })), sample), true).chi2,
      [0.3],
      { bounds: [[0.05, 0.9]], initialStep: [0.05], tolF: 1e-8, tolX: 1e-5 },
    )
    expect(Math.abs(fit.x[0] - 0.33158)).toBeLessThan(0.002)
    expect(Math.abs(fit.f - 1402.919)).toBeLessThan(0.05)
    expect(Math.abs(fit.x[0] - 0.334)).toBeLessThan(0.018) // within the published 1σ
  })
})
