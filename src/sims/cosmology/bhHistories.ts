/**
 * Published black-hole mass-density histories ρ_BH(z), comoving, M☉ Mpc⁻³, as log10.
 *
 * None of the source papers tabulates ρ_BH(z) in print, so each table below was
 * extracted from the paper's own figure file in its arXiv source:
 *  - shankar2009_smbh: Shankar, Weinberg & Miralda-Escudé 2009, ApJ 690, 20
 *    (arXiv:0710.4488), Fig. 6b solid line "ρ•(z) from AGN LF": the vertices of
 *    the PostScript path in rhoBHz.eps (vector, so exact to the plotted
 *    resolution); axes calibrated from the tick marks; first vertex at z = 0.027
 *    is 4.498e5, the paper's adopted local density 4.5e5. Covers z = 0–6.
 *  - sicilia2022_smbh: Sicilia et al. 2022b, ApJ 934, 66 (arXiv:2206.07357),
 *    Fig. 8 solid line "Overall"; BHMF_bhmd.png digitised by colour tracking
 *    against the frame (z = −1…8, log ρ = 0…7). Local value 10^5.87 ≈ 7e5 vs the
 *    text's ≈6e5. Covers z = 0–8. Held flat below z = 0.22 (markers cover it).
 *  - sicilia2022_stellar: Sicilia et al. 2022a, ApJ 924, 56 (arXiv:2110.15607),
 *    Fig. 7 solid blue line; BHMF_density.png digitised by colour against the
 *    tick marks. Local value 10^7.79 ≈ 6e7 vs the text's ≈5e7. Covers z = 0–10.
 * Digitisation accuracy is about ±0.02 dex (one pixel); the shape is what the
 * leak law uses, since α absorbs the normalisation.
 *
 * Interpolation: monotone cubic (Fritsch–Carlson PCHIP) in z of log10 ρ, which
 * keeps ρ(z) decreasing so the formation rate is never negative. Beyond each
 * table's last point log ρ is extrapolated with the final slope and cut at
 * z = 30, where every history is below 1e-4 of its local value.
 */

export interface HistoryTable {
  id: BHHistoryId
  label: string
  citation: string
  /** log10 of the local comoving mass density, M☉ Mpc⁻³ */
  logRho0: number
  zMax: number
  z: number[]
  logRho: number[]
}

export const BH_HISTORY_IDS = ['sfr_proxy', 'shankar2009_smbh', 'sicilia2022_smbh', 'sicilia2022_stellar', 'sicilia2022_total'] as const
export type BHHistoryId = (typeof BH_HISTORY_IDS)[number]

export const SHANKAR2009_SMBH: HistoryTable = {
  id: 'shankar2009_smbh',
  label: 'Shankar+2009 SMBH (AGN LF, Soltan)',
  citation: 'Shankar, Weinberg & Miralda-Escudé 2009, ApJ 690, 20, Fig. 6b',
  logRho0: 5.653,
  zMax: 6,
  z: [0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.25, 2.5, 2.75, 3, 3.25, 3.5, 3.75, 4, 4.25, 4.5, 4.75, 5, 5.25, 5.5, 5.75, 6],
  logRho: [5.653, 5.6323, 5.5948, 5.541, 5.4695, 5.3841, 5.286, 5.1745, 5.0478, 4.9203, 4.7945, 4.6687, 4.5394, 4.4057, 4.2643, 4.111, 3.9355, 3.7465, 3.5546, 3.3576, 3.1599, 2.9355, 2.6925, 2.3915, 1.7894],
}

export const SICILIA2022_SMBH: HistoryTable = {
  id: 'sicilia2022_smbh',
  label: 'Sicilia+2022 SMBH (continuity eq.)',
  citation: 'Sicilia et al. 2022b, ApJ 934, 66, Fig. 8',
  logRho0: 5.8736,
  zMax: 8,
  z: [0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.25, 2.5, 2.75, 3, 3.25, 3.5, 3.75, 4, 4.25, 4.5, 4.75, 5, 5.25, 5.5, 5.75, 6, 6.25, 6.5, 6.75, 7, 7.25, 7.5, 7.75, 8],
  logRho: [5.8736, 5.8736, 5.8575, 5.8231, 5.7609, 5.6925, 5.6143, 5.5195, 5.4176, 5.3103, 5.1852, 5.0529, 4.9116, 4.7632, 4.6023, 4.4315, 4.2483, 4.0713, 3.871, 3.6681, 3.4651, 3.2461, 3.0271, 2.808, 2.5729, 2.3378, 2.0866, 1.8506, 1.5842, 1.333, 1.0656, 0.7983, 0.5471],
}

export const SICILIA2022_STELLAR: HistoryTable = {
  id: 'sicilia2022_stellar',
  label: 'Sicilia+2022 stellar BHs',
  citation: 'Sicilia et al. 2022a, ApJ 924, 56, Fig. 7',
  logRho0: 7.7867,
  zMax: 10,
  z: [0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.25, 2.5, 2.75, 3, 3.25, 3.5, 3.75, 4, 4.25, 4.5, 4.75, 5, 5.25, 5.5, 5.75, 6, 6.25, 6.5, 6.75, 7, 7.25, 7.5, 7.75, 8, 8.25, 8.5, 8.75, 9, 9.25, 9.5, 9.75, 10],
  logRho: [7.7867, 7.7665, 7.7422, 7.6991, 7.6533, 7.597, 7.5309, 7.4531, 7.3753, 7.2905, 7.2057, 7.1098, 7.0193, 6.9291, 6.8302, 6.7301, 6.6302, 6.5343, 6.4384, 6.3425, 6.2466, 6.1517, 6.0627, 5.9699, 5.8848, 5.7958, 5.7068, 5.629, 5.546, 5.4621, 5.3859, 5.3101, 5.2344, 5.1618, 5.0839, 5.0126, 4.9394, 4.8615, 4.7909, 4.7169, 4.639],
}

export const HISTORY_TABLES: Record<Exclude<BHHistoryId, 'sfr_proxy' | 'sicilia2022_total'>, HistoryTable> = {
  shankar2009_smbh: SHANKAR2009_SMBH,
  sicilia2022_smbh: SICILIA2022_SMBH,
  sicilia2022_stellar: SICILIA2022_STELLAR,
}

export const BH_HISTORY_LABELS: Record<BHHistoryId, string> = {
  sfr_proxy: 'SFR proxy (Madau & Dickinson 2014 shape)',
  shankar2009_smbh: SHANKAR2009_SMBH.label,
  sicilia2022_smbh: SICILIA2022_SMBH.label,
  sicilia2022_stellar: SICILIA2022_STELLAR.label,
  sicilia2022_total: 'Sicilia+2022 stellar + SMBH (mass-weighted sum)',
}

// ---------------------------------------------------------------------------
// Monotone cubic interpolation (Fritsch & Carlson 1980), value and derivative.
// ---------------------------------------------------------------------------

export class Pchip {
  readonly x: number[]
  readonly y: number[]
  private readonly d: number[]
  constructor(x: number[], y: number[]) {
    this.x = x
    this.y = y
    const n = x.length
    const h = Array.from({ length: n - 1 }, (_, i) => x[i + 1] - x[i])
    const del = Array.from({ length: n - 1 }, (_, i) => (y[i + 1] - y[i]) / h[i])
    const d = new Array<number>(n).fill(0)
    for (let i = 1; i < n - 1; i++) {
      if (del[i - 1] * del[i] <= 0) d[i] = 0
      else {
        const w1 = 2 * h[i] + h[i - 1], w2 = h[i] + 2 * h[i - 1]
        d[i] = (w1 + w2) / (w1 / del[i - 1] + w2 / del[i])
      }
    }
    const end = (h0: number, h1: number, d0: number, d1: number) => {
      let s = ((2 * h0 + h1) * d0 - h0 * d1) / (h0 + h1)
      if (Math.sign(s) !== Math.sign(d0)) s = 0
      else if (Math.sign(d0) !== Math.sign(d1) && Math.abs(s) > Math.abs(3 * d0)) s = 3 * d0
      return s
    }
    d[0] = end(h[0], h[1], del[0], del[1])
    d[n - 1] = end(h[n - 2], h[n - 3], del[n - 2], del[n - 3])
    this.d = d
  }
  private seg(xq: number): number {
    const x = this.x
    let lo = 0, hi = x.length - 2
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (x[mid] <= xq) lo = mid; else hi = mid - 1 }
    return lo
  }
  /** value and first derivative at xq (linear extrapolation with end slopes outside the table) */
  eval(xq: number): [number, number] {
    const x = this.x, y = this.y, d = this.d
    const n = x.length
    if (xq <= x[0]) return [y[0] + d[0] * (xq - x[0]), d[0]]
    if (xq >= x[n - 1]) return [y[n - 1] + d[n - 1] * (xq - x[n - 1]), d[n - 1]]
    const i = this.seg(xq)
    const h = x[i + 1] - x[i], t = (xq - x[i]) / h
    const h00 = (1 + 2 * t) * (1 - t) ** 2, h10 = t * (1 - t) ** 2, h01 = t * t * (3 - 2 * t), h11 = t * t * (t - 1)
    const v = h00 * y[i] + h10 * h * d[i] + h01 * y[i + 1] + h11 * h * d[i + 1]
    const dh00 = 6 * t * t - 6 * t, dh10 = 3 * t * t - 4 * t + 1, dh01 = -6 * t * t + 6 * t, dh11 = 3 * t * t - 2 * t
    const dv = (dh00 * y[i] + dh10 * h * d[i] + dh01 * y[i + 1] + dh11 * h * d[i + 1]) / h
    return [v, dv]
  }
}

/** A black-hole mass-density history: normalised cumulative mass f(z) ∈ [0, 1] and its rate per unit ln a. */
export interface BHHistory {
  id: BHHistoryId
  /** ρ_BH(z)/ρ_BH(0) */
  fraction(z: number): number
  /** df/d(ln a) = −(1+z) df/dz ≥ 0: normalised comoving mass-formation rate per unit ln a */
  ratePerLnA(z: number): number
  zCut: number
}

export const HISTORY_Z_CUT = 30

function tableHistory(t: HistoryTable): BHHistory {
  const p = new Pchip(t.z, t.logRho)
  const LN10 = Math.LN10
  const f0 = 10 ** t.logRho0
  return {
    id: t.id,
    zCut: HISTORY_Z_CUT,
    fraction(z) {
      if (z >= HISTORY_Z_CUT) return 0
      return 10 ** p.eval(z)[0] / f0
    },
    ratePerLnA(z) {
      if (z >= HISTORY_Z_CUT) return 0
      const [v, dv] = p.eval(z)
      return Math.max(0, -(1 + z) * LN10 * dv * (10 ** v / f0))
    },
  }
}

/** Sum of two comoving mass densities, weighted by their local values, then normalised. */
function sumHistory(id: BHHistoryId, a: HistoryTable, b: HistoryTable): BHHistory {
  const ha = tableHistory(a), hb = tableHistory(b)
  const wa = 10 ** a.logRho0, wb = 10 ** b.logRho0, w = wa + wb
  return {
    id,
    zCut: HISTORY_Z_CUT,
    fraction: (z) => (wa * ha.fraction(z) + wb * hb.fraction(z)) / w,
    ratePerLnA: (z) => (wa * ha.ratePerLnA(z) + wb * hb.ratePerLnA(z)) / w,
  }
}

const cache = new Map<BHHistoryId, BHHistory>()
/** Tabulated histories by id; 'sfr_proxy' is built in model.ts and is not served here. */
export function tabulatedHistory(id: Exclude<BHHistoryId, 'sfr_proxy'>): BHHistory {
  let h = cache.get(id)
  if (!h) {
    h = id === 'sicilia2022_total' ? sumHistory(id, SICILIA2022_STELLAR, SICILIA2022_SMBH) : tableHistory(HISTORY_TABLES[id])
    cache.set(id, h)
  }
  return h
}
