import { useMemo, useState } from 'react'
import type { CallTriple, ChainStep, SegmentRow, WowChange, WowKind } from '../domain/types'
import { SEGMENT_LABEL } from '../domain/types'
import { api } from '../ui/api'
import { CallForm } from '../ui/CallForm'
import { ds } from '../ui/dataset'
import { money, moneyPrecise, signedMoney, times } from '../ui/format'
import { useViewInput } from '../ui/hooks'
import { Card, CardTitle, DeadlinePill, PageHeader } from '../ui/kit'
import { MiniRange, ModelRangeChart, domainOf } from '../ui/ModelRangeChart'
import { PathToPlanBar } from '../ui/PathToPlanBar'

export function CroView() {
  const input = useViewInput()
  return <CroBody key={input.week} />
}

function CroBody() {
  const input = useViewInput()
  const v = useMemo(() => api.croView(ds, input), [input])
  const [draft, setDraft] = useState<CallTriple>(v.ownCall ?? v.reportsSum)
  const closed = v.segments.reduce((s, r) => s + r.closed, 0)

  return (
    <main className="mx-auto flex max-w-[1280px] flex-col gap-6 px-8 pb-16 pt-8">
      <PageHeader
        title="Company forecast" sub={`${v.person.name} · ${v.person.title}`}
        right={<DeadlinePill>Your call is due {v.deadline}</DeadlinePill>}
      />

      <Card labelledBy="cro-path-h" className="flex flex-col gap-[22px] px-7 py-6">
        <div className="flex flex-wrap items-baseline gap-x-3.5 gap-y-1">
          <h2 id="cro-path-h" className="m-0 text-[40px] tabular-nums font-semibold tracking-[-0.02em]">{money(v.reportsSum.commit)}</h2>
          <span className="text-base text-muted">
            committed by your directors, toward a <span className="font-semibold text-ink">{money(v.plan)}</span> plan
          </span>
        </div>
        <PathToPlanBar
          plan={v.plan} closed={closed} committedOpen={Math.max(0, v.reportsSum.commit - closed)}
          gap={Math.max(0, v.plan - v.reportsSum.commit)} callValue={draft.commit}
        />
      </Card>

      <ModelRangeChart
        title="Where the model thinks the quarter lands" range={v.model} plan={v.plan}
        marks={[{ label: "Directors' commit", value: v.reportsSum.commit }, ...(draft.commit !== v.reportsSum.commit ? [{ label: 'Your call', value: draft.commit }] : [])]}
      />

      <div className="flex flex-wrap items-start gap-6">
        <div className="flex min-w-0 flex-[999_1_620px] flex-col gap-6">
          <Segments rows={v.segments} />
          <Chain steps={v.chain} />
          <Wow from={v.wow.from} to={v.wow.to} changes={v.wow.changes} />
        </div>
        <div className="min-w-0 flex-[1_1_320px]">
          <CallForm
            personId={v.person.id} role="cro" title="Your call to the Board"
            subtitle="Your directors' numbers stay on record next to yours."
            targetLabel="Board" baseline={v.reportsSum} baselineWord="directors" model={v.model} unit="M"
            ownCall={v.ownCall} onDraft={setDraft} afterNote="The Board screen now shows it."
          />
        </div>
      </div>
    </main>
  )
}

// ───────────────────────── segments ─────────────────────────

function Segments({ rows }: { rows: SegmentRow[] }) {
  return (
    <Card labelledBy="seg-h" className="flex flex-col gap-2 px-7 pb-3 pt-[22px]">
      <CardTitle
        id="seg-h" title="Plan, call and model by segment"
        sub="Band is the model's likely range, the grey tick its median, the dot the Director's most likely call, the black tick plan."
      />
      <div className="overflow-x-auto">
        <div className="min-w-[640px]">
          <div className="grid grid-cols-[minmax(130px,1fr)_72px_minmax(180px,2fr)_84px] gap-5 pb-1.5 pt-2 text-xs font-medium uppercase tracking-wide text-muted">
            <span>Segment</span><span className="text-right">Plan</span><span>Call vs model range</span><span className="text-right">Closed</span>
          </div>
          {rows.map((r) => <SegmentLine key={r.segment} row={r} />)}
        </div>
      </div>
    </Card>
  )
}

function SegmentLine({ row }: { row: SegmentRow }) {
  const domain = domainOf([row.model.p10, row.model.p90, row.call.mostLikely, row.plan], 0.08)
  const behind = row.call.mostLikely < row.plan
  return (
    <div className="grid grid-cols-[minmax(130px,1fr)_72px_minmax(180px,2fr)_84px] items-center gap-5 border-t border-[#F0F2F5] py-4">
      <div className="flex flex-col leading-snug">
        <span className="font-semibold">{SEGMENT_LABEL[row.segment]}</span>
        <span className="text-[13px] text-muted">{row.directorName}</span>
      </div>
      <span className="num text-right text-sm text-muted">{money(row.plan)}</span>
      <div className="flex flex-col gap-1">
        <div className="flex items-baseline gap-2">
          <span className="num font-semibold">{money(row.call.mostLikely)}</span>
          <span className={`text-[13px] ${behind ? 'text-warn' : 'text-good'}`}>
            {signedMoney(row.call.mostLikely - row.plan, 'on plan')}{row.call.mostLikely !== row.plan ? ' vs plan' : ''}
          </span>
        </div>
        <MiniRange
          range={row.model} value={row.call.mostLikely} domain={domain} plan={row.plan} tone="accent"
          ariaLabel={`${SEGMENT_LABEL[row.segment]}: model ${money(row.model.p10)} to ${money(row.model.p90)}, call ${money(row.call.mostLikely)}, plan ${money(row.plan)}`}
        />
        <div className="num flex justify-between text-[11px] text-muted">
          <span>{money(row.model.p10)}</span><span>{money(row.model.p90)}</span>
        </div>
      </div>
      <div className="flex flex-col items-end leading-snug">
        <span className="num font-semibold">{money(row.closed)}</span>
        <span className="text-[13px] text-muted">{times(row.coverage.ratio)} cover</span>
      </div>
    </div>
  )
}

// ───────────────────────── chain of calls ─────────────────────────

function Chain({ steps }: { steps: ChainStep[] }) {
  return (
    <Card labelledBy="chain-h" className="flex flex-col gap-2 px-7 pb-3 pt-[22px]">
      <CardTitle
        id="chain-h" title="How the call was built"
        sub="Each level keeps the one below on record. The change at each step, and the reason, stays visible."
      />
      <ol className="m-0 list-none p-0">
        {steps.map((s, i) => (
          <li key={s.level} className="grid grid-cols-[110px_minmax(150px,190px)_1fr] items-start gap-5 border-t border-[#F0F2F5] py-4 first:mt-2">
            <div className="flex items-center gap-2 pt-1">
              <span className="inline-flex size-6 flex-none items-center justify-center rounded-full bg-[#EEF1F5] text-xs font-semibold text-[#344054]">{i + 1}</span>
              <span className="font-semibold">{s.level}</span>
            </div>
            <div className="flex flex-col leading-snug">
              <span className="flex items-baseline gap-2">
                <span className="num text-xl font-semibold">{moneyPrecise(s.value.mostLikely)}</span>
                {i > 0 && (
                  <span className="num text-sm font-semibold" style={{ color: s.delta < 0 ? '#A14A0B' : s.delta > 0 ? '#0B6B4A' : '#5D6B7E' }}>
                    {signedMoney(s.delta, 'no change')}
                  </span>
                )}
              </span>
              <span className="num text-xs text-muted">Commit {money(s.value.commit)} · Best {money(s.value.bestCase)}</span>
            </div>
            <div className="flex flex-col gap-1.5 pt-0.5 text-sm">
              {s.reasons.length === 0 && (
                <span className="text-muted">{i === 0 ? "Sum of every rep's own call." : 'Accepted the level below, no reason needed.'}</span>
              )}
              {s.reasons.map((r) => (
                <p key={r.personName} className="m-0"><span className="font-medium">{r.personName}:</span> <span className="text-muted">{r.text}</span></p>
              ))}
            </div>
          </li>
        ))}
      </ol>
    </Card>
  )
}

// ───────────────────────── week-over-week waterfall ─────────────────────────

const KIND_LABEL: Record<WowKind, string> = {
  new: 'New pipeline',
  'pulled-in': 'Pulled into the quarter',
  pushed: 'Pushed out',
  lost: 'Lost',
  won: 'Won',
  'amount-change': 'Amounts and call changes',
  'category-change': 'Category changes',
}

function Wow({ from, to, changes }: { from: number; to: number; changes: WowChange[] }) {
  const rows = useMemo(() => {
    let run = from
    const mid = changes.filter((c) => Math.abs(c.amount) >= 1000 || c.kind === "new").map((c) => {
      const start = run
      run += c.amount
      return { key: c.kind as string, label: KIND_LABEL[c.kind], a: start, b: run, value: signedMoney(c.amount, '$0'), count: c.dealCount, kind: 'delta' as const }
    })
    // Deal changes don't explain the whole move: managers' overrides and churn also change the call.
    // Show the remainder so the rows always add up to this week's number.
    const rest = to - run
    if (changes.length && Math.abs(rest) >= 1000) {
      mid.push({ key: 'rest', label: 'Overrides and churn', a: run, b: to, value: signedMoney(rest, '$0'), count: 0, kind: 'delta' as const })
    }
    return [
      { key: 'from', label: 'Last week', a: null as number | null, b: from, value: moneyPrecise(from), count: 0, kind: 'total' as const },
      ...mid,
      { key: 'to', label: 'This week', a: null as number | null, b: to, value: moneyPrecise(to), count: 0, kind: 'total' as const },
    ]
  }, [from, to, changes])

  const points = rows.flatMap((r) => (r.a == null ? [r.b] : [r.a, r.b]))
  const min = Math.min(...points)
  const max = Math.max(...points)
  const span = Math.max(max - min, 50_000)
  const lo = min - span * 0.8
  const hi = max + span * 0.15
  const pos = (v: number) => ((v - lo) / (hi - lo)) * 100
  const delta = to - from

  return (
    <Card labelledBy="wow-h" className="flex flex-col gap-2 px-7 pb-5 pt-[22px]">
      <CardTitle
        id="wow-h" title="What moved this week"
        sub={changes.length ? `Most likely went from ${moneyPrecise(from)} to ${moneyPrecise(to)} (${signedMoney(delta, 'unchanged')})` : 'No earlier week to compare with yet'}
      />
      {changes.length > 0 && (
        <>
          <div className="mt-2 flex flex-col">
            {rows.map((r) => {
              const total = r.kind === 'total'
              const a = r.a ?? lo
              const left = pos(Math.min(a, r.b))
              const width = Math.abs(pos(r.b) - pos(a))
              const up = r.b >= a
              return (
                <div key={r.key} className="grid grid-cols-[170px_1fr_120px] items-center gap-4 border-t border-[#F0F2F5] py-2">
                  <span className={`text-sm ${total ? 'font-semibold' : ''}`}>{r.label}</span>
                  <div className="relative h-5">
                    <div
                      className={`absolute inset-y-0.5 rounded ${total ? (r.key === 'to' ? 'bg-accent' : 'bg-accent/45') : up ? 'bg-accent/40' : 'bg-churn'}`}
                      style={{ left: `${left}%`, width: `${Math.max(width, 0.6)}%` }}
                    />
                  </div>
                  <span className="flex items-baseline justify-end gap-2 text-right">
                    <span className={`num text-sm font-semibold ${!total && !up ? 'text-warn' : ''}`}>{r.value}</span>
                    {!total && r.count > 0 && <span className="text-xs text-muted">{r.count} deals</span>}
                  </span>
                </div>
              )
            })}
          </div>
          <span className="text-xs text-muted">Scale starts at {moneyPrecise(Math.max(0, lo))}, so small moves are visible.</span>
        </>
      )}
    </Card>
  )
}
