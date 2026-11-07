import { useMemo } from 'react'
import type { ArrBridge, CallTriple, Kpi, ModelRange, TrendPoint } from '../domain/types'
import { SEGMENT_LABEL } from '../domain/types'
import { api } from '../ui/api'
import { ds } from '../ui/dataset'
import { MINUS, millions, niceMax, pct, signedMillions, times } from '../ui/format'
import { useViewInput } from '../ui/hooks'
import { ModelRangeChart } from '../ui/ModelRangeChart'
import { Card, CheckIcon } from '../ui/kit'

/** Board screen (prototype: Board.dc.html). */
export function BoardView() {
  const input = useViewInput()
  const v = useMemo(() => api.boardView(ds, input), [input])
  const attain = v.call.mostLikely / v.plan

  return (
    <main className="mx-auto flex max-w-[1280px] flex-col gap-6 px-8 pb-16 pt-8">
      <Card labelledBy="hero-h" className="flex flex-wrap items-center gap-x-14 gap-y-7 p-7">
        <div className="flex min-w-0 flex-[1_1_320px] flex-col gap-1.5">
          <h1 id="hero-h" className="m-0 text-[15px] font-medium text-muted">
            {v.quarterLabel.split(' ')[0]} net new ARR · CRO's most likely call
          </h1>
          <div className="flex flex-wrap items-baseline gap-x-3.5 gap-y-1.5">
            <span className="text-[56px] tabular-nums font-semibold leading-[1.05] tracking-[-0.03em]">{millions(v.call.mostLikely)}</span>
            <span className={`rounded-full px-2.5 py-1 text-sm font-semibold ${attain >= 1 ? 'bg-[#E4F4EC] text-good' : 'bg-warn-soft text-[#8A3F06]'}`}>
              {pct(attain)} of {millions(v.plan)} plan
            </span>
          </div>
          <span className="flex max-w-[44ch] items-start gap-2 text-sm text-muted">
            <span className="mt-[3px]"><CheckIcon /></span>
            {v.accuracyNote}
          </span>
        </div>
        <div className="flex min-w-0 flex-[1.3_1_460px] flex-col gap-1.5">
          <RangeGraphic call={v.call} plan={v.plan} />
        </div>
      </Card>

      <ModelRangeChart
        title="Where the model thinks the quarter lands" range={v.model} plan={v.plan}
        marks={[{ label: "CRO's call", value: v.call.mostLikely }]}
      />

      <div className="grid grid-cols-[repeat(auto-fit,minmax(440px,1fr))] gap-6">
        <Waterfall bridge={v.bridge} plan={v.plan} net={v.call.mostLikely} />
        <Trend trend={v.trend} plan={v.plan} week={v.week} />
      </div>

      <Card labelledBy="seg-h" className="flex flex-col gap-2 px-7 pb-3 pt-6">
        <h2 id="seg-h" className="m-0 text-[17px] font-semibold">By segment</h2>
        <div className="overflow-x-auto">
          <div className="min-w-[680px]">
            {v.segments.map((s) => {
              const ratio = s.call / s.plan
              return (
                <div key={s.segment} className="grid grid-cols-[minmax(170px,1fr)_minmax(240px,2fr)_120px_56px] items-center gap-6 border-t border-[#F0F2F5] py-4">
                  <div className="flex flex-col leading-snug">
                    <span className="font-semibold">{SEGMENT_LABEL[s.segment]}</span>
                    <span className="text-[13px] text-muted">{s.segment === 'SMB' ? 'Model, checked by reps' : 'Rep calls, deal by deal'}</span>
                  </div>
                  <div
                    className="relative h-3.5 rounded-[7px] bg-[#F0F2F5]" role="img"
                    aria-label={`${SEGMENT_LABEL[s.segment]}: forecast ${millions(s.call)} of ${millions(s.plan)} plan`}
                  >
                    <div className="absolute inset-y-0 left-0 rounded-[7px] bg-accent" style={{ width: `${Math.min(100, ratio * 100).toFixed(1)}%` }} />
                    <div className="absolute -inset-y-1 right-0 w-0.5 bg-ink" />
                  </div>
                  <div className="num text-right"><span className="font-semibold">{millions(s.call)}</span><span className="text-muted"> / {millions(s.plan)}</span></div>
                  <div className="num text-right font-semibold">{pct(ratio)}</div>
                </div>
              )
            })}
          </div>
        </div>
      </Card>

      <section aria-label="Health metrics" className="flex flex-col gap-4">
        {kpiRows(v.kpis).map((row, i) => (
          <div key={i} className="grid gap-4" style={{ gridTemplateColumns: `repeat(${row.length}, minmax(0, 1fr))` }}>
            {row.map((k) => <KpiCard key={k.id} kpi={k} />)}
          </div>
        ))}
      </section>
    </main>
  )
}

// ───────────────────────── range graphic ─────────────────────────

function RangeGraphic({ call, plan }: { call: CallTriple; plan: number }) {
  const half = 500_000
  const lo = Math.floor((Math.min(call.commit, plan) - half) / half) * half
  const hi = Math.ceil((Math.max(call.bestCase, plan) + half) / half) * half
  const pos = (x: number) => ((x - lo) / (hi - lo)) * 100
  const labels: [string, number, boolean][] = [['Commit', call.commit, false], ['Most likely', call.mostLikely, true], ['Best case', call.bestCase, false]]
  return (
    <div
      className="relative h-[108px]" role="img"
      aria-label={`Range: commit ${millions(call.commit)}, most likely ${millions(call.mostLikely)}, best case ${millions(call.bestCase)}. Plan ${millions(plan)}.`}
    >
      <div className="absolute top-0 -translate-x-1/2 whitespace-nowrap rounded-[5px] bg-[#F0F2F5] px-2 py-px text-[13px] font-semibold" style={{ left: `${pos(plan)}%` }}>
        Plan {millions(plan)}
      </div>
      <div className="absolute top-6 -ml-px h-[42px] border-l-2 border-dashed border-ink" style={{ left: `${pos(plan)}%` }} />
      <div className="absolute inset-x-0 top-11 h-2 rounded bg-[#EEF1F5]" />
      <div
        className="absolute top-10 h-4 rounded-lg bg-accent/20"
        style={{ left: `${pos(call.commit)}%`, width: `${pos(call.bestCase) - pos(call.commit)}%` }}
      />
      <div className="absolute top-[34px] -ml-0.5 h-7 w-1 rounded-sm bg-accent" style={{ left: `${pos(call.mostLikely)}%` }} />
      {labels.map(([label, value, strong]) => (
        <div key={label} className="absolute top-[72px] flex -translate-x-1/2 flex-col items-center leading-[1.3]" style={{ left: `${pos(value)}%` }}>
          <span className="text-xs text-muted">{label}</span>
          <span className={`num text-[13px] ${strong ? 'font-semibold' : 'font-medium'}`}>{millions(value)}</span>
        </div>
      ))}
    </div>
  )
}

// ───────────────────────── waterfall ─────────────────────────

function Waterfall({ bridge, plan, net }: { bridge: ArrBridge; plan: number; net: number }) {
  const peak = bridge.newArr + bridge.expansionArr
  const max = niceMax(Math.max(peak, plan) * 1.12, 1_000_000)
  const p = (v: number) => `${((v / max) * 100).toFixed(2)}%`
  const afterChurn = peak - bridge.churnArr
  const bars = [
    { label: 'New customers', sub: 'New logos, self-serve and sales', from: 0, to: bridge.newArr, color: 'bg-accent/45', value: signedMillions(bridge.newArr), strong: false, connect: true },
    { label: 'Expansion', sub: 'Upgrades and credit packs', from: bridge.newArr, to: peak, color: 'bg-accent/45', value: signedMillions(bridge.expansionArr), strong: false, connect: true },
    { label: 'Churn and downgrade', sub: 'Lost or shrunk accounts', from: peak, to: afterChurn, color: 'bg-churn', value: `${MINUS}${millions(bridge.churnArr)}`, strong: false, connect: true },
    { label: 'Net new ARR', sub: 'Most likely', from: 0, to: net, color: 'bg-accent', value: millions(net), strong: true, connect: false },
  ]
  return (
    <Card labelledBy="bridge-h" className="flex flex-col gap-[18px] px-7 py-6">
      <div className="flex flex-col gap-0.5">
        <h2 id="bridge-h" className="m-0 text-[17px] font-semibold">Where the {millions(net)} comes from</h2>
        <span className="text-sm text-muted">ARR grows from {millions(bridge.startingArr)} to {millions(bridge.endingArr)} this quarter</span>
      </div>
      <div
        className="flex flex-col gap-3" role="img"
        aria-label={`New customers ${signedMillions(bridge.newArr)}, expansion ${signedMillions(bridge.expansionArr)}, churn and downgrades minus ${millions(bridge.churnArr)}, net new ${millions(net)}, plan ${millions(plan)}`}
      >
        <div className="relative grid h-[230px] grid-cols-4 gap-5 border-b border-[#C9D1DB]">
          <div className="absolute inset-x-0 border-t-[1.5px] border-dashed border-[#8A96A8]" style={{ bottom: p(plan) }} />
          <div className="absolute left-0 -translate-y-1 text-xs text-muted" style={{ bottom: p(plan) }}>Plan {millions(plan)}</div>
          {bars.map((b) => {
            const down = b.to < b.from
            return (
              <div key={b.label} className="relative h-full">
                {b.connect && (
                  <div className="absolute border-t border-[#8A96A8]" style={{ left: '86%', right: 'calc(-14% - 20px)', bottom: p(b.to) }} />
                )}
                <div className={`absolute inset-x-[14%] rounded ${b.color}`} style={{ bottom: p(Math.min(b.from, b.to)), height: p(Math.abs(b.to - b.from)) }} />
                <div
                  className={`num absolute inset-x-0 text-center text-sm font-semibold ${down ? 'text-warn' : 'text-ink'}`}
                  style={{ bottom: `calc(${p(Math.max(b.from, b.to))} + 6px)` }}
                >
                  {b.value}
                </div>
              </div>
            )
          })}
        </div>
        <div className="grid grid-cols-4 gap-5">
          {bars.map((b) => (
            <div key={b.label} className="flex flex-col items-center text-center leading-[1.3]">
              <span className={`text-sm ${b.strong ? 'font-semibold' : 'font-medium'}`}>{b.label}</span>
              <span className="text-xs text-muted">{b.sub}</span>
            </div>
          ))}
        </div>
      </div>
    </Card>
  )
}

// ───────────────────────── trend ─────────────────────────

function Trend({ trend, plan, week }: { trend: TrendPoint[]; plan: number; week: number }) {
  const W = 560, H = 230, x0 = 44, x1 = 540, y0 = 20, y1 = 180
  const known = trend.filter((t) => t.call != null)
  const vals = known.flatMap((t) => [t.call as number, t.model?.p10 ?? t.call as number, t.model?.p90 ?? t.call as number]).concat(plan)
  const lo = Math.floor((Math.min(...vals) / 1e6) * 2) / 2
  const hi = Math.ceil((Math.max(...vals) / 1e6) * 2) / 2
  const x = (w: number) => x0 + ((w - 1) / 12) * (x1 - x0)
  const y = (v: number) => y0 + ((hi - v / 1e6) / (hi - lo)) * (y1 - y0)
  const ticks: number[] = []
  for (let t = hi; t >= lo - 1e-9; t -= 0.5) ticks.push(t)
  const withModel = known.filter((t) => t.model)
  const band = [
    ...withModel.map((t) => `${x(t.week)},${y((t.model as ModelRange).p90)}`),
    ...withModel.slice().reverse().map((t) => `${x(t.week)},${y((t.model as ModelRange).p10)}`),
  ].join(' ')
  const line = (f: (t: TrendPoint) => number | undefined) =>
    known.map((t) => ({ t, v: f(t) })).filter((d) => d.v != null).map((d) => `${x(d.t.week)},${y(d.v as number)}`).join(' ')
  const last = known[known.length - 1]
  const lx = last ? x(last.week) : x0
  const labelRight = lx < 470
  const first = known[0]
  const lastCall = last?.call ?? 0
  const lastModel = last?.model?.p50 ?? 0
  const converging = first?.model && last?.model && (last.model.p90 - last.model.p10) < (first.model.p90 - first.model.p10)

  return (
    <Card labelledBy="traj-h" className="flex flex-col gap-3.5 px-7 py-6">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1.5">
        <div className="flex flex-col gap-0.5">
          <h2 id="traj-h" className="m-0 text-[17px] font-semibold">How the call has moved</h2>
          <span className="text-sm text-muted">{converging ? 'The model range is narrowing as the quarter plays out' : 'Call and model, week by week'}</span>
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img"
        aria-label={`Weeks 1 to ${week}: CRO call from ${millions(first?.call ?? 0)} to ${millions(lastCall)}; model from ${millions(first?.model?.p50 ?? 0)} to ${millions(lastModel)}; plan ${millions(plan)}`}>
        {week < 13 && <rect x={lx} y={y0} width={x1 - lx} height={y1 - y0} fill="#FAFBFC" />}
        <g stroke="#F0F2F5" strokeWidth="1">{ticks.map((t) => <line key={t} x1={x0} x2={x1} y1={y(t * 1e6)} y2={y(t * 1e6)} />)}</g>
        <g fontSize="12" fill="#5D6B7E" fontFamily="Geist Mono, monospace" textAnchor="end">
          {ticks.map((t) => <text key={t} x={36} y={y(t * 1e6) + 4}>{t.toFixed(1)}</text>)}
        </g>
        {withModel.length > 1 && <polygon points={band} fill="#EEF1F5" />}
        <line x1={x0} x2={x1} y1={y(plan)} y2={y(plan)} stroke="#8A96A8" strokeWidth="1.5" strokeDasharray="5 4" />
        <text x={x1 - 4} y={y(plan) - 8} textAnchor="end" fontSize="12" fill="#5D6B7E" fontFamily="Geist, sans-serif">Plan {millions(plan)}</text>
        <polyline points={line((t) => t.model?.p50)} fill="none" stroke="#8A96A8" strokeWidth="2" strokeLinejoin="round" />
        <polyline points={line((t) => t.call ?? undefined)} fill="none" stroke="#2457D6" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
        {last && (
          <>
            <circle cx={lx} cy={y(lastCall)} r="5.5" fill="#2457D6" stroke="#fff" strokeWidth="2" />
            {lastModel > 0 && <circle cx={lx} cy={y(lastModel)} r="4.5" fill="#8A96A8" stroke="#fff" strokeWidth="2" />}
            <text
              x={labelRight ? lx + 14 : lx - 12} y={y(lastCall) + (labelRight ? -1 : -12)} fontSize="13" fontWeight="600" fill="#101828"
              textAnchor={labelRight ? 'start' : 'end'} fontFamily="Geist, sans-serif"
            >
              Call {millions(lastCall)}
            </text>
            {lastModel > 0 && (
              <text
                x={labelRight ? lx + 14 : lx - 12} y={y(lastModel) + (labelRight ? 9 : 20)} fontSize="13" fill="#5D6B7E"
                textAnchor={labelRight ? 'start' : 'end'} fontFamily="Geist, sans-serif"
              >
                Model {millions(lastModel)}
              </text>
            )}
          </>
        )}
        {week < 13 && (
          <text x={(lx + x1) / 2} y={y1 - 20} textAnchor="middle" fontSize="12" fill="#8A96A8" fontFamily="Geist, sans-serif">
            Weeks {week + 1}–13 ahead
          </text>
        )}
        <g fontSize="12" fill="#5D6B7E" fontFamily="Geist Mono, monospace" textAnchor="middle">
          <text x={x0} y={210}>W1</text>
          {week > 1 && week < 13 && <text x={lx} y={210}>W{week}</text>}
          <text x={x1} y={210}>W13</text>
        </g>
      </svg>
      <div className="flex flex-wrap gap-x-5 gap-y-1 text-[13px] text-muted">
        <span><span className="mr-1.5 inline-block h-[3px] w-3.5 rounded-sm bg-accent align-middle" />CRO call</span>
        <span><span className="mr-1.5 inline-block h-2.5 w-3.5 rounded-sm border-t-2 border-[#8A96A8] bg-[#EEF1F5] align-middle" />Model, with its P10–P90 range</span>
      </div>
    </Card>
  )
}

// ───────────────────────── KPIs ─────────────────────────

/** Split KPIs into balanced rows (7 becomes 4 + 3) so there is never an orphan row. */
function kpiRows(kpis: Kpi[]): Kpi[][] {
  if (kpis.length <= 4) return [kpis]
  const first = Math.ceil(kpis.length / 2)
  return [kpis.slice(0, first), kpis.slice(first)]
}

const LOWER_IS_BETTER = new Set<Kpi['id']>(['cycle-days'])

function fmtKpi(k: Kpi): { value: string; delta: string; good: boolean | null } {
  // Percent KPIs may arrive as fractions (1.12) or already as points (112); small magnitudes are fractions.
  const frac = k.unit === '%' && Math.abs(k.value) <= 3
  const scale = frac ? 100 : 1
  const value = k.unit === '%' ? `${Math.round(k.value * scale)}%` : k.unit === 'x' ? times(k.value) : `${Math.round(k.value)} days`
  let delta = ''
  let good: boolean | null = null
  if (k.change != null && Math.abs(k.change) > 1e-9) {
    const c = k.change * (k.unit === '%' ? scale : 1)
    const sign = c > 0 ? '+' : MINUS
    const mag = Math.abs(c)
    const num = k.unit === 'x' ? mag.toFixed(1) : String(Math.round(mag))
    if (Number(num) === 0) return { value, delta: 'no change', good: null }
    delta = `${sign}${num}${k.unit === '%' ? (Math.round(mag) === 1 ? ' pt' : ' pts') : k.unit === 'x' ? '×' : ' days'} vs last quarter`
    good = LOWER_IS_BETTER.has(k.id) ? c < 0 : c > 0
  } else if (k.target != null) {
    delta = `target ${k.unit === 'x' ? times(k.target) : k.unit === '%' ? `${Math.round(k.target * scale)}%` : `${k.target} days`}`
    good = k.value >= k.target
  }
  return { value, delta, good }
}

function KpiCard({ kpi }: { kpi: Kpi }) {
  const f = fmtKpi(kpi)
  return (
    <div className="flex flex-col gap-1 rounded-[14px] border border-line bg-card px-5 py-[18px]">
      <span className="text-[13px] text-muted">{kpi.label}</span>
      <div className="flex items-baseline justify-between gap-2">
        <span className="num text-2xl font-semibold tracking-[-0.02em]">{f.value}</span>
        <span className="text-[13px] font-medium" style={{ color: f.good == null ? '#5D6B7E' : f.good ? '#0B6B4A' : '#A14A0B' }}>{f.delta}</span>
      </div>
    </div>
  )
}
