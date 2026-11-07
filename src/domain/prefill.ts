import type { CallTriple, Dataset, Deal, ForecastCategory, Quarter, WeekSnapshot } from './types'
import { personById, smbReps, snapshotAt } from './org'

/**
 * How a rep's call is pre-filled from their deals (and, for SMB reps, their territory's
 * self-serve run-rate). Every other module that needs "what the deals say" goes through here.
 *
 *   Commit      = closed + deals marked Commit
 *   Most Likely = Commit + 50% of Best Case deals
 *   Best Case   = Commit + all Best Case + 25% of Pipeline closing in the quarter
 * minus churn: realised churn plus probability-weighted expected churn on the rep's accounts.
 */
export interface Composition {
  newArr: number
  expansionArr: number
  churnArr: number
}

export interface ComposedCall {
  commit: Composition
  mostLikely: Composition
  bestCase: Composition
}

export const WEIGHTS: Record<'commit' | 'mostLikely' | 'bestCase', Partial<Record<ForecastCategory, number>>> = {
  commit: { Commit: 1 },
  mostLikely: { Commit: 1, 'Best Case': 0.45, Pipeline: 0.03 },
  bestCase: { Commit: 1, 'Best Case': 1, Pipeline: 0.12 },
}
/** Multiplier on expected (unrealised) churn: pessimistic for Commit, optimistic for Best Case. */
export const CHURN_FACTOR = { commit: 1.25, mostLikely: 1, bestCase: 0.7 }
/** Multiplier on the self-serve run-rate still to come. */
export const SELF_SERVE_FACTOR = { commit: 0.9, mostLikely: 1, bestCase: 1.1 }

export const emptyComposition = (): Composition => ({ newArr: 0, expansionArr: 0, churnArr: 0 })
export const netOf = (c: Composition): number => c.newArr + c.expansionArr - c.churnArr

export function toTriple(c: ComposedCall): CallTriple {
  return { commit: Math.round(netOf(c.commit)), mostLikely: Math.round(netOf(c.mostLikely)), bestCase: Math.round(netOf(c.bestCase)) }
}

export function dealInQuarter(d: Deal, q: Quarter): boolean {
  return d.closeDate >= q.start && d.closeDate <= q.end
}

/** Weekly self-serve ARR run-rate (trailing 3 weeks) as of a week. */
export function selfServeRunRate(q: Quarter, week: number): number {
  const cur = snapshotAt(q, week).smbFunnel.selfServeArr
  if (week <= 3) return cur / Math.max(1, week)
  return (cur - q.snapshots[week - 4].smbFunnel.selfServeArr) / 3
}

export function selfServeShare(ds: Dataset, personId: string): number {
  const p = personById(ds, personId)
  if (p.role !== 'rep' || p.segment !== 'SMB') return 0
  return 1 / smbReps(ds).length
}

export interface RepBook {
  closedNew: number
  closedExp: number
  realisedChurn: number
  expectedChurn: number
  byCategory: Record<ForecastCategory, { newArr: number; expArr: number }>
  selfServeClosed: number
  selfServeRemaining: number
}

const CATS: ForecastCategory[] = ['Pipeline', 'Best Case', 'Commit', 'Closed Won', 'Omitted']

export function repBook(ds: Dataset, q: Quarter, snap: WeekSnapshot, personId: string, dealIndex?: Map<string, Deal[]>): RepBook {
  const byCategory = {} as RepBook['byCategory']
  for (const c of CATS) byCategory[c] = { newArr: 0, expArr: 0 }
  let closedNew = 0
  let closedExp = 0
  const deals = dealIndex ? (dealIndex.get(personId) ?? []) : snap.deals.filter((d) => d.ownerId === personId)
  for (const d of deals) {
    if (d.stage === 'Closed Won') {
      if (d.type === 'New') closedNew += d.amount
      else closedExp += d.amount
    } else if (d.stage !== 'Closed Lost' && dealInQuarter(d, q)) {
      const b = byCategory[d.category]
      if (d.type === 'New') b.newArr += d.amount
      else b.expArr += d.amount
    }
  }
  let realisedChurn = 0
  let expectedChurn = 0
  for (const c of snap.churn) {
    if (c.ownerId !== personId) continue
    if (c.realised) realisedChurn += c.arrAtRisk
    else expectedChurn += c.arrAtRisk * c.probability
  }
  const share = selfServeShare(ds, personId)
  const week = snap.week
  const remainingWeeks = 13 - week
  return {
    closedNew,
    closedExp,
    realisedChurn,
    expectedChurn,
    byCategory,
    selfServeClosed: share * snap.smbFunnel.selfServeArr,
    selfServeRemaining: share * selfServeRunRate(q, week) * remainingWeeks,
  }
}

export function indexDealsByOwner(snap: WeekSnapshot): Map<string, Deal[]> {
  const m = new Map<string, Deal[]>()
  for (const d of snap.deals) {
    const l = m.get(d.ownerId)
    if (l) l.push(d)
    else m.set(d.ownerId, [d])
  }
  return m
}

export function composeFromBook(b: RepBook): ComposedCall {
  const out = {} as ComposedCall
  for (const key of ['commit', 'mostLikely', 'bestCase'] as const) {
    const w = WEIGHTS[key]
    let n = b.closedNew + b.selfServeClosed + SELF_SERVE_FACTOR[key] * b.selfServeRemaining
    let e = b.closedExp
    for (const cat of CATS) {
      const wt = w[cat] ?? 0
      if (!wt) continue
      n += wt * b.byCategory[cat].newArr
      e += wt * b.byCategory[cat].expArr
    }
    out[key] = { newArr: n, expansionArr: e, churnArr: b.realisedChurn + CHURN_FACTOR[key] * b.expectedChurn }
  }
  return out
}

export function composeRep(ds: Dataset, quarterIndex: number, week: number, personId: string): ComposedCall {
  const q = ds.quarters[quarterIndex]
  return composeFromBook(repBook(ds, q, snapshotAt(q, week), personId))
}

/** The rep's call pre-filled from their deals. */
export function repPrefill(ds: Dataset, quarterIndex: number, week: number, personId: string): CallTriple {
  return toTriple(composeRep(ds, quarterIndex, week, personId))
}

/** Net ARR already closed (won deals + territory self-serve - realised churn) for a set of reps. */
export function closedNetForReps(ds: Dataset, quarterIndex: number, week: number, repIds: readonly string[]): number {
  const q = ds.quarters[quarterIndex]
  const snap = snapshotAt(q, week)
  const idx = indexDealsByOwner(snap)
  let total = 0
  for (const id of repIds) {
    const b = repBook(ds, q, snap, id, idx)
    total += b.closedNew + b.closedExp + b.selfServeClosed - b.realisedChurn
  }
  return total
}
