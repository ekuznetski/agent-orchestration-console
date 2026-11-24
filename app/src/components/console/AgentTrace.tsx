import { useLayoutEffect, useRef } from 'react'
import { actLabel } from '@/config/agentTags'
import type { AgentModel } from '@/store/console.reducer'
import { traceOf } from '@/store/selectors'

/** The agent's steps by seq, grouped by attempt. Capped at 400px with its own scroll; a new step
 * scrolls to the bottom only while the user is already at the bottom. */
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
      <p className="text-muted-foreground mt-2 border-t border-dashed pt-2 italic">
        No steps yet. Steps appear here as the agent reports them.
      </p>
    )
  }

  const status = agent.status
  const last = attempts[attempts.length - 1]
  const working =
    agent.tag === 'running' && status !== null && status.seq > (agent.gate?.event.seq ?? 0) && last.rows.some((row) => row.kind === 'step')

  return (
    <div
      ref={box}
      onScroll={(e) => {
        const el = e.currentTarget
        atBottom.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 4
      }}
      className="mt-2 flex max-h-[400px] flex-col gap-1 overflow-y-auto border-t border-dashed pt-2"
    >
      {attempts.map((attempt) => (
        <div key={attempt.n} className="flex flex-col gap-1">
          {attempts.length > 1 && <div className="text-muted-foreground pt-1 text-[11px] tracking-wide uppercase">Attempt {attempt.n}</div>}
          {attempt.rows.map((row) =>
            row.kind === 'step' ? (
              <div key={row.seq}>
                <b>{actLabel(row.step.act)}:</b> {row.step.detail}
              </div>
            ) : (
              <div
                key={row.seq}
                className="rounded-sm px-1.5 py-0.5"
                style={{ background: 'var(--tone-danger-bg)', color: 'var(--tone-danger)' }}
              >
                {row.statusLine}
                {row.error && <div className="font-mono text-xs">{row.error.message}</div>}
              </div>
            ),
          )}
          {working && attempt === last && status && (
            <div>
              <b>Working:</b> {status.statusLine}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
