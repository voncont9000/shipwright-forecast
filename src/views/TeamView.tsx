import { useMemo, useState } from 'react'
import type { CallTriple, DealRow, TeamRow } from '../domain/types'
import { api } from '../ui/api'
import { CallForm } from '../ui/CallForm'
import { ds } from '../ui/dataset'
import { money, shortDate, signedMoney } from '../ui/format'
import { useSelectedPerson, useViewInput, personName } from '../ui/hooks'
import { Avatar, Card, CardTitle, DeadlinePill, PageHeader, WarnIcon } from '../ui/kit'
import { PathToPlanBar } from '../ui/PathToPlanBar'
import { useStore } from '../ui/store'

/** Manager and Director screen (prototype: Main.dc.html). */
export function TeamView({ role }: { role: 'manager' | 'director' }) {
  const person = useSelectedPerson(role)
  const input = useViewInput()
  return <TeamBody key={`${person.id}-${input.week}`} role={role} personId={person.id} />
}

function TeamBody({ role, personId }: { role: 'manager' | 'director'; personId: string }) {
  const input = useViewInput()
  const viewAs = useStore((s) => s.viewAs)
  const v = useMemo(() => api.teamView(ds, input, personId), [input, personId])
  const [draft, setDraft] = useState<CallTriple>(v.ownCall ?? v.reportsSum)

  const noun = role === 'manager' ? 'reps' : 'managers'
  const target = role === 'manager' ? 'Director' : 'CRO'
  const callValue = draft.commit
  const risk = v.atRiskCommits
  const riskTotal = risk.reduce((s, r) => s + r.deal.amount, 0)
  const drillRole = role === 'manager' ? 'rep' : 'manager'

  const scale = useMemo(() => {
    const top = Math.max(1, ...v.rows.flatMap((r) => [r.call.commit, r.model, r.likelyToLand ?? 0]))
    const step = top > 2_000_000 ? 250_000 : 25_000
    return Math.ceil((top * 1.1) / step) * step
  }, [v.rows])
  const anyLanding = v.rows.some((r) => r.likelyToLand != null)

  return (
    <main className="mx-auto flex max-w-[1280px] flex-col gap-6 px-8 pb-16 pt-8">
      <PageHeader
        title={v.person.title || v.person.name}
        sub={`${v.person.name} · ${v.reportsLabel}`}
        right={<DeadlinePill>Your call is due {v.deadline}</DeadlinePill>}
      />

      <Card labelledBy="path-h" className="flex flex-col gap-[22px] px-7 py-6">
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
          <div className="flex flex-wrap items-baseline gap-x-3.5 gap-y-1">
            <h2 id="path-h" className="num m-0 text-[40px] font-semibold tracking-[-0.02em]">{money(v.reportsSum.commit)}</h2>
            <span className="text-base text-muted">
              committed by your {noun}, toward a <span className="font-semibold text-ink">{money(v.pathToPlan.plan)}</span> plan
            </span>
          </div>
          <span className="text-sm text-muted">
            <span className="font-semibold text-ink">{signedMoney(v.pathToPlan.changeSinceLastWeek, 'No change')}</span>
            {v.pathToPlan.changeSinceLastWeek !== 0 && ' since last week'}
          </span>
        </div>
        <PathToPlanBar
          plan={v.pathToPlan.plan} closed={v.pathToPlan.closed} committedOpen={v.pathToPlan.committedOpen}
          gap={v.pathToPlan.gap} model={v.model} callValue={callValue}
        />
      </Card>

      <div className="flex flex-wrap items-start gap-6">
        <div className="flex min-w-0 flex-[999_1_620px] flex-col gap-6">
          <Card labelledBy="reps-h" className="flex flex-col gap-2 px-7 pb-3 pt-[22px]">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1.5">
              <h2 id="reps-h" className="m-0 text-[17px] font-semibold">{role === 'manager' ? 'Rep calls' : 'Manager calls'}</h2>
              <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-[13px] text-muted">
                <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-accent" />Commit</span>
                {anyLanding && (
                  <span className="inline-flex items-center gap-1.5">
                    <span className="box-border size-2.5 rounded-full border-2 border-ink" />Likely to land, given their record
                  </span>
                )}
                <span className="inline-flex items-center gap-1.5"><span className="h-3 w-[3px] bg-[#8A96A8]" />Model</span>
              </div>
            </div>
            <div className="overflow-x-auto">
              <div className="min-w-[600px]">
                {v.rows.map((r) => (
                  <RepRow key={r.person.id} row={r} scale={scale} onOpen={() => viewAs(drillRole, r.person.id)} />
                ))}
              </div>
            </div>
          </Card>

          <Card labelledBy="risk-h" className="flex flex-col gap-2 px-7 pb-3 pt-[22px]">
            <CardTitle
              id="risk-h" title="Check these commits before you call"
              sub={risk.length
                ? `${risk.length} deal${risk.length > 1 ? 's' : ''} worth ${money(riskTotal)} ${risk.length > 1 ? 'are' : 'is'} marked Commit but break${risk.length > 1 ? '' : 's'} a commit rule`
                : 'Every deal marked Commit passes the six commit rules'}
            />
            {risk.map((r) => <RiskRow key={r.deal.id} row={r} onOpen={() => viewAs('rep', r.deal.ownerId)} />)}
          </Card>
        </div>

        <div className="min-w-0 flex-[1_1_320px]">
          <CallForm
            personId={personId} role={role}
            title={`Your call to the ${target}`}
            subtitle={`Your ${noun}' numbers stay on record next to yours.`}
            targetLabel={target} baseline={v.reportsSum} baselineWord={noun} model={v.model}
            unit={v.reportsSum.mostLikely >= 2_000_000 ? 'M' : 'k'} ownCall={v.ownCall} onDraft={setDraft}
            afterNote={`${target === 'CRO' ? 'The CRO' : 'The Director'} sees it next to your ${noun}' sum.`}
          />
        </div>
      </div>
    </main>
  )
}

function RepRow({ row, scale, onOpen }: { row: TeamRow; scale: number; onOpen: () => void }) {
  const warn = row.warning
  const note = warn ?? row.biasNote ?? 'On track'
  const pos = (v: number) => `${Math.min(100, (v / scale) * 100).toFixed(1)}%`
  const pts = [row.call.commit, row.model, ...(row.likelyToLand != null ? [row.likelyToLand] : [])]
  const lo = Math.min(...pts)
  const hi = Math.max(...pts)
  const aria = `Commit ${money(row.call.commit)}, model ${money(row.model)}${row.likelyToLand != null ? `, likely to land ${money(row.likelyToLand)}` : ''}`
  return (
    <div className="grid grid-cols-[minmax(150px,1.1fr)_80px_minmax(200px,2fr)_minmax(170px,1.3fr)] items-center gap-5 border-t border-[#F0F2F5] py-3.5">
      <div className="flex items-center gap-2.5">
        <Avatar name={row.person.name} />
        <div className="flex min-w-0 flex-col leading-tight">
          <button type="button" onClick={onOpen} className="cursor-pointer border-0 bg-transparent p-0 text-left font-medium text-ink hover:underline">
            {row.person.name}
          </button>
          {!row.submitted && <span className="text-xs text-muted">Call not in yet</span>}
        </div>
      </div>
      <div className="num text-right font-semibold">{money(row.call.commit)}</div>
      <div className="relative h-6" role="img" aria-label={aria}>
        <div className="absolute inset-x-0 top-[11px] h-0.5 bg-[#EEF1F5]" />
        <div className="absolute top-[11px] h-0.5 bg-[#C9D1DB]" style={{ left: pos(lo), width: `${(((hi - lo) / scale) * 100).toFixed(1)}%` }} />
        <div className="absolute top-1 -ml-[1.5px] h-4 w-[3px] rounded-[1px] bg-[#8A96A8]" style={{ left: pos(row.model) }} />
        {row.likelyToLand != null && (
          <div className="absolute top-[5px] -ml-[7px] box-border size-3.5 rounded-full border-2 border-ink bg-white" style={{ left: pos(row.likelyToLand) }} />
        )}
        <div className="absolute top-1.5 -ml-1.5 size-3 rounded-full bg-accent" style={{ left: pos(row.call.commit) }} />
      </div>
      <div className={`flex items-center gap-1.5 text-sm ${warn ? 'text-warn' : 'text-muted'}`}>
        {warn && <WarnIcon />}
        {note}
      </div>
    </div>
  )
}

function RiskRow({ row, onOpen }: { row: DealRow; onOpen: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 border-t border-[#F0F2F5] py-3.5">
      <div className="flex flex-[1_1_220px] flex-col">
        <span className="font-medium">{row.deal.accountName}</span>
        <span className="text-[13px] text-muted">{personName(row.deal.ownerId)} · closes {shortDate(row.deal.closeDate)}</span>
      </div>
      <span className="flex-[1_1_220px] text-sm text-warn">{row.eligibility.failedRules.map((f) => f.label).join(' · ')}</span>
      <span className="num min-w-14 text-right font-semibold">{money(row.deal.amount)}</span>
      <button
        type="button" onClick={onOpen}
        className="cursor-pointer rounded-lg border border-line bg-white px-3 py-2 text-sm font-medium text-ink hover:bg-page"
      >
        Open deal
      </button>
    </div>
  )
}
