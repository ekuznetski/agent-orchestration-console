import { beforeEach, describe, expect, it } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import type { OrchestratorEvent } from '@mock/orchestrator.js'
import fixture from '../../../fixtures/events.json'
import { initialState, type ConsoleEvent } from './console.reducer'
import { useConsoleStore } from './console.store'
import { shownDecisionNow, useShownDecision, useVisibleOutcome } from './hooks'
import { useViewStore } from './view.store'

const events = fixture as OrchestratorEvent[]
const apply = (list: ConsoleEvent[]) => act(() => list.forEach((event) => useConsoleStore.getState().apply(event)))
const upTo = (seq: number) => events.slice(0, events.findIndex((e) => e.seq === seq) + 1)
const outcome = { agentId: 'agent_drafting', kind: 'approve' as const }

beforeEach(() => {
  useConsoleStore.setState(initialState)
  useViewStore.getState().runReset()
})

describe('which decision the panel shows', () => {
  it('shows the selected agent while the user can act on it, otherwise the first waiting', () => {
    // Up to seq 20: research has retried (not in the queue), drafting waits for approval.
    apply(upTo(20))
    const { result } = renderHook(() => useShownDecision())
    expect(result.current).toBe('agent_drafting')
    act(() => useViewStore.getState().select('agent_research'))
    expect(result.current).toBe('agent_drafting')
    apply(upTo(25).slice(upTo(20).length))
    act(() => useViewStore.getState().select('agent_scheduling'))
    expect(result.current).toBe('agent_scheduling')
  })

  it('keeps the outcome after the run has ended; only the user moves it', () => {
    apply(upTo(20))
    act(() => useViewStore.getState().setOutcome(outcome))
    const { result } = renderHook(() => useVisibleOutcome())
    expect(result.current).toEqual(outcome)
    apply(events.slice(upTo(20).length))
    expect(result.current).toEqual(outcome)
  })

  it('shownDecisionNow puts the outcome agent first, then the shown decision', () => {
    apply(upTo(25))
    act(() => useViewStore.getState().select('agent_scheduling'))
    expect(shownDecisionNow()).toBe('agent_scheduling')
    act(() => useViewStore.getState().setOutcome(outcome))
    expect(shownDecisionNow()).toBe('agent_drafting')
  })

  it('select clears the outcome, pin keeps it', () => {
    act(() => useViewStore.getState().setOutcome(outcome))
    act(() => useViewStore.getState().pin('agent_scheduling'))
    expect(useViewStore.getState()).toMatchObject({ selectedId: 'agent_scheduling', outcome })
    act(() => useViewStore.getState().select('agent_research'))
    expect(useViewStore.getState()).toMatchObject({ selectedId: 'agent_research', outcome: null })
  })
})
