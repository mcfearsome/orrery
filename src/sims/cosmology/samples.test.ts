/**
 * Sanity checks for the extra supernova samples: each loads, is positive-definite,
 * and a flat-ΛCDM fit alone lands in the published neighbourhood:
 *   DES-SN5YR (Abbott et al. 2024): Ωm = 0.352 ± 0.017; the Dovekie recalibration
 *   (Popovic et al. 2025) shifts it lower. Union3 (Rubin et al. 2023): Ωm = 0.356 +0.028/−0.026.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { sampleFromJson, type SNEJson } from './data'
import { chi2Marginalised, lcdmDistanceTable, modelMu, nelderMead } from './model'
import { LCDMParams } from './schema'

function load(dir: string) {
  const j = JSON.parse(readFileSync(`data/${dir}/sne.json`, 'utf8')) as SNEJson
  const buf = readFileSync(`data/${dir}/chol_lower.f32`)
  return sampleFromJson(j, buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))
}
const fitOm = (s: ReturnType<typeof load>) => nelderMead(
  ([Om]) => chi2Marginalised(s, modelMu(lcdmDistanceTable(LCDMParams.parse({ Om })), s), true).chi2,
  [0.3], { bounds: [[0.05, 0.9]], initialStep: [0.05], tolF: 1e-8, tolX: 1e-5 },
)

describe('DES-SN5YR Dovekie', () => {
  const s = load('des_y5')
  it('has 1820 SNe with a covariance', () => { expect(s.z.length).toBe(1820); expect(s.cholLower).not.toBeNull() })
  it('flat ΛCDM alone gives Ωm in the published neighbourhood with χ²/n ≈ 1', () => {
    const r = fitOm(s)
    expect(r.x[0]).toBeGreaterThan(0.28); expect(r.x[0]).toBeLessThan(0.40)
    expect(r.f / s.z.length).toBeGreaterThan(0.7); expect(r.f / s.z.length).toBeLessThan(1.3)
  })
})

describe('Union3', () => {
  const s = load('union3')
  it('has 22 nodes with a covariance', () => { expect(s.z.length).toBe(22); expect(s.cholLower).not.toBeNull() })
  it('flat ΛCDM alone gives Ωm in the published neighbourhood', () => {
    const r = fitOm(s)
    expect(r.x[0]).toBeGreaterThan(0.28); expect(r.x[0]).toBeLessThan(0.42)
    expect(r.f).toBeLessThan(40)
  })
})
