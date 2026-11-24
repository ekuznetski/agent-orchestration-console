import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { emit as emitRaw, fakeOrchestrator } from '@/test/fakeOrchestrator'
import { reset, start } from '@/subscriptionManager/subscription'
import { AgentList } from './AgentCard'
import { DecisionPanel } from './DecisionPanel'
import { ResultBlock } from './ResultBlock'

vi.mock('@mock/orchestrator.js', async () => (await import('@/test/fakeOrchestrator')).fakeModule)

// "Would it survive a fourth agent type?" (mock/README.md): an agent of a type the console has no words for goes
// through its whole life next to the three usual agents, with an unknown act, action, effect class and result kind.

const emit = (event: object) => act(() => emitRaw(event))
const panel = () => within(screen.getByRole('complementary', { name: /^(Decisions|Agent record)$/ }))
const card = (id: string) => within(screen.getByTestId(`agent-card-${id}`))
const badge = (id: string) => card(id).getByTestId('agent-badge').textContent
const click = (name: string | RegExp) => fireEvent.click(panel().getByRole('button', { name }))
let seq = 0
const next = () => ++seq
const status = (agentId: string, state: string, extra: object = {}) =>
  emit({ type: 'agent_status', seq: next(), agentId, state, statusLine: `${agentId} ${state}`, ...extra })
const step = (agentId: string, act: string, detail: string) => emit({ type: 'agent_step', seq: next(), agentId, act, detail })

/** The three usual agents stay as they were: research running, drafting and scheduling queued. */
function usualUnaffected() {
  expect(badge('agent_research')).toBe('Running')
  expect(badge('agent_drafting')).toBe('Queued')
  expect(badge('agent_scheduling')).toBe('Queued')
}

beforeEach(() => {
  vi.clearAllMocks()
  render(
    <>
      <ResultBlock />
      <AgentList />
      <DecisionPanel />
    </>,
  )
})

afterEach(() => act(() => reset()))

it('a fourth agent of an unknown type goes through its whole life; the usual three are unaffected', () => {
  act(() => {
    start('Task', 1, false)
  })
  seq = 0
  emit({
    type: 'plan',
    seq: next(),
    runId: 'r',
    task: 'Task',
    subtasks: [
      { id: 'agent_research', type: 'research', label: 'Research the Northwind renewal' },
      { id: 'agent_drafting', type: 'drafting', label: 'Draft a follow-up to Maya Chen' },
      { id: 'agent_scheduling', type: 'scheduling', label: 'Find time for a call next week' },
      { id: 'agent_billing', type: 'billing', label: 'Reconcile invoices' },
    ],
  })
  status('agent_research', 'running')
  status('agent_billing', 'running')

  // Its card: its label; an unknown act word in its trace verbatim.
  expect(card('agent_billing').getByText('Reconcile invoices')).toBeTruthy()
  step('agent_billing', 'reconciled', 'Matched 12 of 14 invoices')
  fireEvent.click(card('agent_billing').getByRole('button', { name: /Show steps/ }))
  const trace = () => within(card('agent_billing').getByTestId('agent-trace'))
  // An unknown act is capitalized for display, like the known ones.
  expect(trace().getByText('Reconciled:')).toBeTruthy()
  expect(trace().getByText(/Matched 12 of 14 invoices/)).toBeTruthy()
  usualUnaffected()

  // A confirmation with an unknown action, effect class and extra draft keys.
  emit({
    type: 'confirmation_required',
    seq: next(),
    agentId: 'agent_billing',
    action: 'issue_refund',
    target: 'acct_42',
    effectClass: 'financial',
    draft: { body: 'Refund the duplicate charge.', amount: 120, currency: 'EUR' },
  })
  expect(panel().getByText('Approve issue_refund?')).toBeTruthy()
  // An unknown effect class is named and treated as the worst case: the danger tone.
  const effect = panel().getByText('Unknown effect "financial". Assume it cannot be undone')
  expect(effect.className).toContain('text-failed')
  expect(panel().getByText('amount')).toBeTruthy()
  expect(panel().getByText('120')).toBeTruthy()
  expect(panel().getByText('EUR')).toBeTruthy()
  click('Approve')
  expect(fakeOrchestrator.approve).toHaveBeenCalledWith('agent_billing')
  usualUnaffected()

  // An escalation with its own options, answered with a picked option, then again with typed words.
  step('agent_billing', 'refunded', 'Refund issued')
  const escalation = () =>
    emit({
      type: 'escalation_required',
      seq: next(),
      agentId: 'agent_billing',
      question: 'Which ledger?',
      context: 'Two ledgers match.',
      options: [
        { id: 'ledger_eu', label: 'EU ledger' },
        { id: 'ledger_us', label: 'US ledger' },
      ],
    })
  escalation()
  fireEvent.click(card('agent_billing').getByRole('button', { name: 'Decision in the panel' }))
  fireEvent.click(panel().getByText('EU ledger'))
  click('Send answer')
  expect(fakeOrchestrator.resolve).toHaveBeenCalledWith('agent_billing', 'ledger_eu')
  step('agent_billing', 'decided', 'You chose: EU ledger')
  escalation()
  fireEvent.click(card('agent_billing').getByRole('button', { name: 'Decision in the panel' }))
  fireEvent.change(panel().getByLabelText('Or answer in your own words'), { target: { value: 'Use the EU ledger for both' } })
  click('Send answer')
  expect(fakeOrchestrator.resolve).toHaveBeenLastCalledWith('agent_billing', 'Use the EU ledger for both')
  usualUnaffected()

  // A retryable failure: Retry sends retry('agent_billing'), and attempt 2 is traced separately.
  status('agent_billing', 'failed', { error: { code: 'timeout', message: 'ledger timed out', retryable: true } })
  expect(badge('agent_billing')).toBe('Failed')
  fireEvent.click(card('agent_billing').getByRole('button', { name: 'Retry in the panel' }))
  click('Retry')
  expect(fakeOrchestrator.retry).toHaveBeenCalledWith('agent_billing')
  status('agent_billing', 'running', { attempt: 2 })
  step('agent_billing', 'reconciled', 'Matched 14 of 14 invoices')
  expect(trace().getByText('Attempt 1')).toBeTruthy()
  expect(trace().getByText('Attempt 2')).toBeTruthy()
  status('agent_billing', 'done')
  usualUnaffected()

  // A result item of an unknown kind renders under the result and in the agent's record.
  emit({
    type: 'result',
    seq: next(),
    summary: 'Invoices reconciled.',
    items: [{ id: 'b', agentId: 'agent_billing', kind: 'ledger_update', title: 'Ledger updated', detail: '14 invoices matched' }],
  })
  const result = within(screen.getByRole('region', { name: 'Result' }))
  expect(result.getByText('Ledger updated')).toBeTruthy()
  expect(result.getByText('ledger_update')).toBeTruthy()
  fireEvent.click(screen.getByTestId('agent-card-agent_billing'))
  expect(panel().getByText('Agent record')).toBeTruthy()
  expect(panel().getByText('Agent')).toBeTruthy()
  expect(panel().getByText('Ledger updated')).toBeTruthy()
  expect(panel().getByText('ledger_update')).toBeTruthy()
  const record = panel().getByText('Effect "financial", unknown to this console')
  expect(record.className).toContain('text-failed')
  usualUnaffected()
})
