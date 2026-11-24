import { useShallow } from 'zustand/react/shallow'
import type { RunState } from './console.reducer'
import { useConsoleStore } from './console.store'
import { decisionQueue, phaseOf, runHeader } from './selectors'
import { useViewStore, type Receipt } from './view.store'

/** One agent by reference: an event for another agent does not re-render the reader. */
export const useAgent = (id: string) => useConsoleStore((state) => state.agents[id])

export const useRunHeader = () => useConsoleStore(useShallow(runHeader))

export const useDecisionQueue = () => useConsoleStore(useShallow(decisionQueue))

function pickShown(queue: string[], selectedId: string | null): string | null {
  return selectedId !== null && queue.includes(selectedId) ? selectedId : (queue[0] ?? null)
}

/** After the run has ended with an empty queue the panel shows "Nothing needs you right now". */
function runEndedEmpty(state: RunState): boolean {
  const phase = phaseOf(state)
  return (phase === 'completed' || phase === 'partial' || phase === 'cancelled') && decisionQueue(state).length === 0
}

function visibleReceipt(state: RunState, receipt: Receipt | null): Receipt | null {
  return runEndedEmpty(state) ? null : receipt
}

/** The selected agent while it is still in the queue, otherwise the first in the queue. */
export function useShownDecision(): string | null {
  const queue = useDecisionQueue()
  const selectedId = useViewStore((state) => state.selectedId)
  return pickShown(queue, selectedId)
}

export function useVisibleReceipt(): Receipt | null {
  const receipt = useViewStore((state) => state.receipt)
  return useConsoleStore((state) => visibleReceipt(state, receipt))
}

/** Whether the panel is about this agent: the receipt's agent first, then the shown decision. */
export function useIsShown(id: string): boolean {
  const receipt = useVisibleReceipt()
  const shown = useShownDecision()
  return (receipt?.agentId ?? shown) === id
}

/** The same answer as useIsShown, read at call time (for click handlers). */
export function shownDecisionNow(): string | null {
  const state = useConsoleStore.getState()
  const view = useViewStore.getState()
  return visibleReceipt(state, view.receipt)?.agentId ?? pickShown(decisionQueue(state), view.selectedId)
}
