import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Call, PersonRole, Role } from '../domain/types'
import { MAX_WEEK } from './dataset'

export type Page = 'main' | 'accuracy' | 'methodology'

interface AppState {
  role: Role
  /** Accuracy and Methodology sit beside the role views. Picking a role goes back to 'main'. */
  page: Page
  /** Who the visitor is viewing as, per role. Undefined = the default person for that role. */
  selected: Partial<Record<PersonRole, string>>
  week: number
  /** Calls the visitor submitted. One per person per week; submitting again replaces it. */
  userCalls: Call[]
  setRole: (role: Role) => void
  setPage: (page: Page) => void
  setPerson: (role: PersonRole, id: string) => void
  /** Jump to a specific person's view, e.g. from "Open deal". */
  viewAs: (role: PersonRole, id: string) => void
  setWeek: (week: number) => void
  submitCall: (call: Call) => void
  reset: () => void
}

const initial = { role: 'manager' as Role, page: 'main' as Page, selected: {}, week: MAX_WEEK, userCalls: [] as Call[] }

export const useStore = create<AppState>()(
  persist(
    (set) => ({
      ...initial,
      setRole: (role) => set({ role, page: 'main' }),
      setPage: (page) => set({ page }),
      setPerson: (role, id) => set((s) => ({ selected: { ...s.selected, [role]: id } })),
      viewAs: (role, id) => set((s) => ({ role, page: 'main', selected: { ...s.selected, [role]: id } })),
      setWeek: (week) => set({ week: Math.min(MAX_WEEK, Math.max(1, week)) }),
      submitCall: (call) =>
        set((s) => ({
          userCalls: [...s.userCalls.filter((c) => !(c.personId === call.personId && c.week === call.week)), call],
        })),
      reset: () => set({ ...initial, userCalls: [], selected: {} }),
    }),
    {
      name: 'shipwright-forecast-v1',
      partialize: (s) => ({ role: s.role, page: s.page, selected: s.selected, week: s.week, userCalls: s.userCalls }),
    },
  ),
)
