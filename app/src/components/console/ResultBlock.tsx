import { CircleCheck, CircleX, LoaderCircle } from 'lucide-react'
import type { ResultEvent } from '@mock/orchestrator.js'
import { Badge } from '@/components/ui/badge'
import { resultKindLabel } from '@/config/agentTags'
import { useConsoleStore } from '@/store/console.store'
import { canRetryFromResult, isDegraded, isRetryingFromResult } from '@/store/selectors'
import { RetryButton } from './RetryButton'

/** The latest aggregate, above the agents. A newer result replaces it in place; a status newer
 * than the result dims it as "Updating" until then. Texts are shown verbatim. */
export function ResultBlock() {
  const result = useConsoleStore((state) => state.result)
  const cancelled = useConsoleStore((state) => state.status === 'cancelled')
  const total = useConsoleStore((state) => state.plan?.order.length ?? 0)
  // Primitives only, so an event for an agent outside the error items does not re-render the block.
  const canRetry = useConsoleStore((state) =>
    (state.result?.event.items ?? []).some((item) => item.kind === 'error' && canRetryFromResult(state, item.agentId)),
  )
  const anyRetrying = useConsoleStore((state) =>
    (state.result?.event.items ?? []).some((item) => item.kind === 'error' && isRetryingFromResult(state, item.agentId)),
  )
  if (!result) return null

  const degraded = isDegraded(result.event)
  // A cancelled run will not update the result: it keeps its own heading, not "Updating".
  const updating = result.outdated && !cancelled
  const head = updating ? 'Updating' : degraded ? 'Partial result' : 'Complete'
  const look = updating
    ? { band: 'bg-muted border-border', ink: 'text-foreground', Icon: LoaderCircle, icon: 'text-foreground motion-safe:animate-spin' }
    : degraded
      ? { band: 'bg-failed-tint border-failed', ink: 'text-failed', Icon: CircleX, icon: 'text-failed' }
      : { band: 'bg-done-tint border-done', ink: 'text-done-ink', Icon: CircleCheck, icon: 'text-done' }
  // One line under the heading, truncated, so a change of note never changes the block's height.
  const note = cancelled
    ? 'From before the run was cancelled.'
    : canRetry
      ? 'An agent failed. Retry it to update this result.'
      : anyRetrying
        ? 'Retrying... This result updates when the agent finishes.'
        : !degraded && !updating
          ? `All ${total} agents finished`
          : null

  return (
    <section
      aria-label="Result"
      data-version={result.version}
      className="bg-card shadow-raised flex flex-col overflow-hidden rounded-lg border border-input"
    >
      <div className={`border-b px-5 pt-5 pb-4 ${look.band}`}>
        <div className="flex items-center gap-3">
          <look.Icon aria-hidden="true" strokeWidth={1.5} className={`size-9 shrink-0 ${look.icon}`} />
          <div className="min-w-0">
            <h2 className={`text-heading font-semibold tracking-[-0.01em] ${look.ink}`}>{head}</h2>
            {note && (
              <p className={`truncate text-sm ${look.ink}`} title={note}>
                {note}
              </p>
            )}
          </div>
        </div>
        <p className={`mt-4 text-xl font-medium ${updating ? 'text-muted-foreground' : ''}`}>{result.event.summary}</p>
      </div>
      <ul className={`m-0 list-none px-4 pt-1 pb-3 ${updating ? 'opacity-60' : ''}`}>
        {result.event.items.map((item) => (
          <ResultItem key={item.id} item={item} />
        ))}
      </ul>
    </section>
  )
}

/** One item of the result; it reads only its own agent. */
function ResultItem({ item }: { item: ResultEvent['items'][number] }) {
  const label = useConsoleStore((state) => state.agents[item.agentId].label)
  const retryable = useConsoleStore((state) => item.kind === 'error' && canRetryFromResult(state, item.agentId))
  const retrying = useConsoleStore((state) => item.kind === 'error' && isRetryingFromResult(state, item.agentId))
  return (
    <li className="grid grid-cols-[7.5rem_minmax(0,1fr)] gap-x-4 border-t py-3 first:border-t-0">
      <div className="flex flex-col">
        <span className={`text-xs font-semibold ${item.kind === 'error' ? 'text-failed' : 'text-muted-foreground'}`}>
          {resultKindLabel(item.kind)}
        </span>
        <span className="text-faint text-xs">{label}</span>
      </div>
      <div className="flex flex-col text-sm">
        <b className={`font-semibold ${item.kind === 'error' ? 'text-failed' : ''}`}>{item.title}</b>
        <span>{item.detail}</span>
        {item.sources && item.sources.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {item.sources.map((source) => (
              <Badge key={source} variant="outline" className="bg-card text-muted-foreground">
                {source}
              </Badge>
            ))}
          </div>
        )}
        {retryable && (
          <div className="pt-2">
            <RetryButton agentId={item.agentId} label="Retry agent" />
          </div>
        )}
        {retrying && <div className="text-muted-foreground flex h-11 items-center pt-2">Retrying...</div>}
      </div>
    </li>
  )
}
