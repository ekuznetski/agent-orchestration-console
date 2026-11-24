import type { ReactNode } from 'react'
import { TAGS, agentType, resultKindLabel, toneBg, toneColor } from '@/config/agentTags'
import type { Action } from '@/store/console.reducer'
import { useAgent } from '@/store/hooks'
import { useConsoleStore } from '@/store/console.store'
import { statusLineOf } from '@/store/selectors'

const Row = ({ label, children }: { label: string; children: ReactNode }) => (
  <>
    <span className="text-muted-foreground">{label}</span>
    <span className="min-w-0 break-words">{children}</span>
  </>
)

/** One accepted command, with what was actually sent. */
function ActionEntry({ action }: { action: Action }) {
  if (action.kind === 'retry') return <p>You retried: attempt {action.attempt}</p>
  if (action.kind === 'resolve') return <p>You answered: {action.label}</p>
  const { subject, body, ...rest } = action.draft
  const title = action.kind === 'approve' ? `You approved (revision ${action.revision})` : 'You sent an edited version'
  return (
    <div className="flex flex-col gap-1.5">
      <b>{title}</b>
      <div className="grid grid-cols-[5rem_minmax(0,1fr)] gap-x-2.5 gap-y-1">
        {action.kind === 'approve' && <Row label="To">{action.target}</Row>}
        {subject !== undefined && <Row label="Subject">{subject}</Row>}
        {Object.entries(rest).map(([key, value]) => (
          <Row key={key} label={key}>
            {typeof value === 'string' ? value : JSON.stringify(value)}
          </Row>
        ))}
      </div>
      {body !== undefined && <div className="bg-muted max-h-[220px] overflow-auto rounded-sm border p-2 whitespace-pre-wrap">{body}</div>}
    </div>
  )
}

/** What one agent did and what the user sent it. The trace stays in the card. */
export function AgentRecord({ id }: { id: string }) {
  const agent = useAgent(id)
  const result = useConsoleStore((state) => state.result)
  const tag = TAGS[agent.tag]
  const items = result ? result.event.items.filter((item) => item.agentId === id) : []

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-muted-foreground">
          {agentType(agent.type).name} - {agent.label}
        </span>
        <span
          className="rounded-full px-2 py-px text-[11px] whitespace-nowrap"
          style={{ background: toneBg(tag.tone), color: toneColor(tag.tone) }}
        >
          {tag.label}
        </span>
      </div>
      <div className="grid grid-cols-[5rem_minmax(0,1fr)] gap-x-2.5">
        <Row label="Status">{statusLineOf(agent) ?? 'No status yet'}</Row>
      </div>
      {items.length > 0 && result && (
        <section aria-label="Result for this agent" className="flex flex-col gap-1.5 border-t pt-2">
          <b>Result{result.outdated ? ' - Updating' : ''}</b>
          <div className={result.outdated ? 'flex flex-col gap-1.5 opacity-50' : 'flex flex-col gap-1.5'}>
            {items.map((item) => (
              <div key={item.id} className="flex flex-col gap-0.5">
                <span
                  className="text-[11px] tracking-wide uppercase"
                  style={{ color: item.kind === 'error' ? 'var(--tone-danger)' : 'var(--tone-neutral)' }}
                >
                  {resultKindLabel(item.kind)}
                </span>
                <b>{item.title}</b>
                <span className="text-muted-foreground">{item.detail}</span>
              </div>
            ))}
          </div>
        </section>
      )}
      <section aria-label="What you did" className="flex flex-col gap-2.5 border-t pt-2">
        {agent.actions.length === 0 ? (
          <p className="text-muted-foreground">You have not acted on this agent.</p>
        ) : (
          agent.actions.map((action, i) => <ActionEntry key={i} action={action} />)
        )}
      </section>
    </div>
  )
}
