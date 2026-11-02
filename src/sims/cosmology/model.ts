/**
 * Background cosmology: Friedmann expansion histories, luminosity distances,
 * a black-hole-leak dark-energy component, and the supernova likelihood.
 *
 * Everything here is pure and synchronous so it can run in a worker, a test,
 * or a Node script unchanged. Units: H0 in km/s/Mpc, distances in Mpc,
 * densities as fractions of the critical density at the reference H0.
 */
import type { LCDMParams, LeakModelParams, LeakParams } from './schema'

export const C_KM_S = 299792.458
/** 1/H0 in Gyr for H0 = 1 km/s/Mpc: 977.792 Gyr */
const GYR_PER_HUBBLE_UNIT = 977.792221

// ---------------------------------------------------------------------------
// Expansion histories. E(z) = H(z)/H0_ref. For ΛCDM E(0) = 1 by construction;
// for the leak model E(0) is whatever the integrated leak component makes it.
// ---------------------------------------------------------------------------

export type Expansion = (z: number) => number

export function lcdmLambda(p: LCDMParams): number {
  return 1 - p.Om - p.Or - p.Ok
}

export function lcdmE(p: LCDMParams): Expansion {
  const OL = lcdmLambda(p)
  return (z) => {
    const a1 = 1 + z
    return Math.sqrt(p.Or * a1 ** 4 + p.Om * a1 ** 3 + p.Ok * a1 ** 2 + OL)
  }
}

// ---------------------------------------------------------------------------
// Black-hole mass-formation history.
//
// v1 uses an analytic approximation, flagged as such: the comoving BH mass
// density is assumed to track the integrated cosmic star-formation history
// (Soltan-style argument: SMBH growth follows the AGN luminosity density, which
// peaks at z ≈ 2 like star formation; stellar-mass BHs are stellar remnants and
// track it by construction). The SFR density is the Madau & Dickinson (2014,
// ARA&A 52, 415, eq. 15) fit:
//   ψ(z) = 0.015 (1+z)^2.7 / (1 + ((1+z)/2.9)^5.6)  M☉ yr⁻¹ Mpc⁻³ (comoving)
// Normalisation: ρ_BH(z=0) is set to the local SMBH mass density of
// Shankar et al. (2009, ApJ 690, 20), ≈ 4.3e5 M☉ Mpc⁻³. Because the leak
// amplitude α multiplies it, only the SHAPE of this history matters for the fit.
//
// Cosmic time is converted from redshift with a fixed reference ΛCDM (Planck 18),
// since the SFR fit is an empirical function of time in that cosmology.
// ---------------------------------------------------------------------------

export const RHO_BH_LOCAL_MSUN_PER_MPC3 = 4.3e5
export const BH_HISTORY_Z_MAX = 30

export function madauDickinsonSFR(z: number): number {
  const a1 = 1 + z
  return (0.015 * a1 ** 2.7) / (1 + (a1 / 2.9) ** 5.6)
}

const REF_FOR_TIME: LCDMParams = { H0: 67.4, Om: 0.315, Or: 9.2e-5, Ok: 0 }
const refE = lcdmE(REF_FOR_TIME)

/** dt/dx in Gyr per unit ln a, in the reference cosmology (x = ln a). */
function dtdx(z: number): number {
  return GYR_PER_HUBBLE_UNIT / (REF_FOR_TIME.H0 * refE(z))
}

/** Comoving BH mass formed per unit ln a, before normalisation (M☉/Mpc³ per unit x). */
function bhFormationPerLnA(z: number): number {
  return madauDickinsonSFR(z) * 1e9 * dtdx(z) // ψ is per yr, dt/dx is in Gyr
}

let bhNormCache: number | null = null
/** ∫ formation d(ln a) from z = BH_HISTORY_Z_MAX to 0: total comoving mass formed (unnormalised). */
export function bhFormationTotal(): number {
  if (bhNormCache !== null) return bhNormCache
  const xMin = -Math.log(1 + BH_HISTORY_Z_MAX)
  const n = 20000
  const h = -xMin / n
  let s = 0
  for (let i = 0; i <= n; i++) {
    const x = xMin + i * h
    const w = i === 0 || i === n ? 1 : i % 2 === 1 ? 4 : 2
    s += w * bhFormationPerLnA(Math.exp(-x) - 1)
  }
  bhNormCache = (s * h) / 3
  return bhNormCache
}

/** Normalised comoving BH mass-formation rate per unit ln a: integrates to 1 over cosmic history. */
export function bhFormationRateNormalised(z: number): number {
  return bhFormationPerLnA(z) / bhFormationTotal()
}

/** Normalised cumulative comoving BH mass density f(z) = ρ_BH(z)/ρ_BH(0) ∈ [0, 1]. */
export function bhMassFraction(z: number): number {
  const xMin = -Math.log(1 + BH_HISTORY_Z_MAX)
  const x1 = -Math.log(1 + z)
  if (x1 <= xMin) return 0
  const n = 2000
  const h = (x1 - xMin) / n
  let s = 0
  for (let i = 0; i <= n; i++) {
    const x = xMin + i * h
    const w = i === 0 || i === n ? 1 : i % 2 === 1 ? 4 : 2
    s += w * bhFormationRateNormalised(Math.exp(-x) - 1)
  }
  return (s * h) / 3
}

// ---------------------------------------------------------------------------
// Leak law. ONE pure function; swap it to try another law.
//
// Physical statement:  dρ_leak/dt = α · ṁ_BH(t) · (1+z)^β − γ H ρ_leak
// where ṁ_BH is the PHYSICAL BH mass-formation rate density, i.e. the comoving
// formation rate times (1+z)^3, and the −γHρ term makes ρ_leak dilute as (1+z)^γ.
// Dividing by H = dx/dt (x = ln a) the Hubble rate cancels from the source:
//   dΩ_leak/dx = α (1+z)^(β+3) f'(x) − γ Ω_leak,     f'(x) = bhFormationRateNormalised
// so the leak history is independent of the expansion it then drives.
// ---------------------------------------------------------------------------

/** Source term dΩ_leak/dx (excluding dilution) at redshift z. */
export function leakSource(z: number, p: LeakParams): number {
  return p.alpha * (1 + z) ** (p.beta + 3) * bhFormationRateNormalised(z)
}

export interface LeakHistory {
  /** ln a grid, ascending */
  x: Float64Array
  /** Ω_leak(x) in units of ρ_crit(H0_ref) */
  omega: Float64Array
  /** Ω_leak today */
  omega0: number
}

/** Integrate the leak ODE with RK4 in x = ln a from z = BH_HISTORY_Z_MAX to today. */
export function integrateLeak(p: LeakParams, steps = 3000): LeakHistory {
  const xMin = -Math.log(1 + BH_HISTORY_Z_MAX)
  const h = -xMin / steps
  const x = new Float64Array(steps + 1)
  const omega = new Float64Array(steps + 1)
  const rhs = (xx: number, om: number) => leakSource(Math.exp(-xx) - 1, p) - p.gamma * om
  let om = 0
  for (let i = 0; i < steps; i++) {
    const xi = xMin + i * h
    x[i] = xi
    omega[i] = om
    const k1 = rhs(xi, om)
    const k2 = rhs(xi + h / 2, om + (h / 2) * k1)
    const k3 = rhs(xi + h / 2, om + (h / 2) * k2)
    const k4 = rhs(xi + h, om + h * k3)
    om += (h / 6) * (k1 + 2 * k2 + 2 * k3 + k4)
  }
  x[steps] = 0
  omega[steps] = om
  return { x, omega, omega0: om }
}

/** Ω_leak(z) by linear interpolation on the integrated history. */
export function leakOmegaAt(hist: LeakHistory, z: number): number {
  const xq = -Math.log(1 + z)
  const n = hist.x.length
  if (xq <= hist.x[0]) return 0
  if (xq >= 0) return hist.omega0
  const h = hist.x[1] - hist.x[0]
  const i = Math.min(n - 2, Math.floor((xq - hist.x[0]) / h))
  const t = (xq - hist.x[i]) / h
  return hist.omega[i] * (1 - t) + hist.omega[i + 1] * t
}

/** E(z) for the leak model (flat; E(0) floats with Ω_leak(0)). */
export function leakE(p: LeakModelParams, hist = integrateLeak(p.leak)): Expansion {
  return (z) => {
    const a1 = 1 + z
    return Math.sqrt(p.Or * a1 ** 4 + p.Om * a1 ** 3 + leakOmegaAt(hist, z))
  }
}

// ---------------------------------------------------------------------------
// Distances. RK4 on dD_C/dz = c/H(z), tabulated on a fine grid then interpolated.
// ---------------------------------------------------------------------------

export interface DistanceTable {
  zMax: number
  h: number
  /** dimensionless comoving distance D_C · H0 / c on the grid z = i·h */
  dc: Float64Array
  H0: number
  Ok: number
}

export function buildDistanceTable(E: Expansion, H0: number, Ok = 0, zMax = 2.6, steps = 2600): DistanceTable {
  const h = zMax / steps
  const dc = new Float64Array(steps + 1)
  const f = (z: number) => 1 / E(z)
  let d = 0
  for (let i = 0; i < steps; i++) {
    const z = i * h
    const k1 = f(z)
    const k2 = f(z + h / 2)
    const k4 = f(z + h)
    d += (h / 6) * (k1 + 4 * k2 + k4) // RK4 with no y-dependence collapses to Simpson
    dc[i + 1] = d
  }
  return { zMax, h, dc, H0, Ok }
}

/** Dimensionless comoving distance at z (linear interpolation on the table). */
export function comovingDistanceDimensionless(t: DistanceTable, z: number): number {
  if (z <= 0) return 0
  if (z >= t.zMax) throw new Error(`z=${z} beyond table zMax=${t.zMax}`)
  const i = Math.floor(z / t.h)
  const u = z / t.h - i
  return t.dc[i] * (1 - u) + t.dc[i + 1] * u
}

/** Luminosity distance in Mpc. zHel multiplies the (1+z) factor; defaults to z. */
export function luminosityDistanceMpc(t: DistanceTable, z: number, zHel = z): number {
  let dm = comovingDistanceDimensionless(t, z)
  if (t.Ok > 1e-12) {
    const s = Math.sqrt(t.Ok)
    dm = Math.sinh(s * dm) / s
  } else if (t.Ok < -1e-12) {
    const s = Math.sqrt(-t.Ok)
    dm = Math.sin(s * dm) / s
  }
  return (1 + zHel) * dm * (C_KM_S / t.H0)
}

/** Distance modulus μ = 5 log10(d_L / 10 pc) = 5 log10(d_L[Mpc]) + 25. */
export function distanceModulus(t: DistanceTable, z: number, zHel = z): number {
  return 5 * Math.log10(luminosityDistanceMpc(t, z, zHel)) + 25
}

export function lcdmDistanceTable(p: LCDMParams, zMax = 2.6): DistanceTable {
  return buildDistanceTable(lcdmE(p), p.H0, p.Ok, zMax)
}

export function leakDistanceTable(p: LeakModelParams, zMax = 2.6): DistanceTable {
  return buildDistanceTable(leakE(p), p.H0, 0, zMax)
}

// ---------------------------------------------------------------------------
// Supernova likelihood. Residuals r = μ_obs − μ_model(z); the absolute
// magnitude / H0 offset ΔM is marginalised analytically (flat prior), i.e.
//   χ² = A − B²/C,  A = rᵀC⁻¹r, B = 1ᵀC⁻¹r, C = 1ᵀC⁻¹1   (Goliath et al. 2001).
// With the Cholesky factor C = L Lᵀ, y = L⁻¹r and u = L⁻¹1 give A = y·y, B = u·y, C = u·u.
// ---------------------------------------------------------------------------

export interface SNSample {
  cid: string[]
  z: Float64Array
  zHel: Float64Array
  mu: Float64Array
  /** diagonal 1σ errors (sqrt of the covariance diagonal) */
  muErr: Float64Array
  /** packed row-major lower-triangular Cholesky factor of the covariance, or null for diagonal-only */
  cholLower: Float32Array | null
}

/** Solve L y = b for packed lower-triangular L (row-major, row i has i+1 entries). */
export function forwardSubstitute(L: Float32Array, b: Float64Array): Float64Array {
  const n = b.length
  const y = new Float64Array(n)
  let off = 0
  for (let i = 0; i < n; i++) {
    let s = b[i]
    for (let j = 0; j < i; j++) s -= L[off + j] * y[j]
    y[i] = s / L[off + i]
    off += i + 1
  }
  return y
}

export interface Chi2Result {
  chi2: number
  /** best-fit magnitude offset ΔM absorbed by the marginalisation */
  deltaM: number
  n: number
  /** χ² with the raw diagonal errors (never the full covariance), for reference */
  chi2Diag: number
  deltaMDiag: number
}

export function chi2Marginalised(sample: SNSample, muModel: Float64Array, useFull = true): Chi2Result {
  const n = sample.z.length
  const r = new Float64Array(n)
  for (let i = 0; i < n; i++) r[i] = sample.mu[i] - muModel[i]
  // diagonal
  let A = 0, B = 0, Cc = 0
  for (let i = 0; i < n; i++) {
    const w = 1 / (sample.muErr[i] * sample.muErr[i])
    A += r[i] * r[i] * w
    B += r[i] * w
    Cc += w
  }
  const chi2Diag = A - (B * B) / Cc
  const deltaMDiag = B / Cc
  if (!useFull || !sample.cholLower) return { chi2: chi2Diag, deltaM: deltaMDiag, n, chi2Diag, deltaMDiag }
  const y = forwardSubstitute(sample.cholLower, r)
  const u = forwardSubstitute(sample.cholLower, new Float64Array(n).fill(1))
  let a = 0, b = 0, c = 0
  for (let i = 0; i < n; i++) {
    a += y[i] * y[i]
    b += u[i] * y[i]
    c += u[i] * u[i]
  }
  return { chi2: a - (b * b) / c, deltaM: b / c, n, chi2Diag, deltaMDiag }
}

export function modelMu(t: DistanceTable, sample: SNSample): Float64Array {
  const n = sample.z.length
  const out = new Float64Array(n)
  for (let i = 0; i < n; i++) out[i] = distanceModulus(t, sample.z[i], sample.zHel[i])
  return out
}

// ---------------------------------------------------------------------------
// Nelder–Mead (Lagarias et al. 1998 parameters) with box bounds via penalty.
// ---------------------------------------------------------------------------

export interface NMOptions {
  maxIter?: number
  tolF?: number
  tolX?: number
  initialStep?: number[]
  bounds?: [number, number][]
  onIter?: (iter: number, best: number[], fBest: number) => void
}

export interface NMResult {
  x: number[]
  f: number
  iterations: number
  evaluations: number
  converged: boolean
}

export function nelderMead(fn: (x: number[]) => number, x0: number[], opts: NMOptions = {}): NMResult {
  const n = x0.length
  const maxIter = opts.maxIter ?? 400 * n
  const tolF = opts.tolF ?? 1e-6
  const tolX = opts.tolX ?? 1e-6
  const bounds = opts.bounds
  let evals = 0
  const f = (x: number[]) => {
    evals++
    if (bounds) for (let i = 0; i < n; i++) if (x[i] < bounds[i][0] || x[i] > bounds[i][1]) return 1e30
    const v = fn(x)
    return Number.isFinite(v) ? v : 1e30
  }
  const simplex: { x: number[]; f: number }[] = [{ x: x0.slice(), f: f(x0) }]
  for (let i = 0; i < n; i++) {
    const x = x0.slice()
    const step = opts.initialStep?.[i] ?? (x[i] !== 0 ? 0.05 * Math.abs(x[i]) : 0.00025)
    x[i] += step
    if (bounds && x[i] > bounds[i][1]) x[i] = x0[i] - step
    simplex.push({ x, f: f(x) })
  }
  const order = () => simplex.sort((a, b) => a.f - b.f)
  order()
  let iter = 0
  let converged = false
  for (; iter < maxIter; iter++) {
    const best = simplex[0], worst = simplex[n]
    const fRange = Math.abs(worst.f - best.f)
    let xRange = 0
    for (let i = 1; i <= n; i++) for (let j = 0; j < n; j++) xRange = Math.max(xRange, Math.abs(simplex[i].x[j] - best.x[j]))
    if (fRange <= tolF * Math.max(1, Math.abs(best.f)) && xRange <= tolX) { converged = true; break }
    opts.onIter?.(iter, best.x, best.f)
    const centroid = new Array(n).fill(0)
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) centroid[j] += simplex[i].x[j] / n
    const lerp = (t: number) => centroid.map((c, j) => c + t * (worst.x[j] - c))
    const xr = lerp(-1), fr = f(xr)
    if (fr < best.f) {
      const xe = lerp(-2), fe = f(xe)
      simplex[n] = fe < fr ? { x: xe, f: fe } : { x: xr, f: fr }
    } else if (fr < simplex[n - 1].f) {
      simplex[n] = { x: xr, f: fr }
    } else {
      const outside = fr < worst.f
      const xc = lerp(outside ? -0.5 : 0.5), fc = f(xc)
      if (fc < (outside ? fr : worst.f)) simplex[n] = { x: xc, f: fc }
      else for (let i = 1; i <= n; i++) {
        const x = best.x.map((b, j) => b + 0.5 * (simplex[i].x[j] - b))
        simplex[i] = { x, f: f(x) }
      }
    }
    order()
  }
  return { x: simplex[0].x, f: simplex[0].f, iterations: iter, evaluations: evals, converged }
}

// ---------------------------------------------------------------------------
// Early-universe pieces for the CMB and BAO priors. Physical densities ω = Ω h²
// are what the CMB fixes, so everything here is written in those.
//   ω_γ for T_CMB = 2.7255 K; radiation includes N_eff = 3.046 massless neutrinos.
// ---------------------------------------------------------------------------

export const OMEGA_GAMMA = 2.4728e-5
export const N_EFF = 3.046
export const OMEGA_RADIATION = OMEGA_GAMMA * (1 + 0.2271 * N_EFF) // 4.1834e-5

/** Ωr for a given H0 (km/s/Mpc), so that the physical radiation density is fixed. */
export function omegaRadiation(H0: number): number {
  const h = H0 / 100
  return OMEGA_RADIATION / (h * h)
}

/** Decoupling redshift, Hu & Sugiyama 1996 (ApJ 471, 542) fitting formula. */
export function zStar(omegaB: number, omegaM: number): number {
  const g1 = (0.0783 * omegaB ** -0.238) / (1 + 39.5 * omegaB ** 0.763)
  const g2 = 0.56 / (1 + 21.1 * omegaB ** 1.81)
  return 1048 * (1 + 0.00124 * omegaB ** -0.738) * (1 + g1 * omegaM ** g2)
}

/** Drag epoch, Eisenstein & Hu 1998 (ApJ 496, 605) eq. 4. */
export function zDrag(omegaB: number, omegaM: number): number {
  const b1 = 0.313 * omegaM ** -0.419 * (1 + 0.607 * omegaM ** 0.674)
  const b2 = 0.238 * omegaM ** 0.223
  return (1291 * omegaM ** 0.251 / (1 + 0.659 * omegaM ** 0.828)) * (1 + b1 * omegaB ** b2)
}

/**
 * Comoving sound horizon r_s(z) in Mpc:  r_s = ∫_0^{a(z)} c_s / (a² H) da,
 * c_s = c / sqrt(3 (1 + R_b)),  R_b = 3 ω_b a / (4 ω_γ).
 * Simpson in ln a from a = 1e-8. E(z) must include radiation for this to be right.
 */
export function soundHorizonMpc(E: Expansion, H0: number, omegaB: number, z: number, steps = 4000): number {
  const xMin = Math.log(1e-8), xMax = -Math.log(1 + z)
  const h = (xMax - xMin) / steps
  const f = (x: number) => {
    const a = Math.exp(x)
    const Rb = (3 * omegaB * a) / (4 * OMEGA_GAMMA)
    const cs = C_KM_S / Math.sqrt(3 * (1 + Rb))
    return cs / (a * H0 * E(1 / a - 1)) // da/(a² H) with da = a dx
  }
  let s = 0
  for (let i = 0; i <= steps; i++) s += (i === 0 || i === steps ? 1 : i % 2 ? 4 : 2) * f(xMin + i * h)
  return (s * h) / 3
}

/** Comoving distance in Mpc to any z, including beyond the distance table (Simpson in ln(1+z)). */
export function comovingDistanceMpc(E: Expansion, H0: number, z: number, steps = 4000): number {
  const uMax = Math.log(1 + z)
  const h = uMax / steps
  let s = 0
  for (let i = 0; i <= steps; i++) {
    const u = i * h
    const zz = Math.exp(u) - 1
    s += (i === 0 || i === steps ? 1 : i % 2 ? 4 : 2) * ((1 + zz) / E(zz)) // dz = (1+z) du
  }
  return ((s * h) / 3) * (C_KM_S / H0)
}

export interface CMBPriorObs {
  R: number
  lA: number
  zStar: number
  rsStar: number
  DMStar: number
}

/**
 * Shift parameter R = sqrt(ω_m) · 100 · D_M(z*) / c  and acoustic scale l_A = π D_M(z*) / r_s(z*).
 * Flat models only (D_M = D_C). omegaM is the physical matter density Ω_m h² of the model.
 */
export function cmbDistancePriors(E: Expansion, H0: number, omegaM: number, omegaB: number): CMBPriorObs {
  const zs = zStar(omegaB, omegaM)
  const DM = comovingDistanceMpc(E, H0, zs)
  const rs = soundHorizonMpc(E, H0, omegaB, zs)
  return { R: (Math.sqrt(omegaM) * 100 * DM) / C_KM_S, lA: (Math.PI * DM) / rs, zStar: zs, rsStar: rs, DMStar: DM }
}

/** χ² of (R, l_A) against a 2×2 prior with correlation ρ. */
export function chi2Gaussian2(d1: number, s1: number, d2: number, s2: number, rho: number): number {
  const det = 1 - rho * rho
  return (d1 * d1 / (s1 * s1) + d2 * d2 / (s2 * s2) - (2 * rho * d1 * d2) / (s1 * s2)) / det
}

export interface BAOPoint {
  z: number
  /** D_M/r_d with error, or null when only D_V is measured */
  DM?: [number, number]
  DH?: [number, number]
  DV?: [number, number]
  /** correlation between the D_M and D_H measurements */
  rMH?: number
  label: string
}

export interface BAOPrediction { z: number; DM: number; DH: number; DV: number }

/** Model BAO observables at z, divided by r_d (Mpc). */
export function baoPredict(E: Expansion, H0: number, rd: number, z: number): BAOPrediction {
  const DM = comovingDistanceMpc(E, H0, z, 2000)
  const DH = C_KM_S / (H0 * E(z))
  const DV = Math.cbrt(z * DM * DM * DH)
  return { z, DM: DM / rd, DH: DH / rd, DV: DV / rd }
}

export function baoChi2(points: BAOPoint[], preds: BAOPrediction[]): number {
  let chi2 = 0
  points.forEach((p, i) => {
    const m = preds[i]
    if (p.DM && p.DH) chi2 += chi2Gaussian2(m.DM - p.DM[0], p.DM[1], m.DH - p.DH[0], p.DH[1], p.rMH ?? 0)
    else if (p.DV) chi2 += ((m.DV - p.DV[0]) / p.DV[1]) ** 2
  })
  return chi2
}

// ---------------------------------------------------------------------------
// Anchored early-universe quantities.
//
// The fitting formulas above and our massless-neutrino radiation term land
// within 0.1–0.3% of the exact Planck 2018 values, which is 2–10σ for the
// priors. So each quantity is anchored: the model's own integral or formula is
// multiplied by a constant that makes it exact for the Planck 2018
// TT,TE,EE+lowE+lensing best fit (Planck 2018 VI, Table 2), and the model's
// physics carries the variation away from it. Models that change only the
// late-time expansion (the leak is 0.2% of matter at z = 6) are well served.
// ---------------------------------------------------------------------------

export const PLANCK18_FIDUCIAL = {
  H0: 67.36, Om: 0.3153, omegaB: 0.02237,
  zStar: 1089.92, rsStar: 144.43, zDrag: 1059.94, rd: 147.09,
  /** D_M(z*) implied by l_A = 301.471 and r_s* = 144.43 */
  DMStar: (301.471 * 144.43) / Math.PI,
} as const

export interface EarlyUniverse {
  zStar: number
  zDrag: number
  /** comoving sound horizon at decoupling and at the drag epoch, Mpc */
  rsStar: number
  rd: number
  /** comoving distance to decoupling, Mpc */
  DMStar: number
  R: number
  lA: number
}

interface Anchors { zStar: number; zDrag: number; rs: number; DM: number }
let anchors: Anchors | null = null
function getAnchors(): Anchors {
  if (anchors) return anchors
  const F = PLANCK18_FIDUCIAL
  const h = F.H0 / 100, om = F.Om * h * h
  const E = lcdmE({ H0: F.H0, Om: F.Om, Or: omegaRadiation(F.H0), Ok: 0 })
  anchors = {
    zStar: F.zStar / zStar(F.omegaB, om),
    zDrag: F.zDrag / zDrag(F.omegaB, om),
    rs: F.rsStar / soundHorizonMpc(E, F.H0, F.omegaB, F.zStar),
    DM: F.DMStar / comovingDistanceMpc(E, F.H0, F.zStar),
  }
  return anchors
}

/** z*, z_d, r_s*, r_d, D_M(z*), R and l_A for a flat model; omegaM is its physical matter density Ω_m h². */
export function earlyUniverse(E: Expansion, H0: number, omegaM: number, omegaB: number): EarlyUniverse {
  const k = getAnchors()
  const zs = zStar(omegaB, omegaM) * k.zStar
  const zd = zDrag(omegaB, omegaM) * k.zDrag
  const rsStar = soundHorizonMpc(E, H0, omegaB, zs) * k.rs
  const rd = soundHorizonMpc(E, H0, omegaB, zd) * k.rs
  const DMStar = comovingDistanceMpc(E, H0, zs) * k.DM
  return { zStar: zs, zDrag: zd, rsStar, rd, DMStar, R: (Math.sqrt(omegaM) * 100 * DMStar) / C_KM_S, lA: (Math.PI * DMStar) / rsStar }
}
