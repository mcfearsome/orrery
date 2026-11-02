import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CosmologyConfig } from '../sims/cosmology/schema'
import { OneSheetConfig } from '../sims/one-sheet/schema'
import { Scene } from './schema'

describe('scene presets', () => {
  const dir = join(__dirname, 'presets')
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    it(`${f} validates against Scene and its module schema`, () => {
      const scene = Scene.parse(JSON.parse(readFileSync(join(dir, f), 'utf8')))
      expect(scene.series.length).toBeGreaterThan(0)
      for (const s of scene.series) expect(s.x.length).toBe(s.y.length)
      if (scene.module === 'cosmology') CosmologyConfig.parse(scene.params)
      if (scene.module === 'one-sheet') OneSheetConfig.parse(scene.params)
    })
  }
})
