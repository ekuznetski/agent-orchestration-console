import type {
  AgentStatusEvent,
  AgentStepEvent,
  ConfirmationRequiredEvent,
  Draft,
  EscalationRequiredEvent,
  EventOf,
  OrchestratorEvent,
  ResultEvent,
} from '@mock/orchestrator.js'

/** What a command actually sent, recorded only when the handler returned true. */
export type Sent =
  | { kind: 'approve'; action: string; target: string; effectClass: string; revision: number; draft: Draft }
  | { kind: 'edit'; draft: Draft }
  /** The picked option (optionId and its label), or the typed words as the label. */
  | { kind: 'resolve'; optionId?: string; label: string }
  | { kind: 'retry'; attempt: number }

export type CommandKind = Sent['kind']

/** An accepted command. afterSeq is the agent's maxSeq when it was sent; its next event answers it. */
export type Action = Sent & { afterSeq: number }

/** Events the console itself dispatches; they never come from the mock. */
export type LocalEvent = { type: 'run_reset' } | { type: 'run_cancelled' } | ({ type: 'command_sent'; agentId: string } & Action)

export type ConsoleEvent = OrchestratorEvent | LocalEvent

export type AgentTag = 'queued' | 'running' | 'needs_approval' | 'needs_answer' | 'failed' | 'done' | 'cancelled'

export type GateEvent = ConfirmationRequiredEvent | EscalationRequiredEvent

export interface Gate {
  event: GateEvent
  /** Seq the gate first opened at; an edit re-emit keeps it, so the queue place does not move. */
  openedSeq: number
  revision: number
}

export interface Failure {
  seq: number
  message: string
  status: AgentStatusEvent
}

export interface Attempt {
  n: number
  startSeq: number
  failure: Failure | null
}

export interface AgentModel {
  id: string
  type: string
  label: string
  status: AgentStatusEvent | null
  steps: AgentStepEvent[]
  attempts: Attempt[]
  actions: Action[]
  gate: Gate | null
  maxSeq: number
  tag: AgentTag
}

export interface ResultModel {
  event: ResultEvent
  version: number
  outdated: boolean
}

export interface LogEntry {
  event: OrchestratorEvent
  late: boolean
}

export type RunStatus = 'idle' | 'running' | 'settled' | 'cancelled'

export interface RunState {
  status: RunStatus
  plan: { task: string; order: string[] } | null
  agents: Record<string, AgentModel>
  result: ResultModel | null
  startedAt: number | null
  log: LogEntry[]
  maxSeq: number
  modelError: string | null
}

export const initialState: RunState = {
  status: 'idle',
  plan: null,
  agents: {},
  result: null,
  startedAt: null,
  log: [],
  maxSeq: 0,
  modelError: null,
}

function isSettled(agent: AgentModel): boolean {
  return agent.status?.state === 'done' || agent.status?.state === 'failed'
}

/** An edit sent after the current confirmation that no newer gate has answered yet. */
function editPendingOn(agent: AgentModel, gate: Gate): boolean {
  const last = agent.actions.at(-1)
  return gate.event.type === 'confirmation_required' && last?.kind === 'edit' && last.afterSeq >= gate.event.seq
}

export function tagOf(agent: AgentModel): AgentTag {
  const gate = agent.gate
  if (gate) {
    const parked = gate.event.type === 'confirmation_required' ? 'needs_approval' : 'needs_answer'
    if (gate.event.seq === agent.maxSeq || editPendingOn(agent, gate)) return parked
  }
  const state = agent.status?.state
  return state === 'running' || state === 'failed' || state === 'done' ? state : 'queued'
}

function putAgent(state: RunState, agent: AgentModel, seq: number): RunState {
  const stored = { ...agent, maxSeq: Math.max(agent.maxSeq, seq) }
  stored.tag = tagOf(stored)
  const agents = { ...state.agents, [stored.id]: stored }
  // Agent events always follow the plan (README: plan is fired once, first).
  const order = state.plan!.order
  const status: RunStatus = order.every((id) => isSettled(agents[id])) ? 'settled' : 'running'
  return { ...state, agents, status }
}

function onGate(state: RunState, event: GateEvent): RunState {
  const agent = state.agents[event.agentId]
  const prev = agent.gate
  if (prev && event.seq <= prev.event.seq) return putAgent(state, agent, event.seq)
  const edited = prev !== null && event.type === 'confirmation_required' && editPendingOn(agent, prev)
  const revision = event.type === 'confirmation_required' ? (event.revision ?? (edited && prev ? prev.revision + 1 : 1)) : 1
  const gate: Gate = {
    event,
    openedSeq: edited && prev ? prev.openedSeq : event.seq,
    revision,
  }
  return putAgent(state, { ...agent, gate }, event.seq)
}

type Handlers = {
  [K in OrchestratorEvent['type']]: (state: RunState, event: EventOf<K>, at: number) => RunState
}

const handlers: Handlers = {
  plan: (state, event, at) => {
    const agents: Record<string, AgentModel> = {}
    for (const s of event.subtasks) {
      agents[s.id] = {
        id: s.id,
        type: s.type,
        label: s.label,
        status: null,
        steps: [],
        attempts: [{ n: 1, startSeq: 0, failure: null }],
        actions: [],
        gate: null,
        maxSeq: 0,
        tag: 'queued',
      }
    }
    return {
      ...state,
      status: 'running',
      plan: { task: event.task, order: event.subtasks.map((s) => s.id) },
      agents,
      startedAt: at,
    }
  },

  agent_status: (state, event) => {
    const agent = state.agents[event.agentId]
    if (agent.status && event.seq <= agent.status.seq) return state
    let attempts = agent.attempts
    const current = attempts[attempts.length - 1]
    const newAttempt =
      event.attempt !== undefined ? event.attempt > current.n : agent.status?.state === 'failed' && event.state !== 'failed'
    if (newAttempt)
      attempts = [
        ...attempts,
        {
          n: event.attempt ?? current.n + 1,
          startSeq: event.seq,
          failure: null,
        },
      ]
    if (event.state === 'failed') {
      const last = attempts[attempts.length - 1]
      const failure = {
        seq: event.seq,
        message: event.error?.message ?? event.statusLine,
        status: event,
      }
      attempts = [...attempts.slice(0, -1), { ...last, failure }]
    }
    const result = state.result && event.seq > state.result.event.seq ? { ...state.result, outdated: true } : state.result
    return putAgent({ ...state, result }, { ...agent, status: event, attempts }, event.seq)
  },

  agent_step: (state, event) => {
    const agent = state.agents[event.agentId]
    let i = agent.steps.length
    while (i > 0 && agent.steps[i - 1].seq > event.seq) i--
    const steps = [...agent.steps.slice(0, i), event, ...agent.steps.slice(i)]
    return putAgent(state, { ...agent, steps }, event.seq)
  },

  confirmation_required: onGate,
  escalation_required: onGate,

  result: (state, event) => {
    if (state.result && event.seq <= state.result.event.seq) return state
    return {
      ...state,
      result: {
        event,
        version: (state.result?.version ?? 0) + 1,
        outdated: false,
      },
    }
  },
}

function cancel(state: RunState): RunState {
  const agents: Record<string, AgentModel> = {}
  for (const [id, agent] of Object.entries(state.agents)) {
    agents[id] = isSettled(agent) ? agent : { ...agent, tag: 'cancelled' }
  }
  return { ...state, status: 'cancelled', agents }
}

/** The only place run state changes. Pure apart from logging a skipped or failed event. */
export function reduce(state: RunState, event: ConsoleEvent, at: number): RunState {
  switch (event.type) {
    case 'run_reset':
      return initialState
    case 'run_cancelled':
      return cancel(state)
    case 'command_sent': {
      const { type: _type, agentId, ...action } = event
      const agent = state.agents[agentId]
      const actions = [...agent.actions, action]
      return {
        ...state,
        agents: { ...state.agents, [agent.id]: { ...agent, actions } },
      }
    }
  }
  if (!Object.hasOwn(handlers, event.type)) {
    console.warn('Unknown event type, skipped:', event)
    return state
  }
  const logged: RunState = {
    ...state,
    log: [...state.log, { event, late: event.seq < state.maxSeq }],
    maxSeq: Math.max(state.maxSeq, event.seq),
  }
  const handle = handlers[event.type] as (state: RunState, event: OrchestratorEvent, at: number) => RunState
  try {
    return handle(logged, event, at)
  } catch (error) {
    console.error('Reducer failed on event, model change dropped:', event, error)
    return {
      ...logged,
      modelError: error instanceof Error ? error.message : String(error),
    }
  }
}
