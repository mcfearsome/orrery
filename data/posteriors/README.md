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
