# Pantheon+ SH0ES supernova distance moduli

Prepared by `pnpm data:pantheon` (`scripts/prepare-pantheon.ts`) from the public
Pantheon+ / SH0ES data release:

- Repository: https://github.com/PantheonPlusSH0ES/DataRelease
- Files: `Pantheon+_Data/4_DISTANCES_AND_COVAR/Pantheon+SH0ES.dat` and
  `Pantheon+SH0ES_STAT+SYS.cov` (SHA-256 of the downloaded copies in `meta.json`)
- Cite: Scolnic et al. 2022, ApJ 938, 113 (sample); Brout et al. 2022, ApJ 938, 110
  (cosmology and covariance); Riess et al. 2022, ApJ 934, L7 (SH0ES calibration).
- License: the release repository carries no license file as of 2026-11-02. The data are
  published for scientific reuse with citation; this repo redistributes a derived subset
  for a non-commercial educational tool. If the authors ask, swap to downloading at runtime.

## What is in here

| file | content |
|---|---|
| `sne.json` | 1590 SNe Ia with `zHD > 0.01`: `cid`, `zHD`, `zHEL`, `mu` (`MU_SH0ES`), `muErr` (√ of the covariance diagonal) |
| `chol_lower.f32` | packed row-major lower-triangular Cholesky factor of the 1590×1590 STAT+SYS covariance, float32 |
| `meta.json` | counts, provenance, file hashes |

The `zHD > 0.01` cut is the one used in the Pantheon+ cosmology analysis (peculiar
velocities dominate below it). Of the 1701 rows, 111 are dropped; that removes the
Cepheid-host calibrators too, so this is the SN-only Hubble-diagram sample. The absolute
magnitude (equivalently H0) is marginalised analytically in the likelihood, so the
SH0ES calibration in `MU_SH0ES` does not pull the fit.

Not modified: no row is re-weighted, no error is inflated, no point is excluded beyond the
published redshift cut.
