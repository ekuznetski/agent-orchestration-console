import { resultKindLabel } from '@/config/agentTags'
import { useConsoleStore } from '@/store/console.store'
import { useDecisionQueue } from '@/store/hooks'
import { isDegraded } from '@/store/selectors'
import { RetryButton } from './RetryButton'

/** The latest aggregate, above the agents. A newer result replaces it in place; a status newer
 * than the result dims it as "Updating" until then. Texts are shown verbatim. */
export function ResultBlock() {
  const result = useConsoleStore((state) => state.result)
  const agents = useConsoleStore((state) => state.agents)
  const cancelled = useConsoleStore((state) => state.status === 'cancelled')
  const queue = useDecisionQueue()
  if (!result) return null
  const retryable = (agentId: string) => queue.includes(agentId) && agents[agentId].tag === 'failed'
  const canRetry = result.event.items.some((item) => item.kind === 'error' && retryable(item.agentId))

  const degraded = isDegraded(result.event)
  const head = result.outdated ? 'Updating' : degraded ? 'Partial result' : 'Complete'
  const headColor = !result.outdated && degraded ? 'var(--tone-danger)' : undefined

  return (
    <section aria-label="Result" className="bg-muted flex flex-col gap-2 rounded-md border p-3">
      <h2 className="text-base font-bold" style={{ color: headColor }}>
        {head}
      </h2>
      {cancelled && <p className="text-muted-foreground">From before the run was cancelled.</p>}
      {!result.outdated && canRetry && <p className="text-muted-foreground">An agent failed. Retry it to update this result.</p>}
      <div className={result.outdated ? 'flex flex-col gap-2 opacity-50' : 'flex flex-col gap-2'}>
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
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
