import { resultKindLabel } from '@/config/agentTags'
import { useConsoleStore } from '@/store/console.store'
import { useWaitingQueue } from '@/store/hooks'
import { isDegraded } from '@/store/selectors'
import { RetryButton } from './RetryButton'

/** The latest aggregate, above the agents. A newer result replaces it in place; a status newer
 * than the result dims it as "Updating" until then. Texts are shown verbatim. */
export function ResultBlock() {
  const result = useConsoleStore((state) => state.result)
  const agents = useConsoleStore((state) => state.agents)
  const cancelled = useConsoleStore((state) => state.status === 'cancelled')
  const queue = useWaitingQueue()
  if (!result) return null
  const retryable = (agentId: string) => queue.includes(agentId) && agents[agentId].tag === 'failed'
  // Retried and not failed again: the row keeps its place with "Retrying..." until a newer result replaces it.
  // After a cancel nothing runs, so nothing is retrying.
  const retrying = (agentId: string) => !cancelled && agents[agentId].actions.at(-1)?.kind === 'retry' && !retryable(agentId)
  const errors = result.event.items.filter((item) => item.kind === 'error')
  const canRetry = errors.some((item) => retryable(item.agentId))
  const anyRetrying = errors.some((item) => retrying(item.agentId))

  const degraded = isDegraded(result.event)
  // A cancelled run will not update the result: it keeps its own heading, not "Updating".
  const updating = result.outdated && !cancelled
  const head = updating ? 'Updating' : degraded ? 'Partial result' : 'Complete'
  const headColor = !updating && degraded ? 'var(--tone-danger)' : undefined

  return (
    <section aria-label="Result" data-version={result.version} className="bg-muted flex flex-col gap-2 rounded-md border p-3">
      <h2 className="text-base font-bold" style={{ color: headColor }}>
        {head}
      </h2>
      {cancelled && <p className="text-muted-foreground">From before the run was cancelled.</p>}
      {(canRetry || anyRetrying) && (
        <p className="text-muted-foreground">
          {canRetry ? 'An agent failed. Retry it to update this result.' : 'Retrying... This result updates when the agent finishes.'}
        </p>
      )}
      <div className={updating ? 'flex flex-col gap-2 opacity-50' : 'flex flex-col gap-2'}>
        <p>{result.event.summary}</p>
        {result.event.items.map((item) => (
          <div key={item.id} className="grid grid-cols-[7rem_minmax(0,1fr)] gap-2 border-t pt-1.5">
            <span
              className="text-[11px] tracking-wide uppercase"
              style={{ color: item.kind === 'error' ? 'var(--tone-danger)' : 'var(--tone-neutral)' }}
            >
              {resultKindLabel(item.kind)}
            </span>
            <div className="flex flex-col gap-0.5">
              <b>{item.title}</b>
              <span className="text-muted-foreground">{item.detail}</span>
              {item.sources && item.sources.length > 0 && (
                <span className="text-muted-foreground text-xs">Sources: {item.sources.join(', ')}</span>
              )}
              {item.kind === 'error' && retryable(item.agentId) && (
                <div className="pt-1">
                  <RetryButton agentId={item.agentId} label="Retry agent" />
                </div>
              )}
              {item.kind === 'error' && retrying(item.agentId) && (
                <div className="text-muted-foreground flex h-9 items-center pt-1">Retrying...</div>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
