import { describe, expect, it } from 'vitest'
import { generateDataset } from '../data/generator'
import { meanRatio, personBias, accuracyByWeek, dealFlowStats } from './accuracy'
import { weekOverWeek } from './bridge'
import { repIdsUnder } from './org'

const ds = generateDataset(42)

describe('bias', () => {
  it('hand-worked example: calls 100 and 200, actuals 90 and 160', () => {
    // 90/100 = 0.90 and 160/200 = 0.80, so the person lands at (0.90 + 0.80) / 2 = 0.85 of their calls.
    expect(meanRatio([{ call: 100, actual: 90 }, { call: 200, actual: 160 }])).toBeCloseTo(0.85, 10)
  })

  it('skips calls of zero', () => {
    expect(meanRatio([{ call: 0, actual: 50 }, { call: 100, actual: 90 }])).toBeCloseTo(0.9, 10)
  })

  it('shows Ana over-calling (about 82% of commit) and Marcus accurate; new hire has no track record', () => {
    const ana = personBias(ds, 'ana-souza', 6)!
    expect(ana.commitRatio).toBeGreaterThan(0.72)
    expect(ana.commitRatio).toBeLessThan(0.92)
    const marcus = personBias(ds, 'marcus-lee', 6)!
    expect(marcus.commitRatio).toBeGreaterThan(0.93)
    expect(marcus.commitRatio).toBeLessThan(1.1)
    expect(marcus.quartersUsed).toBe(4)
    expect(personBias(ds, 'diego-ruiz', 6)).toBeNull()
  })

  it('every level converges to actual by week 13 and higher levels are more accurate at week 6', () => {
    const byWeek = accuracyByWeek(ds)
    for (const level of byWeek) expect(level.points[12].ratio).toBeCloseTo(1, 1)
    const at6 = (name: string) => byWeek.find((l) => l.level === name)!.points[5].ratio
    expect(Math.abs(1 - at6('CRO'))).toBeLessThan(Math.abs(1 - at6('Reps')))
  })

  it('slip, push and conversion stats are sensible shares', () => {
    const s = dealFlowStats(ds, 6)
    for (const v of [s.slipRate, s.pushRate, s.commitConversion]) {
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(1)
    }
    expect(s.pushRate).toBeGreaterThan(0.05)
  })
})

describe('week-over-week bridge', () => {
  it('classifies deal changes between two snapshots', () => {
    const reps = repIdsUnder(ds, ds.org.croId)
    const changes = weekOverWeek(ds, 4, 5, 6, reps)
    expect(changes.map((c) => c.kind)).toEqual(['new', 'pulled-in', 'pushed', 'lost', 'won', 'amount-change', 'category-change'])
    expect(changes.find((c) => c.kind === 'won')!.dealCount).toBeGreaterThan(0)
    expect(changes.find((c) => c.kind === 'pushed')!.amount).toBeLessThanOrEqual(0)
    expect(changes.find((c) => c.kind === 'lost')!.amount).toBeLessThanOrEqual(0)
  })
})
