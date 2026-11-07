import { describe, expect, it } from 'vitest'
import { generateDataset } from '../data/generator'
import type { Call } from './types'
import { buildChain, rollupWeek, sumCalls } from './rollup'
import { childrenOf } from './org'

const ds = generateDataset(42)
const QI = 4
const WEEK = 6

describe('roll-up', () => {
  const roll = rollupWeek(ds, QI, WEEK, [])

  it('each level\'s reports\' sum is the sum of the direct reports\' effective calls', () => {
    for (const p of ds.org.people.filter((x) => x.role !== 'rep')) {
      const kids = childrenOf(ds, p.id).map((k) => roll.get(k.id)!.effective)
      const r = roll.get(p.id)!
      expect(r.reportsSum).toEqual(sumCalls(kids))
    }
  })

  it('totals agree across levels once each level\'s own adjustment is added', () => {
    const cro = roll.get(ds.org.croId)!
    const directors = ds.org.people.filter((p) => p.role === 'director').map((d) => roll.get(d.id)!)
    expect(cro.reportsSum!.mostLikely).toBe(directors.reduce((a, d) => a + d.effective.mostLikely, 0))
    expect(cro.effective.mostLikely).toBe(cro.reportsSum!.mostLikely + cro.adjustment.mostLikely)
    const reps = ds.org.people.filter((p) => p.role === 'rep').map((r) => roll.get(r.id)!.effective.mostLikely)
    const chain = buildChain(ds, QI, WEEK, [])
    expect(chain.map((c) => c.level)).toEqual(['Reps', 'Managers', 'Directors', 'CRO'])
    expect(chain[0].value.mostLikely).toBe(reps.reduce((a, b) => a + b, 0))
    expect(chain[3].value.mostLikely).toBe(cro.effective.mostLikely)
    // delta at each step is the change in most-likely vs the level below
    expect(chain[1].delta).toBe(chain[1].value.mostLikely - chain[0].value.mostLikely)
    expect(chain[2].delta).toBe(chain[2].value.mostLikely - chain[1].value.mostLikely)
    expect(chain[3].delta).toBe(chain[3].value.mostLikely - chain[2].value.mostLikely)
  })

  it('a user override at manager level keeps the reps\' calls and moves the director and CRO sums', () => {
    const priya = ds.org.people.find((p) => p.name === 'Priya Raman')!
    const director = ds.org.people.find((p) => p.id === priya.managerId)!
    const before = roll.get(priya.id)!.effective
    const user: Call = {
      personId: priya.id, quarterId: ds.quarters[QI].id, week: WEEK,
      commit: before.commit - 100_000, mostLikely: before.mostLikely - 150_000, bestCase: before.bestCase - 200_000,
      reason: 'Two Commit deals are stuck in legal', source: 'user',
    }
    const after = rollupWeek(ds, QI, WEEK, [user])

    // reps untouched
    for (const rep of childrenOf(ds, priya.id)) {
      expect(after.get(rep.id)!.effective).toEqual(roll.get(rep.id)!.effective)
    }
    // the manager's own call is the user's, with the reps' sum still visible beside it
    expect(after.get(priya.id)!.source).toBe('user')
    expect(after.get(priya.id)!.reportsSum).toEqual(roll.get(priya.id)!.reportsSum)
    // the director sees a lower sum of managers, and keeps their own adjustment on top
    expect(after.get(director.id)!.reportsSum!.mostLikely).toBe(roll.get(director.id)!.reportsSum!.mostLikely - 150_000)
    expect(after.get(director.id)!.adjustment).toEqual(roll.get(director.id)!.adjustment)
    expect(after.get(director.id)!.effective.mostLikely).toBe(roll.get(director.id)!.effective.mostLikely - 150_000)
    // and it reaches the CRO
    expect(after.get(ds.org.croId)!.effective.mostLikely).toBe(roll.get(ds.org.croId)!.effective.mostLikely - 150_000)

    // the chain shows the delta and the reason
    const chain = buildChain(ds, QI, WEEK, [user])
    const managers = chain.find((c) => c.level === 'Managers')!
    expect(managers.reasons).toContainEqual({ personName: 'Priya Raman', text: 'Two Commit deals are stuck in legal' })
    const baseChain = buildChain(ds, QI, WEEK, [])
    expect(managers.delta).toBe(baseChain[1].delta - 150_000)
    expect(chain[0].value).toEqual(baseChain[0].value)
  })

  it('a user call for a different week does not leak into this week', () => {
    const rep = ds.org.people.find((p) => p.role === 'rep')!
    const other: Call = { personId: rep.id, quarterId: ds.quarters[QI].id, week: 3, commit: 1, mostLikely: 2, bestCase: 3, source: 'user' }
    expect(rollupWeek(ds, QI, WEEK, [other]).get(rep.id)!.effective).toEqual(roll.get(rep.id)!.effective)
  })
})
