import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { useConsoleStore } from '@/store/console.store'
import { shownDecisionNow } from '@/store/hooks'
import { waitingQueue } from '@/store/selectors'
import { useViewStore } from '@/store/view.store'
import { retry } from '@/subscriptionManager/subscription'

export const REFUSED = 'The agent did not accept this action'

/** The one Retry, used by the decision panel and the partial result. It shows a receipt only when the
 * panel is about that agent or already shows a receipt, so a retry from the result never replaces
 * another agent's open decision. */
export function RetryButton({ agentId, label = 'Retry' }: { agentId: string; label?: string }) {
  const [refused, setRefused] = useState(false)

  const onClick = () => {
    const state = useConsoleStore.getState()
    const view = useViewStore.getState()
    const waitingAtAction = waitingQueue(state).filter((id) => id !== agentId)
    const panelIsAboutIt = shownDecisionNow() === agentId || view.receipt !== null
    const attempt = state.agents[agentId].attempts[state.agents[agentId].attempts.length - 1].n + 1
    const accepted = retry(agentId)
    setRefused(!accepted)
    if (accepted && panelIsAboutIt) view.setReceipt({ agentId, kind: 'retry', attempt, waitingAtAction })
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <Button onClick={onClick}>{label}</Button>
      {refused && <span style={{ color: 'var(--tone-danger)' }}>{REFUSED}</span>}
    </div>
  )
}
