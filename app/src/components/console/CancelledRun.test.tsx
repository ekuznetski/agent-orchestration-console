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
const panel = () => within(screen.getByRole('complementary', { name: 'Decisions waiting for you' }))

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
      receipt: null,
      edits: {},
      answers: {},
      request: 'Second request',
      speed: 4,
      jitter: true,
    })
    expect(screen.getByTestId('run-summary').textContent).toContain('Starting')
  })
})
