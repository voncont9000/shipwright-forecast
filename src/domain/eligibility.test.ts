import { describe, expect, it } from 'vitest'
import type { Deal } from './types'
import { checkEligibility } from './eligibility'

const ctx = { asOf: '2026-11-11', quarterStart: '2026-10-01', quarterEnd: '2026-12-31' }

const base: Deal = {
  id: 'd1', accountId: 'a1', accountName: 'Northwind', name: 'Teams rollout', ownerId: 'r1', segment: 'MM', type: 'New',
  amount: 40_000, stage: 'Negotiation', category: 'Commit', closeDate: '2026-12-12', createdDate: '2026-09-01',
  economicBuyerIdentified: true, mutualClosePlan: true, lastActivityDate: '2026-11-10', closeDatePushes: 0, qualityScore: 70,
}

const failed = (d: Deal) => checkEligibility(d, ctx).failedRules.map((r) => r.id)

describe('commit eligibility', () => {
  it('passes a clean late-stage deal', () => {
    const r = checkEligibility(base, ctx)
    expect(r.eligible).toBe(true)
    expect(r.failedRules).toEqual([])
  })

  it('activity exactly 14 days before the snapshot passes, 15 days fails', () => {
    expect(failed({ ...base, lastActivityDate: '2026-10-28' })).toEqual([]) // 14 days
    expect(failed({ ...base, lastActivityDate: '2026-10-27' })).toEqual(['recent-activity']) // 15 days
  })

  it('one close-date push passes, two fail', () => {
    expect(failed({ ...base, closeDatePushes: 1 })).toEqual([])
    expect(failed({ ...base, closeDatePushes: 2 })).toEqual(['push-limit'])
  })

  it('a close date on the last day of the quarter passes; the next day fails', () => {
    expect(failed({ ...base, closeDate: '2026-12-31' })).toEqual([])
    expect(failed({ ...base, closeDate: '2027-01-01' })).toEqual(['close-in-quarter'])
    expect(failed({ ...base, closeDate: '2026-09-30' })).toEqual(['close-in-quarter'])
  })

  it('Proposal stage fails the late-stage rule; Negotiation and Contracting pass', () => {
    expect(failed({ ...base, stage: 'Proposal' })).toEqual(['late-stage'])
    expect(failed({ ...base, stage: 'Contracting' })).toEqual([])
  })

  it('reports every failed rule with a human label', () => {
    const r = checkEligibility(
      { ...base, stage: 'Solution', economicBuyerIdentified: false, mutualClosePlan: false, closeDatePushes: 3, lastActivityDate: '2026-09-01' },
      ctx,
    )
    expect(r.eligible).toBe(false)
    expect(r.failedRules.map((x) => x.id).sort()).toEqual(
      ['close-plan', 'economic-buyer', 'late-stage', 'push-limit', 'recent-activity'],
    )
    expect(r.failedRules.every((x) => x.label.length > 5)).toBe(true)
  })
})
