import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { TAGS, actionLabels, toneEdge } from '@/config/agentTags'
import type { AgentModel } from '@/store/console.reducer'
import { useConsoleStore } from '@/store/console.store'
import { useShownDecision, useVisibleOutcome } from '@/store/hooks'
import { isSent, pendingCommand, phaseOf, statusLineOf, waitingQueue } from '@/store/selectors'
import { useViewStore, type Outcome } from '@/store/view.store'
import { useClearOnNextAction } from '@/hooks/useClearOnNextAction'
import { AgentRecord } from './AgentRecord'
import { ConfirmationDecision, FailureDecision, Frame, QuestionDecision, type Act } from './DecisionViews'
import { ClampedText } from './ClampedText'

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
    <div className="text-muted-foreground grid flex-1 place-items-center p-6 text-center text-label">
      <div>
        <b className="text-foreground mb-1 block text-sm font-semibold">Nothing needs you right now</b>
        {emptyLine(phase, allQueued)}
      </div>
    </div>
  )
}

/** What was sent: fixed once the mock accepted it. */
function sentLine(outcome: Outcome): string {
  if (outcome.kind === 'approve') return 'Approved'
  if (outcome.kind === 'edit') return 'Edit submitted'
  if (outcome.kind === 'resolve') return `Answer sent: ${outcome.answer}`
  return `Retry sent: attempt ${outcome.attempt}`
}

/** Where the agent is now, from the model: its status line, verbatim. A submitted edit says what happens next. */
function nowLine(agent: AgentModel): string {
  const pending = pendingCommand(agent)
  if (pending?.kind === 'edit' && agent.gate?.event.type === 'confirmation_required')
    return actionLabels(agent.gate.event.action).editPending
  if (pending) return 'Waiting for the agent to respond.'
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
    <div className="flex flex-1 flex-col">
      <div ref={statusRef} tabIndex={-1} role="status" className="flex flex-1 flex-col outline-none">
        <Frame
          band={outcome.kind === 'edit' ? 'neutral' : 'done'}
          who={agent.label}
          // At most two lines: a long own-words answer stays whole in the record, not in the heading.
          title={<ClampedText text={sentLine(outcome)} lines={2} />}
        >
          <ClampedText text={now} lines={2} className="text-muted-foreground h-[2lh]" />
        </Frame>
      </div>
      {/* The footer bar at the bottom of the panel: the button on the right, or a muted line in the same height. */}
      <div className="mt-auto flex h-[61px] items-center justify-end border-t px-4">
        {nextAgent ? (
          // The prefix stays; a long label truncates, so the button never leaves the footer.
          // The prefix and the label are two flex items: a word-space gap (gap-1) instead of the icon gap, and the
          // accessible name spelled out, since the label sits in its own box.
          <Button
            size="lg"
            ref={nextRef}
            className="max-w-full gap-1"
            aria-label={`Next decision: ${nextAgent.label}`}
            onClick={() => onNext(nextAgent.id)}
          >
            Next decision:
            <ClampedText text={nextAgent.label} lines={1} />
          </Button>
        ) : (
          <span className="text-muted-foreground mr-auto text-sm">Nothing else needs you right now.</span>
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
  // Any next user action clears a refused-command message; the action itself may set it again.
  useClearOnNextAction(refusedId !== null, () => setRefusedId(null))
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

  // A submitted edit is not a done action: neutral edge, like its band.
  const edgeTag = recordAgent?.tag ?? (outcome ? (outcome.kind === 'edit' ? null : 'done') : agent?.tag)
  // A record of an agent whose command is on its way is neutral, like its card.
  const edge = edgeTag && !(recordAgent && isSent(recordAgent)) ? toneEdge(TAGS[edgeTag].tone) : 'border-l-input'

  return (
    <aside
      // The landmark is named after what it shows: the decisions, or the open record.
      aria-label={recordId ? 'Agent record' : 'Decisions'}
      className={`bg-card shadow-raised flex min-h-[420px] flex-col overflow-hidden rounded-lg border border-l-[3px] ${edge}`}
    >
      {recordId ? (
        <>
          <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
            <h2 ref={recordRef} tabIndex={-1} className="text-title font-semibold outline-none">
              Agent record
            </h2>
            <Button variant="outline" onClick={backToDecisions}>
              {waitingCount > 0 ? `Back to decisions (${waitingCount})` : 'Back to decisions'}
            </Button>
          </div>
          <div className="p-4">
            <AgentRecord id={recordId} />
          </div>
        </>
      ) : (
        <>
          <div className="flex items-center gap-2 border-b px-4 py-3">
            <h2 className="text-title font-semibold">Decisions</h2>
            {waitingCount > 0 && (
              <span className="text-muted-foreground ml-2 text-label font-semibold tabular-nums">
                {waitingCount} {waitingCount === 1 ? 'needs' : 'need'} you
              </span>
            )}
          </div>
          {outcome ? (
            <OutcomeView key={`${outcome.agentId}-${outcome.kind}`} outcome={outcome} onNext={move} />
          ) : agent ? (
            <div ref={decisionRef} tabIndex={-1} role="group" aria-label={agent.label} className="flex flex-1 flex-col outline-none">
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
