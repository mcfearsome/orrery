import type { SNSample } from './model'
import type { SNSampleId } from './schema'

export interface SNEJson {
  cid: string[]
  zHD: number[]
  zHEL: number[]
  mu: number[]
  muErr: number[]
}

/** Where each sample's prepared files live under the data directory, with a short label and citation. */
export const SN_SAMPLES: Record<Exclude<SNSampleId, 'none'>, { dir: string; label: string; citation: string }> = {
  pantheon_plus: { dir: 'pantheon_plus', label: 'Pantheon+ SH0ES (1590 SNe, z > 0.01)', citation: 'Scolnic+2022, Brout+2022' },
  des_y5: { dir: 'des_y5', label: 'DES-SN5YR Dovekie (1820 SNe)', citation: 'DES Collaboration 2024, Vincenzi+2024, Popovic+2025' },
  union3: { dir: 'union3', label: 'Union3 / UNITY1.5 (22 binned nodes)', citation: 'Rubin+2023' },
}

/** Build the sample from the prepared JSON and (optionally) the packed Cholesky factor. */
export function sampleFromJson(j: SNEJson, chol: ArrayBuffer | null): SNSample {
  const n = j.zHD.length
  const cholLower = chol ? new Float32Array(chol) : null
  if (cholLower && cholLower.length !== (n * (n + 1)) / 2) {
    throw new Error(`Cholesky factor length ${cholLower.length} does not match n=${n}`)
  }
  return {
    cid: j.cid,
    z: Float64Array.from(j.zHD),
    zHel: Float64Array.from(j.zHEL),
    mu: Float64Array.from(j.mu),
    muErr: Float64Array.from(j.muErr),
    cholLower,
  }
}

/**
 * Fetch the Pantheon+ files served from data/pantheon_plus (Vite publicDir = data); paths are relative to the page.
 * cholFile lets a host that only serves certain extensions rename the binary (see ui.tsx meta tags).
 */
export async function fetchPantheonPlus(base = 'pantheon_plus', withCovariance = true, cholFile = 'chol_lower.f32'): Promise<SNSample> {
  return fetchSample(base, withCovariance, cholFile)
}

/** Fetch any prepared sample directory (sne.json + packed Cholesky factor). */
export async function fetchSample(base: string, withCovariance = true, cholFile = 'chol_lower.f32'): Promise<SNSample> {
  const [j, chol] = await Promise.all([
    fetch(`${base}/sne.json`).then((r) => { if (!r.ok) throw new Error(`sne.json: ${r.status}`); return r.json() as Promise<SNEJson> }),
    withCovariance
      ? fetch(`${base}/${cholFile}`).then((r) => { if (!r.ok) throw new Error(`${cholFile}: ${r.status}`); return r.arrayBuffer() })
      : Promise.resolve(null),
  ])
  return sampleFromJson(j, chol)
}
