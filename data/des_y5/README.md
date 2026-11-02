# DES-SN5YR (Dovekie) supernova Hubble diagram

Prepared by `python3 scripts/prepare-sn-extra.py` from the public Dark Energy Survey
5-year SN Ia release, Dovekie recalibration:

- Repository: https://github.com/des-science/DES-SN5YR, directory `4_DISTANCES_COVMAT`
- Files: `DES-Dovekie_HD.csv` (1820 SNe: 1635 DES + 185 low-z) and `STAT+SYS.npz`
  (upper-triangular **inverse** covariance; this script inverts it and stores the Cholesky
  factor of the covariance). SHA-256 of both in `meta.json`.
- Cite: DES Collaboration (Abbott et al.) 2024, ApJL 973, L14; Vincenzi et al. 2024, ApJ 975, 86
  (Hubble diagram); Popovic et al. 2025 (Dovekie recalibration). License: the release
  repository states the data are public; cite the papers.

| file | content |
|---|---|
| `sne.json` | `cid`, `zHD` (CMB frame, peculiar-velocity corrected), `zHEL`, `mu` (`MU`, assumes H0 = 70; the absolute magnitude is marginalised so this does not matter), `muErr` (√ of the covariance diagonal) |
| `chol_lower.f32` | packed lower-triangular Cholesky factor of the 1820×1820 STAT+SYS covariance, float32 |
| `meta.json` | counts, provenance, hashes |

All 1820 SNe are kept, as in the DES likelihood (`zHD > 0`). Flat ΛCDM on this sample alone
gives Ωm = 0.330 with our pipeline (Dovekie recalibration; the 2024 release gave 0.352 ± 0.017).
