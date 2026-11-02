#!/usr/bin/env python3
"""
Prepare the DES-SN5YR (Dovekie) and Union3 supernova samples for the browser,
in the same layout as data/pantheon_plus (sne.json + packed Cholesky factor).

Python (numpy + astropy) because the releases ship .npz and .fits; this script is
never part of the shipped tool. Sources are cloned bloblessly into .cache/ and
only the needed files are checked out:
  DES-SN5YR: https://github.com/des-science/DES-SN5YR  4_DISTANCES_COVMAT/
             DES-Dovekie_HD.csv (1820 SNe) + STAT+SYS.npz (upper-triangular INVERSE covariance)
  Union3:    https://github.com/rubind/union3_release   mu_mat_union3_cosmo=2_mu.fits
             (row 0 = node redshifts, column 0 = distance moduli, rest = inverse covariance)

Run: python3 scripts/prepare-sn-extra.py   (needs numpy, astropy)
"""
import hashlib, json, os, subprocess, sys
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, '.cache', 'sn')
os.makedirs(CACHE, exist_ok=True)

def clone(repo, name, paths):
    d = os.path.join(CACHE, name)
    if not os.path.isdir(d):
        subprocess.run(['git', 'clone', '-q', '--filter=blob:none', '--depth', '1', repo, d], check=True)
    subprocess.run(['git', '-C', d, 'checkout', '-q', 'HEAD', '--', *paths], check=True)
    return d

def sha(path):
    return hashlib.sha256(open(path, 'rb').read()).hexdigest()

def packed_cholesky(C):
    L = np.linalg.cholesky(C)
    n = len(C)
    out = np.empty(n * (n + 1) // 2, dtype=np.float32)
    k = 0
    for i in range(n):
        out[k:k + i + 1] = L[i, :i + 1]
        k += i + 1
    return out

def write(outdir, cid, zhd, zhel, mu, C, meta):
    os.makedirs(outdir, exist_ok=True)
    json.dump({'cid': cid, 'zHD': [float(v) for v in zhd], 'zHEL': [float(v) for v in zhel], 'mu': [float(v) for v in mu],
               'muErr': [float(v) for v in np.sqrt(np.diag(C))]}, open(os.path.join(outdir, 'sne.json'), 'w'))
    packed_cholesky(C).tofile(os.path.join(outdir, 'chol_lower.f32'))
    meta.update({'nKept': len(mu), 'cholLowerPackedLength': len(mu) * (len(mu) + 1) // 2})
    json.dump(meta, open(os.path.join(outdir, 'meta.json'), 'w'), indent=2)
    print(outdir, 'n =', len(mu))

# --- DES-SN5YR Dovekie ---------------------------------------------------------------
d = clone('https://github.com/des-science/DES-SN5YR', 'DES-SN5YR', ['4_DISTANCES_COVMAT/DES-Dovekie_HD.csv', '4_DISTANCES_COVMAT/STAT+SYS.npz', '4_DISTANCES_COVMAT/README.md'])
hd = os.path.join(d, '4_DISTANCES_COVMAT', 'DES-Dovekie_HD.csv')
rows = [l.split() for l in open(hd) if l.startswith('SN:')]
names = [l.split()[1:] for l in open(hd) if l.startswith('VARNAMES:')][0]
col = {n: i + 1 for i, n in enumerate(names)}  # +1 for the 'SN:' token
cid = [r[col['CID']] for r in rows]
zhd = np.array([float(r[col['zHD']]) for r in rows]); zhel = np.array([float(r[col['zHEL']]) for r in rows])
mu = np.array([float(r[col['MU']]) for r in rows])
npz = np.load(os.path.join(d, '4_DISTANCES_COVMAT', 'STAT+SYS.npz'))
n = int(npz['nsn'][0]); assert n == len(rows), (n, len(rows))
inv = np.zeros((n, n)); inv[np.triu_indices(n)] = npz['cov']; lo = np.tril_indices(n, -1); inv[lo] = inv.T[lo]
C = np.linalg.inv(inv); C = 0.5 * (C + C.T)
ev = np.linalg.eigvalsh(C); print('DES cov eigen min/max', ev.min(), ev.max())
write(os.path.join(ROOT, 'data', 'des_y5'), cid, zhd, zhel, mu, C, {
    'source': 'https://github.com/des-science/DES-SN5YR (4_DISTANCES_COVMAT, Dovekie release)',
    'files': {'hd': 'DES-Dovekie_HD.csv', 'cov': 'STAT+SYS.npz (inverse covariance, upper triangle)'},
    'sha256': {'hd': sha(hd), 'cov': sha(os.path.join(d, '4_DISTANCES_COVMAT', 'STAT+SYS.npz'))},
    'zMin': 0.0, 'nTotal': n, 'note': 'all SNe kept, as in the DES likelihood; MU assumes H0 = 70 and M is marginalised'})

# --- Union3 ---------------------------------------------------------------------------
from astropy.io import fits
u = clone('https://github.com/rubind/union3_release', 'union3_release', ['mu_mat_union3_cosmo=2_mu.fits', 'LICENSE', 'README.md'])
f = os.path.join(u, 'mu_mat_union3_cosmo=2_mu.fits')
m = fits.open(f)[0].data.astype(float)
z = m[0, 1:]; muu = m[1:, 0]; invu = m[1:, 1:]; invu = 0.5 * (invu + invu.T)
ev = np.linalg.eigvalsh(invu); print('Union3 inverse-cov eigen min/max', ev.min(), ev.max())
Cu = np.linalg.inv(invu); Cu = 0.5 * (Cu + Cu.T)
print('Union3 cov eigen min', np.linalg.eigvalsh(Cu).min())
write(os.path.join(ROOT, 'data', 'union3'), [f'node{i + 1}' for i in range(len(z))], z, z, muu, Cu, {
    'source': 'https://github.com/rubind/union3_release (mu_mat_union3_cosmo=2_mu.fits)',
    'files': {'fits': 'mu_mat_union3_cosmo=2_mu.fits'}, 'sha256': {'fits': sha(f)},
    'zMin': 0.0, 'nTotal': len(z), 'note': 'UNITY1.5 compressed distance moduli at 22 spline nodes with their inverse covariance; zHEL set to the node z'})
