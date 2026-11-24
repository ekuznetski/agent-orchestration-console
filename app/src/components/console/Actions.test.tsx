import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { emit as emitRaw, fakeOrchestrator } from '@/test/fakeOrchestrator'
import { reset, start } from '@/subscriptionManager/subscription'
import { DecisionPanel } from './DecisionPanel'
import { ResultBlock } from './ResultBlock'

vi.mock('@mock/orchestrator.js', async () => (await import('@/test/fakeOrchestrator')).fakeModule)

const emit = (event: object) => act(() => emitRaw(event))
const panel = () => within(screen.getByRole('complementary', { name: 'Decisions waiting for you' }))
const click = (name: string | RegExp) => fireEvent.click(panel().getByRole('button', { name }))

let seq = 0
const next = () => ++seq
const status = (agentId: string, state: string, extra: object = {}) =>
  emit({ type: 'agent_status', seq: next(), agentId, state, statusLine: `${agentId} ${state}`, ...extra })
const step = (agentId: string) => emit({ type: 'agent_step', seq: next(), agentId, act: 'decided', detail: `${agentId} step` })
const confirmation = (extra: object = {}) =>
  emit({
    type: 'confirmation_required',
    seq: next(),
    agentId: 'drafting',
    action: 'send_email',
    target: 'maya@example.test',
    effectClass: 'irreversible',
    draft: { subject: 'Hello', body: 'Body text' },
    ...extra,
  })
const escalation = () =>
  emit({
    type: 'escalation_required',
    seq: next(),
    agentId: 'scheduling',
    question: 'Which week?',
    context: 'Context text',
    options: [
      { id: 'week_a', label: 'Week A', detail: 'Early' },
      { id: 'week_b', label: 'Week B', detail: 'Late' },
    ],
  })
const failure = () => status('research', 'failed', { error: { code: 'timeout', message: 'jira timed out', retryable: true } })

/** A run with three agents; by default all three wait: research failed, drafting asks to approve, scheduling asks a question. */
function setup({ waiting = true } = {}) {
  start('Task', 1, false)
  seq = 1
  emit({
    type: 'plan',
    seq: 1,
    runId: 'r',
    task: 'Task',
    subtasks: [
      { id: 'research', type: 'research', label: 'Research it' },
      { id: 'drafting', type: 'drafting', label: 'Draft it' },
      { id: 'scheduling', type: 'scheduling', label: 'Schedule it' },
    ],
  })
  status('research', 'running')
  step('research')
  failure()
  if (!waiting) return
  status('drafting', 'running')
  confirmation()
  status('scheduling', 'running')
  escalation()
}

beforeEach(() => {
  vi.clearAllMocks()
  render(
    <>
      <ResultBlock />
      <DecisionPanel />
    </>,
  )
})

afterEach(() => {
  vi.useRealTimers()
  act(() => reset())
})

describe('approve', () => {
  it('shows a receipt after approve and keeps it when the agent answers; a double click calls approve once', () => {
    setup()
    click('Next')
    expect(panel().getByText('Send this email?')).toBeTruthy()
    expect(panel().getByText('maya@example.test')).toBeTruthy()
    const button = panel().getByRole('button', { name: 'Approve and send' })
    fireEvent.click(button)
    fireEvent.click(button)
    expect(fakeOrchestrator.approve).toHaveBeenCalledTimes(1)
    expect(panel().getByText('Approved')).toBeTruthy()
    step('drafting')
    expect(panel().getByText('Approved')).toBeTruthy()
    expect(panel().getByText(/Up next:/)).toBeTruthy()
  })

  it('shows the receipt again when the user goes back to a decision whose approve is still pending', () => {
    setup()
    click('Next')
    click('Approve and send')
    click('Next: Research')
    expect(panel().getByText('Retry this agent?')).toBeTruthy()
    click('Next')
    expect(panel().getByText('Approved')).toBeTruthy()
    expect(panel().queryByRole('button', { name: 'Approve and send' })).toBeNull()
  })
})

describe('edit', () => {
  it('keeps typed text across switching, waits for the agent, then asks again with Approve in the same place', () => {
    setup()
    click('Next')
    click('Edit email')
    expect(panel().getByText('Nothing is sent yet. You approve the edited email next.')).toBeTruthy()
    fireEvent.change(panel().getByLabelText('Subject'), { target: { value: 'New subject' } })
    click('Next')
    click('Prev')
    expect((panel().getByLabelText('Subject') as HTMLInputElement).value).toBe('New subject')

    fireEvent.change(panel().getByLabelText('Message'), { target: { value: '   ' } })
    expect((panel().getByRole('button', { name: 'Save changes' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(panel().getByLabelText('Message'), { target: { value: 'New body' } })
    click('Save changes')
    expect(fakeOrchestrator.edit).toHaveBeenCalledWith('drafting', { subject: 'New subject', body: 'New body' })
    expect(panel().getByText('Edited version sent to the agent')).toBeTruthy()
    expect((panel().getByRole('button', { name: 'Waiting for the agent...' }) as HTMLButtonElement).disabled).toBe(true)

    step('drafting')
    click('Next')
    click('Prev')
    expect(panel().getByText('Edited version sent to the agent')).toBeTruthy()

    confirmation({ draft: { subject: 'New subject', body: 'New body' }, revision: 2 })
    expect(panel().getByText('Send the edited email?')).toBeTruthy()
    expect(panel().getByText('Edited version')).toBeTruthy()
    click('Approve and send')
    expect(fakeOrchestrator.approve).toHaveBeenCalledWith('drafting')
  })

  it('labels an unknown action generically and shows every draft field', () => {
    setup({ waiting: false })
    status('drafting', 'running')
    confirmation({ action: 'archive_ticket', effectClass: 'reversible', draft: { ticket: 'NW-1', body: 'Close it' } })
    click('Next')
    expect(panel().getByText('Approve this action?')).toBeTruthy()
    expect(panel().getByRole('button', { name: 'Approve' })).toBeTruthy()
    expect(panel().getByRole('button', { name: 'Edit' })).toBeTruthy()
    expect(panel().getByText('ticket')).toBeTruthy()
    expect(panel().getByText('NW-1')).toBeTruthy()
  })
})

describe('answer a question', () => {
  it('keeps the picked option and the typed words across switching, and sends the option id', () => {
    setup()
    click('Next')
    click('Next')
    fireEvent.click(panel().getByText('Week B'))
    fireEvent.change(panel().getByLabelText('Or answer in your own words'), { target: { value: 'Any week' } })
    click('Prev')
    click('Next')
    expect((panel().getByLabelText('Or answer in your own words') as HTMLInputElement).value).toBe('Any week')
    fireEvent.click(panel().getByText('Week B'))
    click('Send answer')
    expect(fakeOrchestrator.resolve).toHaveBeenCalledWith('scheduling', 'week_b')
    expect(panel().getByText('Answer sent: Week B')).toBeTruthy()
  })

  it('sends the trimmed own words when typing made them the answer', () => {
    setup()
    click('Next')
    click('Next')
    fireEvent.click(panel().getByText('Week A'))
    fireEvent.change(panel().getByLabelText('Or answer in your own words'), { target: { value: '  Next Tuesday  ' } })
    click('Send answer')
    expect(fakeOrchestrator.resolve).toHaveBeenCalledWith('scheduling', 'Next Tuesday')
    expect(panel().getByText('Answer sent: Next Tuesday')).toBeTruthy()
  })
})

describe('retry', () => {
  it('retries from the panel and shows which attempt runs', () => {
    setup()
    expect(panel().getByText('Retry this agent?')).toBeTruthy()
    expect(panel().getByText('The 1 steps of attempt 1 stay in its trace. Retry starts attempt 2.')).toBeTruthy()
    click('Retry')
    expect(fakeOrchestrator.retry).toHaveBeenCalledWith('research')
    expect(panel().getByText('Retried - attempt 2 is running')).toBeTruthy()
  })

  it('retries from the error item of a partial result', () => {
    setup()
    status('drafting', 'done')
    status('scheduling', 'done')
    emit({
      type: 'result',
      seq: next(),
      summary: 'Partial',
      degraded: true,
      items: [{ id: 'e', agentId: 'research', kind: 'error', title: 'Research failed', detail: 'jira timed out' }],
    })
    expect(screen.getByText('Partial result')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Retry agent' }))
    expect(fakeOrchestrator.retry).toHaveBeenCalledWith('research')
    expect(panel().getByText('Retried - attempt 2 is running')).toBeTruthy()
  })
})

describe('refused command', () => {
  it('shows a message when the agent does not accept the command and clears it on the next action', () => {
    setup()
    click('Next')
    fakeOrchestrator.approve.mockReturnValueOnce(false)
    click('Approve and send')
    expect(panel().getByText('The agent did not accept this action')).toBeTruthy()
    click('Edit email')
    expect(panel().queryByText('The agent did not accept this action')).toBeNull()
  })
})

describe('auto-advance', () => {
  it('opens the next decision after 3 s when it was already waiting when the user acted', () => {
    vi.useFakeTimers()
    setup()
    click('Retry')
    expect(panel().getByText('opens in 3 s')).toBeTruthy()
    act(() => vi.advanceTimersByTime(3000))
    expect(panel().getByText('Send this email?')).toBeTruthy()
  })

  it('stays on the receipt when the next decision opened after the user acted', () => {
    vi.useFakeTimers()
    setup({ waiting: false })
    click('Retry')
    status('drafting', 'running')
    confirmation()
    expect(panel().queryByText('opens in 3 s')).toBeNull()
    act(() => vi.advanceTimersByTime(3000))
    expect(panel().getByText('Retried - attempt 2 is running')).toBeTruthy()
    expect(panel().getByRole('button', { name: 'Next: Drafting' })).toBeTruthy()
  })
})
