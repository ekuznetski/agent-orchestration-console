import type { AgentStepEvent, ResultEvent } from '@mock/orchestrator.js'
import type { Action, AgentModel, RunState } from './console.reducer'

export type Phase = 'idle' | 'running' | 'finishing' | 'completed' | 'partial' | 'cancelled'

export function isDegraded(result: ResultEvent): boolean {
  return result.degraded === true || result.items.some((item) => item.kind === 'error')
}

export function phaseOf(state: RunState): Phase {
  if (state.status === 'idle' || state.status === 'running' || state.status === 'cancelled') return state.status
  if (!state.result || state.result.outdated) return 'finishing'
  return isDegraded(state.result.event) ? 'partial' : 'completed'
}

/** The command the agent has not answered yet. There is no ack in the API: an edit is answered
 * only by a newer gate (the re-emitted confirmation), any other command by any newer event. */
export function pendingCommand(agent: AgentModel): Action | null {
  const last = agent.actions.at(-1)
  if (!last) return null
  if (last.kind === 'edit') return agent.gate && agent.gate.event.seq > last.afterSeq ? null : last
  return agent.maxSeq > last.afterSeq ? null : last
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
  /** The attempt number being retried right now, or null. */
  retryingAttempt: number | null
}

export function runHeader(state: RunState): RunHeader {
  const agents = (state.plan?.order ?? []).map((id) => state.agents[id])
  let retryingAttempt: number | null = null
  for (const agent of agents) {
    if ((agent.tag === 'queued' || agent.tag === 'running') && agent.attempts.length > 1) {
      retryingAttempt = Math.max(retryingAttempt ?? 0, agent.attempts.at(-1)!.n)
    }
  }
  return {
    phase: phaseOf(state),
    done: agents.filter((agent) => agent.status?.state === 'done').length,
    total: agents.length,
    needYou: waitingQueue(state).length,
    retryingAttempt,
  }
}

export type TraceRow =
  | { kind: 'step'; seq: number; number: number; step: AgentStepEvent }
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

/** Steps grouped by attempt in seq order, numbered across attempts, with the failure that ended an attempt. */
export function traceOf(agent: AgentModel): TraceAttempt[] {
  const groups: TraceAttempt[] = agent.attempts.map((attempt) => ({
    n: attempt.n,
    rows: [],
  }))
  let number = 0
  for (const step of agent.steps) {
    let i = agent.attempts.length - 1
    while (i > 0 && agent.attempts[i].startSeq > step.seq) i--
    groups[i].rows.push({
      kind: 'step',
      seq: step.seq,
      number: ++number,
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

/** The newest text by seq: the latest status line or the latest step detail.
 * A failed agent keeps its status line; a cancelled one shows its last status line. */
export function statusLineOf(agent: AgentModel): string | null {
  const status = agent.status
  if (agent.tag === 'cancelled') return status ? `Last status: ${status.statusLine}` : null
  if (status?.state === 'failed') return status.statusLine
  const step = agent.steps.at(-1)
  if (step && (!status || step.seq > status.seq)) return step.detail
  return status?.statusLine ?? null
}
