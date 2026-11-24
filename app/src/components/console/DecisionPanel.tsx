import { useEffect, type ReactNode } from 'react'
import type { ConfirmationRequiredEvent, EscalationRequiredEvent } from '@mock/orchestrator.js'
import { Button } from '@/components/ui/button'
import { TAGS, actionLabels, agentType, effectClassLabel, toneColor } from '@/config/agentTags'
import type { AgentModel } from '@/store/console.reducer'
import { useConsoleStore } from '@/store/console.store'
import { useDecisionQueue, useShownDecision } from '@/store/hooks'
import { phaseOf } from '@/store/selectors'
import { useViewStore } from '@/store/view.store'

const Row = ({ label, children, className }: { label: string; children: ReactNode; className?: string }) => (
  <>
    <span className="text-muted-foreground">{label}</span>
    <span className={className}>{children}</span>
  </>
)

function ConfirmationView({ gate, revision }: { gate: ConfirmationRequiredEvent; revision: number }) {
  const labels = actionLabels(gate.action)
  const effect = effectClassLabel(gate.effectClass)
  const { subject, body, ...rest } = gate.draft
  return (
    <div className="flex flex-col gap-2.5">
      <h3 className="text-[15px] font-bold">{revision > 1 ? labels.editedTitle : labels.title}</h3>
      <div className="grid grid-cols-[5rem_minmax(0,1fr)] gap-x-2.5 gap-y-1">
        <Row label="To">{gate.target}</Row>
        {subject !== undefined && <Row label="Subject">{subject}</Row>}
        {Object.entries(rest).map(([key, value]) => (
          <Row key={key} label={key}>
            {typeof value === 'string' ? value : JSON.stringify(value)}
          </Row>
        ))}
      </div>
      {body !== undefined && <div className="bg-muted max-h-[220px] overflow-auto rounded-sm border p-2 whitespace-pre-wrap">{body}</div>}
      <p className="text-xs" style={{ color: toneColor(effect.tone) }}>
        {effect.label}: {effect.note}
      </p>
    </div>
  )
}

function QuestionView({ gate }: { gate: EscalationRequiredEvent }) {
  return (
    <div className="flex flex-col gap-2.5">
      <h3 className="text-[15px] font-bold">{gate.question}</h3>
      <p className="text-muted-foreground">{gate.context}</p>
      <ul className="flex flex-col gap-1.5">
        {gate.options.map((option) => (
          <li key={option.id} className="rounded-sm border px-2 py-1.5">
            <b>{option.label}</b>
            {option.detail && <div className="text-muted-foreground">{option.detail}</div>}
          </li>
        ))}
      </ul>
    </div>
  )
}

function FailureView({ agent }: { agent: AgentModel }) {
  const attempt = agent.attempts[agent.attempts.length - 1]
  return (
    <div className="flex flex-col gap-2.5">
      <h3 className="text-[15px] font-bold">Retry this agent?</h3>
      <div className="grid grid-cols-[5rem_minmax(0,1fr)] gap-x-2.5 gap-y-1">
        <Row label="Status">{agent.status?.statusLine}</Row>
        {agent.status?.error && (
          <Row label="Error" className="font-mono">
            <span style={{ color: 'var(--tone-danger)' }}>{agent.status.error.message}</span>
          </Row>
        )}
      </div>
      <p className="text-muted-foreground">Retry starts attempt {attempt.n + 1}.</p>
    </div>
  )
}

function emptyLine(phase: ReturnType<typeof phaseOf>, allQueued: boolean): string {
  if (phase === 'idle' || allQueued) return 'The agents are starting. New decisions open here.'
  if (phase === 'running') return 'New decisions open here when an agent asks.'
  if (phase === 'finishing') return 'The agents are done. The result appears above the agents.'
  if (phase === 'cancelled') return 'The run was cancelled.'
  return 'The run is finished. The result is above the agents.'
}

/** One decision at a time, "N of M", Prev / Next. The decision on screen stays pinned until the user moves. */
export function DecisionPanel() {
  const queue = useDecisionQueue()
  const shownId = useShownDecision()
  const selectedId = useViewStore((state) => state.selectedId)
  const select = useViewStore((state) => state.select)
  const pin = useViewStore((state) => state.pin)
  const agent = useConsoleStore((state) => (shownId ? state.agents[shownId] : null))
  const phase = useConsoleStore(phaseOf)
  const allQueued = useConsoleStore((state) => (state.plan?.order ?? []).every((id) => state.agents[id].tag === 'queued'))

  // Pin what is shown, so a decision that arrives later with a lower seq never takes its place.
  useEffect(() => {
    if (shownId && shownId !== selectedId) pin(shownId)
  }, [shownId, selectedId, pin])

  const index = shownId ? queue.indexOf(shownId) : -1
  const tone = agent ? TAGS[agent.tag].tone : null

  return (
    <aside
      aria-label="Decisions waiting for you"
      className="flex min-h-0 flex-col gap-2.5 overflow-y-auto border-l-[3px] p-3.5"
      style={{ borderLeftColor: tone ? toneColor(tone) : 'transparent' }}
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-bold">Decisions waiting for you</h2>
        {agent && (
          <div className="text-muted-foreground flex items-center gap-1.5">
            <Button variant="outline" size="sm" disabled={index <= 0} onClick={() => select(queue[index - 1])}>
              Prev
            </Button>
            <span>
              {index + 1} of {queue.length}
            </span>
            <Button variant="outline" size="sm" disabled={index >= queue.length - 1} onClick={() => select(queue[index + 1])}>
              Next
            </Button>
          </div>
        )}
      </div>
      {agent ? (
        <>
          <div className="text-muted-foreground">
            {agentType(agent.type).name} - {agent.label}
          </div>
          {agent.tag === 'failed' ? (
            <FailureView agent={agent} />
          ) : agent.gate?.event.type === 'confirmation_required' ? (
            <ConfirmationView gate={agent.gate.event} revision={agent.gate.revision} />
          ) : agent.gate?.event.type === 'escalation_required' ? (
            <QuestionView gate={agent.gate.event} />
          ) : null}
        </>
      ) : (
        <div className="text-muted-foreground flex flex-col gap-1 pt-8 text-center">
          <b className="text-foreground text-sm">Nothing needs you right now</b>
          <span>{emptyLine(phase, allQueued)}</span>
        </div>
      )}
    </aside>
  )
}
