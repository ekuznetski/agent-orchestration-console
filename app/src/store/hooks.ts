import { useShallow } from 'zustand/react/shallow'
import { useConsoleStore } from './console.store'
import { runHeader, waitingQueue } from './selectors'
import { useViewStore, type Outcome } from './view.store'

/** One agent by reference: an event for another agent does not re-render the reader. */
export const useAgent = (id: string) => useConsoleStore((state) => state.agents[id])

export const useRunHeader = () => useConsoleStore(useShallow(runHeader))

export const useWaitingQueue = () => useConsoleStore(useShallow(waitingQueue))

function pickShown(queue: string[], selectedId: string | null): string | null {
  return selectedId !== null && queue.includes(selectedId) ? selectedId : (queue[0] ?? null)
}

/** The selected agent while the user can act on it, otherwise the first decision waiting. */
export function useShownDecision(): string | null {
  const queue = useWaitingQueue()
  const selectedId = useViewStore((state) => state.selectedId)
  return pickShown(queue, selectedId)
}

/** The outcome shows only in decisions mode; it stays until the user moves. */
export function useVisibleOutcome(): Outcome | null {
  return useViewStore((state) => (state.mode === 'decisions' ? state.outcome : null))
}

/** Whether the panel is about this agent: the open record's agent in agent mode, otherwise the outcome's
 * agent first, then the shown decision. */
export function useIsShown(id: string): boolean {
  const recordId = useViewStore((state) => (state.mode === 'agent' ? state.recordId : null))
  const outcome = useVisibleOutcome()
  const shown = useShownDecision()
  return (recordId ?? outcome?.agentId ?? shown) === id
}

/** The same answer as useIsShown, read at call time (for click handlers). */
export function shownDecisionNow(): string | null {
  const view = useViewStore.getState()
  if (view.mode === 'agent') return view.recordId
  return view.outcome?.agentId ?? pickShown(waitingQueue(useConsoleStore.getState()), view.selectedId)
}
