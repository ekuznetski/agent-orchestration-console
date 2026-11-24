import type { AgentStepEvent, ResultEvent } from '@mock/orchestrator.js'
import type { Action, AgentModel, RunState } from './console.reducer'

export type Phase = 'idle' | 'running' | 'finishing' | 'completed' | 'partial' | 'cancelled'

export function isDegraded(result: ResultEvent): boolean {
  return result.degraded === true || result.items.some((item) => item.kind === 'error')
}

export function phaseOf(state: RunState): Phase {
  if (state.status === 'idle' || state.status === 'running' || state.status === 'cancelled') return state.status
  // Settled, but a command (a Retry) is in flight: the run works again from the moment the mock accepted it.
  if (state.plan?.order.some((id) => pendingCommand(state.agents[id]) !== null)) return 'running'
  if (!state.result || state.result.outdated) return 'finishing'
  return isDegraded(state.result.event) ? 'partial' : 'completed'
}

/** The command the agent has not answered yet. There is no ack in the API: an edit is answered
 * only by a newer gate (the re-emitted confirmation), any other command by any newer event. */
export function pendingCommand(agent: AgentModel): Action | null {
  // A cancelled agent will not answer: Cancel run ended the wait along with the run.
  return agent.tag === 'cancelled' ? null : unanswered(agent)
}

function unanswered(agent: AgentModel): Action | null {
  const last = agent.actions.at(-1)
  if (!last) return null
  if (last.kind === 'edit') return agent.gate && agent.gate.event.seq > last.afterSeq ? null : last
  return agent.maxSeq > last.afterSeq ? null : last
}

/** The user's last command the agent never answered before Cancel run (no event after it): whether it took
 * effect is unknown. Nothing arrives after a cancel, so the model as it stands answers this. */
export function unansweredAtCancel(agent: AgentModel): Action | null {
  return agent.tag === 'cancelled' ? unanswered(agent) : null
}

/** A command the mock accepted and the agent has not answered yet: the badge says "Waiting for agent" instead of the need it
 * no longer has, as the header count already leaves the agent out. For an edit that lasts until the re-asked
 * confirmation; the model's tag and queue place stay as they are. */
export function isWaitingForAgent(agent: AgentModel): boolean {
  return pendingCommand(agent) !== null
}

/** The single rule for "waits for the user". */
export function needsUser(agent: AgentModel): boolean {
  if (agent.tag === 'needs_approval' || agent.tag === 'needs_answer') return true
  return agent.tag === 'failed' && agent.status?.error?.retryable !== false
}

function waitSince(agent: AgentModel): number {
  if (agent.tag === 'needs_approval' || agent.tag === 'needs_answer') return agent.gate!.openedSeq
  return agent.status!.seq
}

/** Agents with a decision in the panel, longest wait first (seq is unique, so there are no ties). */
export function decisionQueue(state: RunState): string[] {
  if (state.status === 'cancelled' || !state.plan) return []
  return state.plan.order
    .map((id) => state.agents[id])
    .filter(needsUser)
    .sort((a, b) => waitSince(a) - waitSince(b))
    .map((agent) => agent.id)
}

/** The decision queue without agents whose command is still pending: what the user can act on now. */
export function waitingQueue(state: RunState): string[] {
  return decisionQueue(state).filter((id) => pendingCommand(state.agents[id]) === null)
}

export interface RunHeader {
  phase: Phase
  done: number
  total: number
  needYou: number
}

export function runHeader(state: RunState): RunHeader {
  const agents = (state.plan?.order ?? []).map((id) => state.agents[id])
  return {
    phase: phaseOf(state),
    done: agents.filter((agent) => agent.status?.state === 'done').length,
    total: agents.length,
    needYou: waitingQueue(state).length,
  }
}

export type TraceRow =
  | { kind: 'step'; seq: number; step: AgentStepEvent }
  | {
      kind: 'failure'
      seq: number
      statusLine: string
      /** The raw error, only when it is not retryable. */
      error: { code: string; message: string; retryable: boolean } | null
    }

export interface TraceAttempt {
  n: number
  rows: TraceRow[]
}

/** Steps grouped by attempt in seq order, with the failure that ended an attempt. */
export function traceOf(agent: AgentModel): TraceAttempt[] {
  const groups: TraceAttempt[] = agent.attempts.map((attempt) => ({
    n: attempt.n,
    rows: [],
  }))
  for (const step of agent.steps) {
    let i = agent.attempts.length - 1
    while (i > 0 && agent.attempts[i].startSeq > step.seq) i--
    groups[i].rows.push({
      kind: 'step',
      seq: step.seq,
      step,
    })
  }
  agent.attempts.forEach((attempt, i) => {
    if (!attempt.failure) return
    const error = attempt.failure.status.error
    groups[i].rows.push({
      kind: 'failure',
      seq: attempt.failure.seq,
      statusLine: attempt.failure.status.statusLine,
      error: error?.retryable === false ? error : null,
    })
    groups[i].rows.sort((a, b) => a.seq - b.seq)
  })
  return groups
}

/** The newest text by seq: the latest status line or the latest step detail. A failed agent keeps its status
 * line; a cancelled one shows "Last status: " + that same newest text. */
export function statusLineOf(agent: AgentModel): string | null {
  const status = agent.status
  if (status?.state === 'failed' && agent.tag !== 'cancelled') return status.statusLine
  const step = agent.steps.at(-1)
  const newest = step && (!status || step.seq > status.seq) ? step.detail : (status?.statusLine ?? null)
  if (agent.tag === 'cancelled') return newest === null ? null : `Last status: ${newest}`
  return newest
}

/** The error item's agent can be retried from the result now: failed, in the waiting queue. */
export function canRetryFromResult(state: RunState, agentId: string): boolean {
  return state.agents[agentId].tag === 'failed' && waitingQueue(state).includes(agentId)
}

/** The error item's agent was retried and has not failed again: its row reads "Retrying..." until a newer result
 * replaces the block. After a cancel nothing runs, so nothing is retrying. */
export function isRetryingFromResult(state: RunState, agentId: string): boolean {
  return retriedFromResult(state, agentId) && !canRetryFromResult(state, agentId) && state.agents[agentId].status?.state !== 'done'
}

/** The error item's agent was retried in this run (its last command is a retry): its row keeps the Retry slot,
 * so the row does not change height when "Retrying..." goes once the agent is done. */
export function retriedFromResult(state: RunState, agentId: string): boolean {
  return state.status !== 'cancelled' && state.agents[agentId].actions.at(-1)?.kind === 'retry'
}
