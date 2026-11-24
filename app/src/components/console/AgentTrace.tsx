import { useLayoutEffect, useRef } from 'react'
import { CircleCheck, CircleX, LoaderCircle } from 'lucide-react'
import { actLabel } from '@/config/agentTags'
import type { AgentModel } from '@/store/console.reducer'
import { traceOf } from '@/store/selectors'

type Row = { key: string; kind: 'step' | 'failure' | 'working'; number?: number; label?: string; text: string; error?: string }

/** One row of the timeline: number, icon on the line, text (a failure shows its status line verbatim). The line joins rows of one attempt; it turns red
 * into a failure. */
function TraceRow({ row, up, down }: { row: Row; up: Row | null; down: Row | null }) {
  const failed = row.kind === 'failure'
  const segment = (to: Row) => (to.kind === 'failure' || failed ? 'bg-failed' : to.kind === 'working' ? 'bg-track' : 'bg-done')
  const Icon = failed ? CircleX : row.kind === 'working' ? LoaderCircle : CircleCheck
  return (
    <li
      className={`relative grid grid-cols-[22px_16px_minmax(0,1fr)] items-start gap-x-2.5 px-3 py-[7px] text-label leading-5 ${failed ? 'bg-failed-tint text-failed rounded-md' : ''}`}
    >
      {up && <span aria-hidden="true" className={`absolute top-0 left-[51px] h-3.5 w-0.5 ${segment(up)}`} />}
      {down && <span aria-hidden="true" className={`absolute top-3.5 bottom-0 left-[51px] w-0.5 ${segment(down)}`} />}
      <span className="text-faint text-right text-xs leading-5 tabular-nums">{row.number ?? ''}</span>
      <Icon
        aria-hidden="true"
        className={`relative z-10 mt-0.5 size-4 rounded-full ${failed ? 'bg-failed-tint text-failed' : row.kind === 'working' ? 'bg-card text-faint motion-safe:animate-spin' : 'bg-card text-done'}`}
      />
      <span className={row.kind === 'working' ? 'text-muted-foreground' : undefined}>
        {/* At most two lines, so a long detail (a free-text answer) cannot stretch the card; the full text
            stays in the tooltip and in the record. */}
        <span className="line-clamp-2" title={row.label ? `${row.label}: ${row.text}` : row.text}>
          {row.label && <b className="font-semibold">{row.label}:</b>} {row.text}
        </span>
        {row.error && <span className="block font-mono text-xs">{row.error}</span>}
      </span>
    </li>
  )
}

/** The agent's steps by seq, grouped by attempt, numbered across attempts. Capped at 400px with its own
 * scroll; a new step scrolls to the bottom only while the user is already at the bottom. */
export function AgentTrace({ agent }: { agent: AgentModel }) {
  const attempts = traceOf(agent)
  const box = useRef<HTMLDivElement>(null)
  const atBottom = useRef(true)
  const rowCount = attempts.reduce((n, attempt) => n + attempt.rows.length, 0)

  useLayoutEffect(() => {
    const el = box.current
    if (el && atBottom.current) el.scrollTop = el.scrollHeight
  }, [rowCount])

  if (agent.steps.length === 0 && attempts.every((attempt) => attempt.rows.length === 0)) {
    return (
      <div className="mx-3 mt-1 mb-3">
        <p className="text-muted-foreground m-0 px-3 py-3.5 text-label leading-[19px]">
          No steps yet. Steps appear here as the agent reports them.
        </p>
      </div>
    )
  }

  const status = agent.status
  const last = attempts[attempts.length - 1]
  const working =
    agent.tag === 'running' && status !== null && status.seq > (agent.gate?.event.seq ?? 0) && last.rows.some((row) => row.kind === 'step')

  // Steps are stored in seq order, so a step's number is its place in that list, across attempts.
  const numberOf = new Map(agent.steps.map((step, i) => [step.seq, i + 1]))
  const groups = attempts.map((attempt) => {
    const rows: Row[] = attempt.rows.map((row) =>
      row.kind === 'step'
        ? { key: `s${row.seq}`, kind: 'step', number: numberOf.get(row.seq), label: actLabel(row.step.act), text: row.step.detail }
        : {
            key: `f${row.seq}`,
            kind: 'failure',
            text: row.statusLine,
            error: row.error?.message,
          },
    )
    if (working && attempt === last && status) rows.push({ key: 'working', kind: 'working', label: 'Working', text: status.statusLine })
    return { n: attempt.n, rows }
  })

  return (
    <div
      ref={box}
      onScroll={(e) => {
        const el = e.currentTarget
        atBottom.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 4
      }}
      className="mx-3 mt-1 mb-3 max-h-[400px] overflow-y-auto rounded-md"
    >
      {groups.map((group) => (
        <div key={group.n}>
          {groups.length > 1 && (
            <div className="text-muted-foreground after:bg-border flex items-center gap-2 px-3 pt-2 pb-1 text-xs font-semibold after:h-px after:flex-1">
              Attempt {group.n}
            </div>
          )}
          <ol className="m-0 list-none p-0">
            {group.rows.map((row, i) => (
              <TraceRow key={row.key} row={row} up={group.rows[i - 1] ?? null} down={group.rows[i + 1] ?? null} />
            ))}
          </ol>
        </div>
      ))}
    </div>
  )
}
