import { OrbitControls } from '@react-three/drei'
import { Canvas, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState, type ComponentRef, type RefObject } from 'react'
import * as THREE from 'three'
import { Axes, Chart, Line, defaultFrame, linearScale } from '../cosmology/charts'
import { crossSection, heightAt, heightField, type HeightField } from './model'
import { OneSheetConfig, type PointMass } from './schema'

/** Topside is neutral and dark; the underside and anything that leaks through carry the one accent. */
const C = { bg: '#0b0e14', top: '#39465f', wire: '#8793b3', under: '#e8b864', mass: '#d8dde8', slice: '#e8b864' }

/** One surface. Vertex colour alpha fades where |∇h| is high: the sheet is stretched thin there. */
function sheetGeometry(f: HeightField, translucency: number): THREE.BufferGeometry {
  const { n, size, h, slope, maxSlope } = f
  const pos = new Float32Array(n * n * 3)
  const col = new Float32Array(n * n * 4)
  const step = size / (n - 1)
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const v = j * n + i
    pos[v * 3] = -size / 2 + i * step
    pos[v * 3 + 1] = h[v]
    pos[v * 3 + 2] = -size / 2 + j * step
    const t = maxSlope > 0 ? slope[v] / maxSlope : 0
    col[v * 4] = col[v * 4 + 1] = col[v * 4 + 2] = 1
    col[v * 4 + 3] = 1 - translucency * t * t * (3 - 2 * t)
  }
  const idx = new Uint32Array((n - 1) * (n - 1) * 6)
  let k = 0
  for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) {
    const a = j * n + i, b = a + 1, c = a + n, d = c + 1
    idx[k++] = a; idx[k++] = c; idx[k++] = b
    idx[k++] = b; idx[k++] = c; idx[k++] = d
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  g.setAttribute('color', new THREE.BufferAttribute(col, 4))
  g.setIndex(new THREE.BufferAttribute(idx, 1))
  g.computeVertexNormals()
  return g
}

function Sheet({ field, translucency }: { field: HeightField; translucency: number }) {
  const geo = useMemo(() => sheetGeometry(field, translucency), [field, translucency])
  useEffect(() => () => geo.dispose(), [geo])
  return (
    <group>
      {/* topside: front faces, lit from above */}
      <mesh geometry={geo}>
        <meshStandardMaterial color={C.top} roughness={0.95} metalness={0} side={THREE.FrontSide} vertexColors transparent polygonOffset polygonOffsetFactor={1} />
      </mesh>
      {/* underside: back faces of the same geometry, lit from below in the accent */}
      <mesh geometry={geo}>
        <meshStandardMaterial color="#6b5a3a" emissive={C.under} emissiveIntensity={0.12} roughness={0.8} metalness={0} side={THREE.BackSide} vertexColors transparent polygonOffset polygonOffsetFactor={1} />
      </mesh>
      <mesh geometry={geo}>
        <meshBasicMaterial color={C.wire} wireframe transparent opacity={0.16} depthWrite={false} />
      </mesh>
    </group>
  )
}

type OrbitControlsImpl = ComponentRef<typeof OrbitControls>
export type View = 'topside' | 'underside'

/** Moves the camera to a named viewpoint; the orbit controls keep working from there. */
function Viewpoint({ view, size, controls }: { view: View; size: number; controls: RefObject<OrbitControlsImpl | null> }) {
  const camera = useThree((s) => s.camera)
  useEffect(() => {
    const up = view === 'topside' ? 1 : -1
    camera.position.set(0, up * size * 0.45, size * 1.1)
    controls.current?.target.set(0, 0, 0)
    controls.current?.update()
  }, [view, size, camera, controls])
  return null
}

function Scene({ cfg, field, sliceY, view }: { cfg: OneSheetConfig; field: HeightField; sliceY: number | null; view: View }) {
  const controls = useRef<OrbitControlsImpl>(null)
  return (
    <>
      <color attach="background" args={[C.bg]} />
      <fog attach="fog" args={[C.bg, cfg.sheetSize * 1.4, cfg.sheetSize * 4]} />
      <hemisphereLight args={['#9fb3d9', '#0b0e14', 0.55]} />
      <directionalLight position={[8, 14, 6]} intensity={1.1} />
      {/* underside light: only back faces see it */}
      <directionalLight position={[-4, -12, 3]} intensity={2.2} color={C.under} />
      <pointLight position={[0, -cfg.sheetSize * 0.5, 0]} intensity={cfg.sheetSize * 6} color={C.under} decay={2} />
      <Sheet field={field} translucency={cfg.translucency} />
      {cfg.masses.map((m, i) => {
        const r = 0.12 + 0.12 * Math.cbrt(m.m)
        const h = heightAt(cfg.masses, cfg.softening, cfg.exaggeration, m.x, m.y)
        return (
          <mesh key={i} position={[m.x, h + r * 0.6, m.y]}>
            <sphereGeometry args={[r, 24, 16]} />
            <meshStandardMaterial color={C.mass} roughness={0.6} />
          </mesh>
        )
      })}
      {sliceY !== null && (
        <mesh position={[0, field.min / 2, sliceY]}>
          <planeGeometry args={[cfg.sheetSize, Math.abs(field.min) + 3]} />
          <meshBasicMaterial color={C.slice} transparent opacity={0.1} side={THREE.DoubleSide} depthWrite={false} />
        </mesh>
      )}
      <OrbitControls ref={controls} enableDamping dampingFactor={0.08} maxPolarAngle={Math.PI} />
      <Viewpoint view={view} size={cfg.sheetSize} controls={controls} />
    </>
  )
}

function SliceChart({ cfg, sliceY }: { cfg: OneSheetConfig; sliceY: number }) {
  const s = crossSection(cfg, sliceY)
  const fr = defaultFrame(900, 300)
  const lo = Math.min(...s.h) - 1
  const x = linearScale(-cfg.sheetSize / 2, cfg.sheetSize / 2, fr.l, fr.w - fr.r)
  const y = linearScale(lo, -lo * 0.5, fr.h - fr.b, fr.t, 6)
  const path = s.x.map((xi, i) => `${x(xi).toFixed(1)},${y(s.h[i]).toFixed(1)}`).join('L')
  return (
    <Chart fr={fr} title="cross-section of the sheet">
      <Axes fr={fr} x={x} y={y} xLabel={`x  (slice at y = ${sliceY.toFixed(1)})`} yLabel="height" />
      <path d={`M${x(s.x[0])},${y(-lo * 0.5)}L${path}L${x(s.x.at(-1)!)},${y(-lo * 0.5)}Z`} fill={C.top} opacity={0.25} />
      <path d={`M${x(s.x[0])},${y(lo)}L${path}L${x(s.x.at(-1)!)},${y(lo)}Z`} fill={C.under} opacity={0.18} />
      <Line xs={s.x} ys={s.h} x={x} y={y} color={C.wire} width={2} />
      <text x={fr.l + 10} y={fr.t + 16} fill={C.top} style={{ fill: '#8fa3d1' }}>topside · our universe</text>
      <text x={fr.l + 10} y={fr.h - fr.b - 8} style={{ fill: C.under }}>underside · the dark side</text>
    </Chart>
  )
}

const rnd = (a: number, b: number) => a + Math.random() * (b - a)

export function OneSheetPanel() {
  const [cfg, setCfg] = useState<OneSheetConfig>(() => OneSheetConfig.parse({}))
  const [slice, setSlice] = useState(false)
  const [sliceY, setSliceY] = useState(0)
  const [view, setView] = useState<View>('topside')
  const field = useMemo(() => heightField(cfg), [cfg])
  const set = (patch: Partial<OneSheetConfig>) => setCfg((c) => OneSheetConfig.parse({ ...c, ...patch }))
  const setMass = (i: number, patch: Partial<PointMass>) => set({ masses: cfg.masses.map((m, j) => (j === i ? { ...m, ...patch } : m)) })
  const scatter = (n: number) => set({ masses: Array.from({ length: n }, () => ({ x: rnd(-0.4, 0.4) * cfg.sheetSize, y: rnd(-0.4, 0.4) * cfg.sheetSize, m: rnd(0.3, 3) })) })

  const slider = (key: 'exaggeration' | 'softening' | 'translucency' | 'sheetSize' | 'resolution', label: string, min: number, max: number, step: number) => (
    <div className="row" key={key}>
      <label title={key}>{label}</label>
      <input type="range" min={min} max={max} step={step} value={cfg[key]} onChange={(e) => set({ [key]: Number(e.target.value) })} />
      <input type="number" min={min} max={max} step={step} value={cfg[key]} onChange={(e) => set({ [key]: Number(e.target.value) })} />
    </div>
  )

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="card">
          <h2>Sheet</h2>
          {slider('exaggeration', 'exag', 0, 6, 0.05)}
          {slider('softening', 'soften', 0.1, 5, 0.05)}
          {slider('translucency', 'thin', 0, 1, 0.05)}
          {slider('sheetSize', 'size', 8, 80, 1)}
          {slider('resolution', 'res', 16, 400, 8)}
          <div className="btns">
            <button className={`btn${view === 'topside' ? ' primary' : ''}`} onClick={() => setView('topside')}>topside</button>
            <button className={`btn${view === 'underside' ? ' primary' : ''}`} onClick={() => setView('underside')}>underside</button>
          </div>
          <label className="check">
            <input type="checkbox" checked={slice} onChange={(e) => setSlice(e.target.checked)} /> cross-section
          </label>
          {slice && (
            <div className="row">
              <label>slice y</label>
              <input type="range" min={-cfg.sheetSize / 2} max={cfg.sheetSize / 2} step={0.1} value={sliceY} onChange={(e) => setSliceY(Number(e.target.value))} />
              <input type="number" step={0.1} value={sliceY} onChange={(e) => setSliceY(Number(e.target.value))} />
            </div>
          )}
          <p className="note">One surface, two sides. h(x, y) is a softened Newtonian potential (not GR): a well seen from the topside, a hill from the underside. Orbit below the sheet to see the dark side. The sheet thins where it is stretched.</p>
        </div>
        <div className="card">
          <h2>Masses <span className="tag">{cfg.masses.length}</span></h2>
          <table className="readouts masses">
            <thead><tr><th>x</th><th>y</th><th>m</th><th /></tr></thead>
            <tbody>
              {cfg.masses.map((m, i) => (
                <tr key={i}>
                  <td><input type="number" step={0.5} value={m.x} onChange={(e) => setMass(i, { x: Number(e.target.value) })} /></td>
                  <td><input type="number" step={0.5} value={m.y} onChange={(e) => setMass(i, { y: Number(e.target.value) })} /></td>
                  <td><input type="number" step={0.1} min={0.01} value={m.m} onChange={(e) => setMass(i, { m: Math.max(0.01, Number(e.target.value)) })} /></td>
                  <td><button className="btn" onClick={() => set({ masses: cfg.masses.filter((_, j) => j !== i) })}>×</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="btns">
            <button className="btn" onClick={() => set({ masses: [...cfg.masses, { x: 0, y: 0, m: 1 }] })}>add mass</button>
            <button className="btn" onClick={() => scatter(8)}>scatter 8</button>
            <button className="btn" onClick={() => scatter(40)}>scatter 40</button>
          </div>
        </div>
      </aside>
      <main className="main">
        <div className="card canvas-card">
          <Canvas camera={{ position: [0, cfg.sheetSize * 0.45, cfg.sheetSize * 1.1], fov: 40, near: 0.1, far: cfg.sheetSize * 10 }} dpr={[1, 2]}>
            <Scene cfg={cfg} field={field} sliceY={slice ? sliceY : null} view={view} />
          </Canvas>
        </div>
        {slice && (
          <div className="card">
            <h2>Cross-section <span className="tag">one curve; above it is the topside, below it the underside</span></h2>
            <SliceChart cfg={cfg} sliceY={sliceY} />
          </div>
        )}
      </main>
    </div>
  )
}
