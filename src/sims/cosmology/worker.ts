/// <reference lib="webworker" />
import * as Comlink from 'comlink'
import { fetchPantheonPlus } from './data'
import {
  bhFormationRateNormalised,
  bhMassFraction,
  chi2Marginalised,
  distanceModulus,
  integrateLeak,
  lcdmDistanceTable,
  lcdmLambda,
  leakDistanceTable,
  leakE,
  leakOmegaAt,
  modelMu,
  nelderMead,
  type Chi2Result,
  type SNSample,
} from './model'
import { CosmologyConfig, FitBounds, LCDMParams, LeakModelParams, type LeakParams } from './schema'

let sample: SNSample | null = null

export interface Curve { z: number[]; mu: number[] }

export interface Evaluation {
  zGrid: number[]
  /** μ(z) on zGrid */
  lcdm: number[]
  leak: number[]
  /** μ_model at each supernova, for residuals */
  lcdmAtData: number[]
  leakAtData: number[]
  chi2Lcdm: Chi2Result
  chi2Leak: Chi2Result
  /** density histories on zGrid (fractions of ρ_crit at H0_ref) */
  omegaLeak: number[]
  omegaLambda: number
  bhFraction: number[]
  bhRate: number[]
  /** leak model derived quantities */
  E0: number
  H0Eff: number
  omegaLeak0: number
  omegaLeak0Frac: number
  omegaMFrac: number
  /** ΛCDM minus leak expansion ratio E_leak/E_lcdm on zGrid */
  eRatio: number[]
}

function zGrid(): number[] {
  const out: number[] = []
  for (let lz = -2.3; lz <= Math.log10(2.3); lz += 0.02) out.push(10 ** lz)
  return out
}

const api = {
  async loadData(base?: string, withCovariance = true): Promise<{ n: number; hasCovariance: boolean }> {
    sample = await fetchPantheonPlus(base, withCovariance)
    return { n: sample.z.length, hasCovariance: !!sample.cholLower }
  },

  sampleSummary(): { z: number[]; mu: number[]; muErr: number[]; cid: string[] } | null {
    if (!sample) return null
    return { z: Array.from(sample.z), mu: Array.from(sample.mu), muErr: Array.from(sample.muErr), cid: sample.cid }
  },

  evaluate(rawConfig: unknown): Evaluation {
    if (!sample) throw new Error('data not loaded')
    const cfg = CosmologyConfig.parse(rawConfig)
    const tL = lcdmDistanceTable(cfg.lcdm)
    const hist = integrateLeak(cfg.leak.leak)
    const E = leakE(cfg.leak, hist)
    const tK = leakDistanceTable(cfg.leak)
    const zs = zGrid()
    const lcdm = zs.map((z) => distanceModulus(tL, z))
    const leak = zs.map((z) => distanceModulus(tK, z))
    const lcdmAtData = modelMu(tL, sample)
    const leakAtData = modelMu(tK, sample)
    const chi2Lcdm = chi2Marginalised(sample, lcdmAtData, cfg.fullCovariance)
    const chi2Leak = chi2Marginalised(sample, leakAtData, cfg.fullCovariance)
    const E0 = E(0)
    const EL = (z: number) => Math.sqrt(cfg.lcdm.Or * (1 + z) ** 4 + cfg.lcdm.Om * (1 + z) ** 3 + cfg.lcdm.Ok * (1 + z) ** 2 + lcdmLambda(cfg.lcdm))
    return {
      zGrid: zs,
      lcdm,
      leak,
      lcdmAtData: Array.from(lcdmAtData),
      leakAtData: Array.from(leakAtData),
      chi2Lcdm,
      chi2Leak,
      omegaLeak: zs.map((z) => leakOmegaAt(hist, z)),
      omegaLambda: lcdmLambda(cfg.lcdm),
      bhFraction: zs.map((z) => bhMassFraction(z)),
      bhRate: zs.map((z) => bhFormationRateNormalised(z)),
      E0,
      H0Eff: cfg.leak.H0 * E0,
      omegaLeak0: hist.omega0,
      omegaLeak0Frac: hist.omega0 / (E0 * E0),
      omegaMFrac: cfg.leak.Om / (E0 * E0),
      eRatio: zs.map((z) => E(z) / EL(z)),
    }
  },

  /** Minimise the leak model's χ² over (α, β, γ). Reports progress through the callback. */
  fitLeak(rawConfig: unknown, rawBounds?: unknown, onProgress?: (iter: number, x: number[], chi2: number) => void) {
    if (!sample) throw new Error('data not loaded')
    const cfg = CosmologyConfig.parse(rawConfig)
    const bounds = FitBounds.parse(rawBounds ?? {})
    const s = sample
    const f = ([alpha, beta, gamma]: number[]) => {
      const p = LeakModelParams.parse({ ...cfg.leak, leak: { alpha, beta, gamma } })
      return chi2Marginalised(s, modelMu(leakDistanceTable(p), s), cfg.fullCovariance).chi2
    }
    const start: LeakParams = cfg.leak.leak
    let every = 0
    const r = nelderMead(f, [start.alpha, start.beta, start.gamma], {
      bounds: [bounds.alpha, bounds.beta, bounds.gamma],
      initialStep: [Math.max(0.01, 0.5 * start.alpha), 0.5, 0.5],
      tolF: 1e-7,
      tolX: 1e-5,
      maxIter: 1500,
      onIter: (i, x, fb) => { if (onProgress && every++ % 5 === 0) onProgress(i, x, fb) },
    })
    return { alpha: r.x[0], beta: r.x[1], gamma: r.x[2], chi2: r.f, iterations: r.iterations, evaluations: r.evaluations, converged: r.converged }
  },

  /** Minimise flat ΛCDM χ² over Ωm (the textbook fit). */
  fitLcdmOm(rawConfig: unknown) {
    if (!sample) throw new Error('data not loaded')
    const cfg = CosmologyConfig.parse(rawConfig)
    const s = sample
    const r = nelderMead(
      ([Om]) => chi2Marginalised(s, modelMu(lcdmDistanceTable(LCDMParams.parse({ ...cfg.lcdm, Om, Ok: 0 })), s), cfg.fullCovariance).chi2,
      [cfg.lcdm.Om],
      { bounds: [[0.02, 0.95]], initialStep: [0.05], tolF: 1e-8, tolX: 1e-5 },
    )
    return { Om: r.x[0], chi2: r.f }
  },
}

export type CosmologyWorkerApi = typeof api
Comlink.expose(api)
