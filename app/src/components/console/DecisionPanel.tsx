import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { TAGS, agentType, toneColor } from '@/config/agentTags'
import type { AgentModel } from '@/store/console.reducer'
import { useConsoleStore } from '@/store/console.store'
import { useShownDecision, useVisibleOutcome } from '@/store/hooks'
import { pendingCommand, phaseOf, statusLineOf, waitingQueue } from '@/store/selectors'
import { useViewStore, type Outcome } from '@/store/view.store'
import { AgentRecord } from './AgentRecord'
import { ConfirmationDecision, FailureDecision, QuestionDecision, type Act } from './DecisionViews'

function emptyLine(phase: ReturnType<typeof phaseOf>, allQueued: boolean): string {
  if (phase === 'cancelled') return 'The run was cancelled.'
  if (phase === 'idle' || allQueued) return 'The agents are starting. New decisions open here.'
  if (phase === 'running') return 'Agents keep working. New decisions open here.'
  if (phase === 'finishing') return 'The agents are done. The result appears above the agents.'
  return 'The run is finished. The result is above the agents.'
}

function EmptyState() {
  const phase = useConsoleStore(phaseOf)
  const allQueued = useConsoleStore((state) => (state.plan?.order ?? []).every((id) => state.agents[id].tag === 'queued'))
  return (
    <div className="text-muted-foreground flex flex-col gap-1 pt-8 text-center">
      <b className="text-foreground text-sm">Nothing needs you right now</b>
      <span>{emptyLine(phase, allQueued)}</span>
    </div>
  )
}

/** What was sent: fixed once the mock accepted it. */
function sentLine(outcome: Outcome): string {
  if (outcome.kind === 'approve') return 'Approved'
  if (outcome.kind === 'edit') return 'Edited version sent'
  if (outcome.kind === 'resolve') return `Answer sent: ${outcome.answer}`
  return `Retry sent: attempt ${outcome.attempt}`
}

/** Where the agent is now, from the model: its status line, verbatim. */
function nowLine(agent: AgentModel): string {
  if (pendingCommand(agent)) return 'Waiting for the agent to respond.'
  return statusLineOf(agent) ?? ''
}

/** The outcome of the user's last action, and the way to the next decision. Nothing here moves by itself:
 * the second line changes text in place, and the button slot keeps its height whether it holds a button or not. */
function OutcomeView({ outcome, onNext }: { outcome: Outcome; onNext: (id: string) => void }) {
  const agent = useConsoleStore((state) => state.agents[outcome.agentId])
  // The same agent asking again comes first: it continues what the user just did. Then the longest wait.
  const next = useConsoleStore((state) => {
    const queue = waitingQueue(state)
    return queue.includes(outcome.agentId) ? outcome.agentId : (queue[0] ?? null)
  })
  const nextAgent = useConsoleStore((state) => (next ? state.agents[next] : null))
  const now = nowLine(agent)
  const statusRef = useRef<HTMLDivElement>(null)
  const nextRef = useRef<HTMLButtonElement>(null)

  // An outcome mounts only after the user's action; the control that went away had focus, so focus moves
  // to the Next decision button, or to the outcome itself when nothing waits.
  useEffect(() => {
    ;(nextRef.current ?? statusRef.current)?.focus()
  }, [])

  return (
    <div className="flex flex-col gap-3">
      <div ref={statusRef} tabIndex={-1} className="bg-muted flex flex-col gap-0.5 rounded-md px-3.5 py-3 outline-none" role="status">
        <b className="break-words" style={{ color: 'var(--tone-success)' }}>
          {sentLine(outcome)}
        </b>
        <span className="text-muted-foreground truncate" title={now}>
          {now}
        </span>
      </div>
      <div className="flex min-h-8 items-center">
        {nextAgent ? (
          <Button ref={nextRef} onClick={() => onNext(nextAgent.id)}>
            Next decision: {agentType(nextAgent.type).name}
          </Button>
        ) : (
          <span className="text-muted-foreground">Nothing else needs you right now.</span>
        )}
      </div>
    </div>
  )
}

/** One decision at a time. What it shows changes only on the user's click: a decision that arrives does not
 * replace the shown decision or outcome; it is announced by its card badge, the header count and the Next
 * decision button. */
export function DecisionPanel() {
  const shownId = useShownDecision()
  const outcome = useVisibleOutcome()
  const selectedId = useViewStore((state) => state.selectedId)
  const recordId = useViewStore((state) => (state.mode === 'agent' ? state.recordId : null))
  const backToDecisions = useViewStore((state) => state.backToDecisions)
  const recordAgent = useConsoleStore((state) => (recordId ? state.agents[recordId] : null))
  const waitingCount = useConsoleStore((state) => waitingQueue(state).length)
  const select = useViewStore((state) => state.select)
  const pin = useViewStore((state) => state.pin)
  const setOutcome = useViewStore((state) => state.setOutcome)
  const agent = useConsoleStore((state) => (shownId ? state.agents[shownId] : null))
  const focusRequest = useViewStore((state) => state.focusRequest)
  const [refusedId, setRefusedId] = useState<string | null>(null)
  const recordRef = useRef<HTMLHeadingElement>(null)
  const decisionRef = useRef<HTMLDivElement>(null)

  // Only the user's moves request focus; a decision that opens in the empty panel by itself leaves focus alone.
  useEffect(() => {
    if (focusRequest > 0) (recordRef.current ?? decisionRef.current)?.focus()
  }, [focusRequest])

  // Pin what is shown, so a decision that arrives later with a lower seq never takes its place.
  useEffect(() => {
    if (shownId && shownId !== selectedId) pin(shownId)
  }, [shownId, selectedId, pin])

  const move = (id: string) => {
    setRefusedId(null)
    select(id)
  }

  // The outcome is stored when the mock accepts the command, with what was sent.
  const act: Act = (agentId, send, sent) => {
    const accepted = send()
    setRefusedId(accepted ? null : agentId)
    if (accepted) setOutcome({ agentId, ...sent })
    return accepted
  }

  const edge = recordAgent
    ? toneColor(TAGS[recordAgent.tag].tone)
    : outcome
      ? 'var(--tone-success)'
      : agent
        ? toneColor(TAGS[agent.tag].tone)
        : 'transparent'

  return (
    <aside
      // The landmark is named after what it shows: the decisions, or the open record.
      aria-label={recordId ? 'Agent record' : 'Decisions waiting for you'}
      // Any next user action in the panel clears a refused-command message; the action itself may set it again.
      onClickCapture={() => setRefusedId(null)}
      onChangeCapture={() => setRefusedId(null)}
      className="flex min-h-0 flex-col gap-2.5 overflow-y-auto border-l-[3px] p-3.5"
      style={{ borderLeftColor: edge }}
    >
      {recordId ? (
        <>
          <div className="flex items-center justify-between gap-2">
            <h2 ref={recordRef} tabIndex={-1} className="text-sm font-bold outline-none">
              Agent record
            </h2>
            <Button variant="outline" size="sm" onClick={backToDecisions}>
              {waitingCount > 0 ? `Back to decisions (${waitingCount})` : 'Back to decisions'}
            </Button>
          </div>
          <AgentRecord id={recordId} />
        </>
      ) : (
        <>
          <h2 className="text-sm font-bold">Decisions waiting for you</h2>
          {outcome ? (
            <OutcomeView key={`${outcome.agentId}-${outcome.kind}`} outcome={outcome} onNext={move} />
          ) : agent ? (
            <div
              ref={decisionRef}
              tabIndex={-1}
              role="group"
              aria-label={`${agentType(agent.type).name} - ${agent.label}`}
              className="flex flex-col gap-2.5 outline-none"
            >
              <div className="text-muted-foreground">
                {agentType(agent.type).name} - {agent.label}
              </div>
              {agent.tag === 'failed' ? (
                <FailureDecision agent={agent} />
              ) : agent.gate?.event.type === 'confirmation_required' ? (
                <ConfirmationDecision agent={agent} gate={agent.gate} refused={refusedId === agent.id} act={act} />
              ) : agent.gate?.event.type === 'escalation_required' ? (
                <QuestionDecision agent={agent} gate={agent.gate} refused={refusedId === agent.id} act={act} />
              ) : null}
            </div>
          ) : (
            <EmptyState />
          )}
        </>
      )}
    </aside>
  )
}
