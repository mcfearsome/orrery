/**
 * Prepare the Pantheon+ SH0ES supernova sample for the browser.
 *
 * Downloads (once, into .cache/) the public release files from
 * https://github.com/PantheonPlusSH0ES/DataRelease, applies the standard
 * cosmology cut (zHD > 0.01, drops the Cepheid-host calibrators' redshift floor),
 * and writes:
 *   data/pantheon_plus/sne.json        cid, zHD, zHEL, MU_SH0ES, sqrt(diag C)
 *   data/pantheon_plus/chol_lower.f32  packed lower-triangular Cholesky factor of
 *                                      the STAT+SYS covariance of the cut sample
 *                                      (row-major, float32, n(n+1)/2 entries)
 *   data/pantheon_plus/meta.json       counts and provenance
 *
 * Run: pnpm data:pantheon
 */
import { createHash } from 'node:crypto'
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const BASE = 'https://raw.githubusercontent.com/PantheonPlusSH0ES/DataRelease/main/Pantheon%2B_Data/4_DISTANCES_AND_COVAR/'
const FILES = { dat: 'Pantheon%2BSH0ES.dat', cov: 'Pantheon%2BSH0ES_STAT%2BSYS.cov' }
const Z_MIN = 0.01
const cache = join(process.cwd(), '.cache', 'pantheon')
const out = join(process.cwd(), 'data', 'pantheon_plus')
mkdirSync(cache, { recursive: true })
mkdirSync(out, { recursive: true })

async function fetchCached(name: string): Promise<string> {
  const p = join(cache, decodeURIComponent(name))
  if (!existsSync(p)) {
    console.log('downloading', name)
    const res = await fetch(BASE + name)
    if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`)
    writeFileSync(p, await res.text())
  }
  return readFileSync(p, 'utf8')
}

const datText = await fetchCached(FILES.dat)
const lines = datText.trim().split('\n')
const header = lines[0].trim().split(/\s+/)
const col = (name: string) => {
  const i = header.indexOf(name)
  if (i < 0) throw new Error(`column ${name} missing`)
  return i
}
const iCID = col('CID'), iZHD = col('zHD'), iZHEL = col('zHEL'), iMU = col('MU_SH0ES'), iERR = col('MU_SH0ES_ERR_DIAG')
const rows = lines.slice(1).map((l) => l.trim().split(/\s+/))
const keep: number[] = []
rows.forEach((r, i) => { if (Number(r[iZHD]) > Z_MIN) keep.push(i) })
const n = keep.length
console.log(`rows ${rows.length}, kept ${n} with zHD > ${Z_MIN}`)

const covText = await fetchCached(FILES.cov)
const covTokens = covText.trim().split(/\s+/)
const N = Number(covTokens[0])
if (N !== rows.length) throw new Error(`cov dimension ${N} != rows ${rows.length}`)
// Full matrix as Float64Array (N*N ≈ 2.9M doubles)
const C = new Float64Array(n * n)
for (let a = 0; a < n; a++) {
  const ia = keep[a]
  for (let b = 0; b < n; b++) C[a * n + b] = Number(covTokens[1 + ia * N + keep[b]])
}
// Cholesky, in place lower
const L = new Float64Array(n * n)
for (let i = 0; i < n; i++) {
  for (let j = 0; j <= i; j++) {
    let s = C[i * n + j]
    for (let k = 0; k < j; k++) s -= L[i * n + k] * L[j * n + k]
    if (i === j) {
      if (s <= 0) throw new Error(`covariance not positive definite at ${i}`)
      L[i * n + i] = Math.sqrt(s)
    } else L[i * n + j] = s / L[j * n + j]
  }
}
const packed = new Float32Array((n * (n + 1)) / 2)
let off = 0
for (let i = 0; i < n; i++) { for (let j = 0; j <= i; j++) packed[off++] = L[i * n + j] }

const sne = {
  cid: keep.map((i) => rows[i][iCID]),
  zHD: keep.map((i) => Number(rows[i][iZHD])),
  zHEL: keep.map((i) => Number(rows[i][iZHEL])),
  mu: keep.map((i) => Number(rows[i][iMU])),
  // sqrt of the covariance diagonal; MU_SH0ES_ERR_DIAG in the table is the same quantity
  muErr: keep.map((i, a) => Math.sqrt(C[a * n + a])),
  muErrTable: keep.map((i) => Number(rows[i][iERR])),
}
const maxDiagDiff = Math.max(...sne.muErr.map((e, a) => Math.abs(e - sne.muErrTable[a])))
console.log('max |sqrt(diag C) - MU_SH0ES_ERR_DIAG| =', maxDiagDiff.toFixed(5))
writeFileSync(join(out, 'sne.json'), JSON.stringify({ cid: sne.cid, zHD: sne.zHD, zHEL: sne.zHEL, mu: sne.mu, muErr: sne.muErr }))
writeFileSync(join(out, 'chol_lower.f32'), Buffer.from(packed.buffer))
const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex')
writeFileSync(join(out, 'meta.json'), JSON.stringify({
  source: 'https://github.com/PantheonPlusSH0ES/DataRelease (Pantheon+_Data/4_DISTANCES_AND_COVAR)',
  files: FILES,
  zMin: Z_MIN,
  nTotal: rows.length,
  nKept: n,
  cholLowerPackedLength: packed.length,
  sha256: { dat: sha(datText), cov: sha(covText) },
  preparedAt: new Date().toISOString(),
}, null, 2))
console.log('wrote', out)
