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

### Not in v1

No WebGPU, no N-body, no backend, no auth. The data are never re-weighted to the model.
