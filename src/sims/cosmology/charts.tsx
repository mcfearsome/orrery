/** Minimal SVG plotting primitives: one responsive axis-aware canvas, lines and error-bar points. */
import type { ReactNode } from 'react'

export interface Scale { (v: number): number; ticks: number[]; fmt: (v: number) => string }

export function linearScale(d0: number, d1: number, r0: number, r1: number, nTicks = 5): Scale {
  const f = ((v: number) => r0 + ((v - d0) / (d1 - d0)) * (r1 - r0)) as Scale
  const step = niceStep((d1 - d0) / nTicks)
  const ticks: number[] = []
  for (let t = Math.ceil(d0 / step) * step; t <= d1 + 1e-9; t += step) ticks.push(Number(t.toFixed(10)))
  f.ticks = ticks
  const dec = Math.max(0, -Math.floor(Math.log10(step)))
  f.fmt = (v) => v.toFixed(dec)
  return f
}

export function logScale(d0: number, d1: number, r0: number, r1: number): Scale {
  const l0 = Math.log10(d0), l1 = Math.log10(d1)
  const f = ((v: number) => r0 + ((Math.log10(v) - l0) / (l1 - l0)) * (r1 - r0)) as Scale
  const ticks: number[] = []
  for (let e = Math.floor(l0); e <= Math.ceil(l1); e++) for (const m of [1, 2, 5]) {
    const v = m * 10 ** e
    if (v >= d0 && v <= d1) ticks.push(v)
  }
  f.ticks = ticks
  f.fmt = (v) => (v >= 1 ? v.toFixed(0) : v >= 0.1 ? v.toFixed(1) : v.toFixed(2))
  return f
}

function niceStep(raw: number): number {
  const p = 10 ** Math.floor(Math.log10(raw))
  const m = raw / p
  return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p
}

export interface Frame { w: number; h: number; l: number; r: number; t: number; b: number }
export const defaultFrame = (w = 900, h = 360): Frame => ({ w, h, l: 56, r: 16, t: 14, b: 36 })

export function Axes({ fr, x, y, xLabel, yLabel }: { fr: Frame; x: Scale; y: Scale; xLabel: string; yLabel: string }) {
  return (
    <g className="axis">
      <g className="grid">
        {y.ticks.map((t) => <line key={`gy${t}`} x1={fr.l} x2={fr.w - fr.r} y1={y(t)} y2={y(t)} />)}
        {x.ticks.map((t) => <line key={`gx${t}`} y1={fr.t} y2={fr.h - fr.b} x1={x(t)} x2={x(t)} />)}
      </g>
      <path d={`M${fr.l},${fr.t}V${fr.h - fr.b}H${fr.w - fr.r}`} fill="none" />
      {y.ticks.map((t) => <text key={`ty${t}`} x={fr.l - 6} y={y(t) + 4} textAnchor="end">{y.fmt(t)}</text>)}
      {x.ticks.map((t) => <text key={`tx${t}`} x={x(t)} y={fr.h - fr.b + 14} textAnchor="middle">{x.fmt(t)}</text>)}
      <text x={(fr.l + fr.w - fr.r) / 2} y={fr.h - 4} textAnchor="middle">{xLabel}</text>
      <text transform={`translate(12,${(fr.t + fr.h - fr.b) / 2}) rotate(-90)`} textAnchor="middle">{yLabel}</text>
    </g>
  )
}

export function Line({ xs, ys, x, y, color, width = 2, dash }: { xs: number[]; ys: number[]; x: Scale; y: Scale; color: string; width?: number; dash?: string }) {
  let d = ''
  for (let i = 0; i < xs.length; i++) {
    if (!Number.isFinite(ys[i])) continue
    d += `${d ? 'L' : 'M'}${x(xs[i]).toFixed(1)},${y(ys[i]).toFixed(1)}`
  }
  return <path d={d} fill="none" stroke={color} strokeWidth={width} strokeDasharray={dash} />
}

export function ErrorPoints({ xs, ys, es, x, y, color, r = 1.6, opacity = 0.6 }: { xs: number[]; ys: number[]; es?: number[]; x: Scale; y: Scale; color: string; r?: number; opacity?: number }) {
  const nodes: ReactNode[] = []
  for (let i = 0; i < xs.length; i++) {
    const cx = x(xs[i]), cy = y(ys[i])
    if (es) nodes.push(<line key={`e${i}`} x1={cx} x2={cx} y1={y(ys[i] - es[i])} y2={y(ys[i] + es[i])} stroke={color} strokeWidth={0.8} opacity={opacity * 0.6} />)
    nodes.push(<circle key={`p${i}`} cx={cx} cy={cy} r={r} fill={color} opacity={opacity} />)
  }
  return <g>{nodes}</g>
}

export function Chart({ fr, children, title }: { fr: Frame; children: ReactNode; title?: string }) {
  return (
    <svg className="chart" viewBox={`0 0 ${fr.w} ${fr.h}`} role="img" aria-label={title}>
      <defs>
        <clipPath id={`clip-${fr.w}-${fr.h}`}><rect x={fr.l} y={fr.t} width={fr.w - fr.l - fr.r} height={fr.h - fr.t - fr.b} /></clipPath>
      </defs>
      {children}
    </svg>
  )
}

export const clipId = (fr: Frame) => `url(#clip-${fr.w}-${fr.h})`
