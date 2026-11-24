import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { emit as emitRaw, fakeOrchestrator } from '@/test/fakeOrchestrator'
import { reset, start } from '@/subscriptionManager/subscription'
import { AgentList } from './AgentCard'
import { DecisionPanel } from './DecisionPanel'

vi.mock('@mock/orchestrator.js', async () => (await import('@/test/fakeOrchestrator')).fakeModule)

const emit = (event: object) => act(() => emitRaw(event))
const panel = () => within(screen.getByRole('complementary', { name: /^(Decisions waiting for you|Agent record)$/ }))
const click = (name: string | RegExp) => fireEvent.click(panel().getByRole('button', { name }))
const openCard = (id: string) => fireEvent.click(screen.getByTestId(`agent-card-${id}`))

let seq = 0
const next = () => ++seq
const status = (agentId: string, state: string, extra: object = {}) =>
  emit({ type: 'agent_status', seq: next(), agentId, state, statusLine: `${agentId} ${state}`, ...extra })
const step = (agentId: string) => emit({ type: 'agent_step', seq: next(), agentId, act: 'decided', detail: `${agentId} step` })
const confirmation = () =>
  emit({
    type: 'confirmation_required',
    seq: next(),
    agentId: 'drafting',
    action: 'send_email',
    target: 'maya@example.test',
    effectClass: 'irreversible',
    draft: { subject: 'Hello', body: 'Body text' },
  })
const escalation = () =>
  emit({
    type: 'escalation_required',
    seq: next(),
    agentId: 'scheduling',
    question: 'Which week?',
    context: 'C',
    options: [{ id: 'a', label: 'A' }],
  })

/** Research failed; with `waiting`, drafting asks to approve and scheduling asks a question. */
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
  status('research', 'failed', { error: { code: 'x', message: 'timed out', retryable: true } })
  status('drafting', 'running')
  status('scheduling', 'running')
  if (!waiting) return
  confirmation()
  escalation()
}

beforeEach(() => {
  vi.clearAllMocks()
  render(
    <>
      <AgentList />
      <DecisionPanel />
    </>,
  )
})

afterEach(() => {
  act(() => reset())
})

describe('agent record', () => {
  it('shows the approved email after the gate has closed', () => {
    setup()
    openCard('drafting')
    click('Approve and send')
    step('drafting')
    status('drafting', 'done')
    openCard('drafting')
    expect(panel().getByText('Agent record')).toBeTruthy()
    expect(panel().getByText('You approved (revision 1)')).toBeTruthy()
    expect(panel().getByText('maya@example.test')).toBeTruthy()
    expect(panel().getByText('Hello')).toBeTruthy()
    expect(panel().getByText('Body text')).toBeTruthy()
  })

  it('puts the result that arrives later below what the user did', () => {
    setup()
    openCard('drafting')
    click('Approve and send')
    status('drafting', 'done')
    openCard('drafting')
    const did = panel().getByRole('region', { name: 'What you did' })
    emit({
      type: 'result',
      seq: next(),
      summary: 'Partial',
      degraded: true,
      items: [{ id: 'm', agentId: 'drafting', kind: 'email_sent', title: 'Mail sent', detail: 'to Maya' }],
    })
    const result = panel().getByRole('region', { name: 'Result for this agent' })
    expect(did.compareDocumentPosition(result) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('stays open when a decision arrives, and the waiting count grows', () => {
    setup({ waiting: false })
    openCard('drafting')
    expect(panel().getByRole('button', { name: 'Back to decisions (1)' })).toBeTruthy()
    confirmation()
    expect(panel().getByText('Agent record')).toBeTruthy()
    expect(panel().getByRole('button', { name: 'Back to decisions (2)' })).toBeTruthy()
  })

  it('Back to decisions returns to the pinned decision', () => {
    setup()
    openCard('drafting')
    expect(panel().getByText('Send this email?')).toBeTruthy()
    status('research', 'running', { attempt: 2 })
    openCard('research')
    expect(panel().getByText('Agent record')).toBeTruthy()
    click(/Back to decisions/)
    expect(panel().getByText('Send this email?')).toBeTruthy()
  })

  it('records nothing for a refused command', () => {
    setup()
    openCard('drafting')
    fakeOrchestrator.approve.mockReturnValueOnce(false)
    click('Approve and send')
    status('drafting', 'done')
    openCard('drafting')
    expect(panel().getByText('You have not acted on this agent.')).toBeTruthy()
  })
})

describe('back to decisions', () => {
  it('shows no count when nothing waits', () => {
    setup({ waiting: false })
    status('research', 'running', { attempt: 2 })
    openCard('research')
    expect(panel().getByRole('button', { name: 'Back to decisions' })).toBeTruthy()
  })
})

describe('panel landmark', () => {
  it('is named after what it shows', () => {
    setup({ waiting: false })
    expect(screen.getByRole('complementary', { name: 'Decisions waiting for you' })).toBeTruthy()
    openCard('drafting')
    expect(screen.getByRole('complementary', { name: 'Agent record' })).toBeTruthy()
  })
})
