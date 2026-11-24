import {
  createMockOrchestrator,
  type ConfirmationRequiredEvent,
  type Draft,
  type EscalationRequiredEvent,
  type MockOrchestrator,
  type Unsubscribe,
} from '@mock/orchestrator.js'
import type { AgentModel, Sent } from '@/store/console.reducer'
import { useConsoleStore } from '@/store/console.store'
import { pendingCommand } from '@/store/selectors'
import { useViewStore } from '@/store/view.store'

// The one orchestrator of the run. No other module creates one or sends a command.
let orchestrator: MockOrchestrator | null = null
let unsubscribe: Unsubscribe | null = null

const apply = useConsoleStore.getState().apply

function stop(): void {
  unsubscribe?.()
  unsubscribe = null
  orchestrator?.reset()
  orchestrator = null
}

/** Starts a new run. Returns the mock's answer: false means it refused to start and the start card shows again. */
export function start(request: string, speed: number, jitter: boolean): boolean {
  stop()
  apply({ type: 'run_reset' })
  useViewStore.getState().runStarted()
  orchestrator = createMockOrchestrator({ speed, jitter })
  // The mock delivers only events emitted after subscribe, so subscribe before start().
  unsubscribe = orchestrator.subscribe((event) => apply(event))
  if (orchestrator.start(request)) return true
  // start() returns false (mock/orchestrator.d.ts): nothing runs, so it is not a run; back to the start card.
  stop()
  apply({ type: 'run_reset' })
  useViewStore.getState().runRefused()
  return false
}

/** Stops the run; everything stays on screen and unfinished agents become cancelled. */
export function cancel(): void {
  stop()
  apply({ type: 'run_cancelled' })
  useViewStore.getState().runCancelled()
}

/** "Start over" after an error: stops the run and goes back to the start card. */
export function reset(): void {
  stop()
  apply({ type: 'run_reset' })
  useViewStore.getState().runReset()
}

/** Sends one command. A second command while one is pending does not reach the mock and returns true
 * (it is already in flight). Only a command the mock accepted (true) is recorded, with what was sent. */
function send(agentId: string, call: (orc: MockOrchestrator) => boolean, sent: (agent: AgentModel) => Sent): boolean {
  // No guard for a missing orchestrator: no rendered control sends a command before start or after cancel
  // (the decision queue is empty then; architecture section 2).
  const agent = useConsoleStore.getState().agents[agentId]
  // A second click before the agent answers: the command is already in flight.
  if (pendingCommand(agent)) return true
  // Read before the call: the agent's next event after this seq answers the command.
  const afterSeq = agent.maxSeq
  const record = sent(agent)
  const accepted = call(orchestrator!)
  if (accepted) apply({ type: 'command_sent', agentId, afterSeq, ...record })
  return accepted
}

/** Approves the agent's open confirmation; records the approved action, target, effect class, revision and full draft. */
export const approve = (agentId: string) =>
  send(
    agentId,
    (orc) => orc.approve(agentId),
    (agent) => {
      const gate = agent.gate!
      const event = gate.event as ConfirmationRequiredEvent
      return {
        kind: 'approve',
        action: event.action,
        target: event.target,
        effectClass: event.effectClass,
        revision: gate.revision,
        draft: event.draft,
      }
    },
  )

export const edit = (agentId: string, draft: Draft) =>
  send(
    agentId,
    (orc) => orc.edit(agentId, draft),
    () => ({ kind: 'edit', draft }),
  )

/** Answers the agent's question with a picked option (its id is sent) or the user's own words. */
export const resolve = (agentId: string, answer: { optionId: string } | { words: string }) =>
  send(
    agentId,
    (orc) => orc.resolve(agentId, 'optionId' in answer ? answer.optionId : answer.words),
    (agent) => {
      if (!('optionId' in answer)) return { kind: 'resolve', label: answer.words }
      const options = (agent.gate!.event as EscalationRequiredEvent).options
      return { kind: 'resolve', optionId: answer.optionId, label: options.find((o) => o.id === answer.optionId)!.label }
    },
  )

export const retry = (agentId: string) =>
  send(
    agentId,
    (orc) => orc.retry(agentId),
    (agent) => ({ kind: 'retry', attempt: agent.attempts[agent.attempts.length - 1].n + 1 }),
  )
