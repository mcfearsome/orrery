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

/** Fetch the Pantheon+ files served from data/pantheon_plus (Vite publicDir = data); path is relative to the page. */
export async function fetchPantheonPlus(base = 'pantheon_plus', withCovariance = true): Promise<SNSample> {
  const [j, chol] = await Promise.all([
    fetch(`${base}/sne.json`).then((r) => { if (!r.ok) throw new Error(`sne.json: ${r.status}`); return r.json() as Promise<SNEJson> }),
    withCovariance
      ? fetch(`${base}/chol_lower.f32`).then((r) => { if (!r.ok) throw new Error(`chol_lower.f32: ${r.status}`); return r.arrayBuffer() })
      : Promise.resolve(null),
  ])
  return sampleFromJson(j, chol)
}
