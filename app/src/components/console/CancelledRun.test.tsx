import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { emit as emitRaw, fakeOrchestrator } from '@/test/fakeOrchestrator'
import { useConsoleStore } from '@/store/console.store'
import { useViewStore } from '@/store/view.store'
import { reset, start } from '@/subscriptionManager/subscription'
import App from '@/App'

vi.mock('@mock/orchestrator.js', async () => (await import('@/test/fakeOrchestrator')).fakeModule)

const emit = (event: object) => act(() => emitRaw(event))
const card = (id: string) => within(screen.getByTestId(`agent-card-${id}`))
const panel = () => within(screen.getByRole('complementary', { name: /^(Decisions waiting for you|Agent record)$/ }))

/** Drafting waits for approval, scheduling is running, research is done. */
function setup() {
  act(() => {
    start('First request', 2, true)
  })
  emit({
    type: 'plan',
    seq: 1,
    runId: 'r',
    task: 'First request',
    subtasks: [
      { id: 'research', type: 'research', label: 'Research it' },
      { id: 'drafting', type: 'drafting', label: 'Draft it' },
      { id: 'scheduling', type: 'scheduling', label: 'Schedule it' },
    ],
  })
  emit({ type: 'agent_status', seq: 2, agentId: 'research', state: 'done', statusLine: 'Research finished' })
  emit({ type: 'agent_status', seq: 3, agentId: 'drafting', state: 'running', statusLine: 'Paused for approval' })
  emit({
    type: 'confirmation_required',
    seq: 4,
    agentId: 'drafting',
    action: 'send_email',
    target: 't@example.test',
    effectClass: 'irreversible',
    draft: { subject: 'S', body: 'B' },
  })
  emit({ type: 'agent_status', seq: 5, agentId: 'scheduling', state: 'running', statusLine: 'Checking calendars' })
}

beforeEach(() => {
  vi.clearAllMocks()
  act(() => useViewStore.getState().runReset())
  render(<App />)
})

afterEach(() => act(() => reset()))

describe('cancel and run again', () => {
  it('keeps the screen, marks unfinished agents cancelled and empties the decision queue', () => {
    setup()
    expect(panel().getByText('Send this email?')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel run' }))

    expect(fakeOrchestrator.reset).toHaveBeenCalled()
    expect(card('research').getByTestId('agent-badge').textContent).toBe('Done')
    expect(card('drafting').getByTestId('agent-badge').textContent).toBe('Cancelled')
    expect(card('drafting').getByTestId('agent-status-line').textContent).toBe('Last status: Paused for approval')
    expect(card('scheduling').getByTestId('agent-status-line').textContent).toBe('Last status: Checking calendars')
    expect(panel().getByText('Nothing needs you right now')).toBeTruthy()
    expect(panel().getByText('The run was cancelled.')).toBeTruthy()
    expect(screen.getByTestId('run-summary').textContent).toContain('Run cancelled')
    expect(screen.getByRole('button', { name: 'Run again' })).toBeTruthy()
    // No control that sends a command is left, so the manager needs no guard for a missing orchestrator.
    expect(screen.queryByRole('button', { name: /^(Approve|Edit|Send answer|Retry)/ })).toBeNull()
    fireEvent.click(screen.getByTestId('agent-card-drafting'))
    expect(screen.queryByRole('button', { name: /^(Approve|Edit|Send answer|Retry)/ })).toBeNull()
  })

  it('keeps an open agent record when the run is cancelled', () => {
    setup()
    fireEvent.click(screen.getByTestId('agent-card-research'))
    expect(panel().getByText('Agent record')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel run' }))
    expect(panel().getByText('Agent record')).toBeTruthy()
  })

  it('Run again starts with the edited request and clears screen state, keeping request, speed and jitter', () => {
    setup()
    act(() => {
      const view = useViewStore.getState()
      view.setEdit('drafting', { draft: { body: 'x' } })
      view.setAnswer('scheduling', { optionId: null, words: 'w', use: 'words' })
    })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel run' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Request' }), { target: { value: 'Second request' } })
    act(() => {
      useViewStore.getState().setSpeed(4)
      useViewStore.getState().setJitter(true)
    })
    fireEvent.click(screen.getByRole('button', { name: 'Run again' }))

    expect(fakeOrchestrator.start).toHaveBeenLastCalledWith('Second request')
    expect(useConsoleStore.getState()).toMatchObject({ status: 'idle', plan: null, log: [] })
    expect(useViewStore.getState()).toMatchObject({
      mode: 'decisions',
      selectedId: null,
      recordId: null,
      outcome: null,
      edits: {},
      answers: {},
      request: 'Second request',
      speed: 4,
      jitter: true,
    })
    expect(screen.getByTestId('run-summary').textContent).toContain('Starting')
  })

  it('Run again refused by the mock goes back to the start card with a message', () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel run' }))
    fakeOrchestrator.start.mockReturnValueOnce(false)
    fireEvent.click(screen.getByRole('button', { name: 'Run again' }))
    expect(screen.getByRole('heading', { name: 'What should the agents do?' })).toBeTruthy()
    expect(screen.getByText('The orchestrator did not start the run.')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Start run' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('Cancel before the plan arrives shows the cancelled state, not Planning...', () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel run' }))
    fireEvent.click(screen.getByRole('button', { name: 'Run again' }))
    expect(screen.getByText('Planning...')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel run' }))
    expect(screen.queryByText('Planning...')).toBeNull()
    expect(screen.getByText('The run was cancelled before the plan arrived.')).toBeTruthy()
    expect(screen.getByTestId('run-summary').textContent).toBe('Run cancelled')
    expect(panel().getByText('The run was cancelled.')).toBeTruthy()
  })

  it('the console has one h1', () => {
    setup()
    expect(screen.getAllByRole('heading', { level: 1 }).map((h) => h.textContent)).toEqual(['Agent orchestration console'])
  })

  it('Cancel during a retry after a partial result: the result keeps its own heading, no retrying note or row', () => {
    setup()
    emit({
      type: 'agent_status',
      seq: 6,
      agentId: 'research',
      state: 'failed',
      statusLine: 'Failed',
      error: { code: 'x', message: 'm', retryable: true },
    })
    emit({ type: 'agent_status', seq: 7, agentId: 'drafting', state: 'done', statusLine: 'Sent' })
    emit({ type: 'agent_status', seq: 8, agentId: 'scheduling', state: 'done', statusLine: 'Held' })
    emit({
      type: 'result',
      seq: 9,
      summary: 'Partial',
      degraded: true,
      items: [{ id: 'e', agentId: 'research', kind: 'error', title: 'Research failed', detail: 'jira timed out' }],
    })
    const result = within(screen.getByRole('region', { name: 'Result' }))
    fireEvent.click(result.getByRole('button', { name: 'Retry agent' }))
    emit({ type: 'agent_status', seq: 10, agentId: 'research', state: 'running', statusLine: 'Retrying', attempt: 2 })
    expect(result.getByText('Updating')).toBeTruthy()
    expect(result.getByText('Retrying...')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Cancel run' }))
    expect(result.getByRole('heading', { name: 'Partial result' })).toBeTruthy()
    expect(result.getByText('From before the run was cancelled.')).toBeTruthy()
    expect(result.queryByText('Updating')).toBeNull()
    expect(result.queryByText(/Retrying/)).toBeNull()
    expect(result.queryByRole('button', { name: 'Retry agent' })).toBeNull()
  })

  it('an accepted Retry on a partial result makes the run active again; the clock skips the idle time', () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] })
    vi.setSystemTime(0)
    setup()
    act(() => vi.setSystemTime(5_000))
    emit({
      type: 'agent_status',
      seq: 6,
      agentId: 'research',
      state: 'failed',
      statusLine: 'Failed',
      error: { code: 'x', message: 'm', retryable: true },
    })
    emit({ type: 'agent_status', seq: 7, agentId: 'drafting', state: 'done', statusLine: 'Sent' })
    emit({ type: 'agent_status', seq: 8, agentId: 'scheduling', state: 'done', statusLine: 'Held' })
    emit({
      type: 'result',
      seq: 9,
      summary: 'Partial',
      degraded: true,
      items: [{ id: 'e', agentId: 'research', kind: 'error', title: 'Research failed', detail: 'jira timed out' }],
    })
    expect(screen.getByTestId('run-summary').textContent).toContain('took 0:05')
    expect(screen.getByRole('button', { name: 'Run again' })).toBeTruthy()

    act(() => vi.advanceTimersByTime(60_000))
    fireEvent.click(within(screen.getByRole('region', { name: 'Result' })).getByRole('button', { name: 'Retry agent' }))
    // Accepted, the agent has not answered yet: the run is active.
    expect(screen.getByRole('button', { name: 'Cancel run' })).toBeTruthy()
    expect(screen.getByRole('checkbox', { name: 'Jitter' }).getAttribute('data-disabled')).not.toBeNull()
    expect(screen.getByTestId('run-summary').textContent).toContain('0:05 into the run')
    act(() => vi.advanceTimersByTime(2_000))
    expect(screen.getByTestId('run-summary').textContent).toContain('0:07 into the run')
    vi.useRealTimers()
  })

  it('announces the phase, counts and need-you politely, but not the ticking clock', () => {
    setup()
    const live = [...screen.getByTestId('run-summary').querySelectorAll('[aria-live="polite"]')].map((el) => el.textContent)
    expect(live).toEqual(['Running- 1 of 3 done', '1 needs you'])
    expect(live.join(' ')).not.toContain('into the run')
  })

  it('shows a spinner from Run again until the plan arrives, and while the run works', () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel run' }))
    fireEvent.click(screen.getByRole('button', { name: 'Run again' }))
    const summary = within(screen.getByTestId('run-summary'))
    expect(summary.getByText('Starting')).toBeTruthy()
    expect(summary.getByRole('status', { name: 'Loading' })).toBeTruthy()
    expect(within(screen.getByText('Planning...')).getByRole('status', { name: 'Loading' })).toBeTruthy()
    emit({ type: 'plan', seq: 1, runId: 'r2', task: 'T', subtasks: [{ id: 'research', type: 'research', label: 'Research it' }] })
    emit({ type: 'agent_status', seq: 2, agentId: 'research', state: 'running', statusLine: 'Working' })
    expect(summary.getByText('Running')).toBeTruthy()
    expect(summary.getByRole('status', { name: 'Loading' })).toBeTruthy()
  })
})
