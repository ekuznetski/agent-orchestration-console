import type { ReactNode } from 'react'
import { actionLabels, agentType, effectClassLabel, resultKindLabel } from '@/config/agentTags'
import type { Action } from '@/store/console.reducer'
import { useAgent } from '@/store/hooks'
import { useConsoleStore } from '@/store/console.store'
import { statusLineOf } from '@/store/selectors'
import { StatusBadge } from './StatusBadge'

const Row = ({ label, children }: { label: string; children: ReactNode }) => (
  <>
    <dt className="text-muted-foreground">{label}</dt>
    <dd className="m-0 min-w-0 break-words">{children}</dd>
  </>
)

const Fields = ({ children }: { children: ReactNode }) => (
  <dl className="text-label m-0 grid grid-cols-[64px_minmax(0,1fr)] gap-x-3 gap-y-1.5">{children}</dl>
)

/** One accepted command, with what was actually sent. */
function ActionEntry({ action }: { action: Action }) {
  if (action.kind === 'retry') return <p>You retried: attempt {action.attempt}</p>
  if (action.kind === 'resolve') return <p>You answered: {action.label}</p>
  const { subject, body, ...rest } = action.draft
  const title = action.kind === 'approve' ? `You approved (revision ${action.revision})` : 'You sent an edited version'
  return (
    <div className="flex flex-col gap-2">
      <b className="font-semibold">{title}</b>
      <Fields>
        {action.kind === 'approve' && (
          <Row label={actionLabels(action.action).targetLabel}>
            <span className="text-code font-mono [overflow-wrap:anywhere]">{action.target}</span>
          </Row>
        )}
        {subject !== undefined && <Row label="Subject">{subject}</Row>}
        {Object.entries(rest).map(([key, value]) => (
          <Row key={key} label={key}>
            {typeof value === 'string' ? value : JSON.stringify(value)}
          </Row>
        ))}
      </Fields>
      {body !== undefined && <div className="bg-muted rounded-md px-3.5 py-3 break-words whitespace-pre-wrap">{body}</div>}
      {action.kind === 'approve' && (
        <p className={`text-label font-semibold ${effectClassLabel(action.effectClass).tone === 'danger' ? 'text-failed' : ''}`}>
          {effectClassLabel(action.effectClass).label}: {effectClassLabel(action.effectClass).note}
        </p>
      )}
    </div>
  )
}

/** What one agent did and what the user sent it. The trace stays in the card. Sections that arrive later (the
 * result) go below what the user did, so their arrival does not move what is already on screen. */
export function AgentRecord({ id }: { id: string }) {
  const agent = useAgent(id)
  const result = useConsoleStore((state) => state.result)
  const cancelled = useConsoleStore((state) => state.status === 'cancelled')
  const items = result ? result.event.items.filter((item) => item.agentId === id) : []

  return (
    <div className="flex flex-col gap-4 text-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-muted-foreground text-xs font-semibold">{agentType(agent.type).name}</div>
          <div className="text-title font-semibold">{agent.label}</div>
        </div>
        <StatusBadge tag={agent.tag} />
      </div>
      {/* Two lines of fixed height: the full status shows, and a new one never pushes down what the user is reading. */}
      <div className="text-label grid grid-cols-[64px_minmax(0,1fr)] gap-x-3">
        <span className="text-muted-foreground">Status</span>
        <span className="line-clamp-2 h-[2lh]" title={statusLineOf(agent) ?? undefined}>
          {statusLineOf(agent) ?? 'No status yet'}
        </span>
      </div>
      <section aria-label="What you did" className="flex flex-col gap-3 border-t pt-3">
        <h3 className="text-muted-foreground text-xs font-semibold">What you did</h3>
        {agent.actions.length === 0 ? (
          <p className="text-muted-foreground">You have not acted on this agent.</p>
        ) : (
          agent.actions.map((action, i) => <ActionEntry key={i} action={action} />)
        )}
      </section>
      {items.length > 0 && result && (
        <section aria-label="Result for this agent" className="flex flex-col gap-2 border-t pt-3">
          <h3 className="text-muted-foreground text-xs font-semibold">Result{result.outdated && !cancelled ? ' - Updating' : ''}</h3>
          <div className={result.outdated && !cancelled ? 'flex flex-col gap-1.5 opacity-50' : 'flex flex-col gap-1.5'}>
            {items.map((item) => (
              <div key={item.id} className="flex flex-col gap-0.5">
                <span className={`text-xs font-semibold ${item.kind === 'error' ? 'text-failed' : 'text-muted-foreground'}`}>
                  {resultKindLabel(item.kind)}
                </span>
                <b>{item.title}</b>
                <span className="text-muted-foreground">{item.detail}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
