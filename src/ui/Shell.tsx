import type { ReactNode } from 'react'
import type { PersonRole, Role } from '../domain/types'
import { ds, MAX_WEEK } from './dataset'
import { peopleWithRole, useSelectedPerson } from './hooks'
import { Segmented } from './kit'
import { useStore } from './store'

const ROLES: { value: Role; label: string }[] = [
  { value: 'rep', label: 'Rep' },
  { value: 'manager', label: 'Manager' },
  { value: 'director', label: 'Director' },
  { value: 'cro', label: 'CRO' },
  { value: 'board', label: 'Board' },
]
const QUARTER_LABEL = ds.quarters[ds.quarters.length - 1].label
const TOTAL_WEEKS = 13

export function Shell({ children }: { children: ReactNode }) {
  const role = useStore((s) => s.role)
  const page = useStore((s) => s.page)
  const setRole = useStore((s) => s.setRole)
  const setPage = useStore((s) => s.setPage)
  const reset = useStore((s) => s.reset)

  return (
    <div className="min-h-screen bg-page text-[15px] leading-normal text-ink">
      <header className="border-b border-line bg-card">
        <div className="mx-auto flex max-w-[1280px] flex-wrap items-center gap-x-7 gap-y-3 px-8 pb-2 pt-3">
          <div className="flex items-center gap-2.5 font-semibold">
            <span className="inline-flex size-7 items-center justify-center rounded-[7px] bg-ink">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M4 18h16" /><path d="M6 14l4-5 4 3 5-7" />
              </svg>
            </span>
            Shipwright Forecast
          </div>
          <nav aria-label="View as" className="flex items-center gap-2 text-sm">
            <span className="text-muted">View as</span>
            <Segmented
              label="View as" value={page === 'main' ? role : ('' as Role)} options={ROLES} onChange={setRole}
            />
          </nav>
          <nav aria-label="More" className="flex items-center gap-5 text-sm">
            <PageLink active={page === 'accuracy'} onClick={() => setPage('accuracy')}>Accuracy</PageLink>
            <PageLink active={page === 'methodology'} onClick={() => setPage('methodology')}>Methodology</PageLink>
          </nav>
          <button
            type="button" onClick={reset}
            className="ml-auto cursor-pointer rounded-lg border border-line bg-white px-3 py-1.5 text-sm font-medium text-muted hover:text-ink"
          >
            Reset demo
          </button>
        </div>
        <div className="mx-auto flex max-w-[1280px] flex-wrap items-center justify-between gap-x-7 gap-y-2 px-8 pb-3">
          <div className="flex min-h-9 items-center">{page === 'main' && role !== 'board' && role !== 'cro' && <PersonPicker role={role} />}</div>
          <WeekSlider />
        </div>
      </header>
      {children}
    </div>
  )
}

function PageLink({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button" onClick={onClick} aria-current={active ? 'page' : undefined}
      className={`cursor-pointer border-0 bg-transparent p-0 ${active ? 'font-semibold text-ink underline decoration-2 underline-offset-[6px]' : 'text-muted hover:text-ink'}`}
    >
      {children}
    </button>
  )
}

function PersonPicker({ role }: { role: PersonRole }) {
  const current = useSelectedPerson(role)
  const setPerson = useStore((s) => s.setPerson)
  const list = peopleWithRole(role)
  return (
    <label className="flex items-center gap-2 text-sm text-muted">
      Viewing as
      <select
        value={current.id} onChange={(e) => setPerson(role, e.target.value)}
        className="cursor-pointer rounded-lg border border-line bg-white py-1.5 pl-2.5 pr-2 font-medium text-ink"
      >
        {list.map((p) => (
          <option key={p.id} value={p.id}>{p.name}{p.title && role !== 'rep' ? ` · ${p.title}` : ''}</option>
        ))}
      </select>
    </label>
  )
}

/** The 13-week tracker from the prototype. Weeks up to the latest are clickable; later weeks are greyed out. */
function WeekSlider() {
  const week = useStore((s) => s.week)
  const setWeek = useStore((s) => s.setWeek)
  const current = Math.min(week, MAX_WEEK)
  const looking = current < MAX_WEEK
  return (
    <div className="flex items-center gap-3">
      {looking && (
        <button
          type="button" onClick={() => setWeek(MAX_WEEK)}
          className="cursor-pointer border-0 bg-transparent p-0 text-sm text-accent underline"
        >
          Back to week {MAX_WEEK}
        </button>
      )}
      <span className="text-sm text-muted">{QUARTER_LABEL}</span>
      <div className="flex" role="group" aria-label={`Week ${current} of ${TOTAL_WEEKS}`}>
        {Array.from({ length: TOTAL_WEEKS }, (_, i) => {
          const w = i + 1
          const enabled = w <= MAX_WEEK
          const color = w <= current ? '#101828' : enabled ? '#9AA5B5' : '#D5DBE3'
          return (
            <button
              key={w} type="button" disabled={!enabled} onClick={() => setWeek(w)}
              aria-label={`Week ${w}`} aria-current={w === current ? 'step' : undefined} title={enabled ? `Go to week ${w}` : `Week ${w} has not happened yet`}
              className={`group flex h-7 w-[9px] items-center justify-center border-0 bg-transparent p-0 ${enabled ? 'cursor-pointer' : 'cursor-not-allowed'}`}
            >
              <span
                className={`block h-4 w-1.5 rounded-sm transition-transform ${w === current ? 'scale-y-125' : ''} ${enabled ? 'group-hover:scale-y-125' : ''}`}
                style={{ background: color }}
              />
            </button>
          )
        })}
      </div>
      <span className="min-w-[60px] text-sm font-semibold">Week {current}</span>
    </div>
  )
}
