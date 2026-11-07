import type { Call, CallTriple, ChainStep, Dataset, Person } from './types'
import { childrenOf, personById } from './org'

/**
 * Roll-up of weekly calls: Reps -> Managers -> Directors -> CRO.
 *
 * Every person's call is stored separately, so an override never erases the level below it.
 * For a person without a user call this week, the effective call is
 *   (sum of their reports' effective calls) + (the adjustment they seeded on top of the reports' sum),
 * so changing a manager's call moves the director's and CRO's totals while their own judgement calls
 * (and the reasons for them) stay visible. A call the visitor submitted replaces that person's call outright.
 */

export interface PersonRoll {
  personId: string
  /** The call in force this week (user call, else seeded call carried through the roll-up). */
  effective: Call
  /** Sum of direct reports' effective calls; null for reps. */
  reportsSum: CallTriple | null
  /** effective - reportsSum (what this person changed); zero for reps. */
  adjustment: CallTriple
  source: 'user' | 'seed' | 'propagated'
}

const ZERO: CallTriple = { commit: 0, mostLikely: 0, bestCase: 0 }

export function sumCalls(list: readonly CallTriple[]): CallTriple {
  const out = { ...ZERO }
  for (const c of list) {
    out.commit += c.commit
    out.mostLikely += c.mostLikely
    out.bestCase += c.bestCase
  }
  return out
}

const sub = (a: CallTriple, b: CallTriple): CallTriple => ({
  commit: a.commit - b.commit, mostLikely: a.mostLikely - b.mostLikely, bestCase: a.bestCase - b.bestCase,
})
const add = (a: CallTriple, b: CallTriple): CallTriple => ({
  commit: a.commit + b.commit, mostLikely: a.mostLikely + b.mostLikely, bestCase: a.bestCase + b.bestCase,
})
const triple = (c: CallTriple): CallTriple => ({ commit: c.commit, mostLikely: c.mostLikely, bestCase: c.bestCase })

/** commit <= mostLikely <= bestCase. */
export function ordered(t: CallTriple): CallTriple {
  const commit = Math.max(0, t.commit)
  const mostLikely = Math.max(commit, t.mostLikely)
  return { commit, mostLikely, bestCase: Math.max(mostLikely, t.bestCase) }
}

const seedIndex = new WeakMap<Dataset, Map<string, Call>>()

function seedFor(ds: Dataset, quarterId: string, week: number, personId: string): Call | undefined {
  let idx = seedIndex.get(ds)
  if (!idx) {
    idx = new Map()
    for (const q of ds.quarters) for (const c of q.calls) idx.set(`${q.id}|${c.week}|${c.personId}`, c)
    seedIndex.set(ds, idx)
  }
  return idx.get(`${quarterId}|${week}|${personId}`)
}

export function seedCallFor(ds: Dataset, quarterIndex: number, week: number, personId: string): Call | undefined {
  return seedFor(ds, ds.quarters[quarterIndex].id, week, personId)
}

/** Latest user call per person for a quarter + week. */
function userIndex(ds: Dataset, quarterIndex: number, week: number, userCalls: readonly Call[]): Map<string, Call> {
  const id = ds.quarters[quarterIndex].id
  const m = new Map<string, Call>()
  for (const c of userCalls) if (c.quarterId === id && c.week === week) m.set(c.personId, c)
  return m
}

export function rollupWeek(ds: Dataset, quarterIndex: number, week: number, userCalls: readonly Call[] = []): Map<string, PersonRoll> {
  const q = ds.quarters[quarterIndex]
  const users = userIndex(ds, quarterIndex, week, userCalls)
  const out = new Map<string, PersonRoll>()

  const visit = (p: Person): PersonRoll | null => {
    const cached = out.get(p.id)
    if (cached) return cached
    const user = users.get(p.id)
    const seed = seedFor(ds, q.id, week, p.id)
    if (p.role === 'rep') {
      const eff = user ?? seed
      if (!eff) return null
      const r: PersonRoll = { personId: p.id, effective: eff, reportsSum: null, adjustment: { ...ZERO }, source: user ? 'user' : 'seed' }
      out.set(p.id, r)
      return r
    }
    const kids = childrenOf(ds, p.id).map(visit).filter((x): x is PersonRoll => x !== null)
    if (kids.length === 0 && !user && !seed) return null
    const S = sumCalls(kids.map((k) => k.effective))
    let effective: Call
    let source: PersonRoll['source']
    if (user) {
      effective = user
      source = 'user'
    } else if (seed) {
      const seedS = sumCalls(childrenOf(ds, p.id).map((c) => seedFor(ds, q.id, week, c.id)).filter((c): c is Call => !!c))
      const adj = sub(triple(seed), seedS)
      const unchanged = S.commit === seedS.commit && S.mostLikely === seedS.mostLikely && S.bestCase === seedS.bestCase
      const t = unchanged ? triple(seed) : ordered(add(S, adj))
      effective = { ...seed, ...t }
      source = unchanged ? 'seed' : 'propagated'
    } else {
      effective = { personId: p.id, quarterId: q.id, week, ...S, source: 'seed' }
      source = 'propagated'
    }
    const r: PersonRoll = { personId: p.id, effective, reportsSum: S, adjustment: sub(triple(effective), S), source }
    out.set(p.id, r)
    return r
  }
  for (const p of ds.org.people) visit(p)
  return out
}

export function effectiveCall(ds: Dataset, quarterIndex: number, week: number, personId: string, userCalls: readonly Call[] = []): Call | null {
  return rollupWeek(ds, quarterIndex, week, userCalls).get(personId)?.effective ?? null
}

export function reportsSumOf(ds: Dataset, quarterIndex: number, week: number, personId: string, userCalls: readonly Call[] = []): CallTriple {
  return rollupWeek(ds, quarterIndex, week, userCalls).get(personId)?.reportsSum ?? { ...ZERO }
}

const LEVELS: { level: ChainStep['level']; role: Person['role'] }[] = [
  { level: 'Reps', role: 'rep' },
  { level: 'Managers', role: 'manager' },
  { level: 'Directors', role: 'director' },
  { level: 'CRO', role: 'cro' },
]

/** Reps' sum -> managers' calls -> directors' calls -> CRO's call, with the change and reasons at each step. */
export function buildChain(ds: Dataset, quarterIndex: number, week: number, userCalls: readonly Call[] = []): ChainStep[] {
  const roll = rollupWeek(ds, quarterIndex, week, userCalls)
  const steps: ChainStep[] = []
  let prevMl = 0
  for (const { level, role } of LEVELS) {
    const people = ds.org.people.filter((p) => p.role === role)
    const rolls = people.map((p) => roll.get(p.id)).filter((r): r is PersonRoll => !!r)
    const value = sumCalls(rolls.map((r) => r.effective))
    const reasons: ChainStep['reasons'] = []
    if (role !== 'rep') {
      for (const r of rolls) {
        const text = r.effective.reason
        const changed = Math.abs(r.adjustment.mostLikely) > 1 || Math.abs(r.adjustment.commit) > 1
        if (text && changed) reasons.push({ personName: personById(ds, r.personId).name, text })
      }
    }
    steps.push({ level, value, delta: steps.length === 0 ? 0 : value.mostLikely - prevMl, reasons })
    prevMl = value.mostLikely
  }
  return steps
}
