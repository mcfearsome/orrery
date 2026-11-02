import { z } from 'zod'
import { BH_HISTORY_IDS } from './bhHistories'

/** Flat/curved ΛCDM background. Fractions are relative to the critical density at H0. */
export const LCDMParams = z.object({
  /** km/s/Mpc */
  H0: z.number().positive().default(67.4),
  /** matter (baryons + CDM) */
  Om: z.number().min(0).max(2).default(0.315),
  /** radiation (photons + relativistic neutrinos); 0 ignores it */
  Or: z.number().min(0).max(0.01).default(0),
  /** curvature; 0 is flat. ΩΛ is whatever closes the sum. */
  Ok: z.number().min(-1).max(1).default(0),
})
export type LCDMParams = z.infer<typeof LCDMParams>

/**
 * Leak law v1 (see model.ts `leakSource`):
 *   dρ_leak/dt = α · ṁ_BH(t) · (1+z)^β,  ρ_leak dilutes as (1+z)^γ
 * where ṁ_BH is the physical BH mass-formation rate density.
 */
export const LeakParams = z.object({
  /** amplitude, in units of ρ_crit(H0) per unit normalised BH mass formed */
  alpha: z.number().min(0).max(10).default(0.03),
  /** extra redshift weighting of the source; 0 = untuned law */
  beta: z.number().min(-6).max(10).default(0),
  /** dilution exponent: 0 behaves like Λ, 3 like matter, 4 like radiation */
  gamma: z.number().min(-2).max(6).default(0),
})
export type LeakParams = z.infer<typeof LeakParams>

/** Leak-model background: ΛCDM with ΩΛ replaced by the integrated leak component. Always flat. */
export const LeakModelParams = z.object({
  H0: z.number().positive().default(67.4),
  Om: z.number().min(0).max(2).default(0.315),
  Or: z.number().min(0).max(0.01).default(0),
  leak: LeakParams.default(() => LeakParams.parse({})),
  /** which black-hole mass-density history sources the leak */
  bhHistory: z.enum(BH_HISTORY_IDS).default('sfr_proxy'),
})
export type LeakModelParams = z.infer<typeof LeakModelParams>

export const CosmologyConfig = z.object({
  lcdm: LCDMParams.default(() => LCDMParams.parse({})),
  leak: LeakModelParams.default(() => LeakModelParams.parse({})),
  /** redshift cut applied to the supernova sample (Pantheon+ cosmology analyses use 0.01) */
  zMin: z.number().min(0).default(0.01),
  /** χ² uses the full STAT+SYS covariance when true, diagonal errors otherwise */
  fullCovariance: z.boolean().default(true),
  /** external distance priors added to χ² */
  priors: z.object({
    /** Planck 2018 (R, l_A) compressed CMB priors */
    cmb: z.boolean().default(false),
    /** DESI DR2 BAO D_M/r_d, D_H/r_d, D_V/r_d */
    bao: z.boolean().default(false),
  }).default(() => ({ cmb: false, bao: false })),
  /** physical baryon density Ω_b h², held fixed (Planck 2018) */
  omegaB: z.number().positive().default(0.02236),
  /** also vary Ωm (and H0 for ΛCDM) in the fits */
  fitDensities: z.boolean().default(true),
})
export type CosmologyConfig = z.infer<typeof CosmologyConfig>

export const FitBounds = z.object({
  alpha: z.tuple([z.number(), z.number()]).default([0, 5]),
  beta: z.tuple([z.number(), z.number()]).default([-4, 8]),
  gamma: z.tuple([z.number(), z.number()]).default([-1, 5]),
})
export type FitBounds = z.infer<typeof FitBounds>
