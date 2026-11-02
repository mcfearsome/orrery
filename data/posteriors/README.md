# Posterior chains (module 1.3)

Headless runs of `src/sims/cosmology/mcmc.ts` (Goodman–Weare ensemble sampler, 48 walkers,
seed 7, 30% burn-in) on the joint likelihood: Pantheon+ SH0ES (full covariance, M
marginalised) + Planck 2018 (R, ℓ_A) distance priors + DESI DR2 BAO, leak model with the
Shankar+2009 SMBH history, H0 ref = 67.4, ω_b = 0.02236, flat priors α ∈ (0, 5],
β ∈ [−4, 8], γ ∈ [−1, 5], Ωm ∈ [0.05, 0.9].

| file | model | steps | τ (max) | converged? |
|---|---|---|---|---|
| `shankar2009_smbh-beta0.json` | α, γ, Ωm (β = 0) | 5000 | 84 | yes (≈ 45 τ after burn-in) |
| `shankar2009_smbh-free.json` | α, β, γ, Ωm | 12000 | 1440 | **no** (8 τ): α and β lie on a long degenerate ridge; use the derived quantities, not α/β individually |

`*-samples.json` hold thinned post-burn-in samples (`names`, `samples`), for plots and
storyboard scenes. `params` are medians with 16/84 percentiles and the integrated
autocorrelation time; `derived` are w_eff(z = 0.1), w_eff(z = 1), Ω_DE today and H0_eff.
A future run should sample log α and a decorrelated combination of (α, β).

## Per-sample sweep (module 1.4): `samples/*.json`

Headline configuration (Shankar+2009 SMBH history, β = 0, free α, γ, Ωm) and the flat ΛCDM
joint fit (Ωm, H0), each with Planck 2018 (R, ℓ_A) + DESI DR2 BAO, for every supernova
sample and for no supernovae at all. Each file holds both fits, Δχ², and a 48-walker ×
1500-step γ posterior (30% burn-in; τ ≈ 20–100 so 10–50 τ: adequate for medians and widths).

| sample | n | Δχ² (leak − ΛCDM, 1 extra param) | γ | P(γ ≤ 0) |
|---|---|---|---|---|
| Pantheon+ | 1590 | −9.0 | 0.19 ± 0.08 | 1.1% |
| DES-SN5YR Dovekie | 1820 | −10.1 | 0.20 ± 0.07 | 0.35% |
| Union3 | 22 nodes | −10.4 | 0.28 ± 0.10 | 0.32% |
| none (CMB + BAO only) | 0 | −5.7 | 0.18 ± 0.14 | 9.7% |

## w0wa versus leak prediction (module 1.5): `prediction/*.json`

For each supernova sample (with Planck priors + DESI BAO): the flat ΛCDM joint fit, the
w0wa (CPL) best fit (Ωm, H0, w0, wa), and the headline leak fit (Shankar+2009, β = 0, free
α, γ, Ωm), then on a z grid the BAO observables D_H/r_d and D_M/r_d, w(z) and
ρ_DE(z)/ρ_DE(0) for each, with the leak's 16–84% band from the Pantheon+ β = 0 posterior,
and the DESI DR2 error where a bin exists.

| sample | w0wa (w0, wa) | Δχ² w0wa vs ΛCDM (2 params) | Δχ² leak vs ΛCDM (1 param) | leak − w0wa |
|---|---|---|---|---|
| Pantheon+ | −0.851, −0.538 | −7.8 | −9.0 | −1.2 |
| DES-SN5YR | −0.817, −0.660 | −11.1 | −10.1 | +1.0 |
| Union3 | −0.680, −1.021 | −14.2 | −10.4 | +3.9 |

Leak − w0wa in D_H/r_d is at most 1% (at z ≈ 1–1.5) and at most 0.3σ of any DESI DR2 bin,
although their w(z) differ strongly above z ≈ 1.5 (leak −1.6 at z = 2.33, w0wa −1.2):
dark energy is subdominant there. BAO alone cannot separate them at present precision.
