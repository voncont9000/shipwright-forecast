import { cssPct, money } from './format'

/**
 * Horizontal "path to plan" stacked bar: closed, committed-but-open, gap to plan (hatched),
 * the call marker plus plan tag below.
 */
export function PathToPlanBar({
  plan, closed, committedOpen, gap, callValue, callLabel = 'Your call', planLabel = 'Plan', closedLabel = 'Closed', gapLabel = 'Gap to plan',
}: {
  gapLabel?: string
  plan: number; closed: number; committedOpen: number; gap: number
  callValue: number; callLabel?: string; planLabel?: string; closedLabel?: string
}) {
  const scale = Math.max(plan, callValue, closed + committedOpen)
  const planAtEdge = plan >= scale * 0.999
  const planPos = (plan / scale) * 100
  const callPos = Math.min(100, Math.max(0, (callValue / scale) * 100))
  const aria = `${closedLabel} ${money(closed)}, committed but open ${money(committedOpen)}, gap to plan ${money(gap)}.`

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <div className="relative h-[22px] overflow-hidden rounded-md bg-[#F6F7F9]" role="img" aria-label={aria}>
          <div
            className="absolute inset-y-0 left-0"
            style={{ width: `${planPos}%`, background: 'repeating-linear-gradient(135deg, #F0F2F5 0 6px, #E4E8EE 6px 7px)' }}
          />
          <div className="absolute inset-y-0 left-0 bg-accent" style={{ width: cssPct(closed, scale) }} />
          <div className="absolute inset-y-0 bg-accent/30" style={{ left: cssPct(closed, scale), width: cssPct(committedOpen, scale) }} />
          <div className="absolute -inset-y-0.5 -ml-[1.5px] w-[3px] bg-ink" style={{ left: `${callPos}%` }} />
        </div>
        <div className="relative h-[22px]">
          <div
            className="absolute top-0 -translate-x-1/2 whitespace-nowrap text-[13px] font-semibold"
            style={{ left: `${Math.min(92, Math.max(8, callPos))}%` }}
          >
            {callLabel} {money(callValue)}
          </div>
          <div
            className="absolute top-0 whitespace-nowrap rounded-[5px] bg-[#F0F2F5] px-2 py-px text-[13px] font-semibold"
            style={planAtEdge ? { right: 0 } : { left: `${planPos}%`, transform: 'translateX(-50%)' }}
          >
            {planLabel} {money(plan)}
          </div>
        </div>
      </div>
      <div className="flex flex-wrap gap-x-7 gap-y-2 text-sm text-muted">
        <LegendItem swatch={<span className="size-3 rounded-[3px] bg-accent" />} label={closedLabel} value={money(closed)} />
        <LegendItem swatch={<span className="size-3 rounded-[3px] bg-accent/30" />} label="Committed, still open" value={money(committedOpen)} />
        <LegendItem
          swatch={<span className="size-3 rounded-[3px]" style={{ background: 'repeating-linear-gradient(135deg, #F0F2F5 0 3px, #C9D1DB 3px 4px)' }} />}
          label={gapLabel} value={money(gap)}
        />
      </div>
    </div>
  )
}

function LegendItem({ swatch, label, value }: { swatch: React.ReactNode; label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      {swatch}{label} <span className="num font-medium text-ink">{value}</span>
    </span>
  )
}
