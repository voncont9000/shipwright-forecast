import type { Rng } from './rng'
import type { Call, CallTriple, Dataset, Person, Quarter } from '../domain/types'
import { allReps, childrenOf, repIdsUnder } from '../domain/org'
import { indexDealsByOwner, repBook, composeFromBook, toTriple } from '../domain/prefill'
import { snapshotAt } from '../domain/org'
import { modelForReps } from '../domain/model'

/** Subset of RepProfile the seeder needs (avoids a circular import with generator.ts). */
interface Profile { landing: number; firstQuarter: number }

/** How far each level pulls the reports' sum toward its own "honest" view, and how often it overrides. */
const LEVEL: Record<'manager' | 'director' | 'cro', { phi: number; p: number }> = {
  manager: { phi: 0.45, p: 0.8 },
  director: { phi: 0.55, p: 0.8 },
  cro: { phi: 0.75, p: 0.9 },
}
/** Honest view of the open part of the quarter: commit / most likely / best case as a share of what will close. */
const HONEST = { commit: 0.83, mostLikely: 1, bestCase: 1.17 }
/** In the current quarter (no actuals yet) managers, directors and the CRO call about at the model's expectation. */
const MODEL_LEAN = 1.0

const DOWN = [
  'Haircut for slip risk on late-stage deals',
  'Trimmed: this group has landed below its commit in past quarters',
  'Removed deals that fail the commit rules',
  'Pulling back Commit deals with stalled legal review',
]
const UP = [
  'Adding an expected pull-in from next quarter',
  'Upside from usage-driven expansions not yet in pipeline',
  'Contracting-stage deals are on track to close early',
]
const REP_REASONS = [
  'Customer legal review is running slower than expected',
  'Buyer confirmed budget, expecting signature this month',
  'Procurement asked for a revised order form',
]

const round1k = (x: number) => Math.round(x / 1000) * 1000

function ordered(t: CallTriple): CallTriple {
  const commit = Math.max(0, t.commit)
  const mostLikely = Math.max(commit, t.mostLikely)
  return { commit, mostLikely, bestCase: Math.max(mostLikely, t.bestCase) }
}

function sumTriples(list: CallTriple[]): CallTriple {
  return list.reduce((a, b) => ({ commit: a.commit + b.commit, mostLikely: a.mostLikely + b.mostLikely, bestCase: a.bestCase + b.bestCase }), { commit: 0, mostLikely: 0, bestCase: 0 })
}

export function seedCalls(ds: Dataset, rng: Rng, profiles: Map<string, Profile>): void {
  ds.quarters.forEach((q, qi) => {
    q.calls = seedQuarter(ds, q, qi, rng.fork(`q${qi}`), profiles)
  })
}

function seedQuarter(ds: Dataset, q: Quarter, qi: number, rng: Rng, profiles: Map<string, Profile>): Call[] {
  const people = ds.org.people
  const reps = allReps(ds).filter((r) => (profiles.get(r.id)?.firstQuarter ?? 0) <= qi)
  const active = new Set(reps.map((r) => r.id))
  const calls: Call[] = []
  const byKey = new Map<string, CallTriple>()
  const key = (w: number, id: string) => `${w}|${id}`

  const push = (p: Person, w: number, t: CallTriple, reason?: string) => {
    const tt = ordered(t)
    byKey.set(key(w, p.id), tt)
    calls.push({ personId: p.id, quarterId: q.id, week: w, ...tt, ...(reason ? { reason } : {}), source: 'seed' })
  }

  // Closed ARR per rep per week (net), used by both closed and current logic.
  const closed = new Map<string, number>()
  for (let w = 1; w <= q.weeksElapsed; w++) {
    const snap = snapshotAt(q, w)
    const idx = indexDealsByOwner(snap)
    for (const r of reps) {
      const b = repBook(ds, q, snap, r.id, idx)
      closed.set(key(w, r.id), b.closedNew + b.closedExp + b.selfServeClosed - b.realisedChurn)
    }
  }
  const closedFor = (w: number, ids: string[]) => ids.reduce((a, id) => a + (closed.get(key(w, id)) ?? 0), 0)

  // 1. Reps
  const landing = new Map<string, number>()
  for (const r of reps) landing.set(r.id, (profiles.get(r.id)?.landing ?? 1) * Math.exp(rng.normal(0, 0.03)))
  const hFactor = new Map<string, number>()
  if (!q.isCurrent) {
    for (const r of reps) {
      const A = q.actuals!.byPerson[r.id] ?? 0
      const c6 = closed.get(key(6, r.id)) ?? 0
      const open6 = A - c6
      let h = 1 / (landing.get(r.id) ?? 1)
      if (Math.abs(open6) > 0.05 * Math.abs(A) && open6 > 0) h = (A / (landing.get(r.id) ?? 1) - c6) / open6
      hFactor.set(r.id, Math.min(3, Math.max(0.4, h)))
    }
  }
  for (let w = 1; w <= q.weeksElapsed; w++) {
    for (const r of reps) {
      if (q.isCurrent) {
        const snap = snapshotAt(q, w)
        let t = toTriple(composeFromBook(repBook(ds, q, snap, r.id)))
        if (w < q.weeksElapsed) {
          // Earlier weeks: the call drifts gently toward this week's number (about 1.5% a week),
          // rather than jumping each time deals change category.
          const latest = toTriple(composeFromBook(repBook(ds, q, snapshotAt(q, q.weeksElapsed), r.id)))
          const c = closedFor(w, [r.id])
          const s = Math.pow(0.985, q.weeksElapsed - w) * (1 + rng.normal(0, 0.008))
          const f = (v: number) => Math.round(c + Math.max(0, v - c) * s)
          push(r, w, { commit: f(latest.commit), mostLikely: f(latest.mostLikely), bestCase: f(latest.bestCase) }, 'Based on the deals I expect to progress this quarter')
          continue
        }
        if (rng.chance(0.12)) {
          const f = 1 + rng.normal(-0.02, 0.04)
          const c = closedFor(w, [r.id])
          const adj = { commit: t.commit, mostLikely: Math.round(c + (t.mostLikely - c) * f), bestCase: Math.round(c + (t.bestCase - c) * f) }
          push(r, w, adj, rng.pick(REP_REASONS))
        } else push(r, w, t)
      } else {
        const A = q.actuals!.byPerson[r.id] ?? 0
        const c = closed.get(key(w, r.id)) ?? 0
        const open = A - c
        const h6 = hFactor.get(r.id) ?? 1
        const hw = w <= 6 ? h6 : 1 + (h6 - 1) * ((13 - w) / 7)
        const openCall = open * hw * (1 + rng.normal(0, 0.03))
        const taper = Math.min(1, Math.max(0, (13 - w) / 7))
        const commit = c + openCall
        const ml = commit + 0.15 * Math.max(0, openCall) * taper
        const bc = ml + 0.35 * Math.max(0, openCall) * taper
        push(r, w, { commit: Math.round(commit), mostLikely: Math.round(ml), bestCase: Math.round(bc) })
      }
    }
  }

  // 2. Managers, directors, CRO (bottom-up so each level's reports are already seeded)
  const levels: Person['role'][] = ['manager', 'director', 'cro']
  for (const role of levels) {
    for (const p of people.filter((x) => x.role === role)) {
      const kids = childrenOf(ds, p.id).filter((k) => byKey.has(key(1, k.id)))
      const ids = repIdsUnder(ds, p.id).filter((id) => active.has(id))
      const cfg = LEVEL[role as 'manager' | 'director' | 'cro']
      for (let w = 1; w <= q.weeksElapsed; w++) {
        const S = sumTriples(kids.map((k) => byKey.get(key(w, k.id))!))
        const c = closedFor(w, ids)
        let T: CallTriple
        if (q.isCurrent) {
          // Managers and above lean on the model: its week-6 expectation, eased in over earlier weeks.
          const target6 = modelForReps(ds, qi, q.weeksElapsed, ids).p50 * MODEL_LEAN
          const t = c + (target6 - c) * Math.pow(0.985, q.weeksElapsed - w)
          T = {
            commit: c + (t - c) * HONEST.commit,
            mostLikely: t,
            bestCase: c + (t - c) * HONEST.bestCase,
          }
        } else {
          const A = ids.reduce((a, id) => a + (q.actuals!.byPerson[id] ?? 0), 0)
          const open = A - c
          const n = 1 + rng.normal(0, 0.02)
          T = { commit: c + open * HONEST.commit * n, mostLikely: c + open * n, bestCase: c + open * HONEST.bestCase * n }
        }
        if (!rng.chance(cfg.p)) {
          push(p, w, S)
          continue
        }
        const noise = rng.normal(0, 0.01)
        const call: CallTriple = ordered({
          commit: round1k(S.commit + cfg.phi * (T.commit - S.commit) + noise * S.commit),
          mostLikely: round1k(S.mostLikely + cfg.phi * (T.mostLikely - S.mostLikely) + noise * S.mostLikely),
          bestCase: round1k(S.bestCase + cfg.phi * (T.bestCase - S.bestCase) + noise * S.bestCase),
        })
        const diff = call.mostLikely - S.mostLikely
        if (Math.abs(diff) <= 1 && Math.abs(call.commit - S.commit) <= 1) push(p, w, call)
        else push(p, w, call, rng.pick(diff < 0 ? DOWN : UP))
      }
    }
  }

  // Calls are emitted rep-first; sort by week then org order for readability.
  calls.sort((a, b) => a.week - b.week)
  if (q.isCurrent) forcePriyaWeek6(ds, q, calls)
  return calls
}

/** Matches the approved Manager prototype: Priya's own week-6 call is 800 / 940 / 1,200 (thousands). */
function forcePriyaWeek6(ds: Dataset, q: Quarter, calls: Call[]): void {
  const idx = calls.findIndex((c) => c.personId === 'priya-raman' && c.week === ds.currentWeek)
  if (idx < 0) return
  const old = calls[idx]
  calls[idx] = {
    ...old, commit: 800_000, mostLikely: 940_000, bestCase: 1_200_000,
    reason: 'Holding back the Commit deals that fail the commit rules (no economic buyer, repeated pushes)',
  }
  void q
}
