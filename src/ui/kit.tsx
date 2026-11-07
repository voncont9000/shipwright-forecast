import { useState } from 'react'
import type { ReactNode } from 'react'
import { initials } from './format'

/** White rounded card used for every section. */
export function Card({
  children, className = '', as: Tag = 'section', labelledBy,
}: { children: ReactNode; className?: string; as?: 'section' | 'aside' | 'div'; labelledBy?: string }) {
  return (
    <Tag aria-labelledby={labelledBy} className={`min-w-0 rounded-[14px] border border-line bg-card ${className}`}>
      {children}
    </Tag>
  )
}

export function CardTitle({ id, title, sub, right }: { id?: string; title: ReactNode; sub?: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
      <div className="flex flex-col gap-0.5">
        <h2 id={id} className="m-0 text-[17px] font-semibold">{title}</h2>
        {sub && <span className="text-sm text-muted">{sub}</span>}
      </div>
      {right}
    </div>
  )
}

export function PageHeader({ title, sub, right }: { title: ReactNode; sub?: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-col gap-0.5">
        <h1 className="m-0 text-[26px] font-semibold tracking-[-0.01em]">{title}</h1>
        {sub && <span className="text-muted">{sub}</span>}
      </div>
      {right}
    </div>
  )
}

export function Avatar({ name }: { name: string }) {
  return (
    <span className="inline-flex size-[30px] flex-none items-center justify-center rounded-full bg-[#EEF1F5] text-xs font-semibold text-[#344054]">
      {initials(name)}
    </span>
  )
}

export function DeadlinePill({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full bg-warn-soft px-3 py-1.5 text-sm font-medium text-[#8A3F06]">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
        <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" />
      </svg>
      {children}
    </span>
  )
}

export function WarnIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="flex-none">
      <path d="M12 3l9.5 17h-19z" /><path d="M12 10v4" /><path d="M12 17.5v.01" />
    </svg>
  )
}

export function CheckIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#0B6B4A" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="flex-none">
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  )
}

export function Dot({ className = '', style }: { className?: string; style?: React.CSSProperties }) {
  return <span className={`inline-block flex-none ${className}`} style={style} />
}

/** Small colour key item: swatch plus label. Used sparingly, where direct labels are not possible. */
export function Key({ swatch, children }: { swatch: ReactNode; children: ReactNode }) {
  return <span className="inline-flex items-center gap-2">{swatch}{children}</span>
}

export function Segmented<T extends string>({
  value, options, onChange, label,
}: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-0.5 rounded-[9px] bg-[#F0F2F5] p-[3px] text-sm">
      {options.map((o) => {
        const on = o.value === value
        return (
          <button
            key={o.value} type="button" aria-pressed={on} onClick={() => onChange(o.value)}
            className={`cursor-pointer rounded-[7px] border-0 px-3 py-[5px] ${on ? 'bg-white font-semibold text-ink shadow-[0_1px_2px_rgba(16,24,40,0.08)]' : 'bg-transparent text-muted hover:text-ink'}`}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

/**
 * A money input shown in $k or $M. Value is whole dollars. While focused it shows exactly what you type;
 * on blur it snaps back to the tidy formatted value.
 */
export function MoneyField({
  id, value, onChange, unit, ariaLabel,
}: { id: string; value: number; onChange: (dollars: number) => void; unit: 'k' | 'M'; ariaLabel?: string }) {
  const mult = unit === 'k' ? 1000 : 1_000_000
  const tidy = (v: number) => String(Math.round((v / mult) * 100) / 100)
  const [focused, setFocused] = useState(false)
  const [text, setText] = useState('')
  return (
    <div className="flex min-h-[46px] min-w-0 flex-1 items-center rounded-[9px] border border-[#C9D1DB] bg-white px-3 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent">
      <span className="num text-muted">$</span>
      <input
        id={id} aria-label={ariaLabel} type="number" inputMode="decimal" step={unit === 'k' ? 1 : 0.01} min={0}
        value={focused ? text : tidy(value)}
        onFocus={() => { setText(tidy(value)); setFocused(true) }}
        onChange={(e) => {
          setText(e.target.value)
          const v = parseFloat(e.target.value)
          onChange(Number.isNaN(v) ? 0 : Math.round(v * mult))
        }}
        onBlur={() => setFocused(false)}
        className="num min-w-0 flex-1 border-0 bg-transparent px-1 py-2.5 text-[17px] font-semibold text-ink outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />
      <span className="num text-muted">{unit}</span>
    </div>
  )
}

export function EmptyNote({ children }: { children: ReactNode }) {
  return <p className="m-0 py-4 text-sm text-muted">{children}</p>
}
