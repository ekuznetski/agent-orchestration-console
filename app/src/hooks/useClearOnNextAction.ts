import { useEffect } from 'react'

/** While `active`, the user's next click or input anywhere calls `clear`, before that action's own handler runs
 * (capture phase), so the action may set the message again. Used for "the agent did not accept" messages. */
export function useClearOnNextAction(active: boolean, clear: () => void) {
  useEffect(() => {
    if (!active) return
    document.addEventListener('click', clear, { capture: true })
    document.addEventListener('input', clear, { capture: true })
    return () => {
      document.removeEventListener('click', clear, { capture: true })
      document.removeEventListener('input', clear, { capture: true })
    }
  }, [active, clear])
}
