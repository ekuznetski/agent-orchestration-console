import { Profiler } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { act, render } from '@testing-library/react'
import { emit as emitRaw } from '@/test/fakeOrchestrator'
import { reset, start } from '@/subscriptionManager/subscription'
import { AgentCard } from './AgentCard'

vi.mock('@mock/orchestrator.js', async () => (await import('@/test/fakeOrchestrator')).fakeModule)

const emit = (event: object) => act(() => emitRaw(event))

afterEach(() => act(() => reset()))

it("does not re-render one agent's card for another agent's event", () => {
  act(() => {
    start('Task', 1, false)
  })
  emit({
    type: 'plan',
    seq: 1,
    runId: 'r',
    task: 'Task',
    subtasks: [
      { id: 'research', type: 'research', label: 'Research it' },
      { id: 'drafting', type: 'drafting', label: 'Draft it' },
    ],
  })
  const commits = { research: 0, drafting: 0 }
  // Unmounted before afterEach resets the run: in the app a new run remounts the cards by key.
  const { unmount } = render(
    <>
      <Profiler id="research" onRender={() => commits.research++}>
        <AgentCard id="research" />
      </Profiler>
      <Profiler id="drafting" onRender={() => commits.drafting++}>
        <AgentCard id="drafting" />
      </Profiler>
    </>,
  )
  const before = { ...commits }
  emit({ type: 'agent_status', seq: 2, agentId: 'research', state: 'running', statusLine: 'Searching' })
  emit({ type: 'agent_step', seq: 3, agentId: 'research', act: 'searched', detail: 'Slack' })
  expect(commits.research).toBeGreaterThan(before.research)
  expect(commits.drafting).toBe(before.drafting)
  unmount()
})
