import type { ArrBridge, Call, Dataset, Deal, WowChange, WowKind } from './types'
import { allReps } from './org'
import { WEIGHTS, composeRep, emptyComposition, netOf } from './prefill'
import { effectiveCall } from './rollup'

/**
 * ARR bridge (start -> new -> expansion -> churn -> end) from the current call's composition,
 * and the week-over-week movement of the most-likely number.
 */

/**
 * The bridge splits the CRO's most-likely call into new logos, expansion and churn using the
 * mix of the reps' deals (and self-serve run-rate), then scales the three parts so that
 * new + expansion - churn equals the CRO's number exactly.
 */
export function arrBridge(ds: Dataset, quarterIndex: number, week: number, userCalls: readonly Call[] = []): ArrBridge {
  const q = ds.quarters[quarterIndex]
  const sum = emptyComposition()
  for (const r of allReps(ds)) {
    const c = composeRep(ds, quarterIndex, week, r.id).mostLikely
    sum.newArr += c.newArr
    sum.expansionArr += c.expansionArr
    sum.churnArr += c.churnArr
  }
  const call = effectiveCall(ds, quarterIndex, week, ds.org.croId, userCalls)
  const net = netOf(sum)
  const f = call && net > 0 ? call.mostLikely / net : 1
  const newArr = Math.round(sum.newArr * f)
  const expansionArr = Math.round(sum.expansionArr * f)
  // churn is the balancing figure so the bridge adds up exactly to the call
  const churnArr = newArr + expansionArr - (call && net > 0 ? call.mostLikely : Math.round(net))
  return { startingArr: q.startingArr, newArr, expansionArr, churnArr, endingArr: q.startingArr + newArr + expansionArr - churnArr }
}

// ── Week-over-week ───────────────────────────────────────────────────────────

/** What a deal contributes to the most-likely number: closed in full, or its category weight if still open and due this quarter. */
export function mostLikelyContribution(d: Deal | undefined, quarterStart: string, quarterEnd: string): number {
  if (!d) return 0
  if (d.stage === 'Closed Won') return d.amount
  if (d.stage === 'Closed Lost') return 0
  if (d.closeDate < quarterStart || d.closeDate > quarterEnd) return 0
  return (WEIGHTS.mostLikely[d.category] ?? 0) * d.amount
}

const weightOf = (d: Deal, qs: string, qe: string) =>
  d.stage === 'Closed Won' ? 1 : d.closeDate < qs || d.closeDate > qe ? 0 : (WEIGHTS.mostLikely[d.category] ?? 0)

/**
 * Compare two weekly snapshots for a set of reps and explain the move in the most-likely number.
 * Each deal change is classified once: won, lost, new, pushed, pulled-in, then category / amount changes.
 */
export function weekOverWeek(ds: Dataset, quarterIndex: number, fromWeek: number, toWeek: number, repIds: readonly string[]): WowChange[] {
  const q = ds.quarters[quarterIndex]
  const ids = new Set(repIds)
  const cur = q.snapshots[toWeek - 1]
  const prev = fromWeek >= 1 ? q.snapshots[fromWeek - 1] : undefined
  const prevMap = new Map<string, Deal>()
  if (prev) for (const d of prev.deals) if (ids.has(d.ownerId)) prevMap.set(d.id, d)
  const curMap = new Map<string, Deal>()
  for (const d of cur.deals) if (ids.has(d.ownerId)) curMap.set(d.id, d)

  const acc = new Map<WowKind, { amount: number; count: number }>()
  const add = (kind: WowKind, amount: number) => {
    const e = acc.get(kind) ?? { amount: 0, count: 0 }
    e.amount += amount
    e.count += 1
    acc.set(kind, e)
  }
  const { start: qs, end: qe } = q

  for (const [id, d] of curMap) {
    const p = prevMap.get(id)
    if (!p) {
      const eff = mostLikelyContribution(d, qs, qe)
      if (d.stage === 'Closed Won') add('won', eff)
      else if (d.stage !== 'Closed Lost' && eff !== 0) add('new', eff)
      continue
    }
    const before = mostLikelyContribution(p, qs, qe)
    const after = mostLikelyContribution(d, qs, qe)
    if (d.stage === 'Closed Won' && p.stage !== 'Closed Won') {
      add('won', after - before)
    } else if (d.stage === 'Closed Lost' && p.stage !== 'Closed Lost') {
      add('lost', after - before)
    } else if (d.closeDatePushes > p.closeDatePushes) {
      add('pushed', after - before)
    } else if (d.closeDate < p.closeDate && after !== before) {
      add('pulled-in', after - before)
    } else {
      const wBefore = weightOf(p, qs, qe)
      const wAfter = weightOf(d, qs, qe)
      if (d.category !== p.category && wBefore !== wAfter) add('category-change', (wAfter - wBefore) * p.amount)
      if (d.amount !== p.amount) add('amount-change', wAfter * (d.amount - p.amount))
    }
  }
  // Deals that vanished (lost deals dropped from the snapshot).
  for (const [id, p] of prevMap) {
    if (curMap.has(id)) continue
    const before = mostLikelyContribution(p, qs, qe)
    if (p.stage !== 'Closed Won' && before !== 0) add('lost', -before)
  }

  const order: WowKind[] = ['new', 'pulled-in', 'pushed', 'lost', 'won', 'amount-change', 'category-change']
  return order.map((kind) => {
    const e = acc.get(kind)
    return { kind, amount: Math.round(e?.amount ?? 0), dealCount: e?.count ?? 0 }
  })
}
