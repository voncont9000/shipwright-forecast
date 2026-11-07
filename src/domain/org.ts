import type { Dataset, Person, Quarter, Segment, WeekSnapshot } from './types'
import type { EligibilityContext } from './eligibility'
import { addDays } from './dates'

/** Small cached lookups over a Dataset. Pure: caches are keyed weakly by the Dataset object. */
interface OrgIndex {
  byId: Map<string, Person>
  children: Map<string, Person[]>
  repsUnder: Map<string, Person[]>
}

const indexCache = new WeakMap<Dataset, OrgIndex>()

function indexOf(ds: Dataset): OrgIndex {
  let idx = indexCache.get(ds)
  if (idx) return idx
  const byId = new Map<string, Person>()
  const children = new Map<string, Person[]>()
  for (const p of ds.org.people) {
    byId.set(p.id, p)
    if (p.managerId) {
      const list = children.get(p.managerId) ?? []
      list.push(p)
      children.set(p.managerId, list)
    }
  }
  for (const list of children.values()) list.sort((a, b) => a.name.localeCompare(b.name))
  const repsUnder = new Map<string, Person[]>()
  const collect = (p: Person): Person[] => {
    const cached = repsUnder.get(p.id)
    if (cached) return cached
    const out: Person[] = p.role === 'rep' ? [p] : (children.get(p.id) ?? []).flatMap(collect)
    repsUnder.set(p.id, out)
    return out
  }
  for (const p of ds.org.people) collect(p)
  idx = { byId, children, repsUnder }
  indexCache.set(ds, idx)
  return idx
}

export function personById(ds: Dataset, id: string): Person {
  const p = indexOf(ds).byId.get(id)
  if (!p) throw new Error(`Unknown person ${id}`)
  return p
}

export function childrenOf(ds: Dataset, id: string): Person[] {
  return indexOf(ds).children.get(id) ?? []
}

/** Reps at or below a person (a rep returns themselves). */
export function repsUnder(ds: Dataset, id: string): Person[] {
  return indexOf(ds).repsUnder.get(id) ?? []
}

export function repIdsUnder(ds: Dataset, id: string): string[] {
  return repsUnder(ds, id).map((p) => p.id)
}

export function allReps(ds: Dataset): Person[] {
  return ds.org.people.filter((p) => p.role === 'rep')
}

export function currentQuarterIndex(ds: Dataset): number {
  return ds.quarters.length - 1
}

export function snapshotAt(q: Quarter, week: number): WeekSnapshot {
  const w = Math.min(Math.max(1, week), q.snapshots.length)
  return q.snapshots[w - 1]
}

export function eligibilityContext(q: Quarter, week: number): EligibilityContext {
  return { asOf: snapshotAt(q, week).asOf, quarterStart: q.start, quarterEnd: q.end }
}

/** Number of weeks of data a quarter has at a given viewing week (closed quarters always have all 13). */
export function clampWeek(q: Quarter, week: number): number {
  return Math.min(Math.max(1, Math.round(week)), q.weeksElapsed)
}

/** A person's quota in a given quarter, scaled from the current quota by that quarter's segment plan. */
export function quotaFor(ds: Dataset, quarterIndex: number, person: Person): number {
  const cur = ds.quarters[currentQuarterIndex(ds)]
  const q = ds.quarters[quarterIndex]
  if (person.role === 'cro') return Object.values(q.plan).reduce((a, b) => a + b, 0)
  const seg = person.segment as Segment
  return person.quota * (q.plan[seg] / cur.plan[seg])
}

export function weekAsOf(q: Quarter, week: number): string {
  return week >= 1 && week <= q.snapshots.length ? q.snapshots[week - 1].asOf : addDays(q.start, 7 * week - 1)
}

/** Number of SMB reps (self-serve ARR is attributed to SMB reps' territories, evenly). */
export function smbReps(ds: Dataset): Person[] {
  return ds.org.people.filter((p) => p.role === 'rep' && p.segment === 'SMB')
}
