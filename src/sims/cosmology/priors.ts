/**
 * External distance priors used alongside the supernovae.
 *
 * CMB: Planck 2018 TT,TE,EE+lowE compressed distance priors from
 *   Chen, Huang & Wang 2019, JCAP 02, 028 (arXiv:1808.05724), Table 1, ΛCDM row.
 *   We use (R, l_A) with their correlation and hold ω_b at the Planck mean; the
 *   ω_b and n_s rows are not used because the leak model does not change them.
 *   Caveat: the priors were derived assuming ΛCDM-like early physics; they are
 *   valid for models that only change the late-time expansion, which the leak
 *   model does (ρ_leak is zero before z ≈ 6).
 *
 * BAO: DESI DR2 (Abdul-Karim et al. 2025, arXiv:2503.14738), Table 4, the seven
 *   consensus bins used for cosmology. Values transcribed from the arXiv HTML;
 *   r_{M,H} is the correlation between D_M/r_d and D_H/r_d in each bin.
 *   Cross-bin correlations are neglected (DESI treats them as negligible).
 */
import type { BAOPoint } from './model'

export const PLANCK18_DISTANCE_PRIORS = {
  R: 1.7502, Rerr: 0.0046,
  lA: 301.471, lAerr: 0.0895,
  rho: 0.46,
  omegaB: 0.02236, omegaBerr: 0.00015,
  source: 'Chen, Huang & Wang 2019 (arXiv:1808.05724) Table 1, Planck 2018 TT,TE,EE+lowE, ΛCDM',
} as const

export const DESI_DR2_BAO: BAOPoint[] = [
  { label: 'BGS', z: 0.295, DV: [7.942, 0.075] },
  { label: 'LRG1', z: 0.51, DM: [13.588, 0.167], DH: [21.863, 0.425], rMH: -0.459 },
  { label: 'LRG2', z: 0.706, DM: [17.351, 0.177], DH: [19.455, 0.33], rMH: -0.404 },
  { label: 'LRG3+ELG1', z: 0.934, DM: [21.576, 0.152], DH: [17.641, 0.193], rMH: -0.416 },
  { label: 'ELG2', z: 1.321, DM: [27.601, 0.318], DH: [14.176, 0.221], rMH: -0.434 },
  { label: 'QSO', z: 1.484, DM: [30.512, 0.76], DH: [12.817, 0.516], rMH: -0.5 },
  { label: 'Lyα', z: 2.33, DM: [38.988, 0.531], DH: [8.632, 0.101], rMH: -0.431 },
]
export const DESI_DR2_SOURCE = 'DESI DR2 Results II (arXiv:2503.14738) Table 4'
/** DESI DR2 BAO-alone flat ΛCDM: Ωm = 0.2975 ± 0.0086 (their eq. 17), for the reproduction test. */
export const DESI_DR2_LCDM_OM = { value: 0.2975, err: 0.0086 }
