import { describe, expect, it } from 'vitest'
import { generateDataset } from '../data/generator'
import { modelForCompany, modelForPerson, modelForSegment } from './model'
import { learnRates } from './dealModel'

describe('model', () => {
  it('is deterministic and ordered', () => {
    const ds = generateDataset(42)
    const a = modelForPerson(ds, 4, 6, 'priya-raman')
    const b = modelForPerson(generateDataset(42), 4, 6, 'priya-raman')
    expect(a).toEqual(b)
    expect(a.p10).toBeLessThan(a.p25)
    expect(a.p25).toBeLessThan(a.p50)
    expect(a.p50).toBeLessThan(a.p75)
    expect(a.p75).toBeLessThan(a.p90)
  })

  it('learns higher win rates for later stages', () => {
    const ds = generateDataset(42)
    const r = learnRates(ds, 6, null)
    expect(r.base('MM', 'Contracting', true)).toBeGreaterThan(r.base('MM', 'Discovery', true))
    expect(r.base('ENT', 'Contracting', true)).toBeGreaterThan(r.base('ENT', 'Qualification', true))
    expect(r.trainingQuarters).toHaveLength(4)
  })

  it('is roughly calibrated: about 80% of actuals fall inside P10-P90 across segments, quarters and seeds', () => {
    let inside = 0
    let total = 0
    for (const seed of [42, 7, 11, 99, 123]) {
      const ds = generateDataset(seed)
      ds.quarters.forEach((q, qi) => {
        if (q.isCurrent) return
        // every back-test learns only from the other closed quarters
        for (const seg of ['SMB', 'MM', 'ENT'] as const) {
          const m = modelForSegment(ds, qi, 6, seg)
          const actual = q.actuals!.bySegment[seg]
          total++
          if (actual >= m.p10 && actual <= m.p90) inside++
        }
      })
    }
    const coverage = inside / total
    expect(total).toBe(60)
    expect(coverage).toBeGreaterThanOrEqual(0.65)
    expect(coverage).toBeLessThanOrEqual(0.95)
  })

  it('company model range is a believable width around the plan', () => {
    const ds = generateDataset(42)
    const m = modelForCompany(ds, 4, 6)
    expect(m.p50).toBeGreaterThan(7_000_000)
    expect(m.p50).toBeLessThan(10_000_000)
    expect((m.p90 - m.p10) / m.p50).toBeGreaterThan(0.1)
    expect((m.p90 - m.p10) / m.p50).toBeLessThan(0.5)
  })
})
