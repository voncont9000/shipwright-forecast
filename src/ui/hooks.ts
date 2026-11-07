import { useMemo } from 'react'
import type { Person, PersonRole, ViewInput } from '../domain/types'
import { MAX_WEEK, PEOPLE } from './dataset'
import { useStore } from './store'

export function useViewInput(): ViewInput {
  const week = useStore((s) => s.week)
  const userCalls = useStore((s) => s.userCalls)
  return useMemo(() => ({ week: Math.min(MAX_WEEK, Math.max(1, week)), userCalls }), [week, userCalls])
}

export function peopleWithRole(role: PersonRole): Person[] {
  return PEOPLE.filter((p) => p.role === role).sort((a, b) => a.name.localeCompare(b.name))
}

/** The person being viewed for a role. Defaults: Rep = Ana Souza, Manager = Priya Raman, Director = Mid-Market. */
export function resolvePerson(role: PersonRole, selectedId: string | undefined): Person {
  const list = peopleWithRole(role)
  const picked = list.find((p) => p.id === selectedId)
  if (picked) return picked
  const byName = (n: string) => list.find((p) => p.name === n)
  if (role === 'rep') return byName('Ana Souza') ?? list[0]
  if (role === 'manager') return byName('Priya Raman') ?? list[0]
  if (role === 'director') return list.find((p) => p.segment === 'MM') ?? list[0]
  return list[0]
}

export function useSelectedPerson(role: PersonRole): Person {
  const id = useStore((s) => s.selected[role])
  return resolvePerson(role, id)
}

export function personName(id: string): string {
  return PEOPLE.find((p) => p.id === id)?.name ?? id
}
