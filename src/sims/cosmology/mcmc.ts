/**
 * Affine-invariant ensemble sampler (Goodman & Weare 2010), the "stretch move"
 * used by emcee (Foreman-Mackey et al. 2013). No step-size tuning, invariant to
 * linear reparametrisation, which suits the strongly correlated (α, β) pair.
 *
 * The sampler keeps its state so it can be advanced in chunks: a worker runs
 * `step(n)` repeatedly and the UI can stop between chunks.
 */

/** Deterministic 32-bit RNG (mulberry32), so runs are reproducible from a seed. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface EnsembleOptions {
  nWalkers: number
  /** stretch scale a (emcee default 2) */
  a?: number
  seed?: number
}

export class EnsembleSampler {
  readonly nDim: number
  readonly nWalkers: number
  readonly a: number
  private readonly rng: () => number
  private readonly logProb: (x: number[]) => number
  /** current positions and log-probabilities */
  readonly x: number[][]
  readonly lp: number[]
  /** the chain: one entry per step, each the full ensemble (flattened walker-major) */
  readonly chain: number[][][] = []
  readonly chainLogProb: number[][] = []
  accepted = 0
  proposed = 0

  constructor(logProb: (x: number[]) => number, x0: number[][], opts: EnsembleOptions) {
    this.logProb = logProb
    this.nWalkers = opts.nWalkers
    this.nDim = x0[0].length
    this.a = opts.a ?? 2
    this.rng = mulberry32(opts.seed ?? 12345)
    if (x0.length !== this.nWalkers) throw new Error('x0 must have nWalkers rows')
    if (this.nWalkers < 2 * this.nDim || this.nWalkers % 2 !== 0) throw new Error('nWalkers must be even and ≥ 2·nDim')
    this.x = x0.map((r) => r.slice())
    this.lp = this.x.map((r) => logProb(r))
  }

  /** Advance the whole ensemble by n steps (two half-updates per step: red/black split). */
  step(n = 1): void {
    const half = this.nWalkers / 2
    for (let it = 0; it < n; it++) {
      for (const [lo, hi, clo, chi] of [[0, half, half, this.nWalkers], [half, this.nWalkers, 0, half]] as const) {
        for (let k = lo; k < hi; k++) {
          const j = clo + Math.floor(this.rng() * (chi - clo))
          // z ~ g(z) ∝ 1/√z on [1/a, a]
          const u = this.rng()
          const z = ((this.a - 1) * u + 1) ** 2 / this.a
          const xj = this.x[j], xk = this.x[k]
          const y = xk.map((v, d) => xj[d] + z * (v - xj[d]))
          const lpy = this.logProb(y)
          const logRatio = (this.nDim - 1) * Math.log(z) + lpy - this.lp[k]
          this.proposed++
          if (Number.isFinite(lpy) && Math.log(this.rng()) < logRatio) {
            this.x[k] = y
            this.lp[k] = lpy
            this.accepted++
          }
        }
      }
      this.chain.push(this.x.map((r) => r.slice()))
      this.chainLogProb.push(this.lp.slice())
    }
  }

  get acceptanceRate(): number { return this.proposed ? this.accepted / this.proposed : 0 }

  /** Samples after discarding `burn` steps, optionally thinned: array of parameter vectors. */
  flat(burn = 0, thin = 1): number[][] {
    const out: number[][] = []
    for (let s = burn; s < this.chain.length; s += thin) for (const w of this.chain[s]) out.push(w)
    return out
  }
}

/** Quantiles of a numeric column (linear interpolation). */
export function quantile(values: number[], q: number): number {
  const v = values.slice().sort((a, b) => a - b)
  const pos = (v.length - 1) * q
  const lo = Math.floor(pos), hi = Math.ceil(pos)
  return v[lo] + (v[hi] - v[lo]) * (pos - lo)
}

export interface ParamSummary { median: number; lo16: number; hi84: number; mean: number; std: number; tau: number }

/**
 * Integrated autocorrelation time of one parameter from the ensemble-mean chain
 * (Goodman & Weare's estimator with the automatic window of Sokal, c = 5).
 */
export function autocorrTime(chain: number[][][], dim: number): number {
  const n = chain.length
  if (n < 10) return NaN
  const m = chain.map((ens) => ens.reduce((s, w) => s + w[dim], 0) / ens.length)
  const mean = m.reduce((s, v) => s + v, 0) / n
  const d = m.map((v) => v - mean)
  const c0 = d.reduce((s, v) => s + v * v, 0) / n
  if (c0 === 0) return 1
  let tau = 1
  for (let lag = 1; lag < n; lag++) {
    let c = 0
    for (let i = 0; i + lag < n; i++) c += d[i] * d[i + lag]
    c /= n - lag
    tau += 2 * (c / c0)
    if (lag >= 5 * tau) break
  }
  return Math.max(1, tau)
}

export function summarise(samples: number[][], chain: number[][][], dim: number): ParamSummary {
  const col = samples.map((s) => s[dim])
  const mean = col.reduce((s, v) => s + v, 0) / col.length
  const std = Math.sqrt(col.reduce((s, v) => s + (v - mean) ** 2, 0) / Math.max(1, col.length - 1))
  return { median: quantile(col, 0.5), lo16: quantile(col, 0.16), hi84: quantile(col, 0.84), mean, std, tau: autocorrTime(chain, dim) }
}

/** Histogram of a column into nBins equal bins over [lo, hi]. */
export function histogram(values: number[], nBins: number, lo = Math.min(...values), hi = Math.max(...values)): { edges: number[]; counts: number[] } {
  const counts = new Array<number>(nBins).fill(0)
  const w = (hi - lo) / nBins || 1
  for (const v of values) { const b = Math.min(nBins - 1, Math.max(0, Math.floor((v - lo) / w))); counts[b]++ }
  return { edges: Array.from({ length: nBins + 1 }, (_, i) => lo + i * w), counts }
}
