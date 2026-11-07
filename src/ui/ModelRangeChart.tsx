import type { ModelRange } from '../domain/types'
import { money } from './format'
import { Card, CardTitle } from './kit'

export interface RangeMark { label: string; value: number }

/** Axis domain that fits a set of values with padding. */
export function domainOf(values: number[], pad = 0.08): [number, number] {
  const lo = Math.min(...values)
  const hi = Math.max(...values)
  const span = Math.max(hi - lo, hi * 0.05, 1)
  return [Math.max(0, lo - span * pad), hi + span * pad]
}

/**
 * "Where the model thinks the quarter lands": light band P10-P90, darker band P25-P75, grey tick at P50,
 * the call(s) as accent dots above, and plan as a dark dashed line with a tag.
 */
export function ModelRangeChart({
  title, range, plan, planLabel = 'Plan', marks,
}: { title: string; range: ModelRange; plan: number; planLabel?: string; marks: RangeMark[] }) {
  const [lo, hi] = domainOf([range.p10, range.p90, plan, ...marks.map((m) => m.value)], 0.1)
  const pos = (v: number) => ((v - lo) / (hi - lo)) * 100
  const sorted = [...marks].sort((a, b) => a.value - b.value)
  const close = sorted.length > 1 && pos(sorted[sorted.length - 1].value) - pos(sorted[0].value) < 22
  const anchor = (i: number) => (close ? (i === 0 ? 'translateX(-100%)' : 'translateX(0)') : 'translateX(-50%)')
  return (
    <Card labelledBy="model-h" className="flex flex-col gap-[18px] px-7 py-6">
      <CardTitle id="model-h" title={title} sub="Darker band: half of outcomes. Lighter band: 8 in 10 outcomes." />
      <div
        className="relative mx-2 h-[116px]" role="img"
        aria-label={`Model: median ${money(range.p50)}, 8 in 10 outcomes between ${money(range.p10)} and ${money(range.p90)}. ${marks.map((m) => `${m.label} ${money(m.value)}`).join(', ')}. ${planLabel} ${money(plan)}.`}
      >
        <div className="absolute inset-x-0 top-[58px] h-px bg-line" />
        <div className="absolute top-[46px] h-6 rounded bg-[#E3E8F0]" style={{ left: `${pos(range.p10)}%`, width: `${pos(range.p90) - pos(range.p10)}%` }} />
        <div className="absolute top-[46px] h-6 rounded-sm bg-[#B9C4D4]" style={{ left: `${pos(range.p25)}%`, width: `${pos(range.p75) - pos(range.p25)}%` }} />
        <div className="absolute top-[42px] -ml-px h-8 w-0.5 bg-muted" style={{ left: `${pos(range.p50)}%` }} />
        <div className="absolute top-[82px] -translate-x-1/2 whitespace-nowrap text-[13px] text-muted" style={{ left: `${pos(range.p50)}%` }}>
          Model <span className="num text-ink">{money(range.p50)}</span>
        </div>
        <div className="num absolute top-[82px] -translate-x-1/2 text-xs text-[#8A96A8]" style={{ left: `${pos(range.p10)}%`, marginLeft: pos(range.p50) - pos(range.p10) < 9 ? '-16px' : 0 }}>{money(range.p10)}</div>
        <div className="num absolute top-[82px] -translate-x-1/2 text-xs text-[#8A96A8]" style={{ left: `${pos(range.p90)}%`, marginLeft: pos(range.p90) - pos(range.p50) < 9 ? '16px' : 0 }}>{money(range.p90)}</div>
        <div className="absolute top-6 h-[52px] -ml-px border-l-2 border-dashed border-ink" style={{ left: `${pos(plan)}%` }} />
        <div className="absolute top-0 -translate-x-1/2 whitespace-nowrap rounded-[5px] bg-[#F0F2F5] px-2 py-px text-[13px] font-semibold" style={{ left: `${pos(plan)}%` }}>
          {planLabel} {money(plan)}
        </div>
        {sorted.map((m, i) => (
          <div key={m.label}>
            <div className="absolute top-[51px] -ml-[7px] box-border size-3.5 rounded-full border-2 border-white bg-accent" style={{ left: `${pos(m.value)}%` }} />
            <div
              className="absolute top-[22px] whitespace-nowrap text-[13px] font-semibold text-accent"
              style={{ left: `${pos(m.value)}%`, transform: anchor(i) }}
            >
              {m.label} {money(m.value)}
            </div>
          </div>
        ))}
      </div>
    </Card>
  )
}

/** One-row version for tables: band = P10-P90, tick = P50, dot = value, optional small plan tick. */
export function MiniRange({
  range, value, domain, plan, tone = 'auto', ariaLabel,
}: { range: ModelRange; value: number; domain: [number, number]; plan?: number; tone?: 'auto' | 'accent'; ariaLabel: string }) {
  const [lo, hi] = domain
  const pos = (v: number) => `${Math.min(100, Math.max(0, ((v - lo) / (hi - lo)) * 100)).toFixed(2)}%`
  const out = value > range.p75 ? 'above likely range' : value < range.p25 ? 'below likely range' : null
  const orange = tone === 'auto' && out
  return (
    <div className="relative h-[22px]" role="img" aria-label={ariaLabel}>
      <div className="absolute inset-x-0 top-2.5 h-0.5 bg-[#F0F2F5]" />
      <div className="absolute top-1 h-3.5 rounded-[3px] bg-[#E3E8F0]" style={{ left: pos(range.p10), width: `${(((range.p90 - range.p10) / (hi - lo)) * 100).toFixed(2)}%` }} />
      <div className="absolute top-1 h-3.5 rounded-[2px] bg-[#B9C4D4]" style={{ left: pos(range.p25), width: `${(((range.p75 - range.p25) / (hi - lo)) * 100).toFixed(2)}%` }} />
      <div className="absolute top-0.5 -ml-px h-[18px] w-0.5 bg-[#5D6B7E]" style={{ left: pos(range.p50) }} />
      {plan != null && <div className="absolute -top-px -ml-px h-6 w-0.5 bg-ink" style={{ left: pos(plan) }} />}
      <div className="absolute top-[5px] -ml-1.5 size-3 rounded-full" style={{ left: pos(value), background: orange ? '#E9A56A' : '#2457D6' }} />
      {orange && (
        <span
          className="absolute top-[-1px] whitespace-nowrap text-xs text-[#8A3F06]"
          style={value > range.p75 ? { left: `calc(${pos(value)} + 12px)` } : { right: `calc(${100 - parseFloat(pos(value))}% + 12px)` }}
        >
          {out}
        </span>
      )}
    </div>
  )
}
