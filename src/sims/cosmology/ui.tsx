import * as Comlink from 'comlink'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Scene } from '../../scenes/schema'
import { Axes, Chart, ErrorPoints, Line, clipId, defaultFrame, linearScale, logScale } from './charts'
import { DESI_DR2_BAO } from './priors'
import { CosmologyConfig, type LeakParams } from './schema'
import type { CosmologyWorkerApi, Evaluation } from './worker'

type Data = { z: number[]; mu: number[]; muErr: number[]; cid: string[] }

function createWorkerApi(): Comlink.Remote<CosmologyWorkerApi> {
  const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
  return Comlink.wrap<CosmologyWorkerApi>(w)
}

const fmt = (v: number, d = 3) => (Number.isFinite(v) ? v.toFixed(d) : '—')

export function CosmologyPanel() {
  const [api] = useState(createWorkerApi)
  const [cfg, setCfg] = useState<CosmologyConfig>(() => CosmologyConfig.parse({}))
  const [data, setData] = useState<Data | null>(null)
  const [ev, setEv] = useState<Evaluation | null>(null)
  const [status, setStatus] = useState('loading Pantheon+ …')
  const [fitting, setFitting] = useState(false)
  const [lastFit, setLastFit] = useState<{ chi2: number; iterations: number; converged: boolean } | null>(null)
  const pending = useRef(false)
  const queued = useRef<CosmologyConfig | null>(null)

  // load data once
  useEffect(() => {
    let alive = true
    // A host page may relocate the data: <meta name="orrery:data-base"> and <meta name="orrery:chol-file">.
    // The base is resolved against the page here because inside the worker a relative URL would
    // resolve against the worker script's own folder.
    const meta = (n: string) => document.querySelector<HTMLMetaElement>(`meta[name="${n}"]`)?.content || undefined
    const dataBase = new URL(meta('orrery:data-base') ?? 'pantheon_plus', document.baseURI).href
    api.loadData(dataBase, true, meta('orrery:chol-file')).then(async (r) => {
      if (!alive) return
      const s = await api.sampleSummary()
      if (!alive || !s) return
      setData(s)
      setStatus(`${r.n} SNe Ia loaded (${r.hasCovariance ? 'full STAT+SYS covariance' : 'diagonal errors'})`)
    }).catch((e) => setStatus(`data error: ${String(e)}`))
    return () => { alive = false }
  }, [api])

  // evaluate on every config change; latest wins
  const evaluate = useCallback(async (c: CosmologyConfig) => {
    if (pending.current) { queued.current = c; return }
    pending.current = true
    try {
      const r = await api.evaluate(c)
      setEv(r)
    } catch (e) {
      setStatus(`evaluate error: ${String(e)}`)
    } finally {
      pending.current = false
      if (queued.current) { const q = queued.current; queued.current = null; void evaluate(q) }
    }
  }, [api])
  useEffect(() => { if (data) void evaluate(cfg) }, [cfg, data, evaluate])

  const setLeak = (patch: Partial<LeakParams>) => setCfg((c) => ({ ...c, leak: { ...c.leak, leak: { ...c.leak.leak, ...patch } } }))
  const setLcdm = (patch: Partial<CosmologyConfig['lcdm']>) => setCfg((c) => ({ ...c, lcdm: { ...c.lcdm, ...patch } }))

  const runFit = async () => {
    setFitting(true)
    setStatus('fitting (Nelder–Mead over α, β, γ) …')
    try {
      const r = await api.fitLeak(cfg, undefined, Comlink.proxy((i: number, x: number[], chi2: number) => {
        setStatus(`fit iter ${i}: α=${x[0].toFixed(4)} β=${x[1].toFixed(2)} γ=${x[2].toFixed(2)} χ²=${chi2.toFixed(2)}`)
      }))
      setCfg((c) => ({ ...c, leak: { ...c.leak, Om: r.Om, leak: { alpha: r.alpha, beta: r.beta, gamma: r.gamma } } }))
      setLastFit({ chi2: r.chi2, iterations: r.iterations, converged: r.converged })
      setStatus(`best fit after ${r.iterations} iterations (${r.evaluations} evals)${r.converged ? '' : ', not converged'}: total χ² = ${r.chi2.toFixed(2)}`)
    } catch (e) {
      setStatus(`fit error: ${String(e)}`)
    } finally { setFitting(false) }
  }
  const runFitOm = async () => {
    setFitting(true)
    try {
      const r = await api.fitLcdmOm(cfg)
      setLcdm({ Om: r.Om, H0: r.H0, Ok: 0 })
      setStatus(`flat ΛCDM best fit: Ωm = ${r.Om.toFixed(4)}, H0 = ${r.H0.toFixed(2)}, total χ² = ${r.chi2.toFixed(2)}`)
    } finally { setFitting(false) }
  }

  const exportScene = () => {
    if (!ev || !data) return
    const dM_L = ev.chi2Lcdm.deltaM, dM_K = ev.chi2Leak.deltaM
    const scene = Scene.parse({
      schema: 'orrery.scene.v1',
      id: `cosmology-leak-${Date.now()}`,
      module: 'cosmology',
      title: 'Hubble diagram: black-hole leak model vs ΛCDM vs Pantheon+',
      beat: 'explain',
      render_hint: 'preview',
      params: cfg,
      series: [
        { id: 'pantheon_plus', label: 'Pantheon+ SH0ES (zHD > 0.01)', x: data.z, y: data.mu, yErr: data.muErr, xLabel: 'z', yLabel: 'μ [mag]' },
        { id: 'lcdm_mu', label: `flat ΛCDM Ωm=${cfg.lcdm.Om.toFixed(3)} (+ΔM)`, x: ev.zGrid, y: ev.lcdm.map((m) => m + dM_L), xLabel: 'z', yLabel: 'μ [mag]' },
        { id: 'leak_mu', label: 'leak model (+ΔM)', x: ev.zGrid, y: ev.leak.map((m) => m + dM_K), xLabel: 'z', yLabel: 'μ [mag]' },
        { id: 'leak_minus_lcdm', label: 'μ_leak − μ_ΛCDM', x: ev.zGrid, y: ev.leak.map((m, i) => m + dM_K - ev.lcdm[i] - dM_L), xLabel: 'z', yLabel: 'Δμ [mag]' },
        { id: 'omega_leak', label: 'Ω_leak(z) / ρ_crit(H0)', x: ev.zGrid, y: ev.omegaLeak, xLabel: 'z', yLabel: 'Ω' },
        { id: 'bh_mass_fraction', label: 'ρ_BH(z)/ρ_BH(0)', x: ev.zGrid, y: ev.bhFraction, xLabel: 'z', yLabel: 'fraction' },
        { id: 'bao_dm_lcdm', label: 'D_M/r_d ΛCDM', x: ev.baoGrid, y: ev.baoCurveLcdm.DM, xLabel: 'z', yLabel: 'D_M/r_d' },
        { id: 'bao_dm_leak', label: 'D_M/r_d leak', x: ev.baoGrid, y: ev.baoCurveLeak.DM, xLabel: 'z', yLabel: 'D_M/r_d' },
        { id: 'bao_dh_lcdm', label: 'D_H/r_d ΛCDM', x: ev.baoGrid, y: ev.baoCurveLcdm.DH, xLabel: 'z', yLabel: 'D_H/r_d' },
        { id: 'bao_dh_leak', label: 'D_H/r_d leak', x: ev.baoGrid, y: ev.baoCurveLeak.DH, xLabel: 'z', yLabel: 'D_H/r_d' },
      ],
      readouts: {
        n: ev.chi2Lcdm.n,
        chi2_lcdm: ev.chi2Lcdm.chi2, chi2_leak: ev.chi2Leak.chi2,
        chi2_lcdm_diag: ev.chi2Lcdm.chi2Diag, chi2_leak_diag: ev.chi2Leak.chi2Diag,
        deltaM_lcdm: dM_L, deltaM_leak: dM_K,
        H0_eff: ev.H0Eff, omega_leak_0: ev.omegaLeak0Frac, omega_m_eff: ev.omegaMFrac, omega_lambda: ev.omegaLambda,
        chi2_cmb_lcdm: ev.priorsLcdm.chi2CMB, chi2_cmb_leak: ev.priorsLeak.chi2CMB,
        chi2_bao_lcdm: ev.priorsLcdm.chi2BAO, chi2_bao_leak: ev.priorsLeak.chi2BAO,
        chi2_total_lcdm: ev.totalLcdm, chi2_total_leak: ev.totalLeak,
        R_lcdm: ev.priorsLcdm.early.R, R_leak: ev.priorsLeak.early.R,
        lA_lcdm: ev.priorsLcdm.early.lA, lA_leak: ev.priorsLeak.early.lA,
        rd_lcdm: ev.priorsLcdm.early.rd, rd_leak: ev.priorsLeak.early.rd,
      },
      notes: 'ΔM is the analytically marginalised magnitude offset; curves are shifted by it to overlay the data. Full STAT+SYS covariance unless params.fullCovariance is false.',
      createdAt: new Date().toISOString(),
    })
    const json = JSON.stringify(scene, null, 2)
    // Copy first (works in sandboxed viewers that block downloads), then offer the file.
    const copied = navigator.clipboard?.writeText(json).then(() => true, () => false) ?? Promise.resolve(false)
    const blob = new Blob([json], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${scene.id}.json`
    a.click()
    URL.revokeObjectURL(a.href)
    void copied.then((ok) => setStatus(`exported ${scene.id}.json (${scene.series.length} series, ${Math.round(json.length / 1024)} KB)${ok ? ', copied to clipboard' : ''}`))
  }

  const lp = cfg.leak.leak
  const dof = ev ? ev.chi2Lcdm.n - 1 : 0
  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="card">
          <h2>ΛCDM baseline <span className="tag muted">Planck 2018 defaults</span></h2>
          <Slider label="H0" value={cfg.lcdm.H0} min={50} max={90} step={0.1} unit="km/s/Mpc" onChange={(v) => setLcdm({ H0: v })} />
          <Slider label="Ωm" value={cfg.lcdm.Om} min={0.05} max={0.9} step={0.001} onChange={(v) => setLcdm({ Om: v })} />
          <Slider label="Ωk" value={cfg.lcdm.Ok} min={-0.3} max={0.3} step={0.001} onChange={(v) => setLcdm({ Ok: v })} />
          <div className="btns">
            <button className="btn" disabled={!data || fitting} onClick={runFitOm}>Fit Ωm (flat)</button>
            <button className="btn" disabled={fitting} onClick={() => setLcdm({ H0: 67.4, Om: 0.315, Ok: 0 })}>Planck 18</button>
          </div>
        </div>
        <div className="card">
          <h2>Leak model <span className="tag muted">ΩΛ → ρ_leak(t)</span></h2>
          <Slider label="log₁₀ α" value={Math.log10(Math.max(lp.alpha, 1e-6))} min={-5} max={1} step={0.01} onChange={(v) => setLeak({ alpha: 10 ** v })} display={lp.alpha.toExponential(2)} />
          <Slider label="β" value={lp.beta} min={-4} max={8} step={0.01} onChange={(v) => setLeak({ beta: v })} />
          <Slider label="γ" value={lp.gamma} min={-1} max={5} step={0.01} onChange={(v) => setLeak({ gamma: v })} />
          <Slider label="Ωm ref" value={cfg.leak.Om} min={0.05} max={0.9} step={0.001} onChange={(v) => setCfg((c) => ({ ...c, leak: { ...c.leak, Om: v } }))} />
          <div className="btns">
            <button className="btn primary" disabled={!data || fitting} onClick={runFit}>Best fit (α, β, γ{cfg.fitDensities ? ', Ωm' : ''})</button>
            <button className="btn" disabled={fitting} onClick={() => setLeak({ alpha: 0.03, beta: 0, gamma: 0 })}>Untuned</button>
          </div>
          <label className="check">
            <input type="checkbox" checked={cfg.fullCovariance} onChange={(e) => setCfg((c) => ({ ...c, fullCovariance: e.target.checked }))} />
            χ² with full STAT+SYS covariance
          </label>
          <p className="note">Source: dρ/dt = α·ṁ_BH·(1+z)^β, dilution (1+z)^γ. β = 0, γ = 0 is the untuned, Λ-like-dilution law. Ωm ref is the physical matter density in units of ρ_crit(H0 = {cfg.leak.H0}).</p>
        </div>
        <div className="card">
          <h2>External priors <span className="tag muted">added to χ²</span></h2>
          <label className="check">
            <input type="checkbox" checked={cfg.priors.cmb} onChange={(e) => setCfg((c) => ({ ...c, priors: { ...c.priors, cmb: e.target.checked } }))} />
            Planck 2018 CMB distance priors (R, ℓ_A)
          </label>
          <label className="check">
            <input type="checkbox" checked={cfg.priors.bao} onChange={(e) => setCfg((c) => ({ ...c, priors: { ...c.priors, bao: e.target.checked } }))} />
            DESI DR2 BAO (7 bins, D_M/r_d, D_H/r_d, D_V/r_d)
          </label>
          <label className="check">
            <input type="checkbox" checked={cfg.fitDensities} onChange={(e) => setCfg((c) => ({ ...c, fitDensities: e.target.checked }))} />
            fits also vary Ωm (and H0 for ΛCDM when a prior is on)
          </label>
          <p className="note">ω_b fixed at {cfg.omegaB}. r_d, z*, z_d and D_M(z*) are the model's own integrals anchored to Planck 2018 ΛCDM at the fiducial.</p>
        </div>
        <div className="card">
          <h2>Readouts <span className="tag muted">{ev ? `n = ${ev.chi2Lcdm.n}, dof = ${dof}` : ''}</span></h2>
          <table className="readouts">
            <thead><tr><th /><th className="lcdm">ΛCDM</th><th className="leak">leak</th></tr></thead>
            <tbody>
              <tr><td>χ² (full cov)</td><td>{ev ? fmt(ev.chi2Lcdm.chi2, 2) : '—'}</td><td>{ev ? fmt(ev.chi2Leak.chi2, 2) : '—'}</td></tr>
              <tr><td>χ² / dof</td><td>{ev ? fmt(ev.chi2Lcdm.chi2 / dof, 4) : '—'}</td><td>{ev ? fmt(ev.chi2Leak.chi2 / dof, 4) : '—'}</td></tr>
              <tr><td>χ² (diag only)</td><td>{ev ? fmt(ev.chi2Lcdm.chi2Diag, 1) : '—'}</td><td>{ev ? fmt(ev.chi2Leak.chi2Diag, 1) : '—'}</td></tr>
              <tr><td>χ² CMB (R, ℓ_A){cfg.priors.cmb ? '' : ' · off'}</td><td className={cfg.priors.cmb ? '' : 'muted'}>{ev ? fmt(ev.priorsLcdm.chi2CMB, 2) : '—'}</td><td className={cfg.priors.cmb ? '' : 'muted'}>{ev ? fmt(ev.priorsLeak.chi2CMB, 2) : '—'}</td></tr>
              <tr><td>χ² BAO (13 numbers){cfg.priors.bao ? '' : ' · off'}</td><td className={cfg.priors.bao ? '' : 'muted'}>{ev ? fmt(ev.priorsLcdm.chi2BAO, 2) : '—'}</td><td className={cfg.priors.bao ? '' : 'muted'}>{ev ? fmt(ev.priorsLeak.chi2BAO, 2) : '—'}</td></tr>
              <tr><td><b>χ² total</b></td><td><b>{ev ? fmt(ev.totalLcdm, 2) : '—'}</b></td><td><b>{ev ? fmt(ev.totalLeak, 2) : '—'}</b></td></tr>
              <tr><td>Δχ² total (leak − ΛCDM)</td><td /><td className={ev && ev.totalLeak - ev.totalLcdm > 0 ? 'bad' : 'good'}>{ev ? fmt(ev.totalLeak - ev.totalLcdm, 2) : '—'}</td></tr>
              <tr><td>R · ℓ_A</td><td>{ev ? `${fmt(ev.priorsLcdm.early.R, 4)} · ${fmt(ev.priorsLcdm.early.lA, 2)}` : '—'}</td><td>{ev ? `${fmt(ev.priorsLeak.early.R, 4)} · ${fmt(ev.priorsLeak.early.lA, 2)}` : '—'}</td></tr>
              <tr><td>r_d [Mpc]</td><td>{ev ? fmt(ev.priorsLcdm.early.rd, 2) : '—'}</td><td>{ev ? fmt(ev.priorsLeak.early.rd, 2) : '—'}</td></tr>
              <tr><td>ΔM (marginalised)</td><td>{ev ? fmt(ev.chi2Lcdm.deltaM, 4) : '—'}</td><td>{ev ? fmt(ev.chi2Leak.deltaM, 4) : '—'}</td></tr>
              <tr><td>H0 eff</td><td>{fmt(cfg.lcdm.H0, 1)}</td><td>{ev ? fmt(ev.H0Eff, 1) : '—'}</td></tr>
              <tr><td>Ω_DE today</td><td>{ev ? fmt(ev.omegaLambda) : '—'}</td><td>{ev ? fmt(ev.omegaLeak0Frac) : '—'}</td></tr>
              <tr><td>Ωm today</td><td>{fmt(cfg.lcdm.Om)}</td><td>{ev ? fmt(ev.omegaMFrac) : '—'}</td></tr>
              <tr><td>α, β, γ</td><td /><td>{lp.alpha.toExponential(2)}, {fmt(lp.beta, 2)}, {fmt(lp.gamma, 2)}</td></tr>
            </tbody>
          </table>
          {lastFit && <p className="note">last fit: χ² {fmt(lastFit.chi2, 2)} in {lastFit.iterations} iterations{lastFit.converged ? '' : ' (hit limit)'}</p>}
          <div className="btns">
            <button className="btn" disabled={!ev} onClick={exportScene}>Export scene JSON</button>
          </div>
        </div>
        <div className="status">{status}</div>
      </aside>
      <main className="main">
        <HubbleDiagram data={data} ev={ev} cfg={cfg} />
        <ResidualPanel data={data} ev={ev} />
        <BAOPanel ev={ev} />
        <DensityPanel ev={ev} />
      </main>
    </div>
  )
}

function Slider({ label, value, min, max, step, unit, onChange, display }: { label: string; value: number; min: number; max: number; step: number; unit?: string; onChange: (v: number) => void; display?: string }) {
  return (
    <div className="row">
      <label>{label}</label>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      {display ? <span className="small" style={{ width: 86, fontFamily: 'var(--mono)' }}>{display}</span>
        : <input type="number" min={min} max={max} step={step} value={Number(value.toFixed(4))} onChange={(e) => onChange(Number(e.target.value))} />}
      <span className="unit">{unit ?? ''}</span>
    </div>
  )
}

function Legend({ items }: { items: { color: string; label: string; dash?: boolean }[] }) {
  return <div className="legend">{items.map((it) => <span key={it.label}><span className="sw" style={{ background: it.color, opacity: it.dash ? 0.6 : 1 }} />{it.label}</span>)}</div>
}

const COL = { lcdm: '#66c2ff', leak: '#ff7a90', data: '#b8c0d0', accent: '#e8b864' }

function HubbleDiagram({ data, ev, cfg }: { data: Data | null; ev: Evaluation | null; cfg: CosmologyConfig }) {
  const fr = defaultFrame(900, 380)
  const x = useMemo(() => logScale(0.009, 2.4, fr.l, fr.w - fr.r), [fr.l, fr.w, fr.r])
  const y = useMemo(() => linearScale(32, 47, fr.h - fr.b, fr.t, 6), [fr.h, fr.b, fr.t])
  return (
    <div className="card">
      <h2>Hubble diagram <span className="tag muted">distance modulus vs redshift, models shifted by their marginalised ΔM</span></h2>
      <Legend items={[{ color: COL.data, label: 'Pantheon+ SH0ES' }, { color: COL.lcdm, label: `flat ΛCDM Ωm = ${cfg.lcdm.Om.toFixed(3)}` }, { color: COL.leak, label: 'black-hole leak model' }]} />
      <Chart fr={fr} title="Hubble diagram">
        <Axes fr={fr} x={x} y={y} xLabel="redshift z (Hubble-diagram frame)" yLabel="μ [mag]" />
        <g clipPath={clipId(fr)}>
          {data && <ErrorPoints xs={data.z} ys={data.mu} es={data.muErr} x={x} y={y} color={COL.data} />}
          {ev && <Line xs={ev.zGrid} ys={ev.lcdm.map((m) => m + ev.chi2Lcdm.deltaM)} x={x} y={y} color={COL.lcdm} />}
          {ev && <Line xs={ev.zGrid} ys={ev.leak.map((m) => m + ev.chi2Leak.deltaM)} x={x} y={y} color={COL.leak} dash="6 4" />}
        </g>
      </Chart>
    </div>
  )
}

/** Median residual in log-z bins with error of the mean, so 1590 points read as a trend. */
function binned(z: number[], r: number[], e: number[], nBins = 18) {
  const lo = Math.log10(0.01), hi = Math.log10(2.3)
  const bins = Array.from({ length: nBins }, () => ({ zs: [] as number[], rs: [] as number[], ws: [] as number[] }))
  for (let i = 0; i < z.length; i++) {
    const b = Math.min(nBins - 1, Math.max(0, Math.floor(((Math.log10(z[i]) - lo) / (hi - lo)) * nBins)))
    bins[b].zs.push(z[i]); bins[b].rs.push(r[i]); bins[b].ws.push(1 / (e[i] * e[i]))
  }
  const out = { z: [] as number[], r: [] as number[], e: [] as number[] }
  for (const b of bins) {
    if (b.zs.length < 3) continue
    let sw = 0, swr = 0, sz = 0
    for (let i = 0; i < b.zs.length; i++) { sw += b.ws[i]; swr += b.ws[i] * b.rs[i]; sz += Math.log10(b.zs[i]) }
    out.z.push(10 ** (sz / b.zs.length)); out.r.push(swr / sw); out.e.push(1 / Math.sqrt(sw))
  }
  return out
}

function ResidualPanel({ data, ev }: { data: Data | null; ev: Evaluation | null }) {
  const fr = defaultFrame(900, 260)
  const x = useMemo(() => logScale(0.009, 2.4, fr.l, fr.w - fr.r), [fr.l, fr.w, fr.r])
  const y = useMemo(() => linearScale(-0.6, 0.6, fr.h - fr.b, fr.t, 6), [fr.h, fr.b, fr.t])
  const res = useMemo(() => {
    if (!data || !ev) return null
    const dL = ev.chi2Lcdm.deltaM, dK = ev.chi2Leak.deltaM
    const r = data.mu.map((m, i) => m - ev.lcdmAtData[i] - dL)
    return { r, b: binned(data.z, r, data.muErr), leak: ev.leak.map((m, i) => m + dK - ev.lcdm[i] - dL) }
  }, [data, ev])
  return (
    <div className="card">
      <h2>Residuals vs ΛCDM <span className="tag muted">μ − μ_ΛCDM; grey = SNe, gold = inverse-variance binned, red = leak model</span></h2>
      <Chart fr={fr} title="Residuals">
        <Axes fr={fr} x={x} y={y} xLabel="z" yLabel="Δμ [mag]" />
        <g clipPath={clipId(fr)}>
          <line x1={fr.l} x2={fr.w - fr.r} y1={y(0)} y2={y(0)} stroke={COL.lcdm} strokeWidth={1.5} />
          {data && res && <ErrorPoints xs={data.z} ys={res.r} x={x} y={y} color={COL.data} r={1.2} opacity={0.35} />}
          {res && <ErrorPoints xs={res.b.z} ys={res.b.r} es={res.b.e} x={x} y={y} color={COL.accent} r={3} opacity={1} />}
          {ev && res && <Line xs={ev.zGrid} ys={res.leak} x={x} y={y} color={COL.leak} dash="6 4" />}
        </g>
      </Chart>
    </div>
  )
}

function DensityPanel({ ev }: { ev: Evaluation | null }) {
  const fr = defaultFrame(900, 240)
  const x = useMemo(() => logScale(0.009, 2.4, fr.l, fr.w - fr.r), [fr.l, fr.w, fr.r])
  const yMax = ev ? Math.max(1, ev.omegaLambda * 1.2, Math.max(...ev.omegaLeak) * 1.2) : 1
  const y = useMemo(() => linearScale(0, yMax, fr.h - fr.b, fr.t, 5), [fr.h, fr.b, fr.t, yMax])
  return (
    <div className="card">
      <h2>Dark-energy density history <span className="tag muted">fractions of ρ_crit(H0); dotted = BH mass fraction formed</span></h2>
      <Legend items={[{ color: COL.lcdm, label: 'ΩΛ (constant)' }, { color: COL.leak, label: 'Ω_leak(z)' }, { color: COL.accent, label: 'ρ_BH(z)/ρ_BH(0)', dash: true }]} />
      <Chart fr={fr} title="Density history">
        <Axes fr={fr} x={x} y={y} xLabel="z" yLabel="Ω" />
        <g clipPath={clipId(fr)}>
          {ev && <line x1={fr.l} x2={fr.w - fr.r} y1={y(ev.omegaLambda)} y2={y(ev.omegaLambda)} stroke={COL.lcdm} strokeWidth={1.5} />}
          {ev && <Line xs={ev.zGrid} ys={ev.omegaLeak} x={x} y={y} color={COL.leak} />}
          {ev && <Line xs={ev.zGrid} ys={ev.bhFraction.map((f) => f * yMax * 0.9)} x={x} y={y} color={COL.accent} width={1.2} dash="2 3" />}
        </g>
      </Chart>
    </div>
  )
}

function BAOPanel({ ev }: { ev: Evaluation | null }) {
  const fr = { w: 440, h: 250, l: 50, r: 12, t: 14, b: 36 }
  const x = useMemo(() => linearScale(0, 2.6, fr.l, fr.w - fr.r, 5), [fr.l, fr.w, fr.r])
  const yM = useMemo(() => linearScale(0, 44, fr.h - fr.b, fr.t, 5), [fr.h, fr.b, fr.t])
  const yH = useMemo(() => linearScale(6, 30, fr.h - fr.b, fr.t, 5), [fr.h, fr.b, fr.t])
  const pts = DESI_DR2_BAO.filter((p) => p.DM && p.DH)
  return (
    <div className="card">
      <h2>BAO vs DESI DR2 <span className="tag muted">D_M/r_d and D_H/r_d; r_d is each model's own sound horizon</span></h2>
      <Legend items={[{ color: COL.data, label: 'DESI DR2 (7 bins)' }, { color: COL.lcdm, label: 'ΛCDM' }, { color: COL.leak, label: 'leak model' }]} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 12 }}>
        <Chart fr={fr} title="D_M over r_d">
          <Axes fr={fr} x={x} y={yM} xLabel="z" yLabel="D_M / r_d" />
          <g clipPath={clipId(fr)}>
            {ev && <Line xs={ev.baoGrid} ys={ev.baoCurveLcdm.DM} x={x} y={yM} color={COL.lcdm} />}
            {ev && <Line xs={ev.baoGrid} ys={ev.baoCurveLeak.DM} x={x} y={yM} color={COL.leak} dash="6 4" />}
            <ErrorPoints xs={pts.map((p) => p.z)} ys={pts.map((p) => p.DM![0])} es={pts.map((p) => p.DM![1])} x={x} y={yM} color={COL.data} r={3} opacity={1} />
          </g>
        </Chart>
        <Chart fr={fr} title="D_H over r_d">
          <Axes fr={fr} x={x} y={yH} xLabel="z" yLabel="D_H / r_d" />
          <g clipPath={clipId(fr)}>
            {ev && <Line xs={ev.baoGrid} ys={ev.baoCurveLcdm.DH} x={x} y={yH} color={COL.lcdm} />}
            {ev && <Line xs={ev.baoGrid} ys={ev.baoCurveLeak.DH} x={x} y={yH} color={COL.leak} dash="6 4" />}
            <ErrorPoints xs={pts.map((p) => p.z)} ys={pts.map((p) => p.DH![0])} es={pts.map((p) => p.DH![1])} x={x} y={yH} color={COL.data} r={3} opacity={1} />
          </g>
        </Chart>
      </div>
      <p className="note">Error bars are the diagonal of each bin; the χ² uses the published D_M–D_H correlation per bin. The BGS bin (z = 0.295) enters χ² through D_V/r_d only and is not drawn.</p>
    </div>
  )
}
