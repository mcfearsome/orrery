import { Scene } from '../../scenes/schema'
import { crossSection, cyclePhase, drains, expanded, undersideDensity } from './model'
import type { OneSheetConfig } from './schema'

/** What the storyboard pipeline needs to redraw a one-sheet moment without re-running the sim. */
export function sceneFromState(cfg: OneSheetConfig, anim: { scale: number; pooled: number; t: number }, preset = 'custom'): Scene {
  const eff = expanded(cfg, anim.scale, anim.pooled)
  const ds = drains(eff)
  const cy = cyclePhase(anim.t, cfg.cyclePeriod, cfg.cycleDepth)
  const mid = crossSection(eff, 0)
  const pool = mid.x.map((x) => undersideDensity(ds, eff.spread, x, 0))
  return Scene.parse({
    schema: 'orrery.scene.v1',
    id: `one-sheet-${preset}-${Date.now()}`,
    module: 'one-sheet',
    title: `One sheet, two sides: ${preset}`,
    beat: 'explain',
    render_hint: 'preview',
    params: cfg,
    series: [
      { id: 'height_y0', label: 'sheet height along y = 0 (topside above, underside below)', x: mid.x, y: mid.h, xLabel: 'x', yLabel: 'h' },
      { id: 'underside_density_y0', label: 'pooled underside energy along y = 0', x: mid.x, y: pool, xLabel: 'x', yLabel: 'ρ_under' },
      { id: 'galaxies', label: 'galaxy positions (x, y) at this scale factor', x: eff.masses.map((m) => m.x), y: eff.masses.map((m) => m.y), xLabel: 'x', yLabel: 'y' },
      { id: 'galaxy_mass', label: 'galaxy masses (index, m)', x: eff.masses.map((_, i) => i), y: eff.masses.map((m) => m.m) },
      { id: 'drains', label: 'drain positions (x, y)', x: ds.map((d) => d.x), y: ds.map((d) => d.y), xLabel: 'x', yLabel: 'y' },
    ],
    readouts: {
      scale_factor: anim.scale, pooled: anim.pooled, t: anim.t,
      n_masses: cfg.masses.length, n_drains: ds.length, sheet_size: eff.sheetSize,
      cycle_level: cy.level, cycle_phase: cy.phase,
    },
    notes: 'h = exaggeration · Σ −m/√(r²+ε²) + ridge · pooled · ρ_under. Softened Newtonian, not GR. Drains flow topside → underside only; the cycle burst is the one upward path.',
    createdAt: new Date().toISOString(),
  })
}
