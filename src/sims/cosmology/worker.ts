/// <reference lib="webworker" />
import * as Comlink from 'comlink'
import { fetchPantheonPlus, fetchSample, SN_SAMPLES } from './data'
import { EnsembleSampler, histogram, mulberry32, summarise, type ParamSummary } from './mcmc'
import { bhHistory } from './model'
import {
  baoChi2,
  baoPredict,
  chi2Gaussian2,
  chi2Marginalised,
  cplDensityRatio,
  cplDistanceTable,
  cplE,
  distanceModulus,
  earlyUniverse,
  integrateLeak,
  lcdmDistanceTable,
  lcdmE,
  lcdmLambda,
  leakDistanceTable,
  leakE,
  leakEffectiveW,
  leakOmegaAt,
  modelMu,
  nelderMead,
  omegaRadiation,
  type BAOPrediction,
  type Chi2Result,
  type DistanceTable,
  type EarlyUniverse,
  type Expansion,
  type SNSample,
} from './model'
import { DESI_DR2_BAO, PLANCK18_DISTANCE_PRIORS as P18 } from './priors'
import { CosmologyConfig, FitBounds, LCDMParams, LeakModelParams, type LeakParams, type SNSampleId } from './schema'

let sample: SNSample | null = null
const samples = new Map<SNSampleId, SNSample>()
let dataBase = 'pantheon_plus'
let cholFileName = 'chol_lower.f32'

/** The sample the config asks for, or an empty one for the CMB + BAO-only case. */
function sampleFor(cfg: CosmologyConfig): SNSample {
  if (cfg.snSample === 'none') return EMPTY_SAMPLE
  const s = samples.get(cfg.snSample)
  if (!s) throw new Error(`sample ${cfg.snSample} not loaded`)
  return s
}
const EMPTY_SAMPLE: SNSample = { cid: [], z: new Float64Array(0), zHel: new Float64Array(0), mu: new Float64Array(0), muErr: new Float64Array(0), cholLower: null }

interface McmcState { sampler: EnsembleSampler; names: string[]; freeBeta: boolean; cfg: CosmologyConfig }
let mcmc: McmcState | null = null

export interface McmcProgress {
  steps: number
  nWalkers: number
  acceptance: number
  evaluations: number
  bestChi2: number
  summaries: Record<string, ParamSummary>
}

function mcmcSummary(m: McmcState): McmcProgress {
  const steps = m.sampler.chain.length
  const burn = Math.floor(steps * 0.3)
  const flat = m.sampler.flat(burn)
  const summaries: Record<string, ParamSummary> = {}
  m.names.forEach((n, d) => { summaries[n] = summarise(flat, m.sampler.chain.slice(burn), d) })
  let best = -Infinity
  for (const row of m.sampler.chainLogProb) for (const v of row) if (v > best) best = v
  return { steps, nWalkers: m.sampler.nWalkers, acceptance: m.sampler.acceptanceRate, evaluations: m.sampler.proposed, bestChi2: -2 * best, summaries }
}

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
  /** external priors, per model */
  priorsLcdm: PriorScore
  priorsLeak: PriorScore
  /** BAO observables on a z grid for plotting */
  baoGrid: number[]
  baoCurveLcdm: { DM: number[]; DH: number[] }
  baoCurveLeak: { DM: number[]; DH: number[] }
  /** total χ² = SN + enabled priors */
  totalLcdm: number
  totalLeak: number
  /** w0wa comparison (present when cfg.cpl.enabled) */
  cpl: null | {
    mu: number[]
    muAtData: number[]
    chi2: Chi2Result
    priors: PriorScore
    total: number
    baoCurve: { DM: number[]; DH: number[] }
    /** w(z) and ρ_DE(z)/ρ_DE(0) on zGrid */
    w: number[]
    fDE: number[]
  }
  /** leak effective w(z) and ρ_leak(z)/ρ_leak(0) on zGrid */
  leakW: number[]
  leakFDE: number[]
}

export interface PriorScore {
  early: EarlyUniverse
  chi2CMB: number
  chi2BAO: number
  bao: BAOPrediction[]
}

/** CMB + BAO scores for one expansion history. omegaM is the physical matter density of the model. */
function scorePriors(E: Expansion, H0: number, omegaM: number, omegaB: number, table?: DistanceTable): PriorScore {
  const early = earlyUniverse(E, H0, omegaM, omegaB)
  const chi2CMB = chi2Gaussian2(early.R - P18.R, P18.Rerr, early.lA - P18.lA, P18.lAerr, P18.rho)
  const bao = DESI_DR2_BAO.map((p) => baoPredict(E, H0, early.rd, p.z, table))
  return { early, chi2CMB, chi2BAO: baoChi2(DESI_DR2_BAO, bao), bao }
}

/** Fill in the radiation density from H0 so the physical radiation density is always Planck's. */
function withRadiation(cfg: CosmologyConfig): CosmologyConfig {
  return {
    ...cfg,
    lcdm: { ...cfg.lcdm, Or: omegaRadiation(cfg.lcdm.H0) },
    leak: { ...cfg.leak, Or: omegaRadiation(cfg.leak.H0) },
  }
}

const omegaMOf = (Om: number, H0: number) => Om * (H0 / 100) ** 2

function totalWithPriors(cfg: CosmologyConfig, chi2SN: number, ps: PriorScore): number {
  return chi2SN + (cfg.priors.cmb ? ps.chi2CMB : 0) + (cfg.priors.bao ? ps.chi2BAO : 0)
}

const ZERO_CHI2: Chi2Result = { chi2: 0, deltaM: 0, n: 0, chi2Diag: 0, deltaMDiag: 0 }
const snChi2 = (s: SNSample, mu: Float64Array, full: boolean): Chi2Result => (s.z.length ? chi2Marginalised(s, mu, full) : ZERO_CHI2)

function scoreLcdm(cfg: CosmologyConfig, s: SNSample) {
  const t = lcdmDistanceTable(cfg.lcdm)
  const sn = snChi2(s, modelMu(t, s), cfg.fullCovariance)
  const ps = scorePriors(lcdmE(cfg.lcdm), cfg.lcdm.H0, omegaMOf(cfg.lcdm.Om, cfg.lcdm.H0), cfg.omegaB, t)
  return { sn, ps, total: totalWithPriors(cfg, sn.chi2, ps) }
}

function cplParams(cfg: CosmologyConfig) {
  return { H0: cfg.cpl.H0, Om: cfg.cpl.Om, Or: omegaRadiation(cfg.cpl.H0), w0: cfg.cpl.w0, wa: cfg.cpl.wa }
}

function scoreCpl(cfg: CosmologyConfig, s: SNSample) {
  const p = cplParams(cfg)
  const E = cplE(p)
  const t = cplDistanceTable(p)
  const sn = snChi2(s, modelMu(t, s), cfg.fullCovariance)
  const ps = scorePriors(E, p.H0, omegaMOf(p.Om, p.H0), cfg.omegaB, t)
  return { sn, ps, total: totalWithPriors(cfg, sn.chi2, ps), E, t, p }
}

function scoreLeak(cfg: CosmologyConfig, s: SNSample) {
  const hist = integrateLeak(cfg.leak.leak, 1000, bhHistory(cfg.leak.bhHistory))
  const E = leakE(cfg.leak, hist)
  const t = leakDistanceTable(cfg.leak, 2.6, hist)
  const sn = snChi2(s, modelMu(t, s), cfg.fullCovariance)
  const ps = scorePriors(E, cfg.leak.H0, omegaMOf(cfg.leak.Om, cfg.leak.H0), cfg.omegaB, t)
  return { sn, ps, total: totalWithPriors(cfg, sn.chi2, ps), hist, E }
}

function zGrid(): number[] {
  const out: number[] = []
  for (let lz = -2.3; lz <= Math.log10(2.3); lz += 0.02) out.push(10 ** lz)
  return out
}

const api = {
  async loadData(base?: string, withCovariance = true, cholFile?: string): Promise<{ n: number; hasCovariance: boolean }> {
    if (base) dataBase = base.replace(/\/pantheon_plus\/?$/, '')
    if (cholFile) cholFileName = cholFile
    sample = await fetchPantheonPlus(base, withCovariance, cholFile)
    samples.set('pantheon_plus', sample)
    return { n: sample.z.length, hasCovariance: !!sample.cholLower }
  },

  /** Load another prepared sample (DES-Y5, Union3) on demand; served next to pantheon_plus. */
  async loadSample(id: Exclude<SNSampleId, 'none'>): Promise<{ n: number; hasCovariance: boolean }> {
    let s = samples.get(id)
    if (!s) {
      const dir = SN_SAMPLES[id].dir
      const base = dataBase && dataBase !== 'pantheon_plus' ? `${dataBase}/${dir}` : dir
      s = await fetchSample(base, true, cholFileName)
      samples.set(id, s)
    }
    return { n: s.z.length, hasCovariance: !!s.cholLower }
  },

  isLoaded(id: SNSampleId): boolean { return id === 'none' || samples.has(id) },

  sampleSummary(id: SNSampleId = 'pantheon_plus'): { z: number[]; mu: number[]; muErr: number[]; cid: string[] } | null {
    const s = id === 'none' ? EMPTY_SAMPLE : samples.get(id)
    if (!s) return null
    return { z: Array.from(s.z), mu: Array.from(s.mu), muErr: Array.from(s.muErr), cid: s.cid }
  },

  evaluate(rawConfig: unknown): Evaluation {
    const cfg = withRadiation(CosmologyConfig.parse(rawConfig))
    const sample = sampleFor(cfg)
    const tL = lcdmDistanceTable(cfg.lcdm)
    const bh = bhHistory(cfg.leak.bhHistory)
    const hist = integrateLeak(cfg.leak.leak, 1000, bh)
    const E = leakE(cfg.leak, hist)
    const tK = leakDistanceTable(cfg.leak, 2.6, hist)
    const zs = zGrid()
    const lcdm = zs.map((z) => distanceModulus(tL, z))
    const leak = zs.map((z) => distanceModulus(tK, z))
    const lcdmAtData = modelMu(tL, sample)
    const leakAtData = modelMu(tK, sample)
    const chi2Lcdm = snChi2(sample, lcdmAtData, cfg.fullCovariance)
    const chi2Leak = snChi2(sample, leakAtData, cfg.fullCovariance)
    const E0 = E(0)
    const EL = lcdmE(cfg.lcdm)
    const priorsLcdm = scorePriors(EL, cfg.lcdm.H0, omegaMOf(cfg.lcdm.Om, cfg.lcdm.H0), cfg.omegaB, tL)
    const priorsLeak = scorePriors(E, cfg.leak.H0, omegaMOf(cfg.leak.Om, cfg.leak.H0), cfg.omegaB, tK)
    const baoGrid: number[] = []
    for (let z = 0.1; z <= 2.5001; z += 0.05) baoGrid.push(Number(z.toFixed(3)))
    const curve = (Ex: Expansion, H0: number, rd: number) => {
      const DM: number[] = [], DH: number[] = []
      for (const z of baoGrid) { const b = baoPredict(Ex, H0, rd, z); DM.push(b.DM); DH.push(b.DH) }
      return { DM, DH }
    }
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
      bhFraction: zs.map((z) => bh.fraction(z)),
      bhRate: zs.map((z) => bh.ratePerLnA(z)),
      E0,
      H0Eff: cfg.leak.H0 * E0,
      omegaLeak0: hist.omega0,
      omegaLeak0Frac: hist.omega0 / (E0 * E0),
      omegaMFrac: cfg.leak.Om / (E0 * E0),
      eRatio: zs.map((z) => E(z) / EL(z)),
      priorsLcdm,
      priorsLeak,
      baoGrid,
      baoCurveLcdm: curve(EL, cfg.lcdm.H0, priorsLcdm.early.rd),
      baoCurveLeak: curve(E, cfg.leak.H0, priorsLeak.early.rd),
      totalLcdm: totalWithPriors(cfg, chi2Lcdm.chi2, priorsLcdm),
      totalLeak: totalWithPriors(cfg, chi2Leak.chi2, priorsLeak),
      cpl: cfg.cpl.enabled ? (() => {
        const c = scoreCpl(cfg, sample)
        return {
          mu: zs.map((z) => distanceModulus(c.t, z)),
          muAtData: Array.from(modelMu(c.t, sample)),
          chi2: c.sn,
          priors: c.ps,
          total: c.total,
          baoCurve: curve(c.E, c.p.H0, c.ps.early.rd),
          w: zs.map((z) => c.p.w0 + c.p.wa * z / (1 + z)),
          fDE: zs.map((z) => cplDensityRatio(z, c.p.w0, c.p.wa)),
        }
      })() : null,
      leakW: zs.map((z) => leakEffectiveW(hist, z)),
      leakFDE: zs.map((z) => (hist.omega0 > 0 ? leakOmegaAt(hist, z) / hist.omega0 : NaN)),
    }
  },

  /** Fit the w0wa model (Ωm, H0, w0, wa) to the same data; several starts because wa is weakly constrained. */
  fitCpl(rawConfig: unknown) {
    const cfg = withRadiation(CosmologyConfig.parse(rawConfig))
    const s = sampleFor(cfg)
    const f = ([Om, H0, w0, wa]: number[]) => scoreCpl({ ...cfg, cpl: { ...cfg.cpl, Om, H0, w0, wa } }, s).total
    let best: ReturnType<typeof nelderMead> | null = null
    for (const x0 of [[cfg.cpl.Om, cfg.cpl.H0, cfg.cpl.w0, cfg.cpl.wa], [0.3, 68, -1, 0], [0.32, 67, -0.7, -1.2]]) {
      const r = nelderMead(f, x0, { bounds: [[0.1, 0.6], [50, 90], [-2, 0], [-4, 2]], initialStep: [0.02, 1, 0.1, 0.3], tolF: 1e-8, tolX: 1e-5, maxIter: 3000 })
      if (!best || r.f < best.f) best = r
    }
    return { Om: best!.x[0], H0: best!.x[1], w0: best!.x[2], wa: best!.x[3], chi2: best!.f }
  },

  /** Minimise the leak model's total χ² over (α, β, γ) and, with fitDensities, Ωm. Reports progress through the callback. */
  fitLeak(rawConfig: unknown, rawBounds?: unknown, onProgress?: (iter: number, x: number[], chi2: number) => void) {
    const cfg = withRadiation(CosmologyConfig.parse(rawConfig))
    const bounds = FitBounds.parse(rawBounds ?? {})
    const s = sampleFor(cfg)
    const withOm = cfg.fitDensities
    const f = ([alpha, beta, gamma, Om]: number[]) => {
      const leak = LeakModelParams.parse({ ...cfg.leak, Om: withOm ? Om : cfg.leak.Om, leak: { alpha, beta, gamma } })
      return scoreLeak({ ...cfg, leak }, s).total
    }
    const start: LeakParams = cfg.leak.leak
    let every = 0
    const x0 = [start.alpha, start.beta, start.gamma, ...(withOm ? [cfg.leak.Om] : [])]
    const r = nelderMead(f, x0, {
      bounds: [bounds.alpha, bounds.beta, bounds.gamma, ...(withOm ? [[0.05, 0.9] as [number, number]] : [])],
      initialStep: [Math.max(0.01, 0.5 * start.alpha), 0.5, 0.5, ...(withOm ? [0.03] : [])],
      tolF: 1e-7,
      tolX: 1e-5,
      maxIter: 2500,
      onIter: (i, x, fb) => { if (onProgress && every++ % 5 === 0) onProgress(i, x, fb) },
    })
    return { alpha: r.x[0], beta: r.x[1], gamma: r.x[2], Om: withOm ? r.x[3] : cfg.leak.Om, chi2: r.f, iterations: r.iterations, evaluations: r.evaluations, converged: r.converged }
  },

  // ---- MCMC: posterior over the leak parameters, advanced in chunks so the UI can stop it ----
  mcmcStart(rawConfig: unknown, opts: { nWalkers?: number; freeBeta?: boolean; seed?: number; spread?: number } = {}) {
    const cfg = withRadiation(CosmologyConfig.parse(rawConfig))
    const s = sampleFor(cfg)
    const freeBeta = opts.freeBeta ?? true
    const names = freeBeta ? ['alpha', 'beta', 'gamma', 'Om'] : ['alpha', 'gamma', 'Om']
    const unpack = (v: number[]) => (freeBeta ? v : [v[0], 0, v[1], v[2]])
    const inBounds = (x: number[]) => x[0] > 0 && x[0] <= 5 && x[1] >= -4 && x[1] <= 8 && x[2] >= -1 && x[2] <= 5 && x[3] >= 0.05 && x[3] <= 0.9
    const logProb = (v: number[]) => {
      const x = unpack(v)
      if (!inBounds(x)) return -Infinity
      const leak = LeakModelParams.parse({ ...cfg.leak, Om: x[3], leak: { alpha: x[0], beta: x[1], gamma: x[2] } })
      return -0.5 * scoreLeak({ ...cfg, leak }, s).total
    }
    const lp = cfg.leak.leak
    const start = freeBeta ? [lp.alpha, lp.beta, lp.gamma, cfg.leak.Om] : [lp.alpha, lp.gamma, cfg.leak.Om]
    const nWalkers = Math.max(2 * names.length, opts.nWalkers ?? 32)
    const rng = mulberry32((opts.seed ?? 42) + 1)
    const spread = opts.spread ?? 0.05
    const x0 = Array.from({ length: nWalkers }, () => start.map((v) => v * (1 + spread * (rng() - 0.5)) + (v === 0 ? spread * (rng() - 0.5) : 0)))
    mcmc = { sampler: new EnsembleSampler(logProb, x0, { nWalkers, seed: opts.seed ?? 42 }), names, freeBeta, cfg }
    return { names, nWalkers }
  },

  /** Advance the ensemble by n steps; returns progress and running summaries (burn = 30% of steps so far). */
  mcmcStep(n: number): McmcProgress {
    if (!mcmc) throw new Error('mcmc not started')
    mcmc.sampler.step(n)
    return mcmcSummary(mcmc)
  },

  /** Thinned samples for plotting: parameter columns, histograms, and 2-D points for two chosen dims. */
  mcmcSamples(burnFraction = 0.3, maxPoints = 4000): { names: string[]; points: number[][]; hist: { name: string; edges: number[]; counts: number[] }[] } {
    if (!mcmc) throw new Error('mcmc not started')
    const burn = Math.floor(mcmc.sampler.chain.length * burnFraction)
    const flat = mcmc.sampler.flat(burn)
    const thin = Math.max(1, Math.ceil(flat.length / maxPoints))
    const points = flat.filter((_, i) => i % thin === 0)
    const hist = mcmc.names.map((name, d) => ({ name, ...histogram(flat.map((v) => v[d]), 30) }))
    return { names: mcmc.names, points, hist }
  },

  mcmcStop() { mcmc = null },

  /** Minimise flat ΛCDM total χ² over Ωm, and over H0 too when a prior that constrains it is on (SN alone cannot). */
  fitLcdmOm(rawConfig: unknown) {
    const cfg = withRadiation(CosmologyConfig.parse(rawConfig))
    const s = sampleFor(cfg)
    const withH0 = cfg.fitDensities && (cfg.priors.cmb || cfg.priors.bao)
    const f = ([Om, H0]: number[]) => {
      const lcdm = LCDMParams.parse({ ...cfg.lcdm, Om, Ok: 0, H0: withH0 ? H0 : cfg.lcdm.H0, Or: omegaRadiation(withH0 ? H0 : cfg.lcdm.H0) })
      return scoreLcdm({ ...cfg, lcdm }, s).total
    }
    const r = nelderMead(f, [cfg.lcdm.Om, ...(withH0 ? [cfg.lcdm.H0] : [])], {
      bounds: [[0.02, 0.95], ...(withH0 ? [[50, 90] as [number, number]] : [])],
      initialStep: [0.05, ...(withH0 ? [2] : [])],
      tolF: 1e-8, tolX: 1e-5, maxIter: 1000,
    })
    return { Om: r.x[0], H0: withH0 ? r.x[1] : cfg.lcdm.H0, chi2: r.f }
  },
}

export type CosmologyWorkerApi = typeof api
Comlink.expose(api)
