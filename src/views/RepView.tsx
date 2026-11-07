import { useMemo, useState } from 'react'
import type { CallTriple, DealRow, ForecastCategory, Stage } from '../domain/types'
import { SEGMENT_LABEL } from '../domain/types'
import { api } from '../ui/api'
import { CallForm } from '../ui/CallForm'
import { ds } from '../ui/dataset'
import { money, pct, shortDate, times } from '../ui/format'
import { useSelectedPerson, useViewInput } from '../ui/hooks'
import { Card, CardTitle, DeadlinePill, PageHeader, Segmented } from '../ui/kit'
import { PathToPlanBar } from '../ui/PathToPlanBar'

type SortKey = 'amount' | 'close' | 'win' | 'stage'
const SORTS: { value: SortKey; label: string }[] = [
  { value: 'amount', label: 'Amount' },
  { value: 'close', label: 'Close date' },
  { value: 'win', label: 'Win probability' },
  { value: 'stage', label: 'Stage' },
]
const STAGE_ORDER: Stage[] = ['Discovery', 'Qualification', 'Solution', 'Proposal', 'Negotiation', 'Contracting', 'Closed Won', 'Closed Lost']
const GROUPS: { cat: ForecastCategory; hint: string }[] = [
  { cat: 'Commit', hint: 'You are telling your manager these will close this quarter' },
  { cat: 'Best Case', hint: 'Could close this quarter if things go well' },
  { cat: 'Pipeline', hint: 'Open, not yet called' },
  { cat: 'Closed Won', hint: 'Already booked this quarter' },
]
const COLS = 'grid-cols-[minmax(190px,2.4fr)_100px_64px_64px_76px]'

function sorter(key: SortKey): (a: DealRow, b: DealRow) => number {
  switch (key) {
    case 'amount': return (a, b) => b.deal.amount - a.deal.amount
    case 'close': return (a, b) => a.deal.closeDate.localeCompare(b.deal.closeDate)
    case 'win': return (a, b) => b.winProbability - a.winProbability
    case 'stage': return (a, b) => STAGE_ORDER.indexOf(b.deal.stage) - STAGE_ORDER.indexOf(a.deal.stage)
  }
}

export function RepView() {
  const person = useSelectedPerson('rep')
  const input = useViewInput()
  return <RepBody key={`${person.id}-${input.week}`} personId={person.id} />
}

function RepBody({ personId }: { personId: string }) {
  const input = useViewInput()
  const v = useMemo(() => api.repView(ds, input, personId), [input, personId])
  const [sort, setSort] = useState<SortKey>('amount')
  const [draft, setDraft] = useState<CallTriple>(v.submitted ?? v.prefill)

  const grouped = useMemo(() => GROUPS.map((g) => {
    const rows = v.deals.filter((d) => d.deal.category === g.cat).sort(sorter(sort))
    return { ...g, rows, total: rows.reduce((s, r) => s + r.deal.amount, 0) }
  }).filter((g) => g.rows.length > 0), [v.deals, sort])

  const commit = v.prefill.commit
  const atRisk = v.deals.filter((d) => d.commitAtRisk)

  return (
    <main className="mx-auto flex max-w-[1280px] flex-col gap-6 px-8 pb-16 pt-8">
      <PageHeader
        title={v.person.name}
        sub={`${v.person.title}${v.person.segment ? ` · ${SEGMENT_LABEL[v.person.segment]}` : ''}`}
        right={<DeadlinePill>Your call is due {v.deadline}</DeadlinePill>}
      />

      <Card labelledBy="quota-h" className="flex flex-col gap-6 px-7 py-6">
        <div className="flex flex-wrap items-baseline gap-x-3.5 gap-y-1">
          <h2 id="quota-h" className="num m-0 text-[40px] font-semibold tracking-[-0.02em]">{money(v.closed)}</h2>
          <span className="text-base text-muted">
            closed so far, toward a <span className="font-semibold text-ink">{money(v.quota)}</span> quota
            <span className="text-muted"> ({pct(v.closed / v.quota)})</span>
          </span>
        </div>
        <PathToPlanBar
          plan={v.quota} planLabel="Quota" gapLabel="Gap to quota" closed={v.closed} committedOpen={Math.max(0, commit - v.closed)}
          gap={Math.max(0, v.quota - commit)} model={v.model} callValue={draft.commit}
        />
        <dl className="m-0 grid grid-cols-1 gap-4 border-t border-[#F0F2F5] pt-5 sm:grid-cols-3">
          <Stat
            label="Pipeline coverage" value={times(v.coverage.ratio)}
            note={`${v.coverage.ratio >= v.coverage.target ? 'meets' : 'below'} the ${times(v.coverage.target)} target on ${money(v.coverage.remaining)} still to win`}
            warn={v.coverage.ratio < v.coverage.target}
          />
          <Stat
            label="Your track record"
            value={v.bias ? pct(v.bias.commitRatio) : 'Not yet'}
            note={v.bias ? `of your commit has landed, on average over ${v.bias.quartersUsed} quarters` : 'No closed quarters to learn from yet'}
          />
          <Stat label="Model for your book" value={money(v.model.p50)} note={`likely range ${money(v.model.p10)}–${money(v.model.p90)}`} />
        </dl>
      </Card>

      <div className="flex flex-wrap items-start gap-6">
        <Card labelledBy="deals-h" className="flex min-w-0 flex-[999_1_620px] flex-col gap-4 px-7 pb-4 pt-[22px]">
          <CardTitle
            id="deals-h" title="Your deals"
            sub={atRisk.length ? `${atRisk.length} marked Commit but break a commit rule` : 'Everything marked Commit passes the commit rules'}
            right={<Segmented<SortKey> label="Sort deals by" value={sort} options={SORTS} onChange={setSort} />}
          />
          <div className="overflow-x-auto">
            <div className="min-w-[640px]">
              <div className={`grid ${COLS} gap-4 pb-2 text-xs font-medium uppercase tracking-wide text-muted`}>
                <span>Deal</span><span>Stage</span><span className="text-right">Close</span><span className="text-right">Win</span><span className="text-right">Amount</span>
              </div>
              {grouped.map((g) => (
                <div key={g.cat} className="mb-2">
                  <div className="flex items-baseline justify-between gap-3 border-t border-line bg-page/60 px-0 py-2.5">
                    <div className="flex items-baseline gap-3">
                      <h3 className="m-0 text-sm font-semibold">{g.cat}</h3>
                      <span className="text-[13px] text-muted">{g.rows.length} · {g.hint}</span>
                    </div>
                    <span className="num text-sm font-semibold">{money(g.total)}</span>
                  </div>
                  {g.rows.map((r) => <DealLine key={r.deal.id} row={r} />)}
                </div>
              ))}
            </div>
          </div>
        </Card>

        <div className="min-w-0 flex-[1_1_320px]">
          <CallForm
            personId={personId} role="rep" title="Your call to your Manager"
            subtitle="Pre-filled from your deals. Change a number and say why."
            targetLabel="Manager" baseline={v.prefill} baselineWord="your deals" model={v.model}
            unit={v.prefill.mostLikely >= 2_000_000 ? 'M' : 'k'} ownCall={v.submitted} onDraft={setDraft}
            afterNote="Your manager sees it next to the model."
          />
        </div>
      </div>
    </main>
  )
}

function Stat({ label, value, note, warn }: { label: string; value: string; note: string; warn?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-[13px] text-muted">{label}</dt>
      <dd className="m-0 flex flex-col">
        <span className={`num text-xl font-semibold ${warn ? 'text-warn' : ''}`}>{value}</span>
        <span className="text-[13px] text-muted">{note}</span>
      </dd>
    </div>
  )
}

function DealLine({ row }: { row: DealRow }) {
  const d = row.deal
  const won = d.stage === 'Closed Won'
  return (
    <div className={`grid ${COLS} items-center gap-4 border-t border-[#F0F2F5] py-3`}>
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{d.accountName}</span>
          {row.commitAtRisk && (
            <span className="rounded-full bg-warn-soft px-2 py-0.5 text-xs font-semibold text-[#8A3F06]">Commit at risk</span>
          )}
        </span>
        {row.commitAtRisk && (
          <span className="text-[13px] text-warn">{row.eligibility.failedRules.map((f) => f.label).join(' · ')}</span>
        )}
      </div>
      <span className="text-sm text-muted">{d.stage}</span>
      <span className="num text-right text-sm">{shortDate(d.closeDate)}</span>
      <span className="num text-right text-sm text-muted">{won ? '—' : pct(row.winProbability)}</span>
      <span className="num text-right font-semibold">{money(d.amount)}</span>
    </div>
  )
}
