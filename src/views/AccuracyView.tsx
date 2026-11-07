import { useMemo, useState } from 'react'
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { CalibrationRow, ChainStep, PersonRole, Segment } from '../domain/types'
import { SEGMENT_LABEL } from '../domain/types'
import { api } from '../ui/api'
import { ds } from '../ui/dataset'
import { money, pct } from '../ui/format'
import { Avatar, Card, CardTitle, PageHeader, Segmented } from '../ui/kit'

const LEVEL_COLOR: Record<ChainStep['level'], string> = {
  Reps: '#8A96A8', Managers: '#0B7285', Directors: '#4B44C9', CRO: '#2457D6',
}
const ROLE_LABEL: Record<PersonRole, string> = { rep: 'Rep', manager: 'Manager', director: 'Director', cro: 'CRO' }

export function AccuracyView() {
  const v = useMemo(() => api.accuracyView(ds), [])
  return (
    <main className="mx-auto flex max-w-[1280px] flex-col gap-6 px-8 pb-16 pt-8">
      <PageHeader
        title="Accuracy"
        sub="How close each level's most likely call lands to the final number, averaged over the last four closed quarters."
      />
      <ByWeek byWeek={v.byWeek} />
      <section aria-label="Slip, push and conversion" className="grid grid-cols-[repeat(auto-fit,minmax(260px,1fr))] gap-4">
        <Stat label="Slip rate" value={pct(v.slipRate)} note="of Commit deals ended up closing in a later quarter" />
        <Stat label="Push rate" value={pct(v.pushRate)} note="of deals had their close date moved at least once" />
        <Stat label="Commit conversion" value={pct(v.commitConversion)} note="of the dollars called Commit closed won" />
      </section>
      <Bias people={v.people} />
      <Calibration data={v.calibration} />
    </main>
  )
}

function Stat({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-[14px] border border-line bg-card px-6 py-5">
      <span className="text-[13px] text-muted">{label}</span>
      <span className="num text-[28px] font-semibold tracking-[-0.02em]">{value}</span>
      <span className="text-sm text-muted">{note}</span>
    </div>
  )
}

// ───────────────────────── accuracy by week ─────────────────────────

function ByWeek({ byWeek }: { byWeek: { level: ChainStep['level']; points: { week: number; ratio: number }[] }[] }) {
  const data = useMemo(
    () => Array.from({ length: 13 }, (_, i) => {
      const row: Record<string, number> = { week: i + 1 }
      for (const l of byWeek) row[l.level] = l.points.find((p) => p.week === i + 1)?.ratio ?? NaN
      return row
    }),
    [byWeek],
  )
  return (
    <Card labelledBy="byweek-h" className="flex flex-col gap-3 px-7 pb-5 pt-6">
      <CardTitle
        id="byweek-h" title="Accuracy by week of the quarter"
        sub="Final result divided by the call made that week. 1.00 is perfect; below 1.00 means the call was too high."
      />
      <div className="h-[340px] w-full" role="img" aria-label="Line chart of accuracy ratio by week of quarter for reps, managers, directors and the CRO">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 12, right: 92, bottom: 4, left: 0 }}>
            <CartesianGrid stroke="#F0F2F5" vertical={false} />
            <XAxis dataKey="week" tickFormatter={(w) => `W${w}`} tick={{ fontSize: 12, fill: '#5D6B7E' }} axisLine={{ stroke: '#C9D1DB' }} tickLine={false} />
            <YAxis
              domain={[0.7, 1.05]} ticks={[0.7, 0.8, 0.9, 1.0]} tickFormatter={(v: number) => v.toFixed(2)}
              tick={{ fontSize: 12, fill: '#5D6B7E', fontFamily: 'Geist Mono, monospace' }} axisLine={false} tickLine={false} width={44}
            />
            <ReferenceLine y={1} stroke="#101828" strokeDasharray="5 4" label={{ value: 'Call = actual', position: 'insideBottomLeft', fontSize: 12, fill: '#5D6B7E' }} />
            <Tooltip
              formatter={(value, name) => [typeof value === 'number' ? value.toFixed(3) : String(value), String(name)]}
              labelFormatter={(w) => `Week ${w}`} contentStyle={{ borderRadius: 10, border: '1px solid #E4E8EE', fontSize: 13 }}
            />
            {byWeek.map((l) => (
              <Line
                key={l.level} type="monotone" dataKey={l.level} stroke={LEVEL_COLOR[l.level]} strokeWidth={l.level === 'CRO' ? 3 : 2}
                dot={false} activeDot={{ r: 4 }} isAnimationActive={false}
                label={(p: { x?: number | string; y?: number | string; index?: number }) =>
                  p.index === 12 && p.x != null && p.y != null ? (
                    <text key={l.level} x={Number(p.x) + 10} y={Number(p.y) + 4 + (['Reps', 'Managers', 'Directors', 'CRO'].indexOf(l.level) - 1.5) * 4} fontSize={13} fontWeight={600} fill={LEVEL_COLOR[l.level]}>{l.level}</text>
                  ) : <g key={`${l.level}-${p.index}`} />
                }
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </Card>
  )
}

// ───────────────────────── bias ─────────────────────────

function Bias({ people }: { people: ReturnType<typeof api.accuracyView>['people'] }) {
  const [filter, setFilter] = useState<'all' | PersonRole>('all')
  const [all, setAll] = useState(false)
  const rows = useMemo(
    () => people.filter((p) => filter === 'all' || p.person.role === filter).sort((a, b) => a.bias.commitRatio - b.bias.commitRatio),
    [people, filter],
  )
  const shown = all ? rows : rows.slice(0, 10)
  const lo = 0.7, hi = 1.15
  const at = (r: number) => `${(((Math.min(hi, Math.max(lo, r)) - lo) / (hi - lo)) * 100).toFixed(1)}%`
  return (
    <Card labelledBy="bias-h" className="flex flex-col gap-3 px-7 pb-4 pt-6">
      <CardTitle
        id="bias-h" title="Who runs high, who runs low"
        sub="Average of final result ÷ commit call, at the same point in the quarter. Managers see this next to each rep's call."
        right={
          <Segmented<'all' | PersonRole>
            label="Show level" value={filter} onChange={setFilter}
            options={[{ value: 'all', label: 'Everyone' }, { value: 'rep', label: 'Reps' }, { value: 'manager', label: 'Managers' }, { value: 'director', label: 'Directors' }]}
          />
        }
      />
      <div className="overflow-x-auto">
        <div className="min-w-[680px]">
          <div className="grid grid-cols-[minmax(180px,1.2fr)_minmax(220px,2fr)_90px_90px] gap-5 pb-1.5 pt-1 text-xs font-medium uppercase tracking-wide text-muted">
            <span>Person</span><span>Lands at … of commit</span><span className="text-right">Of most likely</span><span className="text-right">Typical miss</span>
          </div>
          {shown.map((p) => {
            const r = p.bias.commitRatio
            const low = r < 1
            return (
              <div key={p.person.id} className="grid grid-cols-[minmax(180px,1.2fr)_minmax(220px,2fr)_90px_90px] items-center gap-5 border-t border-[#F0F2F5] py-3">
                <div className="flex items-center gap-2.5">
                  <Avatar name={p.person.name} />
                  <div className="flex flex-col leading-tight">
                    <span className="font-medium">{p.person.name}</span>
                    <span className="text-xs text-muted">{ROLE_LABEL[p.person.role]}{p.person.segment ? ` · ${SEGMENT_LABEL[p.person.segment]}` : ''}</span>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="relative h-5 flex-1" role="img" aria-label={`Lands at ${pct(r)} of commit`}>
                    <div className="absolute inset-x-0 top-[9px] h-0.5 bg-[#EEF1F5]" />
                    <div
                      className={`absolute top-[8px] h-1 rounded-sm ${low ? 'bg-churn' : 'bg-accent/40'}`}
                      style={{ left: at(Math.min(1, r)), width: `${(Math.abs(parseFloat(at(r)) - parseFloat(at(1)))).toFixed(1)}%` }}
                    />
                    <div className="absolute -top-px h-[22px] w-px bg-ink" style={{ left: at(1) }} />
                    <div className={`absolute top-1 -ml-1.5 size-3 rounded-full ${low ? 'bg-warn' : 'bg-accent'}`} style={{ left: at(r) }} />
                  </div>
                  <span className="num w-12 text-right text-sm font-semibold">{pct(r)}</span>
                </div>
                <span className="num text-right text-sm text-muted">{pct(p.bias.mostLikelyRatio)}</span>
                <span className="num text-right text-sm text-muted">±{pct(p.mape, 1)}</span>
              </div>
            )
          })}
        </div>
      </div>
      {rows.length > 10 && (
        <button type="button" onClick={() => setAll(!all)} className="cursor-pointer self-start border-0 bg-transparent p-0 pb-1 text-sm text-accent underline">
          {all ? 'Show fewer' : `Show all ${rows.length}`}
        </button>
      )}
    </Card>
  )
}

// ───────────────────────── model calibration ─────────────────────────

function Calibration({ data }: { data: { segment: Segment; rows: CalibrationRow[] }[] }) {
  return (
    <Card labelledBy="cal-h" className="flex flex-col gap-4 px-7 py-6">
      <CardTitle
        id="cal-h" title="Is the model honest about its range?"
        sub="For each past quarter: the model's P10–P90 range and what actually happened. About 80% should land inside."
      />
      <div className="grid grid-cols-[repeat(auto-fit,minmax(300px,1fr))] gap-8">
        {data.map((s) => <CalibrationBlock key={s.segment} segment={s.segment} rows={s.rows} />)}
      </div>
    </Card>
  )
}

function CalibrationBlock({ segment, rows }: { segment: Segment; rows: CalibrationRow[] }) {
  const lo = Math.min(...rows.flatMap((r) => [r.model.p10, r.actual])) * 0.96
  const hi = Math.max(...rows.flatMap((r) => [r.model.p90, r.actual])) * 1.03
  const pos = (v: number) => `${(((v - lo) / (hi - lo)) * 100).toFixed(2)}%`
  const inside = rows.filter((r) => r.insideP10P90).length
  return (
    <div className="flex flex-col">
      <div className="flex items-baseline justify-between pb-1.5">
        <h3 className="m-0 font-semibold">{SEGMENT_LABEL[segment]}</h3>
        <span className="text-sm text-muted">{inside} of {rows.length} inside</span>
      </div>
      {rows.map((r) => (
        <div key={r.quarterLabel} className="grid grid-cols-[62px_1fr_84px] items-center gap-3 border-t border-[#F0F2F5] py-2.5">
          <span className="text-sm text-muted">{r.quarterLabel}</span>
          <div className="relative h-5" role="img" aria-label={`${r.quarterLabel}: model ${money(r.model.p10)} to ${money(r.model.p90)}, actual ${money(r.actual)}`}>
            <div className="absolute top-1 h-3 rounded-md bg-[#E4E8EE]" style={{ left: pos(r.model.p10), width: `${(((r.model.p90 - r.model.p10) / (hi - lo)) * 100).toFixed(2)}%` }} />
            <div className="absolute top-1 h-3 rounded-sm bg-[#C9D1DB]" style={{ left: pos(r.model.p25), width: `${(((r.model.p75 - r.model.p25) / (hi - lo)) * 100).toFixed(2)}%` }} />
            <div className={`absolute top-[3px] -ml-[7px] size-3.5 rounded-full border-2 border-white ${r.insideP10P90 ? 'bg-accent' : 'bg-warn'}`} style={{ left: pos(r.actual) }} />
          </div>
          <span className="flex flex-col items-end leading-tight">
            <span className="num text-sm font-semibold">{money(r.actual)}</span>
            <span className={`text-xs ${r.insideP10P90 ? 'text-good' : 'text-warn'}`}>{r.insideP10P90 ? 'inside range' : 'outside range'}</span>
          </span>
        </div>
      ))}
    </div>
  )
}
