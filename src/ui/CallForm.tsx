import { useEffect, useState } from 'react'
import type { Call, CallTriple, ModelRange, PersonRole } from '../domain/types'
import { api } from './api'
import { ds } from './dataset'
import { money, signedMoney } from './format'
import { useViewInput } from './hooks'
import { Card, CardTitle, CheckIcon, MoneyField } from './kit'
import { useStore } from './store'

const FIELDS: { key: keyof CallTriple; label: string }[] = [
  { key: 'commit', label: 'Commit' },
  { key: 'mostLikely', label: 'Most likely' },
  { key: 'bestCase', label: 'Best case' },
]

const deltaColor = (d: number) => (d < 0 ? '#A14A0B' : d > 0 ? '#0B6B4A' : '#5D6B7E')

/**
 * The weekly call form shared by Rep, Manager, Director and CRO.
 * Pre-filled from `baseline` (the rep's deals, or the sum of the person's reports). A reason is required as
 * soon as anything differs from the baseline; the API decides and its message is shown as-is.
 */
export function CallForm({
  personId, role, title, subtitle, targetLabel, baseline, baselineWord, model, unit, onDraft, afterNote, ownCall,
}: {
  personId: string
  role: PersonRole
  title: string
  subtitle: string
  /** Who receives the call, e.g. "Director". */
  targetLabel: string
  baseline: CallTriple
  /** Short word shown next to each field, e.g. "reps" or "your deals". */
  baselineWord: string
  model: ModelRange
  unit: 'k' | 'M'
  onDraft?: (draft: CallTriple) => void
  afterNote?: string
  ownCall: Call | null
}) {
  const input = useViewInput()
  const submitCall = useStore((s) => s.submitCall)
  const [draft, setDraft] = useState<CallTriple>(
    ownCall ? { commit: ownCall.commit, mostLikely: ownCall.mostLikely, bestCase: ownCall.bestCase } : baseline,
  )
  const [reason, setReason] = useState(ownCall?.reason ?? '')
  const [editing, setEditing] = useState(!ownCall)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { onDraft?.(draft) }, [draft, onDraft])

  const changed = FIELDS.some((f) => draft[f.key] !== baseline[f.key])
  const vsModel = draft.commit - model.p50
  const inside = draft.commit >= model.p10 && draft.commit <= model.p90

  function submit() {
    const res = api.prepareCall(ds, input, personId, { ...draft, reason })
    if (!res.ok) { setError(res.error); return }
    setError(null)
    submitCall(res.call)
    setEditing(false)
  }

  if (ownCall && !editing) {
    return (
      <Card as="aside" className="flex flex-col gap-5 p-6" labelledBy={`call-${role}-h`}>
        <div className="flex flex-col gap-1">
          <h2 id={`call-${role}-h`} className="m-0 flex items-center gap-2 text-[17px] font-semibold">
            <CheckIcon /> Submitted to {targetLabel}
          </h2>
          <span className="text-sm text-muted">
            {ownCall.source === 'user' ? 'Your call is saved for this week.' : 'This call was already in for this week.'} {afterNote}
          </span>
        </div>
        <dl className="m-0 flex flex-col">
          {FIELDS.map((f) => {
            const d = ownCall[f.key] - baseline[f.key]
            return (
              <div key={f.key} className="flex items-baseline justify-between border-t border-[#F0F2F5] py-3">
                <dt className="font-semibold">{f.label}</dt>
                <dd className="m-0 flex items-baseline gap-3">
                  <span className="num text-[17px] font-semibold">{money(ownCall[f.key])}</span>
                  <span className="num min-w-[64px] text-right text-sm font-semibold" style={{ color: deltaColor(d) }}>
                    {signedMoney(d)}
                  </span>
                </dd>
              </div>
            )
          })}
        </dl>
        {ownCall.reason && (
          <div className="rounded-[9px] bg-page px-3.5 py-3 text-sm">
            <span className="text-muted">Why you changed it</span>
            <p className="m-0 mt-1">{ownCall.reason}</p>
          </div>
        )}
        <button
          type="button" onClick={() => setEditing(true)}
          className="min-h-[44px] cursor-pointer rounded-[9px] border border-line bg-white font-semibold text-ink hover:bg-page"
        >
          Change my call
        </button>
      </Card>
    )
  }

  return (
    <Card as="aside" className="flex flex-col gap-[18px] p-6" labelledBy={`call-${role}-h`}>
      <CardTitle id={`call-${role}-h`} title={title} sub={subtitle} />

      {FIELDS.map((f) => {
        const d = draft[f.key] - baseline[f.key]
        return (
          <div key={f.key} className="flex flex-col gap-1.5">
            <label htmlFor={`call-${role}-${f.key}`} className="flex items-baseline justify-between gap-2">
              <span className="font-semibold">{f.label}</span>
              <span className="text-[13px] text-muted">{baselineWord} {money(baseline[f.key])}</span>
            </label>
            <div className="flex items-center gap-2.5">
              <MoneyField
                id={`call-${role}-${f.key}`} unit={unit} value={draft[f.key]}
                onChange={(v) => { setDraft((p) => ({ ...p, [f.key]: v })); setError(null) }}
              />
              <span className="num min-w-16 text-right text-sm font-semibold" style={{ color: deltaColor(d) }}>
                {signedMoney(d)}
              </span>
            </div>
          </div>
        )
      })}

      <div className="flex flex-col gap-1.5">
        <label htmlFor={`call-${role}-reason`} className="flex items-baseline justify-between gap-2 font-semibold">
          Why you changed it
          <span className="text-[13px] font-normal text-muted">{changed ? 'required' : 'optional'}</span>
        </label>
        <textarea
          id={`call-${role}-reason`} rows={3} value={reason} onChange={(e) => { setReason(e.target.value); setError(null) }}
          placeholder={changed ? 'e.g. Holding back Northwind: no economic buyer, pushed twice.' : 'No change from the sum, so no reason needed.'}
          className="resize-y rounded-[9px] border border-[#C9D1DB] bg-white px-3 py-2.5 text-sm text-ink"
        />
      </div>

      <div className="flex justify-between gap-3 rounded-[9px] bg-page px-3.5 py-3 text-sm">
        <span className="text-muted">Your commit vs model</span>
        <span className="num whitespace-nowrap text-[13px] font-semibold">
          {signedMoney(vsModel, 'on the model')}, {inside ? 'inside range' : 'outside range'}
        </span>
      </div>

      {error && <p role="alert" className="m-0 text-sm text-warn">{error}</p>}

      <button
        type="button" onClick={submit}
        className="min-h-12 cursor-pointer rounded-[9px] border-0 bg-ink font-semibold text-white hover:bg-[#1D2939]"
      >
        {ownCall ? 'Resubmit' : 'Submit'} to {targetLabel}
      </button>
      {ownCall && (
        <button type="button" onClick={() => { setEditing(false); setError(null); setDraft({ commit: ownCall.commit, mostLikely: ownCall.mostLikely, bestCase: ownCall.bestCase }); setReason(ownCall.reason ?? '') }} className="cursor-pointer border-0 bg-transparent text-sm text-muted underline">
          Keep what I submitted
        </button>
      )}
    </Card>
  )
}
