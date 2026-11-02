import { OrbitControls } from '@react-three/drei'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState, type ComponentRef, type RefObject } from 'react'
import * as THREE from 'three'
import { Axes, Chart, Line, defaultFrame, linearScale } from '../cosmology/charts'
import { crossSection, drains, heightField, totalHeightAt, type Drain, type HeightField } from './model'
import { OneSheetConfig, type PointMass } from './schema'

/** Topside is neutral and dark; the underside and anything drained through carry the one accent. */
const C = { bg: '#0b0e14', top: '#39465f', wire: '#8793b3', under: '#e8b864', flow: '#ffe3a3', mass: '#d8dde8', slice: '#e8b864' }

// ponytail: drains are passed to the particle shader as a fixed uniform array; raise if a preset needs more
const MAX_DRAINS = 64

/** One surface. Vertex-colour alpha fades where |∇h| is high (stretched thin) and is 0 inside a drain's throat: a real hole. */
function sheetGeometry(f: HeightField, translucency: number, ds: readonly Drain[]): THREE.BufferGeometry {
  const { n, size, h, slope, maxSlope } = f
  const pos = new Float32Array(n * n * 3)
  const col = new Float32Array(n * n * 4)
  const step = size / (n - 1)
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const v = j * n + i
    const x = -size / 2 + i * step, y = -size / 2 + j * step
    pos[v * 3] = x
    pos[v * 3 + 1] = h[v]
    pos[v * 3 + 2] = y
    const t = maxSlope > 0 ? slope[v] / maxSlope : 0
    let a = 1 - translucency * t * t * (3 - 2 * t)
    for (const d of ds) {
      const r = Math.hypot(x - d.x, y - d.y) / d.throat
      if (r < 1.8) a *= r <= 1 ? 0 : (r - 1) / 0.8
    }
    col[v * 4] = col[v * 4 + 1] = col[v * 4 + 2] = 1
    col[v * 4 + 3] = a
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

function Sheet({ field, translucency, ds }: { field: HeightField; translucency: number; ds: readonly Drain[] }) {
  const geo = useMemo(() => sheetGeometry(field, translucency, ds), [field, translucency, ds])
  useEffect(() => () => geo.dispose(), [geo])
  return (
    <group>
      {/* topside: front faces, lit from above */}
      <mesh geometry={geo}>
        <meshStandardMaterial color={C.top} roughness={0.95} metalness={0} side={THREE.FrontSide} vertexColors transparent alphaTest={0.02} polygonOffset polygonOffsetFactor={1} />
      </mesh>
      {/* underside: back faces of the same geometry, lit from below in the accent */}
      <mesh geometry={geo}>
        <meshStandardMaterial color="#3a3222" emissive={C.under} emissiveIntensity={0.05} roughness={0.9} metalness={0} side={THREE.BackSide} vertexColors transparent alphaTest={0.02} polygonOffset polygonOffsetFactor={1} />
      </mesh>
      <mesh geometry={geo}>
        <meshBasicMaterial color={C.wire} wireframe transparent opacity={0.16} depthWrite={false} />
      </mesh>
    </group>
  )
}

/** The height field as a float texture so the particle shader can hug the surface. */
function heightTexture(f: HeightField): THREE.DataTexture {
  // nearest: linear filtering of 32-bit float textures needs an extension not every GPU has; the shader interpolates itself
  const t = new THREE.DataTexture(f.h, f.n, f.n, THREE.RedFormat, THREE.FloatType)
  t.minFilter = t.magFilter = THREE.NearestFilter
  t.needsUpdate = true
  return t
}

const DRAIN_VERT = /* glsl */ `
uniform float uTime, uLife, uSize, uSpread, uPx, uN;
uniform sampler2D uHeight;
uniform vec4 uDrain[${MAX_DRAINS}];
attribute vec4 aSeed;
attribute float aDrain;
varying float vAlpha;
// bilinear sample of the height grid (vertex i sits at x = -size/2 + i * size/(n-1))
float hAt(vec2 p) {
  vec2 g = clamp((p / uSize + 0.5) * (uN - 1.0), 0.0, uN - 1.001);
  vec2 i = floor(g), f = g - i;
  vec2 t = (i + 0.5) / uN;
  vec2 d = vec2(1.0 / uN, 0.0);
  float h00 = texture2D(uHeight, t).r, h10 = texture2D(uHeight, t + d.xy).r;
  float h01 = texture2D(uHeight, t + d.yx).r, h11 = texture2D(uHeight, t + d.xx).r;
  return mix(mix(h00, h10, f.x), mix(h01, h11, f.x), f.y);
}
void main() {
  vec4 d = uDrain[int(aDrain)];            // x, y, throat, h at the drain
  float age = fract(uTime / uLife + aSeed.x);
  float th = aSeed.y * 6.2831853;
  const float A = 0.3;                      // fraction of the life spent on the topside
  vec2 p; float y;
  if (age < A) {
    // topside: spiral in from a few throat radii, then drop through the hole
    float s = age / A;
    float r = mix(d.z * (2.5 + 2.0 * aSeed.z), d.z * 0.3, s * s);
    float ang = th + 3.0 * s;
    p = d.xy + r * vec2(cos(ang), sin(ang));
    y = hAt(p) + 0.06 - smoothstep(0.8, 1.0, s) * 1.2;
    vAlpha = 0.3;
  } else {
    // underside: come out below the throat, run outward along a few streams just under the surface,
    // decelerate and pool at about uSpread (the ring the ridge model uses)
    float s = (age - A) / (1.0 - A);
    float travel = 1.0 - (1.0 - s) * (1.0 - s);
    float r = d.z * 0.3 + travel * uSpread * (0.85 + 0.3 * aSeed.w);
    float stream = floor(aSeed.y * 5.0) / 5.0 * 6.2831853 + fract(d.x * 0.731 + d.y * 0.317) * 6.2831853;
    float ang = stream + (aSeed.z - 0.5) * (0.35 + 0.5 * travel);
    p = d.xy + r * vec2(cos(ang), sin(ang));
    y = hAt(p) - 0.1 - (1.0 - smoothstep(0.0, 0.12, s)) * 1.1;
    vAlpha = 0.2 * (1.0 - smoothstep(0.9, 1.0, s));
  }
  vec4 mv = modelViewMatrix * vec4(p.x, y, p.y, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp(uPx * 60.0 / -mv.z, 1.5, 7.0);
}`

const DRAIN_FRAG = /* glsl */ `
uniform vec3 uColor;
varying float vAlpha;
void main() {
  float a = smoothstep(0.5, 0.1, length(gl_PointCoord - 0.5));
  gl_FragColor = vec4(uColor, a * vAlpha);
}`

/** Stateless GPU particles: each has a seed and a drain; position is a pure function of time. Nothing to integrate. */
function DrainFlow({ cfg, field, ds }: { cfg: OneSheetConfig; field: HeightField; ds: readonly Drain[] }) {
  const dpr = useThree((s) => s.viewport.dpr)
  const n = cfg.particles
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry()
    const seed = new Float32Array(n * 4)
    for (let i = 0; i < seed.length; i++) seed[i] = Math.random()
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3))
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4))
    g.setAttribute('aDrain', new THREE.BufferAttribute(new Float32Array(n), 1))
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6)
    return g
  }, [n])
  useEffect(() => {
    const a = geo.getAttribute('aDrain') as THREE.BufferAttribute
    const k = Math.max(1, ds.length)
    for (let i = 0; i < n; i++) a.setX(i, i % k)
    a.needsUpdate = true
  }, [geo, ds, n])
  useEffect(() => () => geo.dispose(), [geo])

  const mat = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: DRAIN_VERT,
    fragmentShader: DRAIN_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 }, uLife: { value: 10 }, uSize: { value: 1 }, uSpread: { value: 1 }, uPx: { value: 1 }, uN: { value: 2 },
      uHeight: { value: null }, uColor: { value: new THREE.Color(C.flow) },
      uDrain: { value: Array.from({ length: MAX_DRAINS }, () => new THREE.Vector4()) },
    },
  }), [])
  useEffect(() => () => mat.dispose(), [mat])

  const tex = useMemo(() => heightTexture(field), [field])
  useEffect(() => () => tex.dispose(), [tex])

  useEffect(() => {
    const u = mat.uniforms
    u.uHeight.value = tex
    u.uSize.value = cfg.sheetSize
    u.uN.value = field.n
    u.uSpread.value = cfg.spread
    u.uPx.value = 1.8 * dpr
    // lifetime so that flux per drain = leakRate: particles per drain / rate, kept in a watchable range
    u.uLife.value = THREE.MathUtils.clamp(n / Math.max(1, ds.length) / cfg.leakRate, 2, 60)
    ds.slice(0, MAX_DRAINS).forEach((d, i) => u.uDrain.value[i].set(d.x, d.y, d.throat, totalHeightAt(cfg, ds, d.x, d.y)))
  }, [mat, tex, field.n, cfg, ds, n, dpr])

  useFrame((s) => { mat.uniforms.uTime.value = s.clock.elapsedTime })
  if (ds.length === 0) return null
  // drawn after the sheet: the points write no depth, so an earlier draw would be painted over
  return <points geometry={geo} material={mat} frustumCulled={false} renderOrder={1} />
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

function Scene({ cfg, field, ds, sliceY, view }: { cfg: OneSheetConfig; field: HeightField; ds: readonly Drain[]; sliceY: number | null; view: View }) {
  const controls = useRef<OrbitControlsImpl>(null)
  return (
    <>
      <color attach="background" args={[C.bg]} />
      <fog attach="fog" args={[C.bg, cfg.sheetSize * 1.4, cfg.sheetSize * 4]} />
      <hemisphereLight args={['#9fb3d9', '#0b0e14', 0.55]} />
      <directionalLight position={[8, 14, 6]} intensity={1.1} />
      {/* underside light: only back faces see it */}
      <directionalLight position={[-4, -12, 3]} intensity={0.9} color={C.under} />
      <pointLight position={[0, -cfg.sheetSize * 0.5, 0]} intensity={cfg.sheetSize * 2.5} color={C.under} decay={2} />
      <Sheet field={field} translucency={cfg.translucency} ds={ds} />
      <DrainFlow cfg={cfg} field={field} ds={ds} />
      {cfg.masses.map((m, i) => {
        const h = totalHeightAt(cfg, ds, m.x, m.y)
        if (m.m >= cfg.bhThreshold) {
          // a black hole: no body, just the ring at the throat
          const t = cfg.throat * cfg.softening
          return (
            <mesh key={i} position={[m.x, h + 0.02, m.y]} rotation={[Math.PI / 2, 0, 0]}>
              <torusGeometry args={[t, Math.max(0.015, t * 0.08), 8, 48]} />
              <meshStandardMaterial color={C.under} emissive={C.under} emissiveIntensity={0.9} roughness={0.4} />
            </mesh>
          )
        }
        const r = 0.12 + 0.12 * Math.cbrt(m.m)
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
  const hi = Math.max(1, Math.max(...s.h) + 1, -lo * 0.5)
  const x = linearScale(-cfg.sheetSize / 2, cfg.sheetSize / 2, fr.l, fr.w - fr.r)
  const y = linearScale(lo, hi, fr.h - fr.b, fr.t, 6)
  const path = s.x.map((xi, i) => `${x(xi).toFixed(1)},${y(s.h[i]).toFixed(1)}`).join('L')
  return (
    <Chart fr={fr} title="cross-section of the sheet">
      <Axes fr={fr} x={x} y={y} xLabel={`x  (slice at y = ${sliceY.toFixed(1)})`} yLabel="height" />
      <path d={`M${x(s.x[0])},${y(hi)}L${path}L${x(s.x.at(-1)!)},${y(hi)}Z`} fill={C.top} opacity={0.25} />
      <path d={`M${x(s.x[0])},${y(lo)}L${path}L${x(s.x.at(-1)!)},${y(lo)}Z`} fill={C.under} opacity={0.18} />
      <Line xs={s.x} ys={s.h} x={x} y={y} color={C.wire} width={2} />
      <text x={fr.l + 10} y={fr.t + 16} style={{ fill: '#8fa3d1' }}>topside · our universe</text>
      <text x={fr.l + 10} y={fr.h - fr.b - 8} style={{ fill: C.under }}>underside · the dark side</text>
    </Chart>
  )
}

const rnd = (a: number, b: number) => a + Math.random() * (b - a)

type NumKey = 'exaggeration' | 'softening' | 'translucency' | 'sheetSize' | 'resolution' | 'bhThreshold' | 'throat' | 'leakRate' | 'particles' | 'spread' | 'pooled' | 'ridge'

export function OneSheetPanel() {
  const [cfg, setCfg] = useState<OneSheetConfig>(() => OneSheetConfig.parse({}))
  const [slice, setSlice] = useState(false)
  const [sliceY, setSliceY] = useState(0)
  const [view, setView] = useState<View>('topside')
  const field = useMemo(() => heightField(cfg), [cfg])
  const ds = useMemo(() => drains(cfg), [cfg])
  const set = (patch: Partial<OneSheetConfig>) => setCfg((c) => OneSheetConfig.parse({ ...c, ...patch }))
  const setMass = (i: number, patch: Partial<PointMass>) => set({ masses: cfg.masses.map((m, j) => (j === i ? { ...m, ...patch } : m)) })
  const scatter = (n: number) => set({ masses: Array.from({ length: n }, () => ({ x: rnd(-0.4, 0.4) * cfg.sheetSize, y: rnd(-0.4, 0.4) * cfg.sheetSize, m: rnd(0.3, 3) })) })

  const slider = (key: NumKey, label: string, min: number, max: number, step: number) => (
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
          <h2>Drains <span className="tag">{ds.length} black hole{ds.length === 1 ? '' : 's'}</span></h2>
          {slider('bhThreshold', 'BH ≥ m', 0.1, 10, 0.1)}
          {slider('throat', 'throat', 0.05, 3, 0.05)}
          {slider('leakRate', 'rate /s', 1, 20000, 1)}
          {slider('particles', 'points', 1000, 200000, 1000)}
          {slider('spread', 'spread', 0.5, 30, 0.5)}
          {slider('pooled', 'pooled', 0, 1, 0.01)}
          {slider('ridge', 'ridge', 0, 2, 0.01)}
          <p className="note">A mass at or above the threshold tears the sheet: energy drains DOWN through the throat and spreads on the underside, settling about <code>spread</code> away. What pools there pulls the sheet toward the underside's own down, which is our up: a ridge on the topside between galaxies, scaled by <code>pooled × ridge</code>.</p>
        </div>
        <div className="card">
          <h2>Masses <span className="tag">{cfg.masses.length}</span></h2>
          <table className="readouts masses">
            <thead><tr><th>x</th><th>y</th><th>m</th><th /></tr></thead>
            <tbody>
              {cfg.masses.map((m, i) => (
                <tr key={i} className={m.m >= cfg.bhThreshold ? 'bh' : undefined}>
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
            <Scene cfg={cfg} field={field} ds={ds} sliceY={slice ? sliceY : null} view={view} />
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
