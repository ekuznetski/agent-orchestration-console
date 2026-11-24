import { describe, expect, it, vi } from 'vitest'
import type { OrchestratorEvent } from '@mock/orchestrator.js'
import fixture from '../../../fixtures/events.json'
import { initialState, reduce, type ConsoleEvent, type RunState } from './console.reducer'

const events = fixture as OrchestratorEvent[]

function run(list: ConsoleEvent[], from: RunState = initialState): RunState {
  return list.reduce((state, event) => reduce(state, event, 1000), from)
}

function upTo(seq: number): OrchestratorEvent[] {
  return events.slice(0, events.findIndex((e) => e.seq === seq) + 1)
}

// Builders for synthetic runs. Agent ids outside the mock's closed union stand in
// for a fourth agent type, so events are typed loosely here.
let seq = 0
const next = () => ++seq
function plan(subtasks: { id: string; type: string }[]): ConsoleEvent {
  seq = 1
  return {
    type: 'plan',
    seq: 1,
    ts: '',
    runId: 'run_test',
    task: 'Task',
    subtasks: subtasks.map((s) => ({ ...s, label: `Label ${s.id}` })),
  } as unknown as ConsoleEvent
}
function status(agentId: string, state: string, extra: object = {}): ConsoleEvent {
  return {
    type: 'agent_status',
    seq: next(),
    ts: '',
    agentId,
    state,
    statusLine: `${agentId} ${state}`,
    ...extra,
  } as unknown as ConsoleEvent
}
function step(agentId: string, detail = 'step'): ConsoleEvent {
  return {
    type: 'agent_step',
    seq: next(),
    ts: '',
    agentId,
    act: 'decided',
    detail,
  } as unknown as ConsoleEvent
}
function confirmation(agentId: string, extra: object = {}): ConsoleEvent {
  return {
    type: 'confirmation_required',
    seq: next(),
    ts: '',
    agentId,
    action: 'send_email',
    target: 'someone@example.test',
    effectClass: 'irreversible',
    draft: { subject: 'S', body: 'B' },
    ...extra,
  } as unknown as ConsoleEvent
}
function escalation(agentId: string): ConsoleEvent {
  return {
    type: 'escalation_required',
    seq: next(),
    ts: '',
    agentId,
    question: 'Which?',
    context: 'Context',
    options: [{ id: 'a', label: 'A' }],
  } as unknown as ConsoleEvent
}

describe('the recorded run in arrival order', () => {
  const state = run(events)

  it('creates one agent per subtask in plan order', () => {
    expect(state.plan?.order).toEqual(['agent_research', 'agent_drafting', 'agent_scheduling'])
    expect(state.plan?.task).toBe(events[0].type === 'plan' ? events[0].task : '')
    expect(state.startedAt).toBe(1000)
  })

  it('orders every trace by seq, so the late searched step lands before read', () => {
    expect(state.agents.agent_research.steps.map((s) => s.seq)).toEqual([6, 8, 9, 12, 23, 27, 31])
    expect(state.agents.agent_drafting.steps.map((s) => s.seq)).toEqual([11, 14, 21])
    expect(state.agents.agent_scheduling.steps.map((s) => s.seq)).toEqual([13, 17, 26, 29])
  })

  it('places the step that arrives after done without reopening the agent', () => {
    const beforeLateStep = run(upTo(30))
    expect(beforeLateStep.agents.agent_scheduling.tag).toBe('done')
    const afterLateStep = run(upTo(29))
    expect(afterLateStep.agents.agent_scheduling.tag).toBe('done')
    expect(afterLateStep.agents.agent_scheduling.status?.seq).toBe(30)
    expect(afterLateStep.agents.agent_scheduling.steps.at(-1)?.seq).toBe(29)
  })

  it('never lets an older status override a newer one', () => {
    const late = status('agent_scheduling', 'running')
    const stale = { ...(late as object), seq: 10 } as ConsoleEvent
    const after = reduce(state, stale, 1000)
    expect(after.agents.agent_scheduling.status?.seq).toBe(30)
    expect(after.agents.agent_scheduling.tag).toBe('done')
  })

  it('closes every gate and settles every agent', () => {
    for (const id of state.plan!.order) expect(state.agents[id].tag).toBe('done')
    expect(state.status).toBe('settled')
  })

  it('keeps one result, version 1, not outdated', () => {
    expect(state.result?.event.seq).toBe(33)
    expect(state.result?.version).toBe(1)
    expect(state.result?.outdated).toBe(false)
  })

  it('logs every event in arrival order and marks only seq 8 and 29 late', () => {
    expect(state.log.map((l) => l.event.seq)).toEqual(events.map((e) => e.seq))
    expect(state.log.filter((l) => l.late).map((l) => l.event.seq)).toEqual([8, 29])
    expect(state.maxSeq).toBe(33)
  })

  it('splits research into two attempts and records the first failure', () => {
    const attempts = state.agents.agent_research.attempts
    expect(attempts.map((a) => [a.n, a.startSeq])).toEqual([
      [1, 0],
      [2, 16],
    ])
    expect(attempts[0].failure?.seq).toBe(15)
    expect(attempts[0].failure?.message).toBe('jira.search timed out after 30s')
    expect(attempts[1].failure).toBeNull()
  })

  it('handles each event type: gate, revision and tag while parked', () => {
    const atGate = run(upTo(20))
    expect(atGate.agents.agent_drafting.tag).toBe('needs_approval')
    expect(atGate.agents.agent_drafting.gate?.openedSeq).toBe(20)
    expect(atGate.agents.agent_drafting.gate?.revision).toBe(1)
    const atQuestion = run(upTo(25))
    expect(atQuestion.agents.agent_scheduling.tag).toBe('needs_answer')
    expect(atQuestion.agents.agent_drafting.tag).toBe('running')
    const failed = run(upTo(15))
    expect(failed.agents.agent_research.tag).toBe('failed')
  })
})

describe('optional fields', () => {
  it('counts attempts without attempt and revisions without revision', () => {
    const stripped = events.map((e) => {
      const copy: Record<string, unknown> = { ...e }
      delete copy.attempt
      delete copy.revision
      return copy as unknown as OrchestratorEvent
    })
    const state = run(stripped)
    expect(state.agents.agent_research.attempts.map((a) => [a.n, a.startSeq])).toEqual([
      [1, 0],
      [2, 16],
    ])
    expect(run(stripped.slice(0, stripped.findIndex((e) => e.seq === 20) + 1)).agents.agent_drafting.gate?.revision).toBe(1)
  })

  it('uses the status line as the failure message when error is absent', () => {
    const state = run([plan([{ id: 'a1', type: 'research' }]), status('a1', 'running'), status('a1', 'failed')])
    expect(state.agents.a1.attempts[0].failure?.message).toBe('a1 failed')
  })
})

describe('other plans', () => {
  it('handles a fourth agent type and a ten-agent plan', () => {
    const ids = Array.from({ length: 10 }, (_, i) => `agent_${i}`)
    const state = run([
      plan(ids.map((id, i) => ({ id, type: i === 3 ? 'billing' : 'research' }))),
      ...ids.map((id) => status(id, 'running')),
      status('agent_3', 'done'),
    ])
    expect(state.plan?.order).toEqual(ids)
    expect(state.agents.agent_3.type).toBe('billing')
    expect(state.agents.agent_3.tag).toBe('done')
    expect(ids.filter((id) => state.agents[id].tag === 'running')).toHaveLength(9)
    expect(state.status).toBe('running')
  })
})

describe('cancel', () => {
  it('marks every agent that is not done or failed as cancelled', () => {
    const state = run([...upTo(15), { type: 'run_cancelled' }])
    expect(state.status).toBe('cancelled')
    expect(state.agents.agent_research.tag).toBe('failed')
    expect(state.agents.agent_drafting.tag).toBe('cancelled')
    expect(state.agents.agent_scheduling.tag).toBe('cancelled')
  })

  it('cancels a failed agent whose accepted Retry it has not answered yet', () => {
    const before = run(upTo(15))
    const afterSeq = before.agents.agent_research.maxSeq
    const state = run([
      ...upTo(15),
      { type: 'command_sent', agentId: 'agent_research', afterSeq, kind: 'retry', attempt: 2 },
      { type: 'run_cancelled' },
    ])
    expect(state.agents.agent_research.tag).toBe('cancelled')
  })

  it('run_reset goes back to the initial state', () => {
    expect(run([...upTo(15), { type: 'run_reset' }])).toEqual(initialState)
  })
})

describe('result', () => {
  it('is replaced by a newer one and marked outdated by a newer status', () => {
    const result = (degraded: boolean): ConsoleEvent =>
      ({
        type: 'result',
        seq: next(),
        ts: '',
        summary: 'S',
        items: [],
        degraded,
      }) as unknown as ConsoleEvent
    const first = run([plan([{ id: 'a1', type: 'research' }]), status('a1', 'failed'), result(true)])
    expect(first.result?.version).toBe(1)
    const retried = run([status('a1', 'running')], first)
    expect(retried.result?.outdated).toBe(true)
    expect(retried.status).toBe('running')
    const second = run([status('a1', 'done'), result(false)], retried)
    expect(second.result?.version).toBe(2)
    expect(second.result?.outdated).toBe(false)
  })
})

describe('commands and the edit seam', () => {
  it('records command_sent after the agent newest seq', () => {
    const state = run([plan([{ id: 'd', type: 'drafting' }]), status('d', 'running'), confirmation('d')])
    const sent = reduce(
      state,
      {
        type: 'command_sent',
        agentId: 'd',
        kind: 'approve',
        afterSeq: 3,
        action: 'send_email',
        target: 't',
        effectClass: 'irreversible',
        revision: 1,
        draft: {},
      },
      1000,
    )
    expect(sent.agents.d.actions).toEqual([
      { kind: 'approve', afterSeq: 3, action: 'send_email', target: 't', effectClass: 'irreversible', revision: 1, draft: {} },
    ])
    expect(sent.agents.d.tag).toBe('needs_approval')
  })

  it('keeps needs_approval and openedSeq across a step between edit() and the re-emitted gate', () => {
    let state = run([
      plan([
        { id: 'd', type: 'drafting' },
        { id: 's', type: 'scheduling' },
      ]),
      status('d', 'running'),
      confirmation('d'),
    ])
    const opened = state.agents.d.gate!.openedSeq
    state = run(
      [{ type: 'command_sent', agentId: 'd', kind: 'edit', afterSeq: 3, draft: { subject: 'S2' } }, escalation('s'), step('d', 'Editing')],
      state,
    )
    expect(state.agents.d.tag).toBe('needs_approval')
    state = run([confirmation('d')], state)
    expect(state.agents.d.tag).toBe('needs_approval')
    expect(state.agents.d.gate?.openedSeq).toBe(opened)
    expect(state.agents.d.gate?.revision).toBe(2)
  })

  it('opens a fresh gate when no edit was sent', () => {
    const state = run([plan([{ id: 'd', type: 'drafting' }]), confirmation('d'), step('d'), confirmation('d', { revision: 1 })])
    expect(state.agents.d.gate?.openedSeq).toBe(4)
    expect(state.agents.d.gate?.revision).toBe(1)
  })
})

describe('reducer errors', () => {
  it('a handler that throws sets modelError, keeps the log, and later events still apply', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const state = run([plan([{ id: 'a1', type: 'research' }]), step('ghost')])
    expect(state.modelError).not.toBeNull()
    expect(state.log).toHaveLength(2)
    expect(state.maxSeq).toBe(2)
    expect(state.agents.a1.steps).toEqual([])
    const after = run([status('a1', 'running')], state)
    expect(after.agents.a1.tag).toBe('running')
    expect(error).toHaveBeenCalled()
    error.mockRestore()
  })

  it('logs and skips an unknown event type', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const before = run([plan([{ id: 'a1', type: 'research' }])])
    const after = reduce(before, { type: 'heartbeat', seq: 2, ts: '' } as unknown as ConsoleEvent, 1000)
    expect(after).toBe(before)
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})
