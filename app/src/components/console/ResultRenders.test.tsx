import { Profiler } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { act, render } from '@testing-library/react'
import { emit as emitRaw } from '@/test/fakeOrchestrator'
import { reset, start } from '@/subscriptionManager/subscription'
import { ResultBlock } from './ResultBlock'

vi.mock('@mock/orchestrator.js', async () => (await import('@/test/fakeOrchestrator')).fakeModule)

const emit = (event: object) => act(() => emitRaw(event))

afterEach(() => act(() => reset()))

it('does not re-render the result for an event of an agent it does not show', () => {
  let commits = 0
  render(
    <Profiler id="result" onRender={() => commits++}>
      <ResultBlock />
    </Profiler>,
  )
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
  emit({ type: 'agent_status', seq: 2, agentId: 'research', state: 'done', statusLine: 'Done' })
  emit({ type: 'result', seq: 3, summary: 'S', items: [{ id: 'i', agentId: 'research', kind: 'summary', title: 'T', detail: 'D' }] })
  const afterResult = commits
  emit({ type: 'agent_step', seq: 4, agentId: 'drafting', act: 'read', detail: 'x' })
  expect(commits).toBe(afterResult)
})
