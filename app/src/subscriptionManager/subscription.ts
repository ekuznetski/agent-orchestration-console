import { createMockOrchestrator, type Draft, type MockOrchestrator, type Unsubscribe } from '@mock/orchestrator.js'
import type { CommandKind } from '@/store/console.reducer'
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

/** Starts a new run. Returns the mock's answer: false means it refused to start. */
export function start(request: string, speed: number, jitter: boolean): boolean {
  stop()
  apply({ type: 'run_reset' })
  useViewStore.getState().runStarted()
  orchestrator = createMockOrchestrator({ speed, jitter })
  // The mock delivers only events emitted after subscribe, so subscribe before start().
  unsubscribe = orchestrator.subscribe((event) => apply(event))
  return orchestrator.start(request)
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
 * (it is already in flight). Only a command the mock accepted (true) is recorded. */
function send(agentId: string, kind: CommandKind, call: (orc: MockOrchestrator) => boolean): boolean {
  // After cancel the run is over and nothing can be sent (architecture section 2).
  if (!orchestrator) return false
  const agent = useConsoleStore.getState().agents[agentId]
  // A second click before the agent answers: the command is already in flight.
  if (pendingCommand(agent)) return true
  // Read before the call, so the answer can never be counted as older than the command.
  const afterSeq = agent.maxSeq
  const accepted = call(orchestrator)
  if (accepted) apply({ type: 'command_sent', agentId, kind, afterSeq })
  return accepted
}

export const approve = (agentId: string) => send(agentId, 'approve', (orc) => orc.approve(agentId))
export const edit = (agentId: string, draft: Draft) => send(agentId, 'edit', (orc) => orc.edit(agentId, draft))
export const resolve = (agentId: string, choice: string) => send(agentId, 'resolve', (orc) => orc.resolve(agentId, choice))
export const retry = (agentId: string) => send(agentId, 'retry', (orc) => orc.retry(agentId))
