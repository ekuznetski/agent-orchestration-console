import { beforeEach, describe, expect, it } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import type { OrchestratorEvent } from '@mock/orchestrator.js'
import fixture from '../../../fixtures/events.json'
import { initialState, type ConsoleEvent } from './console.reducer'
import { useConsoleStore } from './console.store'
import { shownDecisionNow, useShownDecision, useVisibleReceipt } from './hooks'
import { useViewStore } from './view.store'

const events = fixture as OrchestratorEvent[]
const apply = (list: ConsoleEvent[]) => act(() => list.forEach((event) => useConsoleStore.getState().apply(event)))
const upTo = (seq: number) => events.slice(0, events.findIndex((e) => e.seq === seq) + 1)
const receipt = { agentId: 'agent_drafting', kind: 'approve' as const, waitingAtAction: [] }

beforeEach(() => {
  useConsoleStore.setState(initialState)
  useViewStore.getState().runReset()
})

describe('which decision the panel shows', () => {
  it('shows the selected agent while it is in the queue, otherwise the first in the queue', () => {
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

  it('hides the receipt once the run has ended with an empty queue', () => {
    apply(upTo(20))
    act(() => useViewStore.getState().setReceipt(receipt))
    const { result } = renderHook(() => useVisibleReceipt())
    expect(result.current).toEqual(receipt)
    apply(events.slice(upTo(20).length))
    expect(result.current).toBeNull()
  })

  it('shownDecisionNow puts the receipt agent first, then the shown decision', () => {
    apply(upTo(25))
    act(() => useViewStore.getState().select('agent_scheduling'))
    expect(shownDecisionNow()).toBe('agent_scheduling')
    act(() => useViewStore.getState().setReceipt(receipt))
    expect(shownDecisionNow()).toBe('agent_drafting')
  })

  it('select clears the receipt, pin keeps it', () => {
    act(() => useViewStore.getState().setReceipt(receipt))
    act(() => useViewStore.getState().pin('agent_scheduling'))
    expect(useViewStore.getState()).toMatchObject({ selectedId: 'agent_scheduling', receipt })
    act(() => useViewStore.getState().select('agent_research'))
    expect(useViewStore.getState()).toMatchObject({ selectedId: 'agent_research', receipt: null })
  })
})
