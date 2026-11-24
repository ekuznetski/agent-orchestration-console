import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { emit as emitRaw, fakeOrchestrator } from '@/test/fakeOrchestrator'
import { reset, start } from '@/subscriptionManager/subscription'
import { AgentList } from './AgentCard'
import { DecisionPanel } from './DecisionPanel'
import { ResultBlock } from './ResultBlock'

vi.mock('@mock/orchestrator.js', async () => (await import('@/test/fakeOrchestrator')).fakeModule)

const emit = (event: object) => act(() => emitRaw(event))
const panel = () => within(screen.getByRole('complementary', { name: /^(Decisions|Agent record)$/ }))
const click = (name: string | RegExp) => fireEvent.click(panel().getByRole('button', { name }))
const openCard = (id: string) => fireEvent.click(screen.getByTestId(`agent-card-${id}`))
const outcome = () => panel().getByRole('status')

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
      <AgentList />
      <DecisionPanel />
    </>,
  )
})

afterEach(() => {
  vi.useRealTimers()
  act(() => reset())
})

describe('approve', () => {
  it('shows the outcome after approve, and no Approve is left for a second click', () => {
    // The manager's own guard against a second command while one is pending is in subscription.test.ts.
    setup()
    openCard('drafting')
    expect(panel().getByText('Send this email?')).toBeTruthy()
    expect(panel().getByText('maya@example.test')).toBeTruthy()
    expect(panel().getByText('Be careful, this action cannot be undone')).toBeTruthy()
    const button = panel().getByRole('button', { name: 'Approve and send' })
    fireEvent.click(button)
    expect(fakeOrchestrator.approve).toHaveBeenCalledTimes(1)
    expect(button.isConnected).toBe(false)
    expect(panel().queryByRole('button', { name: 'Approve and send' })).toBeNull()
    expect(within(outcome()).getByText('Approved')).toBeTruthy()
    openCard('drafting')
    expect(panel().queryByRole('button', { name: 'Approve and send' })).toBeNull()
  })

  it('keeps the outcome while the agent answers and the run ends; the second line follows the agent', () => {
    setup()
    openCard('drafting')
    click('Approve and send')
    expect(outcome().textContent).toBe('Draft itApprovedWaiting for the agent to respond.')
    step('drafting')
    expect(outcome().textContent).toBe('Draft itApproveddrafting step')
    status('drafting', 'done')
    expect(outcome().textContent).toBe('Draft itApproveddrafting done')
  })

  it('the card badge says Waiting for agent while the command is on its way, then follows the agent', () => {
    setup()
    const badge = () => within(screen.getByTestId('agent-card-drafting')).getByTestId('agent-badge')
    expect(badge().textContent).toBe('Needs approval')
    openCard('drafting')
    click('Approve and send')
    expect(badge().textContent).toBe('Waiting for agent')
    step('drafting')
    expect(badge().textContent).toBe('Running')
  })

  it('a pending edit says Waiting for agent until the agent asks again', () => {
    setup()
    const badge = () => within(screen.getByTestId('agent-card-drafting')).getByTestId('agent-badge')
    openCard('drafting')
    click('Edit email')
    fireEvent.change(panel().getByLabelText('Subject'), { target: { value: 'Changed' } })
    click('Save changes')
    expect(badge().textContent).toBe('Waiting for agent')
    step('drafting')
    expect(badge().textContent).toBe('Waiting for agent')
    confirmation({ revision: 2 })
    expect(badge().textContent).toBe('Needs approval')
  })

  it('a card click on an agent whose command is pending opens its record, not its decision', () => {
    setup()
    openCard('drafting')
    click('Approve and send')
    openCard('drafting')
    expect(panel().getByText('Agent record')).toBeTruthy()
    expect(panel().queryByRole('button', { name: 'Approve and send' })).toBeNull()
  })
})

describe('edit', () => {
  it('keeps typed text across switching, sends the edit, waits, then opens the re-asked confirmation', () => {
    setup()
    openCard('drafting')
    click('Edit email')
    expect(panel().getByText('Nothing is sent yet. You approve the edited email next.')).toBeTruthy()
    fireEvent.change(panel().getByLabelText('Subject'), { target: { value: 'New subject' } })
    openCard('scheduling')
    openCard('drafting')
    expect((panel().getByLabelText('Subject') as HTMLInputElement).value).toBe('New subject')

    fireEvent.change(panel().getByLabelText('Message'), { target: { value: '   ' } })
    expect((panel().getByRole('button', { name: 'Save changes' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(panel().getByLabelText('Message'), { target: { value: 'New body' } })
    click('Save changes')
    expect(fakeOrchestrator.edit).toHaveBeenCalledWith('drafting', { subject: 'New subject', body: 'New body' })
    // The waiting state: no status line, no Next decision for this agent (others may still be offered).
    expect(outcome().textContent).toBe('Draft itEdit submittedThe agent is preparing the edited email...')
    expect(panel().queryByRole('button', { name: 'Next decision: Draft it' })).toBeNull()

    step('drafting')
    expect(outcome().textContent).toBe('Draft itEdit submittedThe agent is preparing the edited email...')
    confirmation({ draft: { subject: 'New subject', body: 'New body' }, revision: 2 })
    // The answer to the user's own Save opens by itself, focused on the decision, not on Approve.
    expect(panel().getByText('Send the edited email?')).toBeTruthy()
    expect(document.activeElement).toBe(panel().getByRole('group', { name: 'Draft it' }))
    expect(panel().getByText('Edited version')).toBeTruthy()
    click('Approve and send')
    expect(fakeOrchestrator.approve).toHaveBeenCalledWith('drafting')
  })

  it('words each effect class as a sentence under the buttons; an unknown class as label: note', () => {
    setup()
    openCard('drafting')
    expect(panel().getByText('Be careful, this action cannot be undone')).toBeTruthy()
    confirmation({ effectClass: 'reversible' })
    expect(panel().getByText('You can undo this action later')).toBeTruthy()
    confirmation({ effectClass: 'read_only' })
    expect(panel().getByText('This action changes nothing')).toBeTruthy()
    confirmation({ effectClass: 'billing' })
    expect(panel().getByText('Side effect: the agent acts on your behalf')).toBeTruthy()
  })

  it('does not switch to the re-asked confirmation when the user moved away', () => {
    setup()
    openCard('drafting')
    click('Edit email')
    fireEvent.change(panel().getByLabelText('Subject'), { target: { value: 'Changed' } })
    click('Save changes')
    click('Next decision: Research it')
    expect(panel().getByText('Retry this agent?')).toBeTruthy()
    confirmation({ revision: 2 })
    expect(panel().getByText('Retry this agent?')).toBeTruthy()
  })

  it('ignores the second click of a double click on Approve and Edit', () => {
    setup()
    openCard('drafting')
    fireEvent.click(panel().getByRole('button', { name: 'Approve and send' }), { detail: 2 })
    fireEvent.click(panel().getByRole('button', { name: 'Edit email' }), { detail: 2 })
    expect(fakeOrchestrator.approve).not.toHaveBeenCalled()
    expect(panel().getByText('Send this email?')).toBeTruthy()
  })

  it('labels an unknown action generically and shows every draft field', () => {
    setup({ waiting: false })
    status('drafting', 'running')
    confirmation({ action: 'archive_ticket', effectClass: 'reversible', draft: { ticket: 'NW-1', body: 'Close it' } })
    openCard('drafting')
    expect(panel().getByText('Approve archive_ticket?')).toBeTruthy()
    expect(panel().getByText('Target')).toBeTruthy()
    expect(panel().queryByText('To')).toBeNull()
    expect(panel().getByRole('button', { name: 'Approve' })).toBeTruthy()
    expect(panel().getByRole('button', { name: 'Edit' })).toBeTruthy()
    expect(panel().getByText('ticket')).toBeTruthy()
    expect(panel().getByText('NW-1')).toBeTruthy()
  })
})

describe('answer a question', () => {
  it('keeps the picked option and the typed words across switching, and sends the option id', () => {
    setup()
    openCard('scheduling')
    fireEvent.click(panel().getByText('Week B'))
    fireEvent.change(panel().getByLabelText('Or answer in your own words'), { target: { value: 'Any week' } })
    openCard('drafting')
    openCard('scheduling')
    expect((panel().getByLabelText('Or answer in your own words') as HTMLInputElement).value).toBe('Any week')
    fireEvent.click(panel().getByText('Week B'))
    click('Send answer')
    expect(fakeOrchestrator.resolve).toHaveBeenCalledWith('scheduling', 'week_b')
    expect(panel().getByText('Answer sent: Week B')).toBeTruthy()
  })

  it('a second question from the same agent starts empty', () => {
    setup()
    openCard('scheduling')
    fireEvent.click(panel().getByText('Week B'))
    click('Send answer')
    status('scheduling', 'running')
    escalation()
    click('Next decision: Schedule it')
    expect((panel().getByRole('button', { name: 'Send answer' }) as HTMLButtonElement).disabled).toBe(true)
    expect(
      panel()
        .getByRole('radio', { name: /Week B/ })
        .getAttribute('aria-checked'),
    ).toBe('false')
  })

  it('gives the answer back to the picked option when the typed words are cleared', () => {
    setup()
    openCard('scheduling')
    fireEvent.click(panel().getByText('Week A'))
    const own = panel().getByLabelText('Or answer in your own words')
    fireEvent.change(own, { target: { value: 'x' } })
    expect((panel().getByRole('radio', { name: /Week A/ }) as HTMLElement).getAttribute('aria-checked')).toBe('false')
    fireEvent.change(own, { target: { value: '' } })
    expect((panel().getByRole('radio', { name: /Week A/ }) as HTMLElement).getAttribute('aria-checked')).toBe('true')
    expect((panel().getByRole('button', { name: 'Send answer' }) as HTMLButtonElement).disabled).toBe(false)
    click('Send answer')
    expect(fakeOrchestrator.resolve).toHaveBeenCalledWith('scheduling', 'week_a')
  })

  it('sends the trimmed own words when typing made them the answer', () => {
    setup()
    openCard('scheduling')
    fireEvent.click(panel().getByText('Week A'))
    fireEvent.change(panel().getByLabelText('Or answer in your own words'), { target: { value: '  Next Tuesday  ' } })
    click('Send answer')
    expect(fakeOrchestrator.resolve).toHaveBeenCalledWith('scheduling', 'Next Tuesday')
    expect(panel().getByText('Answer sent: Next Tuesday')).toBeTruthy()
  })
})

describe('retry', () => {
  it('retries from the panel and shows which attempt was sent', () => {
    setup()
    expect(panel().getByText('Retry this agent?')).toBeTruthy()
    expect(panel().getByText('The 1 step of attempt 1 stays in its trace. Retry starts attempt 2.')).toBeTruthy()
    click('Retry')
    expect(fakeOrchestrator.retry).toHaveBeenCalledWith('research')
    expect(outcome().textContent).toBe('Research itRetry sent: attempt 2Waiting for the agent to respond.')
    status('research', 'running', { attempt: 2 })
    expect(outcome().textContent).toBe('Research itRetry sent: attempt 2research running')
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
    expect(screen.getByText('1 of 3 agents failed - retry it to complete the result')).toBeTruthy()
    fireEvent.click(within(screen.getByRole('region', { name: 'Result' })).getByRole('button', { name: 'Retry' }))
    expect(fakeOrchestrator.retry).toHaveBeenCalledWith('research')
    expect(panel().getByText('Retry sent: attempt 2')).toBeTruthy()
    const result = within(screen.getByRole('region', { name: 'Result' }))
    expect(result.getByText('Retrying...')).toBeTruthy()
    expect(result.getByText('This result is outdated - attempt 2 of Research it is running')).toBeTruthy()
    status('research', 'running', { attempt: 2 })
    expect(result.getByText('Updating')).toBeTruthy()
    expect(result.getByText('Retrying...')).toBeTruthy()
    expect(result.getByText('This result is outdated - attempt 2 of Research it is running')).toBeTruthy()
  })
})

describe('refused command', () => {
  it('clears a refused Retry message from the result on the next action', () => {
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
    const result = within(screen.getByRole('region', { name: 'Result' }))
    fakeOrchestrator.retry.mockReturnValueOnce(false)
    fireEvent.click(result.getByRole('button', { name: 'Retry' }))
    expect(result.getByText('The agent did not accept this action')).toBeTruthy()
    fireEvent.click(screen.getByTestId('agent-card-drafting'))
    expect(result.queryByText('The agent did not accept this action')).toBeNull()
  })

  it('shows a message when the agent does not accept the command and clears it on the next action', () => {
    setup()
    openCard('drafting')
    fakeOrchestrator.approve.mockReturnValueOnce(false)
    click('Approve and send')
    expect(panel().getByText('The agent did not accept this action')).toBeTruthy()
    click('Edit email')
    expect(panel().queryByText('The agent did not accept this action')).toBeNull()
  })
})

describe('next decision', () => {
  it('offers the longest-waiting decision and never switches by itself', () => {
    vi.useFakeTimers()
    setup()
    click('Retry')
    act(() => vi.advanceTimersByTime(10_000))
    expect(panel().getByText('Retry sent: attempt 2')).toBeTruthy()
    click('Next decision: Draft it')
    expect(panel().getByText('Send this email?')).toBeTruthy()
  })

  it('shows no button while nothing waits; a decision that arrives adds the button and leaves the outcome', () => {
    setup({ waiting: false })
    click('Retry')
    expect(panel().queryByRole('button', { name: /^Next decision/ })).toBeNull()
    expect(panel().getByText('Nothing else needs you right now.')).toBeTruthy()
    status('drafting', 'running')
    confirmation()
    expect(panel().getByText('Retry sent: attempt 2')).toBeTruthy()
    expect(panel().getByRole('button', { name: 'Next decision: Draft it' })).toBeTruthy()
  })

  it('a decision that arrives does not replace the decision on screen', () => {
    setup({ waiting: false })
    expect(panel().getByText('Retry this agent?')).toBeTruthy()
    status('drafting', 'running')
    confirmation()
    expect(panel().getByText('Retry this agent?')).toBeTruthy()
  })
})

describe('focus', () => {
  it('moves to the editor on Edit, to the Next decision button after Save, to the decision on a card click', () => {
    setup()
    openCard('drafting')
    expect(document.activeElement).toBe(panel().getByRole('group', { name: 'Draft it' }))
    click('Edit email')
    expect(document.activeElement).toBe(panel().getByLabelText('Subject'))
    fireEvent.change(panel().getByLabelText('Subject'), { target: { value: 'Changed' } })
    click('Save changes')
    expect(document.activeElement).toBe(panel().getByRole('button', { name: 'Next decision: Research it' }))
  })

  it('keeps Save changes disabled until the draft differs from the current revision', () => {
    setup()
    openCard('drafting')
    click('Edit email')
    const save = () => panel().getByRole('button', { name: 'Save changes' }) as HTMLButtonElement
    expect(save().disabled).toBe(true)
    fireEvent.change(panel().getByLabelText('Subject'), { target: { value: 'Hello again' } })
    expect(save().disabled).toBe(false)
    fireEvent.change(panel().getByLabelText('Subject'), { target: { value: 'Hello' } })
    expect(save().disabled).toBe(true)
  })

  it('returns to the Edit button after Cancel edit', () => {
    setup()
    openCard('drafting')
    click('Edit email')
    click('Cancel edit')
    expect(document.activeElement).toBe(panel().getByRole('button', { name: 'Edit email' }))
  })

  it('moves to the outcome after approve when nothing else waits', () => {
    setup({ waiting: false })
    status('drafting', 'running')
    confirmation()
    click('Retry')
    click('Next decision: Draft it')
    click('Approve and send')
    expect(document.activeElement).toBe(outcome())
  })

  it('stays where the user put it when a decision opens in the empty panel', () => {
    start('Task', 1, false)
    seq = 1
    emit({ type: 'plan', seq: 1, runId: 'r', task: 'Task', subtasks: [{ id: 'drafting', type: 'drafting', label: 'Draft it' }] })
    status('drafting', 'running')
    const outside = screen.getByRole('button', { name: 'Show steps (0)' })
    outside.focus()
    confirmation()
    expect(panel().getByText('Send this email?')).toBeTruthy()
    expect(document.activeElement).toBe(outside)
  })
})
