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

interface Path { seconds: number; play: boolean; playFrom?: number; camera: (u: number, size: number) => [el: number, az: number, dist: number] }

/** Camera paths per preset: elevation (°, negative = underside), azimuth (°), distance (sheet sizes). u is 0..1 through the clip. */
const ONE_SHEET: Record<string, Path> = {
  sheet: { seconds: 8, play: false, camera: (u, s) => [26, -20 + 50 * u, 1.3 * s] },
  drain: { seconds: 10, play: false, camera: (u, s) => [u < 0.5 ? 28 - 112 * (u / 0.5) ** 1.5 : -28 - 10 * ((u - 0.5) / 0.5), 15 + 40 * u, 1.25 * s] },
  // s03: start underneath on the dents, roll up over the rim to the topside ridges while space expands
  cosmic: { seconds: 14, play: true, playFrom: 1.5, camera: (u, s) => [-30 + 62 * smooth(u), -10 + 40 * u, 1.2 * s] },
  // s12: hold topside and let the cycle run; slow drift
  cycle: { seconds: 28, play: true, camera: (u, s) => [30 - 6 * u, 10 + 35 * u, 1.15 * s] },
}
const smooth = (u: number) => u * u * (3 - 2 * u)

const [, , mod, preset, ...rest] = process.argv
const opt = (k: string, d: number) => { const i = rest.indexOf(`--${k}`); return i >= 0 ? Number(rest[i + 1]) : d }
const outArg = rest.includes('--out') ? rest[rest.indexOf('--out') + 1] : undefined

if (mod !== 'one-sheet' || !preset || !(preset in ONE_SHEET)) {
  console.error(`usage: pnpm capture one-sheet <${Object.keys(ONE_SHEET).join('|')}> [--seconds N] [--fps N] [--out DIR]`)
  process.exit(2)
}
const path = ONE_SHEET[preset]
const fps = opt('fps', 30)
const seconds = opt('seconds', path.seconds)
const frames = Math.round(seconds * fps)
const out = outArg ?? join('captures', `one-sheet-${preset}`)
mkdirSync(out, { recursive: true })

const server = await createServer({ server: { port: 5199, strictPort: true }, logLevel: 'error' })
await server.listen()
const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--hide-scrollbars'] })
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 })
await page.goto(`http://localhost:5199/?capture=${preset}#one-sheet`)
await page.waitForFunction(() => (window as unknown as { __orrery?: { ready: boolean } }).__orrery?.ready, null, { timeout: 30000 })

const sheetSize = await page.evaluate(() => JSON.parse((window as unknown as { __orrery: { scene(): string } }).__orrery.scene()).readouts.sheet_size as number)
const t0 = Date.now()
for (let i = 0; i < frames; i++) {
  const u = i / Math.max(1, frames - 1)
  const t = i / fps
  const [el, az, dist] = path.camera(u, sheetSize)
  await page.evaluate(async ([el, az, dist, dt, play]) => {
    const o = (window as unknown as { __orrery: { setCamera(e: number, a: number, d: number): void; step(dt: number): Promise<void>; play(on: boolean): void } }).__orrery
    o.play(play as boolean)
    o.setCamera(el as number, az as number, dist as number)
    await o.step(dt as number)
  }, [el, az, dist, 1 / fps, path.play && t >= (path.playFrom ?? 0)])
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
