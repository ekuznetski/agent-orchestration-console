import { useState } from 'react'
import { useClearOnNextAction } from '@/hooks/useClearOnNextAction'
import { Button } from '@/components/ui/button'
import type { Action } from '@/store/console.reducer'
import { useConsoleStore } from '@/store/console.store'
import { shownDecisionNow } from '@/store/hooks'
import { useViewStore } from '@/store/view.store'
import { retry } from '@/subscriptionManager/subscription'

export const REFUSED = 'The agent did not accept this action'

/** The one Retry, used by the decision panel and the partial result. It shows its outcome only when the
 * panel is about that agent or already shows an outcome, so a retry from the result never replaces
 * another agent's open decision. */
export function RetryButton({ agentId, label = 'Retry' }: { agentId: string; label?: string }) {
  const [refused, setRefused] = useState(false)
  useClearOnNextAction(refused, () => setRefused(false))

  const onClick = () => {
    const view = useViewStore.getState()
    // Outcomes only in decisions mode: an open record is never replaced.
    const panelIsAboutIt = view.mode === 'decisions' && (shownDecisionNow() === agentId || view.outcome !== null)
    const result = retry(agentId)
    setRefused(result === 'refused')
    if (result !== 'sent' || !panelIsAboutIt) return
    // Only a retry actually sent shows its outcome, with the attempt the manager recorded: send() applies
    // command_sent before it returns 'sent', so the agent's last action is this retry.
    const sent = useConsoleStore.getState().agents[agentId].actions.at(-1) as Extract<Action, { kind: 'retry' }>
    view.setOutcome({ agentId, kind: 'retry', attempt: sent.attempt })
  }

  return (
    <div className="flex flex-col items-start gap-1">
      {/* The second click of a double click (detail > 1) is ignored, like every command button in the panel. */}
      <Button size="lg" onClick={(e) => e.detail <= 1 && onClick()}>
        {label}
      </Button>
      {refused && <span className="text-failed text-sm">{REFUSED}</span>}
    </div>
  )
}
