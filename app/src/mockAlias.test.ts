import { expect, it } from 'vitest'
import { createMockOrchestrator, type OrchestratorEvent } from '@mock/orchestrator.js'

it('loads the mock through @mock and receives the plan as the first event', async () => {
  const orc = createMockOrchestrator({ speed: 4 })
  const first = new Promise<OrchestratorEvent>((done) => {
    const off = orc.subscribe((e) => {
      off()
      done(e)
    })
  })
  orc.start()
  const event = await first
  orc.reset()
  expect(event.type).toBe('plan')
})
