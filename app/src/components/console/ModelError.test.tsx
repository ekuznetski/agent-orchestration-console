import { beforeEach, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { initialState, type ConsoleEvent } from '@/store/console.reducer'
import { useConsoleStore } from '@/store/console.store'
import { AgentList } from './AgentCard'
import { TopBar } from './TopBar'

vi.mock('@mock/orchestrator.js', async () => (await import('@/test/fakeOrchestrator')).fakeModule)

const apply = (event: object) => act(() => useConsoleStore.getState().apply({ ts: '', ...event } as ConsoleEvent))

beforeEach(() => useConsoleStore.setState(initialState))

it('warns in the top bar when a handler throws, and later events still apply', () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  render(
    <>
      <TopBar />
      <AgentList />
    </>,
  )
  apply({ type: 'plan', seq: 1, runId: 'r', task: 'T', subtasks: [{ id: 'a1', type: 'research', label: 'A' }] })
  expect(screen.queryByText('The screen may not match what the agents did')).toBeNull()

  // An agent outside the plan makes the step handler throw.
  apply({ type: 'agent_step', seq: 2, agentId: 'ghost', act: 'read', detail: 'x' })
  expect(screen.getByText('The screen may not match what the agents did')).toBeTruthy()

  apply({ type: 'agent_status', seq: 3, agentId: 'a1', state: 'running', statusLine: 'Working on it' })
  expect(screen.getByTestId('agent-status-line').textContent).toBe('Working on it')
  expect(screen.getByText('The screen may not match what the agents did')).toBeTruthy()
  error.mockRestore()
})
