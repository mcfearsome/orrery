import { z } from 'zod'

/**
 * Serializable playground scene for the storyboard pipeline (Manim/Remotion).
 * Mirrors the V01 storyboard Scene fields that matter downstream (id, beat,
 * durationSec, voStartMs/voEndMs, render_hint) and adds the sim payload:
 * the exact parameters plus sampled curves so renderers never re-run the sim.
 */
export const Series = z.object({
  id: z.string(),
  label: z.string(),
  x: z.array(z.number()),
  y: z.array(z.number()),
  xLabel: z.string().optional(),
  yLabel: z.string().optional(),
  /** optional per-point 1σ error (same length as y) */
  yErr: z.array(z.number()).optional(),
})
export type Series = z.infer<typeof Series>

export const Scene = z.object({
  schema: z.literal('orrery.scene.v1'),
  id: z.string().min(1),
  module: z.string().min(1),
  title: z.string().min(1),
  beat: z.enum(['hook', 'stakes', 'explain', 'reveal', 'demo', 'payoff', 'cta']).optional(),
  render_hint: z.enum(['preview', 'full']).default('preview'),
  durationSec: z.number().positive().optional(),
  voStartMs: z.number().nonnegative().nullable().default(null),
  voEndMs: z.number().nonnegative().nullable().default(null),
  /** the sim config that produced the series, validated by the module's own schema */
  params: z.record(z.string(), z.unknown()),
  series: z.array(Series),
  readouts: z.record(z.string(), z.number()),
  notes: z.string().optional(),
  createdAt: z.string(),
})
export type Scene = z.infer<typeof Scene>

export const Storyboard = z.object({
  schema: z.literal('orrery.storyboard.v1'),
  id: z.string(),
  title: z.string(),
  fps: z.number().int().positive().default(30),
  scenes: z.array(Scene),
})
export type Storyboard = z.infer<typeof Storyboard>
