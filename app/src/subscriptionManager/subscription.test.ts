import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OrchestratorEvent } from '@mock/orchestrator.js'
import { createMockOrchestrator } from '@mock/orchestrator.js'
import { useConsoleStore } from '@/store/console.store'
import { pendingCommand } from '@/store/selectors'
import { useViewStore } from '@/store/view.store'
import { approve, cancel, edit, reset, resolve, retry, start } from './subscription'

// A fake orchestrator: the test sets what each call returns and emits events by hand.
// Only our manager is under test here, never the mock.
const fake = vi.hoisted(() => {
  const calls: string[] = []
  let listener: ((event: unknown) => void) | null = null
  const orchestrator = {
    subscribe: vi.fn((cb: (event: unknown) => void) => {
      calls.push('subscribe')
      listener = cb
      return orchestrator.unsubscribe
    }),
    unsubscribe: vi.fn(() => calls.push('unsubscribe')),
    start: vi.fn((_request?: string) => {
      calls.push('start')
      return true
    }),
    approve: vi.fn((_id: string) => true),
    edit: vi.fn((_id: string, _draft: unknown) => true),
    resolve: vi.fn((_id: string, _choice: unknown) => true),
    retry: vi.fn((_id: string) => true),
    reset: vi.fn(() => calls.push('reset')),
  }
  return { orchestrator, calls, emit: (event: unknown) => listener?.(event) }
})

// A complete fake module: the real mock is never loaded here. Everything else is imported as types only.
vi.mock('@mock/orchestrator.js', () => ({
  DEFAULT_TASK: 'Default task',
  createMockOrchestrator: vi.fn(() => fake.orchestrator),
}))

const emit = (event: object) => fake.emit({ ts: '', ...event } as OrchestratorEvent)
const drafting = () => useConsoleStore.getState().agents.agent_drafting

function startWithGate(): void {
  start('Task', 4, true)
  emit({ type: 'plan', seq: 1, runId: 'r', task: 'Task', subtasks: [{ id: 'agent_drafting', type: 'drafting', label: 'Draft' }] })
  emit({
    type: 'confirmation_required',
    seq: 2,
    agentId: 'agent_drafting',
    action: 'send_email',
    target: 't',
    effectClass: 'irreversible',
    draft: { subject: 'S', body: 'B' },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  fake.calls.length = 0
})

afterEach(() => reset())

describe('start', () => {
  it('creates the orchestrator with speed and jitter and subscribes before start', () => {
    expect(start('Research Northwind', 0.25, true)).toBe(true)
    expect(createMockOrchestrator).toHaveBeenCalledWith({ speed: 0.25, jitter: true })
    expect(fake.calls).toEqual(['subscribe', 'start'])
    expect(fake.orchestrator.start).toHaveBeenCalledWith('Research Northwind')
  })

  it('a second start stops the previous run first', () => {
    start('First', 1, false)
    start('Second', 1, false)
    expect(fake.calls).toEqual(['subscribe', 'start', 'unsubscribe', 'reset', 'subscribe', 'start'])
  })

  it("returns the orchestrator's refusal", () => {
    fake.orchestrator.start.mockReturnValueOnce(false)
    expect(start('Task', 1, false)).toBe(false)
  })

  it('puts delivered events into the run store', () => {
    startWithGate()
    expect(useConsoleStore.getState().log.map((entry) => entry.event.seq)).toEqual([1, 2])
    expect(drafting().tag).toBe('needs_approval')
  })
})

describe('commands', () => {
  it('records a command only when the orchestrator accepts it', () => {
    startWithGate()
    fake.orchestrator.approve.mockReturnValueOnce(false)
    expect(approve('agent_drafting')).toBe(false)
    expect(drafting().actions).toEqual([])
    expect(approve('agent_drafting')).toBe(true)
    expect(drafting().actions).toEqual([{ kind: 'approve', afterSeq: 2 }])
  })

  it('reads afterSeq before the call, so an answer delivered inside the call still answers the command', () => {
    startWithGate()
    fake.orchestrator.approve.mockImplementationOnce(() => {
      emit({ type: 'agent_step', seq: 3, agentId: 'agent_drafting', act: 'decided', detail: 'Approved' })
      return true
    })
    expect(approve('agent_drafting')).toBe(true)
    expect(drafting().actions).toEqual([{ kind: 'approve', afterSeq: 2 }])
    expect(pendingCommand(drafting())).toBeNull()
  })

  it('does not call the orchestrator for a command while one is pending, and reports it as in flight', () => {
    startWithGate()
    expect(approve('agent_drafting')).toBe(true)
    expect(approve('agent_drafting')).toBe(true)
    expect(fake.orchestrator.approve).toHaveBeenCalledTimes(1)
    expect(drafting().actions).toHaveLength(1)
  })

  it('passes edit, resolve and retry through to the orchestrator', () => {
    startWithGate()
    const draft = { subject: 'S2', body: 'B2' }
    expect(edit('agent_drafting', draft)).toBe(true)
    expect(fake.orchestrator.edit).toHaveBeenCalledWith('agent_drafting', draft)
    emit({
      type: 'confirmation_required',
      seq: 3,
      agentId: 'agent_drafting',
      action: 'send_email',
      target: 't',
      effectClass: 'irreversible',
      draft,
    })
    expect(resolve('agent_drafting', 'week_of_9_mar')).toBe(true)
    expect(fake.orchestrator.resolve).toHaveBeenCalledWith('agent_drafting', 'week_of_9_mar')
    emit({ type: 'agent_step', seq: 4, agentId: 'agent_drafting', act: 'decided', detail: 'd' })
    expect(retry('agent_drafting')).toBe(true)
    expect(fake.orchestrator.retry).toHaveBeenCalledWith('agent_drafting')
  })
})

describe('cancel and reset', () => {
  it('cancel unsubscribes, resets the orchestrator, keeps the screen and edits, clears the receipt', () => {
    startWithGate()
    useViewStore.getState().setEdit('agent_drafting', { draft: { body: 'y' } })
    useViewStore.getState().setReceipt({ agentId: 'agent_drafting', kind: 'approve', waitingAtAction: [] })
    cancel()
    expect(fake.calls.slice(-2)).toEqual(['unsubscribe', 'reset'])
    expect(useConsoleStore.getState().status).toBe('cancelled')
    expect(useConsoleStore.getState().log).toHaveLength(2)
    expect(useViewStore.getState()).toMatchObject({ receipt: null, runs: 1, edits: { agent_drafting: { draft: { body: 'y' } } } })
    expect(approve('agent_drafting')).toBe(false)
    expect(fake.orchestrator.approve).not.toHaveBeenCalled()
  })

  it('start clears screen state and counts the run; reset clears both stores and keeps request, speed, jitter', () => {
    const view = useViewStore.getState()
    view.select('agent_drafting')
    view.setReceipt({ agentId: 'agent_drafting', kind: 'approve', waitingAtAction: [] })
    view.setEdit('agent_drafting', { draft: { body: 'x' } })
    view.setAnswer('agent_scheduling', { optionId: null, words: 'w', use: 'words' })
    view.setRequest('Kept request')
    view.setSpeed(4)
    view.setJitter(true)

    startWithGate()
    expect(useViewStore.getState()).toMatchObject({ selectedId: null, receipt: null, edits: {}, answers: {}, runs: 1 })

    reset()
    expect(fake.calls.slice(-2)).toEqual(['unsubscribe', 'reset'])
    expect(useConsoleStore.getState()).toMatchObject({ status: 'idle', plan: null, log: [] })
    expect(useViewStore.getState()).toMatchObject({
      selectedId: null,
      receipt: null,
      edits: {},
      answers: {},
      runs: 0,
      request: 'Kept request',
      speed: 4,
      jitter: true,
    })
  })
})
