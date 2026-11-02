# orrery

Code Nerd visual math / physics playground. Every simulation is a pure TypeScript model
with a zod schema, runs in a Web Worker, and can export a `Scene` JSON that the storyboard
pipeline (Remotion + Manim) renders from.

## Module 1 · background cosmology: black-hole leak vs ΛCDM

A Friedmann integrator that replaces the cosmological constant with an energy component
`ρ_leak(t)` sourced by black-hole formation, fitted to the Pantheon+ SH0ES supernova
Hubble diagram and compared against flat ΛCDM.

```
pnpm install
pnpm dev            # http://localhost:5173
pnpm test           # astropy-referenced distance tests + Pantheon+ ΛCDM reproduction
pnpm data:pantheon  # regenerate data/pantheon_plus from the public release (cached in .cache/)
```

### Layout

```
src/sims/cosmology/
  schema.ts   zod: LCDMParams, LeakParams, LeakModelParams, CosmologyConfig, FitBounds
  model.ts    pure math: Friedmann E(z), RK4 distances, BH formation history,
              leak law (ONE function: leakSource), χ² with marginalised M, Nelder–Mead
  data.ts     loads data/pantheon_plus
  worker.ts   Comlink API: loadData, evaluate, fitLeak, fitLcdmOm
  ui.tsx      the panel; charts.tsx are plain SVG primitives
src/scenes/   Scene / Storyboard zod schema + exported presets
data/         datasets with a README citing source and license (served as Vite publicDir)
scripts/      Node-only data preparation (never shipped)
```

### The model, precisely

Expansion, in units of the critical density at the reference `H0`:

```
E(z)² = Ωr (1+z)⁴ + Ωm (1+z)³ + Ω_leak(z)
```

Leak law v1 (`model.ts: leakSource`), with `x = ln a`:

```
dρ_leak/dt = α · ṁ_BH(t) · (1+z)^β  −  γ H ρ_leak
```

`ṁ_BH` is the *physical* black-hole mass-formation rate density, so `β = 0` is the untuned
law; `γ` is the dilution exponent (0 behaves like Λ, 3 like matter). Dividing by `H` cancels
the Hubble rate from the source, so the leak history depends only on the BH history:

```
dΩ_leak/dx = α (1+z)^(β+3) f'(x) − γ Ω_leak        f(z) = ρ_BH(z)/ρ_BH(0)
```

`Ω_leak(0)` is whatever the integral gives, so the model is flat with a floating effective
`H0_eff = H0 · E(0)`; the supernova likelihood marginalises the absolute magnitude, so only
the shape of μ(z) is tested. The readouts show the real fractions `Ω_leak,0 / E(0)²` and
`Ωm / E(0)²`.

**BH formation history (v1, analytic approximation, flagged):** the comoving BH mass density
is assumed to follow the integrated cosmic star-formation history of Madau & Dickinson 2014
(ARA&A 52, 415, eq. 15), normalised to the local SMBH mass density of Shankar et al. 2009
(ApJ 690, 20), ≈ 4.3×10⁵ M☉ Mpc⁻³. Only the shape matters because α absorbs the
normalisation. Replace `bhFormationRateNormalised` with a tabulated BH mass-function
integral when one is wanted.

**Likelihood:** residuals against `MU_SH0ES` with `d_L = (1+z_hel) D_M(z_HD)`, the full
STAT+SYS covariance through its Cholesky factor, and the magnitude offset marginalised
analytically (χ² = A − B²/C). The TypeScript pipeline reproduces the published SN-only flat
ΛCDM fit: Ωm = 0.332 (Brout et al. 2022: 0.334 ± 0.018), χ² = 1402.9 for 1590 SNe. That
number is locked in `pantheon.test.ts`.

### Module 1.1 · CMB and BAO priors

Supernovae alone cannot separate a late-rising constant from Λ, so the likelihood can add
two external priors (`src/sims/cosmology/priors.ts`, both off by default in the UI):

- **CMB:** Planck 2018 TT,TE,EE+lowE compressed distance priors (R, ℓ_A) with their
  correlation, from Chen, Huang & Wang 2019 (JCAP 02, 028), ω_b held at the Planck mean.
- **BAO:** DESI DR2 (Abdul-Karim et al. 2025, arXiv:2503.14738) Table 4, seven bins of
  D_M/r_d, D_H/r_d (with their per-bin correlation) and D_V/r_d for BGS.

`model.ts: earlyUniverse` computes z*, z_drag, r_s*, r_d and D_M(z*) from the model's own
expansion history, using the Hu & Sugiyama and Eisenstein & Hu fitting formulas and a
Simpson sound-horizon integral, each anchored by a constant factor so that the Planck 2018
best fit reproduces Planck's exact values (the raw formulas are 0.1–3% off, which is many σ
for these priors). This is valid for models that change only the late-time expansion; the
leak component is 0.2% of matter at z = 6. Locked in `priors.test.ts`: the DESI BAO-alone
flat ΛCDM fit returns Ωm = 0.2975 (published 0.2975 ± 0.0086) and the SN+CMB+BAO ΛCDM fit
returns Ωm = 0.302, H0 = 68.3 (DESI+CMB published: 0.3027 ± 0.0036, 68.17 ± 0.28).

With priors on, the fits vary Ωm (and H0 for ΛCDM). The scene export carries every χ²
component and the (R, ℓ_A, r_d) of both models.

### Module 1.2 · published black-hole histories

The SFR-shaped proxy is now one of five selectable histories (`bhHistories.ts`, dropdown in
the leak card). The other four are read from the papers' own figure files in their arXiv
sources, because none prints ρ_BH(z) as a table:

| id | source | extraction | z range |
|---|---|---|---|
| `shankar2009_smbh` | Shankar, Weinberg & Miralda-Escudé 2009, ApJ 690, 20, Fig. 6b | vertices of the PostScript path (vector, exact) | 0–6 |
| `sicilia2022_smbh` | Sicilia et al. 2022b, ApJ 934, 66, Fig. 8 "Overall" | colour-tracked raster, frame-calibrated | 0–8 |
| `sicilia2022_stellar` | Sicilia et al. 2022a, ApJ 924, 56, Fig. 7 | colour-tracked raster, tick-calibrated | 0–10 |
| `sicilia2022_total` | mass-weighted sum of the two Sicilia histories | | 0–10 |

Each table is log₁₀ ρ on a 0.25 step in z, interpolated with a monotone cubic (PCHIP) so ρ
never increases with z, extrapolated with the end slope and cut at z = 30. The leak law takes
the normalised rate per unit ln a, so α still absorbs the normalisation and only the shape
matters. Tests check each history is monotone, starts at 1 and integrates to 1.

### Module 1.3 · posteriors by MCMC

`mcmc.ts` is a Goodman & Weare (2010) affine-invariant ensemble sampler (the emcee stretch
move) with a seeded RNG, so runs are reproducible. The worker exposes it in chunks
(`mcmcStart`, `mcmcStep`, `mcmcSamples`, `mcmcStop`) so the UI can stop between chunks. It
samples (α, β, γ, Ωm), or (α, γ, Ωm) with β fixed at 0, under flat priors α ∈ (0, 5],
β ∈ [−4, 8], γ ∈ [−1, 5], Ωm ∈ [0.05, 0.9], with the log-likelihood −χ²/2 of whatever
SN / CMB / BAO combination is switched on. The Posterior card reports medians with 16–84%
intervals, the integrated autocorrelation time τ per parameter, acceptance rate and the best
χ² seen; the panel below the BAO plot shows any 2-D projection and the 1-D histogram. A
30% burn-in is discarded. One likelihood evaluation takes about 5 ms, so 32 walkers × 600
steps is a couple of minutes in the browser.

### Module 1.4 · alternative supernova samples

The Data card selects which supernova sample enters χ²: Pantheon+ SH0ES (default), DES-SN5YR
Dovekie (1820 SNe, `data/des_y5`), Union3 / UNITY1.5 (22 binned nodes, `data/union3`), or none
(CMB + BAO only). All three use the same likelihood: full covariance through a Cholesky
factor and an analytically marginalised magnitude offset. The two extra samples are prepared
by `scripts/prepare-sn-extra.py` (Python, because the releases ship `.npz` and `.fits`; never
part of the shipped tool). Each dataset directory has a README with sources, citations and
what was done to the files. Sanity checks in `samples.test.ts`: flat ΛCDM alone gives
Ωm = 0.330 on DES Dovekie and 0.356 on Union3 (published 0.356 +0.028/−0.026).

### Not in v1

No WebGPU, no N-body, no backend, no auth. The data are never re-weighted to the model.
