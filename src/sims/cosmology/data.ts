import type { SNSample } from './model'

export interface SNEJson {
  cid: string[]
  zHD: number[]
  zHEL: number[]
  mu: number[]
  muErr: number[]
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
  const [j, chol] = await Promise.all([
    fetch(`${base}/sne.json`).then((r) => { if (!r.ok) throw new Error(`sne.json: ${r.status}`); return r.json() as Promise<SNEJson> }),
    withCovariance
      ? fetch(`${base}/${cholFile}`).then((r) => { if (!r.ok) throw new Error(`${cholFile}: ${r.status}`); return r.arrayBuffer() })
      : Promise.resolve(null),
  ])
  return sampleFromJson(j, chol)
}
