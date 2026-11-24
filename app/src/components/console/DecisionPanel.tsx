import { useEffect, useState } from 'react'
import type { EscalationRequiredEvent } from '@mock/orchestrator.js'
import { Button } from '@/components/ui/button'
import { TAGS, actionLabels, agentType, toneColor } from '@/config/agentTags'
import type { AgentModel } from '@/store/console.reducer'
import { useConsoleStore } from '@/store/console.store'
import { useDecisionQueue, useShownDecision, useVisibleReceipt } from '@/store/hooks'
import { pendingCommand, phaseOf, waitingQueue } from '@/store/selectors'
import { useViewStore, type Receipt } from '@/store/view.store'
import { ConfirmationDecision, FailureDecision, QuestionDecision, answerText, type Act } from './DecisionViews'

const AUTO_ADVANCE_MS = 3000

function emptyLine(phase: ReturnType<typeof phaseOf>, allQueued: boolean): string {
  if (phase === 'idle' || allQueued) return 'The agents are starting. New decisions open here.'
  if (phase === 'running') return 'Agents keep working. New decisions open here.'
  if (phase === 'finishing') return 'The agents are done. The result appears above the agents.'
  if (phase === 'cancelled') return 'The run was cancelled.'
  return 'The run is finished. The result is above the agents.'
}

/** What the decision asks, in a few words: used for "Up next". */
function decisionTitle(agent: AgentModel): string {
  if (agent.tag === 'failed') return 'Retry this agent?'
  const event = agent.gate!.event
  if (event.type === 'escalation_required') return event.question
  const labels = actionLabels(event.action)
  return agent.gate!.revision > 1 ? labels.editedTitle : labels.title
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

/** What happened after approve, answer or retry, plus what is up next. */
function ReceiptView({ receipt, onNext }: { receipt: Receipt; onNext: (id: string) => void }) {
  const agent = useConsoleStore((state) => state.agents[receipt.agentId])
  const next = useConsoleStore((state) => waitingQueue(state).find((id) => id !== receipt.agentId) ?? null)
  const nextAgent = useConsoleStore((state) => (next ? state.agents[next] : null))

  const title =
    receipt.kind === 'approve'
      ? 'Approved'
      : receipt.kind === 'resolve'
        ? `Answer sent: ${receipt.answer}`
        : `Retried - attempt ${receipt.attempt} is running`

  return (
    <div className="flex flex-col gap-3">
      <div className="bg-muted flex flex-col gap-0.5 rounded-md px-3.5 py-3" role="status">
        <b style={{ color: 'var(--tone-success)' }}>{title}</b>
        <span className="text-muted-foreground">{agent.label} continues; its card on the left shows what it does next.</span>
      </div>
      {nextAgent ? (
        <div className="flex flex-col gap-2 border-t pt-2">
          <span>
            Up next: <b>{agentType(nextAgent.type).name}</b> - {decisionTitle(nextAgent)}
          </span>
          <div className="flex items-center gap-2">
            <Button onClick={() => onNext(nextAgent.id)}>Next: {agentType(nextAgent.type).name}</Button>
            {receipt.waitingAtAction.includes(nextAgent.id) && <span className="text-muted-foreground">opens in 3 s</span>}
          </div>
        </div>
      ) : (
        <EmptyState />
      )}
    </div>
  )
}

/** One decision at a time, "N of M", Prev / Next. The decision on screen stays pinned until the user moves. */
export function DecisionPanel() {
  const queue = useDecisionQueue()
  const shownId = useShownDecision()
  const receipt = useVisibleReceipt()
  const selectedId = useViewStore((state) => state.selectedId)
  const answers = useViewStore((state) => state.answers)
  const select = useViewStore((state) => state.select)
  const pin = useViewStore((state) => state.pin)
  const setReceipt = useViewStore((state) => state.setReceipt)
  const agent = useConsoleStore((state) => (shownId ? state.agents[shownId] : null))
  const [refusedId, setRefusedId] = useState<string | null>(null)

  // Pin what is shown, so a decision that arrives later with a lower seq never takes its place.
  useEffect(() => {
    if (shownId && shownId !== selectedId) pin(shownId)
  }, [shownId, selectedId, pin])

  // After a receipt, open the next decision by itself, but only one that was already waiting when the user acted.
  useEffect(() => {
    if (!receipt) return
    const timer = setTimeout(() => {
      const next = waitingQueue(useConsoleStore.getState()).find((id) => id !== receipt.agentId && receipt.waitingAtAction.includes(id))
      if (next) useViewStore.getState().select(next)
    }, AUTO_ADVANCE_MS)
    return () => clearTimeout(timer)
  }, [receipt])

  const move = (id: string) => {
    setRefusedId(null)
    select(id)
  }

  const act: Act = (agentId, send, done) => {
    const waitingAtAction = waitingQueue(useConsoleStore.getState()).filter((id) => id !== agentId)
    const accepted = send()
    setRefusedId(accepted ? null : agentId)
    if (accepted && done) setReceipt({ agentId, waitingAtAction, ...done })
    return accepted
  }

  // Going back to a decision whose command is still pending shows its receipt, rebuilt from the model.
  const pending = agent ? pendingCommand(agent) : null
  const rebuilt: Receipt | null =
    agent && pending && pending.kind !== 'edit'
      ? {
          agentId: agent.id,
          kind: pending.kind,
          answer:
            pending.kind === 'resolve'
              ? (answerText(agent.gate!.event as EscalationRequiredEvent, answers[agent.id]) ?? undefined)
              : undefined,
          attempt: agent.attempts[agent.attempts.length - 1].n + 1,
          waitingAtAction: [],
        }
      : null
  const shownReceipt = receipt ?? rebuilt

  const index = shownId ? queue.indexOf(shownId) : -1
  const edge = receipt ? 'var(--tone-success)' : agent ? toneColor(TAGS[agent.tag].tone) : 'transparent'

  return (
    <aside
      aria-label="Decisions waiting for you"
      // Any next user action in the panel clears a refused-command message; the action itself may set it again.
      onClickCapture={() => setRefusedId(null)}
      onChangeCapture={() => setRefusedId(null)}
      className="flex min-h-0 flex-col gap-2.5 overflow-y-auto border-l-[3px] p-3.5"
      style={{ borderLeftColor: edge }}
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-bold">Decisions waiting for you</h2>
        {agent && !receipt && (
          <div className="text-muted-foreground flex items-center gap-1.5">
            <Button variant="outline" size="sm" disabled={index <= 0} onClick={() => move(queue[index - 1])}>
              Prev
            </Button>
            <span>
              {index + 1} of {queue.length}
            </span>
            <Button variant="outline" size="sm" disabled={index >= queue.length - 1} onClick={() => move(queue[index + 1])}>
              Next
            </Button>
          </div>
        )}
      </div>
      {shownReceipt ? (
        <ReceiptView receipt={shownReceipt} onNext={move} />
      ) : agent ? (
        <>
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
        </>
      ) : (
        <EmptyState />
      )}
    </aside>
  )
}
