import { describe, expect, it } from 'vitest'
import { generateDataset } from './generator'
import { createRng } from './rng'
import { childrenOf, repsUnder } from '../domain/org'

const ds = generateDataset(42)

describe('rng', () => {
  it('is deterministic per seed and differs across seeds', () => {
    const a = createRng(1)
    const b = createRng(1)
    const c = createRng(2)
    const xs = [a.next(), a.next(), a.next()]
    expect([b.next(), b.next(), b.next()]).toEqual(xs)
    expect(c.next()).not.toEqual(xs[0])
  })
})

describe('generateDataset', () => {
  it('is deterministic for the same seed', () => {
    expect(JSON.stringify(generateDataset(42))).toEqual(JSON.stringify(ds))
  })

  it('differs for another seed', () => {
    expect(JSON.stringify(generateDataset(43))).not.toEqual(JSON.stringify(ds))
  })

  it('builds the org: CRO, 3 directors, 7 managers, 30 reps, Priya with her five reps', () => {
    const count = (role: string) => ds.org.people.filter((p) => p.role === role).length
    expect([count('cro'), count('director'), count('manager'), count('rep')]).toEqual([1, 3, 7, 30])
    const priya = ds.org.people.find((p) => p.name === 'Priya Raman')!
    expect(priya.title).toBe('Mid-Market East')
    expect(childrenOf(ds, priya.id).map((p) => p.name).sort()).toEqual(['Ana Souza', 'Diego Ruiz', 'Grace Kim', 'Marcus Lee', 'Tom Becker'])
    expect(priya.quota).toBe(1_200_000)
  })

  it('rolls quotas up exactly to the board plan', () => {
    for (const p of ds.org.people.filter((x) => x.role !== 'rep')) {
      const sum = childrenOf(ds, p.id).reduce((a, c) => a + c.quota, 0)
      expect(p.quota).toBe(sum)
    }
    expect(ds.org.boardPlan).toBe(9_000_000)
    const segTotal = (s: string) => ds.org.people.filter((p) => p.role === 'rep' && p.segment === s).reduce((a, p) => a + p.quota, 0)
    expect([segTotal('SMB'), segTotal('MM'), segTotal('ENT')]).toEqual([3_600_000, 2_800_000, 2_600_000])
  })

  it('has 4 closed quarters with 13 weekly snapshots plus the current quarter at week 6', () => {
    expect(ds.quarters).toHaveLength(5)
    ds.quarters.slice(0, 4).forEach((q) => {
      expect(q.isCurrent).toBe(false)
      expect(q.snapshots).toHaveLength(13)
      expect(q.actuals).toBeDefined()
    })
    const cur = ds.quarters[4]
    expect(cur.id).toBe('2026-Q4')
    expect(cur.isCurrent).toBe(true)
    expect(cur.snapshots).toHaveLength(6)
    expect(ds.currentWeek).toBe(6)
    expect(cur.start).toBe('2026-10-01')
    expect(cur.end).toBe('2026-12-31')
    expect(cur.startingArr).toBe(120_000_000)
  })

  it('seeds a call for every active person for every elapsed week, ordered commit <= most likely <= best case', () => {
    for (const q of ds.quarters) {
      for (let w = 1; w <= q.weeksElapsed; w++) {
        for (const p of ds.org.people) {
          if (p.name === 'Diego Ruiz' && q.id < '2026-Q3') continue
          const c = q.calls.find((x) => x.personId === p.id && x.week === w)
          expect(c, `${p.name} week ${w} ${q.id}`).toBeDefined()
          expect(c!.commit).toBeLessThanOrEqual(c!.mostLikely)
          expect(c!.mostLikely).toBeLessThanOrEqual(c!.bestCase)
        }
      }
    }
  })

  it('actuals match the final snapshot and roll up the tree', () => {
    for (const q of ds.quarters.slice(0, 4)) {
      const a = q.actuals!
      const final = q.snapshots[12]
      const wonNew = final.deals.filter((d) => d.stage === 'Closed Won' && d.type === 'New').reduce((s, d) => s + d.amount, 0)
      expect(a.newArr).toBe(wonNew + final.smbFunnel.selfServeArr)
      expect(a.netNewArr).toBe(a.newArr + a.expansionArr - a.churnArr)
      expect(a.bySegment.SMB + a.bySegment.MM + a.bySegment.ENT).toBe(a.netNewArr)
      expect(Math.round(a.byPerson[ds.org.croId])).toBe(Math.round(a.netNewArr))
      const reps = repsUnder(ds, ds.org.croId)
      expect(Math.round(reps.reduce((s, r) => s + a.byPerson[r.id], 0))).toBe(Math.round(a.netNewArr))
    }
  })

  it('close-date pushes only grow over time and some Commit deals are ineligible', () => {
    const q = ds.quarters[4]
    const prev = new Map(q.snapshots[4].deals.map((d) => [d.id, d]))
    for (const d of q.snapshots[5].deals) {
      const p = prev.get(d.id)
      if (p) expect(d.closeDatePushes).toBeGreaterThanOrEqual(p.closeDatePushes)
    }
    expect(q.snapshots[5].deals.some((d) => d.closeDatePushes >= 2)).toBe(true)
  })

  it('has expansion candidates (>80% credit use for 2+ months) and falling-usage churn risks', () => {
    const candidates = ds.accounts.filter((a) => a.creditUtilisation.slice(-3).filter((u) => u > 0.8).length >= 2)
    expect(candidates.length).toBeGreaterThan(40)
    const cur = ds.quarters[4].snapshots[5]
    expect(cur.churn.some((c) => c.reason === 'falling-usage' && !c.realised)).toBe(true)
  })
})
