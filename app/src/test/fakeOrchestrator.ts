import { vi } from 'vitest'
import type { OrchestratorEvent } from '@mock/orchestrator.js'

// A fake orchestrator for component tests: each test sets what a call returns and emits events by hand.
// The real mock is never loaded.
let listener: ((event: OrchestratorEvent) => void) | null = null

export const fakeOrchestrator = {
  subscribe: vi.fn((cb: (event: OrchestratorEvent) => void) => {
    listener = cb
    return () => {
      listener = null
    }
  }),
  start: vi.fn((_request?: string) => true),
  approve: vi.fn((_id: string) => true),
  edit: vi.fn((_id: string, _draft: unknown) => true),
  resolve: vi.fn((_id: string, _choice: unknown) => true),
  retry: vi.fn((_id: string) => true),
  reset: vi.fn(),
}

export const fakeModule = {
  DEFAULT_TASK: 'Default task',
  createMockOrchestrator: vi.fn(() => fakeOrchestrator),
}

export const emit = (event: object) => listener?.({ ts: '', ...event } as OrchestratorEvent)
