import { describe, expect, it } from 'vitest'
import type { OrchestratorEvent } from '@mock/orchestrator.js'
import fixture from '../../../fixtures/events.json'
import { initialState, reduce, type ConsoleEvent, type RunState } from './console.reducer'
import {
  decisionQueue,
  needsUser,
  pendingCommand,
  phaseOf,
  runHeader,
  statusLineOf,
  traceOf,
  unansweredAtCancel,
  waitingQueue,
} from './selectors'

const events = fixture as OrchestratorEvent[]

function run(list: ConsoleEvent[], from: RunState = initialState): RunState {
  return list.reduce((state, event) => reduce(state, event, 1000), from)
}

function upTo(seq: number): OrchestratorEvent[] {
  return events.slice(0, events.findIndex((e) => e.seq === seq) + 1)
}

let seq = 0
const ev = (event: object): ConsoleEvent => ({ seq: ++seq, ts: '', ...event }) as unknown as ConsoleEvent
function plan(ids: string[]): ConsoleEvent {
  seq = 0
  return ev({
    type: 'plan',
    runId: 'run_test',
    task: 'Task',
    subtasks: ids.map((id) => ({ id, type: 'research', label: id })),
  })
}
const status = (agentId: string, state: string, extra: object = {}) =>
  ev({
    type: 'agent_status',
    agentId,
    state,
    statusLine: `${agentId} ${state}`,
    ...extra,
  })
const step = (agentId: string, detail = 'step') => ev({ type: 'agent_step', agentId, act: 'decided', detail })
const confirmation = (agentId: string) =>
  ev({
    type: 'confirmation_required',
    agentId,
    action: 'send_email',
    target: 't',
    effectClass: 'irreversible',
    draft: { subject: 'S', body: 'B' },
  })
const escalation = (agentId: string) =>
  ev({
    type: 'escalation_required',
    agentId,
    question: 'Q',
    context: 'C',
    options: [],
  })
// afterSeq is the newest seq so far, which is at least the agent's own maxSeq when the command is sent.
const PAYLOAD = {
  approve: { action: 'send_email', target: 't', effectClass: 'irreversible', revision: 1, draft: {} },
  edit: { draft: {} },
  resolve: { label: 'Answer' },
  retry: { attempt: 2 },
}
const sent = (agentId: string, kind: 'approve' | 'edit' | 'resolve' | 'retry'): ConsoleEvent =>
  ({ type: 'command_sent', agentId, kind, afterSeq: seq, ...PAYLOAD[kind] }) as ConsoleEvent

describe('runHeader and phaseOf', () => {
  it('reports a finished run as completed with everything done', () => {
    expect(runHeader(run(events))).toEqual({
      phase: 'completed',
      done: 3,
      total: 3,
      needYou: 0,
    })
  })

  it('counts the open approval mid-run', () => {
    expect(runHeader(run(upTo(20)))).toEqual({
      phase: 'running',
      done: 0,
      total: 3,
      needYou: 1,
    })
  })

  it('goes idle, finishing, partial and cancelled', () => {
    expect(phaseOf(initialState)).toBe('idle')
    const settled = run([plan(['a']), status('a', 'failed')])
    expect(phaseOf(settled)).toBe('finishing')
    const partial = run(
      [
        ev({
          type: 'result',
          summary: 'S',
          items: [{ id: 'e', agentId: 'a', kind: 'error', title: 'T', detail: 'D' }],
        }),
      ],
      settled,
    )
    expect(phaseOf(partial)).toBe('partial')
    expect(phaseOf(run([{ type: 'run_cancelled' }], settled))).toBe('cancelled')
  })

  it('counts an accepted Retry after a partial result as running before the agent answers', () => {
    const partial = run([
      plan(['a']),
      status('a', 'failed', { error: { code: 'x', message: 'm', retryable: true } }),
      ev({ type: 'result', summary: 'S', items: [{ id: 'e', agentId: 'a', kind: 'error', title: 'T', detail: 'D' }] }),
    ])
    expect(phaseOf(partial)).toBe('partial')
    expect(phaseOf(run([sent('a', 'retry')], partial))).toBe('running')
  })
})

describe('pendingCommand', () => {
  it('answers an approve with any newer event of the agent', () => {
    const state = run([plan(['d']), confirmation('d'), sent('d', 'approve')])
    expect(pendingCommand(state.agents.d)?.kind).toBe('approve')
    expect(pendingCommand(run([step('d')], state).agents.d)).toBeNull()
  })

  it('answers an edit only with a newer gate', () => {
    const state = run([plan(['d']), confirmation('d'), sent('d', 'edit'), step('d')])
    expect(pendingCommand(state.agents.d)?.kind).toBe('edit')
    expect(pendingCommand(run([confirmation('d')], state).agents.d)).toBeNull()
  })
})

describe('unansweredAtCancel', () => {
  const cancel: ConsoleEvent = { type: 'run_cancelled' }
  it('is the last command the agent never answered before Cancel run', () => {
    const state = run([plan(['d']), confirmation('d'), sent('d', 'approve'), cancel])
    expect(unansweredAtCancel(state.agents.d)?.kind).toBe('approve')
  })

  it('is null when the agent answered before Cancel run', () => {
    expect(unansweredAtCancel(run([plan(['d']), confirmation('d'), sent('d', 'approve'), step('d'), cancel]).agents.d)).toBeNull()
  })

  it('is null without Cancel run, while the command is simply pending', () => {
    expect(unansweredAtCancel(run([plan(['d']), confirmation('d'), sent('d', 'approve')]).agents.d)).toBeNull()
  })

  it('counts an edit as unanswered after a step without a new gate, and answered after the re-emitted gate', () => {
    const edited = run([plan(['d']), confirmation('d'), sent('d', 'edit'), step('d')])
    expect(unansweredAtCancel(run([cancel], edited).agents.d)?.kind).toBe('edit')
    expect(unansweredAtCancel(run([confirmation('d'), cancel], edited).agents.d)).toBeNull()
  })
})

describe('retry lifecycle', () => {
  it('a retry stays pending until the next status, starts attempt 2, outdates the degraded result and a new one replaces it', () => {
    const result = (degraded: boolean) => ev({ type: 'result', summary: 'S', items: [], degraded })
    let state = run([plan(['a']), status('a', 'running'), status('a', 'failed'), result(true)])
    expect(phaseOf(state)).toBe('partial')
    state = run([sent('a', 'retry')], state)
    expect(pendingCommand(state.agents.a)?.kind).toBe('retry')
    state = run([status('a', 'running')], state)
    expect(pendingCommand(state.agents.a)).toBeNull()
    expect(state.agents.a.attempts.map((attempt) => attempt.n)).toEqual([1, 2])
    expect(state.result?.outdated).toBe(true)
    expect(phaseOf(state)).toBe('running')
    state = run([status('a', 'done'), result(false)], state)
    expect(state.result).toMatchObject({ version: 2, outdated: false })
    expect(phaseOf(state)).toBe('completed')
  })
})

describe('traceOf', () => {
  it('groups research steps by attempt, with the failure row', () => {
    const trace = traceOf(run(events).agents.agent_research)
    expect(trace.map((a) => a.n)).toEqual([1, 2])
    expect(trace[0].rows.map((r) => [r.kind, r.seq])).toEqual([
      ['step', 6],
      ['step', 8],
      ['step', 9],
      ['step', 12],
      ['failure', 15],
    ])
    const failure = trace[0].rows[4]
    expect(failure.kind === 'failure' && failure.error).toBeNull()
  })

  it('keeps the raw error on a failure that is not retryable', () => {
    const error = {
      code: 'denied',
      message: 'Access denied',
      retryable: false,
    }
    const trace = traceOf(run([plan(['a']), status('a', 'failed', { error })]).agents.a)
    expect(trace[0].rows[0]).toMatchObject({ kind: 'failure', error })
  })
})

describe('decisionQueue', () => {
  it('puts the longest wait first and keeps an edited gate in its place', () => {
    // Plan order (s, f, d) differs from wait order (d, f, s), so only the sort can produce this.
    let state = run([plan(['s', 'f', 'd']), confirmation('d'), status('f', 'failed'), escalation('s')])
    expect(decisionQueue(state)).toEqual(['d', 'f', 's'])
    state = run([sent('d', 'edit'), step('d'), confirmation('d')], state)
    expect(decisionQueue(state)).toEqual(['d', 'f', 's'])
  })

  it('keeps a pending command in the queue but not in the waiting queue', () => {
    const state = run([plan(['d', 's']), confirmation('d'), escalation('s'), sent('d', 'approve')])
    expect(decisionQueue(state)).toEqual(['d', 's'])
    expect(waitingQueue(state)).toEqual(['s'])
  })

  it('leaves out a failure that is not retryable and keeps one without error', () => {
    const state = run([
      plan(['x', 'y']),
      status('x', 'failed', {
        error: { code: 'c', message: 'm', retryable: false },
      }),
      status('y', 'failed'),
    ])
    expect(needsUser(state.agents.x)).toBe(false)
    expect(decisionQueue(state)).toEqual(['y'])
  })

  it('is empty after a cancel', () => {
    expect(decisionQueue(run([plan(['d']), confirmation('d'), { type: 'run_cancelled' }]))).toEqual([])
  })
})

describe('statusLineOf', () => {
  it('shows the newest of status and step, so Approve replaces "Paused"', () => {
    expect(statusLineOf(run(upTo(18)).agents.agent_drafting)).toBe('Paused \u2014 waiting for your approval')
    expect(statusLineOf(run(upTo(21)).agents.agent_drafting)).toBe('Approved by you \u2014 sending as drafted')
  })

  it('does not let the late step override done', () => {
    expect(statusLineOf(run(upTo(29)).agents.agent_scheduling)).toBe('Hold placed \u2014 Tue 10 Mar, 14:00')
  })

  it('keeps a failed status line; a cancelled one shows its newest text, step or status, after "Last status:"', () => {
    expect(statusLineOf(run(upTo(15)).agents.agent_research)).toBe('Failed \u2014 Jira fetch timed out after 3 attempts')
    // Drafting's newest event before the cancel is a step (seq 14), newer than its running status (seq 7).
    const cancelled = run([...upTo(15), { type: 'run_cancelled' }]).agents.agent_drafting
    expect(statusLineOf(cancelled)).toBe('Last status: Tone: concise; lead with the security sign-off blocker')
    const early = run([...upTo(7), { type: 'run_cancelled' }]).agents.agent_drafting
    expect(statusLineOf(early)).toBe('Last status: Drafting the follow-up to Maya Chen…')
  })
})
