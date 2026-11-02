/**
 * pnpm capture one-sheet <preset> [--seconds N] [--fps N] [--out DIR]
 *
 * Renders a preset to a 1920×1080 PNG sequence (and an MP4 when ffmpeg is on PATH) on a fixed camera
 * path. The page is stepped frame by frame through window.__orrery (see CaptureDriver in the sim's
 * ui.tsx), so frames are deterministic regardless of machine speed. Uses the installed Google Chrome
 * through playwright-core, headed, because headless Chrome falls back to a software GL.
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright-core'
import { createServer } from 'vite'

interface Path { seconds: number; play: boolean; playFrom?: number; roll?: number; camera: (u: number, size: number, roll: number) => [el: number, az: number, dist: number] }

const smooth = (u: number) => u * u * (3 - 2 * u)
/** 0→1 over a window of width `w` centred on `at` */
const ramp = (u: number, at: number, w: number) => smooth(Math.min(1, Math.max(0, (u - (at - w / 2)) / w)))

/**
 * Camera paths per preset: elevation (°, negative = underside), azimuth (°), distance (sheet sizes).
 * u is 0..1 through the clip; `roll` (--roll) is the u at which the camera crosses the sheet plane, so a
 * narration beat can land on the flip.
 */
const ONE_SHEET: Record<string, Path> = {
  sheet: { seconds: 8, play: false, camera: (u, s) => [26, -20 + 50 * u, 1.3 * s] },
  // s02: topside, then roll under and end tight on the deepest well from below
  drain: { seconds: 10, play: false, roll: 0.5, camera: (u, s, roll) => [28 - 60 * ramp(u, roll, 0.3), 15 + 40 * u, 1.25 * s - 0.35 * s * ramp(u, 0.85, 0.3)] },
  // s03: start underneath on the dents, roll up over the rim to the topside ridges while space expands
  cosmic: { seconds: 14, play: true, playFrom: 1.5, roll: 0.5, camera: (u, s, roll) => [-30 + 62 * ramp(u, roll, 0.3), -10 + 40 * u, 1.2 * s] },
  // s12: hold topside and let the cycle run; slow drift, pull back at the end to show the stack
  cycle: { seconds: 28, play: true, camera: (u, s) => [30 - 6 * u, 10 + 35 * u, 1.15 * s + 0.5 * s * ramp(u, 0.9, 0.2)] },
}

const [, , mod, preset, ...rest] = process.argv
const opt = (k: string, d: number) => { const i = rest.indexOf(`--${k}`); return i >= 0 ? Number(rest[i + 1]) : d }
const outArg = rest.includes('--out') ? rest[rest.indexOf('--out') + 1] : undefined
/** --set key=value ... : numeric config overrides applied to the preset in the page (e.g. --set expandRate=0.015 cyclePeriod=10) */
const sets = (() => { const i = rest.indexOf('--set'); return i < 0 ? [] : rest.slice(i + 1).filter((a) => a.includes('=') && !a.startsWith('--')) })()

if (mod !== 'one-sheet' || !preset || !(preset in ONE_SHEET)) {
  console.error(`usage: pnpm capture one-sheet <${Object.keys(ONE_SHEET).join('|')}> [--seconds N] [--fps N] [--roll U] [--play-from S] [--out DIR] [--set key=value ...]`)
  process.exit(2)
}
const path = ONE_SHEET[preset]
const fps = opt('fps', 30)
const seconds = opt('seconds', path.seconds)
const roll = opt('roll', path.roll ?? 0.5)
const playFrom = opt('play-from', path.playFrom ?? 0)
const frames = Math.round(seconds * fps)
const out = outArg ?? join('captures', `one-sheet-${preset}`)
mkdirSync(out, { recursive: true })

const server = await createServer({ server: { port: 5199, strictPort: true }, logLevel: 'error' })
await server.listen()
const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--hide-scrollbars'] })
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 })
await page.goto(`http://localhost:5199/?capture=${preset}${sets.map((s) => `&${s}`).join('')}#one-sheet`)
await page.waitForFunction(() => (window as unknown as { __orrery?: { ready: boolean } }).__orrery?.ready, null, { timeout: 30000 })

const sheetSize = await page.evaluate(() => JSON.parse((window as unknown as { __orrery: { scene(): string } }).__orrery.scene()).readouts.sheet_size as number)
const t0 = Date.now()
for (let i = 0; i < frames; i++) {
  const u = i / Math.max(1, frames - 1)
  const t = i / fps
  const [el, az, dist] = path.camera(u, sheetSize, roll)
  await page.evaluate(async ([el, az, dist, dt, play]) => {
    const o = (window as unknown as { __orrery: { setCamera(e: number, a: number, d: number): void; step(dt: number): Promise<void>; play(on: boolean): void } }).__orrery
    o.play(play as boolean)
    o.setCamera(el as number, az as number, dist as number)
    await o.step(dt as number)
  }, [el, az, dist, 1 / fps, path.play && t >= playFrom])
  await page.screenshot({ path: join(out, `frame-${String(i + 1).padStart(5, '0')}.png`), type: 'png' })
  if (i % fps === 0) process.stdout.write(`\r${preset}: frame ${i + 1}/${frames} (${((Date.now() - t0) / 1000).toFixed(0)}s)`)
}
writeFileSync(join(out, 'scene.json'), await page.evaluate(() => (window as unknown as { __orrery: { scene(): string } }).__orrery.scene()))
console.log(`\n${frames} frames + scene.json in ${out}`)
await browser.close()
await server.close()

const mp4 = join(out, `one-sheet-${preset}.mp4`)
const ff = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(fps), '-i', join(out, 'frame-%05d.png'), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', mp4], { stdio: 'inherit' })
console.log(ff.status === 0 ? `wrote ${mp4}` : 'ffmpeg not available or failed; PNG sequence only')
