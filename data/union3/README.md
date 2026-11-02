# Union3 / UNITY1.5 compressed distance moduli

Prepared by `python3 scripts/prepare-sn-extra.py` from the public Union3 release:

- Repository: https://github.com/rubind/union3_release, file `mu_mat_union3_cosmo=2_mu.fits`
  (row 0: 22 spline-node redshifts; column 0: distance moduli; the rest: inverse covariance).
  SHA-256 in `meta.json`.
- Cite: Rubin et al. 2023, arXiv:2311.12098 (Union3 and UNITY1.5). License: see `LICENSE` in the
  release repository (MIT).

| file | content |
|---|---|
| `sne.json` | 22 nodes: `cid` = node1…node22, `zHD` = `zHEL` = node redshift, `mu`, `muErr` (√ of the covariance diagonal) |
| `chol_lower.f32` | packed lower-triangular Cholesky factor of the 22×22 covariance (inverse of the released matrix), float32 |

The nodes are a compression of 2087 SNe from 24 samples; the distance-modulus offset is
arbitrary and is marginalised by the likelihood. Flat ΛCDM on these nodes alone gives
Ωm = 0.356 with our pipeline (published: 0.356 +0.028/−0.026).
