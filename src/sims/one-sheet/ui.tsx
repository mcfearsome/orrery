import { OrbitControls } from '@react-three/drei'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import * as Comlink from 'comlink'
import { useEffect, useMemo, useRef, useState, type ComponentRef, type RefObject } from 'react'
import * as THREE from 'three'
import { Axes, Chart, Line, defaultFrame, linearScale } from '../cosmology/charts'
import { crossSection, cyclePhase, drains, expanded, nestedSheet, totalHeightAt, type Drain, type HeightField } from './model'
import { PRESETS } from './presets'
import { sceneFromState } from './scene'
import { OneSheetConfig, type PointMass } from './schema'
import type { OneSheetWorkerApi } from './worker'

/** Topside is neutral and dark; the underside and anything drained through carry the one accent. */
const C = { bg: '#0b0e14', top: '#39465f', wire: '#8793b3', under: '#e8b864', flow: '#ffe3a3', mass: '#d8dde8', slice: '#e8b864' }

// ponytail: drains are passed to the particle shader as a fixed uniform array; raise if a preset needs more
const MAX_DRAINS = 64

function createWorkerApi(): Comlink.Remote<OneSheetWorkerApi> {
  return Comlink.wrap<OneSheetWorkerApi>(new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' }))
}

/** Animation state lives outside React: it changes every frame. */
export interface Anim { scale: number; pooled: number; /** seconds into the nested-universe cycle */ t: number; playing: boolean }

/**
 * Capture mode (`?capture=<preset>`): the page is driven frame by frame from a script instead of the
 * wall clock, so every frame is deterministic. `time`/`dt` replace the renderer clock; `pending` and
 * `dirty` tell the driver when the worker's field has landed.
 */
export interface CaptureBus { time: number; dt: number; pending: boolean; dirty: boolean }

/** Grid geometry for `n` vertices per side; positions and colours are filled in by `applyField`. */
function gridGeometry(n: number): THREE.BufferGeometry {
  const idx = new Uint32Array((n - 1) * (n - 1) * 6)
  let k = 0
  for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) {
    const a = j * n + i, b = a + 1, c = a + n, d = c + 1
    idx[k++] = a; idx[k++] = c; idx[k++] = b
    idx[k++] = b; idx[k++] = c; idx[k++] = d
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * n * 3), 3))
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * n * 4).fill(1), 4))
  g.setIndex(new THREE.BufferAttribute(idx, 1))
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6)
  return g
}

/**
 * Write a height field into the grid. Vertex-colour alpha fades where |∇h| is high (the sheet is
 * stretched thin) and is 0 inside a drain's throat, which with alphaTest is a real hole.
 */
function applyField(g: THREE.BufferGeometry, f: HeightField, translucency: number, ds: readonly Drain[]) {
  const { n, size, h, slope, maxSlope } = f
  const pos = g.getAttribute('position') as THREE.BufferAttribute
  const col = g.getAttribute('color') as THREE.BufferAttribute
  const p = pos.array as Float32Array, c = col.array as Float32Array
  const step = size / (n - 1)
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const v = j * n + i
    const x = -size / 2 + i * step, y = -size / 2 + j * step
    p[v * 3] = x
    p[v * 3 + 1] = h[v]
    p[v * 3 + 2] = y
    const t = maxSlope > 0 ? slope[v] / maxSlope : 0
    let a = 1 - translucency * t * t * (3 - 2 * t)
    for (const d of ds) {
      const r = Math.hypot(x - d.x, y - d.y) / d.throat
      if (r < 1.8) a *= r <= 1 ? 0 : (r - 1) / 0.8
    }
    c[v * 4 + 3] = a
  }
  pos.needsUpdate = col.needsUpdate = true
  g.computeVertexNormals()
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

function drainMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
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
  })
}

const OCEAN_VERT = /* glsl */ `
uniform float uPhase, uScale, uLift, uR, uPx;
attribute vec4 aSeed;
varying float vAlpha;
void main() {
  float p = uPhase;
  float r0 = uR * sqrt(aSeed.x);
  float ang = aSeed.y * 6.2831853;
  vec2 xy; float y; float a;
  if (p < 0.45) {
    // pool: the underside ocean gathers and swells
    float q = p / 0.45;
    xy = r0 * (0.3 + 0.7 * q) * vec2(cos(ang), sin(ang));
    y = uLift - uScale * (0.35 + 0.25 * q * aSeed.z);
    a = 0.25 * q;
  } else if (p < 0.6) {
    // burst: it funnels in and shoots UP through the sheet, the only upward path
    float q = (p - 0.45) / 0.15;
    xy = mix(r0, r0 * 0.15, q) * vec2(cos(ang + 2.0 * q), sin(ang + 2.0 * q));
    y = uLift - uScale * 0.35 + q * q * uScale * 4.0 * (0.5 + aSeed.z);
    a = 0.35;
  } else {
    // settle: rains out over the new sheet and fades
    float q = (p - 0.6) / 0.4;
    xy = (r0 * 0.15 + q * r0 * 0.8) * vec2(cos(ang), sin(ang));
    y = uLift + uScale * 4.0 * (0.5 + aSeed.z) * (1.0 - q) + uScale * 0.3;
    a = 0.3 * (1.0 - q);
  }
  vAlpha = a;
  vec4 mv = modelViewMatrix * vec4(xy.x, y, xy.y, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp(uPx * 70.0 / -mv.z, 1.5, 8.0);
}`

function oceanMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: OCEAN_VERT,
    fragmentShader: DRAIN_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uPhase: { value: 0 }, uScale: { value: 1 }, uLift: { value: 0 }, uR: { value: 1 }, uPx: { value: 1 }, uColor: { value: new THREE.Color(C.flow) } },
  })
}

/** Stateless GPU particles: a seed and a drain index each; position is a pure function of time. */
function particleGeometry(n: number, nDrains: number): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry()
  const seed = new Float32Array(n * 4)
  for (let i = 0; i < seed.length; i++) seed[i] = Math.random()
  const drain = new Float32Array(n)
  for (let i = 0; i < n; i++) drain[i] = i % Math.max(1, nDrains)
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3))
  g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4))
  g.setAttribute('aDrain', new THREE.BufferAttribute(drain, 1))
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6)
  return g
}

/** Current field as the renderer last applied it: what the markers and the chart follow. */
export interface Applied { cfg: OneSheetConfig; ds: Drain[]; scale: number; pooled: number; t: number }

/**
 * The sheet, the drain flow and the markers. The height field is computed in a worker; while playing,
 * the scale factor and pooled fraction advance every frame and a new field is requested as soon as the
 * previous one lands, so rendering never waits on the CPU.
 */
function Surface({ cfg, anim, onTick, bus }: { cfg: OneSheetConfig; anim: RefObject<Anim>; onTick: (a: Applied) => void; bus?: CaptureBus }) {
  const [api] = useState(createWorkerApi)
  const dpr = useThree((s) => s.viewport.dpr)
  const n = cfg.resolution
  const geo = useMemo(() => gridGeometry(n), [n])
  const tex = useMemo(() => {
    // nearest: linear filtering of 32-bit float textures needs an extension not every GPU has; the shader interpolates itself
    const t = new THREE.DataTexture(new Float32Array(n * n), n, n, THREE.RedFormat, THREE.FloatType)
    t.minFilter = t.magFilter = THREE.NearestFilter
    return t
  }, [n])
  const mat = useMemo(drainMaterial, [])
  const sheetMats = useMemo(() => ({
    top: new THREE.MeshStandardMaterial({ color: C.top, roughness: 0.95, metalness: 0, side: THREE.FrontSide, vertexColors: true, transparent: true, alphaTest: 0.02, polygonOffset: true, polygonOffsetFactor: 1 }),
    under: new THREE.MeshStandardMaterial({ color: '#3a3222', emissive: C.under, emissiveIntensity: 0.05, roughness: 0.9, metalness: 0, side: THREE.BackSide, vertexColors: true, transparent: true, alphaTest: 0.02, polygonOffset: true, polygonOffsetFactor: 1 }),
    wire: new THREE.MeshBasicMaterial({ color: C.wire, wireframe: true, transparent: true, opacity: 0.16, depthWrite: false }),
  }), [])
  const oceanMat = useMemo(oceanMaterial, [])
  const oceanGeo = useMemo(() => particleGeometry(20000, 1), [])
  const nested = useRef<(THREE.Group | null)[]>([])
  const flash = useRef<THREE.PointLight>(null)
  const nDrains = drains(cfg).length
  const pgeo = useMemo(() => particleGeometry(cfg.particles, nDrains), [cfg.particles, nDrains])
  useEffect(() => () => geo.dispose(), [geo])
  useEffect(() => () => tex.dispose(), [tex])
  useEffect(() => () => mat.dispose(), [mat])
  useEffect(() => () => { sheetMats.top.dispose(); sheetMats.under.dispose(); sheetMats.wire.dispose() }, [sheetMats])
  useEffect(() => () => { oceanMat.dispose(); oceanGeo.dispose() }, [oceanMat, oceanGeo])
  useEffect(() => () => pgeo.dispose(), [pgeo])

  const applied = useRef<Applied | null>(null)
  const dirty = useRef(true)
  const pending = useRef(false)
  const lastTick = useRef(0)
  useEffect(() => { dirty.current = true }, [cfg, geo, tex])

  const markers = useRef<(THREE.Mesh | null)[]>([])

  useFrame((s, dtFrame) => {
    const a = anim.current
    const dt = bus ? bus.dt : dtFrame
    const now = bus ? bus.time : s.clock.elapsedTime
    if (a.playing && dt > 0 && (cfg.expandRate > 0 || cfg.poolRate > 0)) {
      a.scale *= 1 + cfg.expandRate * Math.min(dt, 0.1)
      a.pooled = Math.min(1, a.pooled + cfg.poolRate * Math.min(dt, 0.1))
      dirty.current = true
    }
    if (a.playing && cfg.cycleDepth > 0) a.t += Math.min(dt, 0.1)
    mat.uniforms.uTime.value = now

    // nested-universe cycle: child k unfurls on its parent once the parent's ocean has burst
    const cy = cyclePhase(a.t, cfg.cyclePeriod, cfg.cycleDepth)
    const lift = 1.2 * cfg.exaggeration
    for (let k = 1; k <= cfg.cycleDepth; k++) {
      const g = nested.current[k]
      if (!g) continue
      const phase = k < cy.level ? 1 : k === cy.level ? cy.phase : 0
      const unfurl = THREE.MathUtils.smoothstep(phase, 0.55, 0.95)
      const { scale, y } = nestedSheet(k, cfg.cycleShrink, lift)
      g.visible = unfurl > 0
      g.scale.setScalar(scale * unfurl)
      g.position.y = y
    }
    const parent = nestedSheet(cy.level - 1, cfg.cycleShrink, lift)
    const ocean = oceanMat.uniforms
    oceanMat.visible = cy.level > 0 && cy.phase < 1
    ocean.uPhase.value = cy.phase
    ocean.uScale.value = parent.scale * cfg.sheetSize / 24
    ocean.uLift.value = parent.y
    ocean.uR.value = 0.3 * cfg.sheetSize * parent.scale
    ocean.uPx.value = 1.8 * dpr
    if (flash.current) {
      flash.current.position.y = parent.y + 0.5
      const burst = Math.exp(-(((cy.phase - 0.53) / 0.06) ** 2))
      flash.current.intensity = oceanMat.visible ? cfg.sheetSize * 40 * parent.scale * burst : 0
    }

    if (dirty.current && !pending.current) {
      dirty.current = false
      pending.current = true
      const { scale, pooled } = a
      const myGeo = geo, myTex = tex
      api.field(cfg, scale, pooled).then((f) => {
        if (myGeo !== geo || f.n !== n) return // resolution changed mid-flight
        const eff = expanded(cfg, scale, pooled)
        const ds = drains(eff)
        applyField(myGeo, f, cfg.translucency, ds)
        myTex.image.data = f.h
        myTex.needsUpdate = true
        const u = mat.uniforms
        u.uHeight.value = myTex
        u.uSize.value = f.size
        u.uN.value = f.n
        u.uSpread.value = cfg.spread
        u.uPx.value = 1.8 * dpr
        // lifetime so that flux per drain = leakRate: particles per drain / rate, kept in a watchable range
        u.uLife.value = THREE.MathUtils.clamp(cfg.particles / Math.max(1, ds.length) / cfg.leakRate, 2, 60)
        ds.slice(0, MAX_DRAINS).forEach((d, i) => u.uDrain.value[i].set(d.x, d.y, d.throat, totalHeightAt(eff, ds, d.x, d.y)))
        applied.current = { cfg: eff, ds, scale, pooled, t: a.t }
      }).finally(() => { pending.current = false; if (bus) bus.pending = false })
    }
    if (applied.current && now - lastTick.current > 0.25) {
      lastTick.current = now
      onTick({ ...applied.current, t: a.t })
    }
    if (bus) { bus.pending = pending.current; bus.dirty = dirty.current }

    // markers follow the applied field
    const ap = applied.current
    if (ap) ap.cfg.masses.forEach((m, i) => {
      const mesh = markers.current[i]
      if (!mesh) return
      const h = totalHeightAt(ap.cfg, ap.ds, m.x, m.y)
      const bh = m.m >= ap.cfg.bhThreshold
      mesh.position.set(m.x, h + (bh ? 0.02 : (0.12 + 0.12 * Math.cbrt(m.m)) * 0.6), m.y)
    })
  })

  const throat = cfg.throat * cfg.softening
  return (
    <group>
      {/* topside: front faces, lit from above; underside: back faces of the same geometry, lit from below in the accent */}
      <mesh geometry={geo} material={sheetMats.top} />
      <mesh geometry={geo} material={sheetMats.under} />
      <mesh geometry={geo} material={sheetMats.wire} />
      {/* nested universes: the same sheet again, smaller, unfurling on top of its parent */}
      {Array.from({ length: cfg.cycleDepth }, (_, i) => (
        <group key={i + 1} ref={(el) => { nested.current[i + 1] = el }} visible={false}>
          <mesh geometry={geo} material={sheetMats.top} />
          <mesh geometry={geo} material={sheetMats.under} />
          <mesh geometry={geo} material={sheetMats.wire} />
        </group>
      ))}
      {cfg.cycleDepth > 0 && <points geometry={oceanGeo} material={oceanMat} frustumCulled={false} renderOrder={2} />}
      {cfg.cycleDepth > 0 && <pointLight ref={flash} color={C.under} intensity={0} decay={2} />}
      {/* drawn after the sheet: the points write no depth, so an earlier draw would be painted over */}
      {nDrains > 0 && <points geometry={pgeo} material={mat} frustumCulled={false} renderOrder={1} />}
      {cfg.masses.map((m, i) =>
        m.m >= cfg.bhThreshold ? (
          // a black hole: no body, just the ring at the throat
          <mesh key={i} ref={(el) => { markers.current[i] = el }} rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[throat, Math.max(0.015, throat * 0.08), 8, 48]} />
            <meshStandardMaterial color={C.under} emissive={C.under} emissiveIntensity={0.9} roughness={0.4} />
          </mesh>
        ) : (
          <mesh key={i} ref={(el) => { markers.current[i] = el }}>
            <sphereGeometry args={[0.12 + 0.12 * Math.cbrt(m.m), 24, 16]} />
            <meshStandardMaterial color={C.mass} roughness={0.6} />
          </mesh>
        ),
      )}
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

/** What a capture script talks to: `window.__orrery`. */
export interface CaptureApi {
  ready: boolean
  /** advance the animation by dt seconds, wait for the field, draw the frame */
  step(dt: number): Promise<void>
  /** camera on a sphere around the origin: elevation and azimuth in degrees (negative elevation is the underside) */
  setCamera(elevationDeg: number, azimuthDeg: number, distance: number): void
  play(on: boolean): void
  scene(): string
}

function CaptureDriver({ bus, anim, cfg, preset }: { bus: CaptureBus; anim: RefObject<Anim>; cfg: OneSheetConfig; preset: string }) {
  const advance = useThree((s) => s.advance)
  const camera = useThree((s) => s.camera)
  useEffect(() => {
    const settled = () => new Promise<void>((resolve) => {
      const poll = () => (bus.pending || bus.dirty ? setTimeout(poll, 4) : resolve())
      poll()
    })
    const api: CaptureApi = {
      ready: true,
      async step(dt) {
        bus.time += dt
        bus.dt = dt
        advance(performance.now())
        bus.dt = 0
        await settled()
        advance(performance.now())
      },
      setCamera(el, az, dist) {
        const e = (el * Math.PI) / 180, a = (az * Math.PI) / 180
        camera.position.set(dist * Math.cos(e) * Math.sin(a), dist * Math.sin(e), dist * Math.cos(e) * Math.cos(a))
        camera.lookAt(0, 0, 0)
      },
      play(on) { anim.current.playing = on },
      scene: () => JSON.stringify(sceneFromState(cfg, anim.current, preset), null, 2),
    }
    ;(window as unknown as { __orrery: CaptureApi }).__orrery = api
  }, [bus, anim, cfg, preset, advance, camera])
  return null
}

function Scene({ cfg, anim, onTick, sliceY, view, capture }: { cfg: OneSheetConfig; anim: RefObject<Anim>; onTick: (a: Applied) => void; sliceY: number | null; view: View; capture?: { bus: CaptureBus; preset: string } }) {
  const controls = useRef<OrbitControlsImpl>(null)
  return (
    <>
      <color attach="background" args={[C.bg]} />
      <fog attach="fog" args={[C.bg, cfg.sheetSize * 1.4, cfg.sheetSize * 5]} />
      <hemisphereLight args={['#9fb3d9', '#0b0e14', 0.55]} />
      <directionalLight position={[8, 14, 6]} intensity={1.1} />
      {/* underside light: only back faces see it */}
      <directionalLight position={[-4, -12, 3]} intensity={0.9} color={C.under} />
      <pointLight position={[0, -cfg.sheetSize * 0.5, 0]} intensity={cfg.sheetSize * 2.5} color={C.under} decay={2} />
      <Surface cfg={cfg} anim={anim} onTick={onTick} bus={capture?.bus} />
      {sliceY !== null && (
        <mesh position={[0, -cfg.exaggeration * 2, sliceY]}>
          <planeGeometry args={[cfg.sheetSize * 2, cfg.exaggeration * 8 + 3]} />
          <meshBasicMaterial color={C.slice} transparent opacity={0.1} side={THREE.DoubleSide} depthWrite={false} />
        </mesh>
      )}
      {capture ? <CaptureDriver bus={capture.bus} anim={anim} cfg={cfg} preset={capture.preset} /> : (
        <>
          <OrbitControls ref={controls} enableDamping dampingFactor={0.08} maxPolarAngle={Math.PI} />
          <Viewpoint view={view} size={cfg.sheetSize} controls={controls} />
        </>
      )}
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
const fmt = (v: number, d = 2) => v.toFixed(d)

type NumKey = 'exaggeration' | 'softening' | 'translucency' | 'sheetSize' | 'resolution' | 'bhThreshold' | 'throat' | 'leakRate' | 'particles' | 'spread' | 'pooled' | 'ridge' | 'expandRate' | 'poolRate' | 'cycleDepth' | 'cyclePeriod' | 'cycleShrink'

export function OneSheetPanel() {
  // `?capture=<preset>` renders only the canvas, driven by a script (see CaptureDriver)
  const [captureId] = useState(() => new URLSearchParams(location.search).get('capture'))
  const [bus] = useState<CaptureBus>(() => ({ time: 0, dt: 0, pending: false, dirty: false }))
  const [preset, setPreset] = useState<string>(() => (captureId && captureId in PRESETS ? captureId : 'drain'))
  const [cfg, setCfg] = useState<OneSheetConfig>(() => {
    // capture mode may override numeric fields through the URL: ?capture=cosmic&expandRate=0.015
    const over: Record<string, number> = {}
    if (captureId) for (const [k, v] of new URLSearchParams(location.search)) if (k !== 'capture' && Number.isFinite(Number(v))) over[k] = Number(v)
    return OneSheetConfig.parse({ ...(PRESETS[preset] ?? {}), ...over })
  })
  const [status, setStatus] = useState('')
  const [slice, setSlice] = useState(false)
  const [sliceY, setSliceY] = useState(0)
  const [view, setView] = useState<View>('topside')
  const [playing, setPlaying] = useState(false)
  const anim = useRef<Anim>({ scale: 1, pooled: cfg.pooled, t: 0, playing: false })
  const [tick, setTick] = useState<Applied | null>(null)

  const set = (patch: Partial<OneSheetConfig>) => setCfg((c) => OneSheetConfig.parse({ ...c, ...patch }))
  const setMass = (i: number, patch: Partial<PointMass>) => set({ masses: cfg.masses.map((m, j) => (j === i ? { ...m, ...patch } : m)) })
  const scatter = (n: number) => set({ masses: Array.from({ length: n }, () => ({ x: rnd(-0.4, 0.4) * cfg.sheetSize, y: rnd(-0.4, 0.4) * cfg.sheetSize, m: rnd(0.3, 3) })) })
  const reset = (c = cfg) => { anim.current.scale = 1; anim.current.pooled = c.pooled; anim.current.t = 0 }
  const loadPreset = (id: string) => {
    const c = OneSheetConfig.parse(PRESETS[id] ?? {})
    setPreset(id)
    setCfg(c)
    reset(c)
  }
  const togglePlay = () => { anim.current.playing = !playing; setPlaying(!playing) }
  const exportScene = () => {
    const scene = sceneFromState(cfg, anim.current, preset)
    const json = JSON.stringify(scene, null, 2)
    // Copy first (works in sandboxed viewers that block downloads), then offer the file.
    const copied = navigator.clipboard?.writeText(json).then(() => true, () => false) ?? Promise.resolve(false)
    const blob = new Blob([json], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${scene.id}.json`
    a.click()
    URL.revokeObjectURL(a.href)
    void copied.then((ok) => setStatus(`exported ${scene.id}.json (${scene.series.length} series)${ok ? ', copied to clipboard' : ''}`))
  }

  const slider = (key: NumKey, label: string, min: number, max: number, step: number) => (
    <div className="row" key={key}>
      <label title={key}>{label}</label>
      <input type="range" min={min} max={max} step={step} value={cfg[key]} onChange={(e) => set({ [key]: Number(e.target.value) })} />
      <input type="number" min={min} max={max} step={step} value={cfg[key]} onChange={(e) => set({ [key]: Number(e.target.value) })} />
    </div>
  )
  const nDrains = drains(cfg).length
  const chartCfg = tick ? tick.cfg : cfg

  if (captureId) {
    return (
      <div className="capture">
        <Canvas frameloop="never" camera={{ position: [0, cfg.sheetSize * 0.45, cfg.sheetSize * 1.1], fov: 40, near: 0.1, far: cfg.sheetSize * 12 }} dpr={1} gl={{ preserveDrawingBuffer: true }}>
          <Scene cfg={cfg} anim={anim} onTick={setTick} sliceY={null} view="topside" capture={{ bus, preset }} />
        </Canvas>
      </div>
    )
  }

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="card">
          <h2>Preset</h2>
          <div className="row">
            <label>preset</label>
            <select className="select" value={preset} onChange={(e) => loadPreset(e.target.value)}>
              {Object.keys(PRESETS).map((id) => <option key={id} value={id}>{id}</option>)}
            </select>
          </div>
          {slider('expandRate', 'expand/s', 0, 0.3, 0.005)}
          {slider('poolRate', 'pool/s', 0, 0.3, 0.005)}
          {slider('cycleDepth', 'depth', 0, 6, 1)}
          {slider('cyclePeriod', 'period s', 2, 60, 0.5)}
          {slider('cycleShrink', 'shrink', 0.2, 0.8, 0.05)}
          <div className="btns">
            <button className={`btn${playing ? ' primary' : ''}`} onClick={togglePlay}>{playing ? 'pause' : 'play'}</button>
            <button className="btn" onClick={() => reset()}>reset</button>
            <button className="btn" onClick={exportScene}>export scene JSON</button>
          </div>
          {status && <p className="status">{status}</p>}
          <table className="readouts">
            <tbody>
              <tr><td>scale factor</td><td>{tick ? fmt(tick.scale, 3) : '1.000'}</td></tr>
              <tr><td>pooled</td><td>{tick ? fmt(tick.pooled) : fmt(cfg.pooled)}</td></tr>
              {cfg.cycleDepth > 0 && (() => { const c = cyclePhase(tick?.t ?? 0, cfg.cyclePeriod, cfg.cycleDepth); return <tr><td>cycle</td><td>level {c.level} / {cfg.cycleDepth} · {fmt(c.phase)}</td></tr> })()}
            </tbody>
          </table>
        </div>
        <div className="card">
          <h2>Sheet</h2>
          {slider('exaggeration', 'exag', 0, 6, 0.05)}
          {slider('softening', 'soften', 0.1, 5, 0.05)}
          {slider('translucency', 'thin', 0, 1, 0.05)}
          {slider('sheetSize', 'size', 8, 120, 1)}
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
          <h2>Drains <span className="tag">{nDrains} black hole{nDrains === 1 ? '' : 's'}</span></h2>
          {slider('bhThreshold', 'BH ≥ m', 0.1, 10, 0.1)}
          {slider('throat', 'throat', 0.05, 3, 0.05)}
          {slider('leakRate', 'rate /s', 1, 20000, 1)}
          {slider('particles', 'points', 1000, 200000, 1000)}
          {slider('spread', 'spread', 0.5, 30, 0.5)}
          {slider('pooled', 'pooled', 0, 1, 0.01)}
          {slider('ridge', 'ridge', 0, 2, 0.01)}
          <p className="note">A mass at or above the threshold tears the sheet: energy drains DOWN through the throat and spreads on the underside, settling about <code>spread</code> away. What pools there pulls the sheet toward the underside's own down, which is our up: a ridge on the topside between galaxies, scaled by <code>pooled × ridge</code>. While playing, <code>pooled</code> rises at <code>pool/s</code> and positions expand at <code>expand/s</code>.</p>
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
          <Canvas camera={{ position: [0, cfg.sheetSize * 0.45, cfg.sheetSize * 1.1], fov: 40, near: 0.1, far: cfg.sheetSize * 12 }} dpr={[1, 2]}>
            <Scene cfg={cfg} anim={anim} onTick={setTick} sliceY={slice ? sliceY : null} view={view} />
          </Canvas>
        </div>
        {slice && (
          <div className="card">
            <h2>Cross-section <span className="tag">one curve; above it is the topside, below it the underside</span></h2>
            <SliceChart cfg={chartCfg} sliceY={sliceY} />
          </div>
        )}
      </main>
    </div>
  )
}
