import { CircleCheck, CircleX, LoaderCircle } from 'lucide-react'
import type { ResultEvent } from '@mock/orchestrator.js'
import { Badge } from '@/components/ui/badge'
import { resultKindLabel } from '@/config/agentTags'
import { useConsoleStore } from '@/store/console.store'
import { canRetryFromResult, isDegraded, isRetryingFromResult } from '@/store/selectors'
import { useViewStore } from '@/store/view.store'
import { RetryButton } from './RetryButton'
import { ClampedText } from './ClampedText'

/** The latest aggregate, full width above the agents and the panel. A newer result replaces it in place; a status newer
 * than the result dims it as "Updating" until then. Texts are shown verbatim. */
export function ResultBlock() {
  const result = useConsoleStore((state) => state.result)
  const cancelled = useConsoleStore((state) => state.status === 'cancelled')
  const total = useConsoleStore((state) => state.plan?.order.length ?? 0)
  // Primitives only, so an event for an agent outside the error items does not re-render the block.
  const canRetry = useConsoleStore((state) =>
    (state.result?.event.items ?? []).some((item) => item.kind === 'error' && canRetryFromResult(state, item.agentId)),
  )
  // While a retry from the result runs: which attempt of which agent, as one string (a primitive).
  const retrying = useConsoleStore((state) => {
    const item = (state.result?.event.items ?? []).find((item) => item.kind === 'error' && isRetryingFromResult(state, item.agentId))
    if (!item) return null
    const agent = state.agents[item.agentId]
    // The attempt the accepted Retry started, known before the agent reports it.
    const sent = agent.actions.findLast((action) => action.kind === 'retry')
    return `attempt ${sent?.kind === 'retry' ? sent.attempt : agent.attempts[agent.attempts.length - 1].n} of ${agent.label}`
  })
  if (!result) return null

  const degraded = isDegraded(result.event)
  // A cancelled run will not update the result: it keeps its own heading, not "Updating".
  const updating = result.outdated && !cancelled
  const head = cancelled ? 'Run cancelled' : updating ? 'Updating' : degraded ? 'Partial result' : 'Complete'
  const look = cancelled
    ? { band: 'bg-muted border-input', ink: 'text-foreground', Icon: CircleX, icon: 'text-muted-foreground' }
    : updating
      ? { band: 'bg-muted border-border', ink: 'text-foreground', Icon: LoaderCircle, icon: 'text-foreground motion-safe:animate-spin' }
      : degraded
        ? { band: 'bg-failed-tint border-failed', ink: 'text-failed', Icon: CircleX, icon: 'text-failed' }
        : { band: 'bg-done-tint border-done', ink: 'text-done-ink', Icon: CircleCheck, icon: 'text-done' }
  // One line under the heading, truncated, so a change of note never changes the block's height.
  const failedCount = result.event.items.filter((item) => item.kind === 'error').length
  const note = cancelled
    ? `This is the result from before the run was cancelled.${failedCount > 0 ? ` ${failedCount} of ${total} agents had failed.` : ''}`
    : canRetry
      ? `${failedCount} of ${total} agents failed - retry ${failedCount === 1 ? 'it' : 'them'} to complete the result`
      : retrying
        ? `This result is outdated - ${retrying} is running`
        : !degraded && !updating
          ? `All ${total} agents finished${result.version > 1 ? '. Updated after retry.' : ''}`
          : null

  return (
    <section
      aria-label="Result"
      data-version={result.version}
      className="bg-card shadow-raised flex flex-col overflow-hidden rounded-lg border border-input [overflow-wrap:anywhere]"
    >
      <div className={`border-b px-6 pt-6 pb-[22px] ${look.band}`}>
        <div className="flex items-center gap-3.5">
          <look.Icon aria-hidden="true" strokeWidth={1.5} className={`size-10 shrink-0 ${look.icon}`} />
          <div className="min-w-0">
            <h2 className={`text-heading font-semibold tracking-[-0.01em] ${look.ink}`}>{head}</h2>
            {note && <ClampedText text={note} lines={1} className={`text-sm leading-5 ${look.ink}`} />}
          </div>
        </div>
        <p className={`mt-[18px] mb-0 max-w-[64ch] text-xl leading-[30px] font-medium ${updating ? 'opacity-72' : ''}`}>
          {result.event.summary}
        </p>
      </div>
      <ul className={`m-0 list-none px-4 pt-1 pb-3 ${updating ? 'opacity-72' : ''}`}>
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
  const openRecord = useViewStore((state) => state.openRecord)
  const error = item.kind === 'error'
  return (
    <li className={`grid grid-cols-[148px_minmax(0,1fr)] gap-x-4 gap-y-1 border-t py-3 ${error ? 'bg-failed-tint -mx-4 px-4' : ''}`}>
      <div className="flex flex-col items-start">
        <span className={`text-xs leading-[19px] font-semibold ${error ? 'text-failed' : 'text-muted-foreground'}`}>
          {resultKindLabel(item.kind)}
        </span>
        {error ? (
          <ClampedText text={label} lines={1} className="text-faint max-w-full text-xs" />
        ) : (
          // The agent's label opens its record in the panel.
          <button
            type="button"
            className="text-faint decoration-input hover:decoration-foreground max-w-full text-left text-xs underline underline-offset-2"
            onClick={() => openRecord(item.agentId)}
          >
            <ClampedText text={label} lines={1} />
          </button>
        )}
      </div>
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col text-sm leading-[21px]">
          <ClampedText text={item.title} lines={1} className={`font-semibold ${error ? 'text-failed' : ''}`} />
          {/* At most three lines: a detail can echo a long draft field; the full text is in the tooltip and the record. */}
          <ClampedText text={item.detail} lines={3} />
          {item.sources && item.sources.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {item.sources.map((source) => (
                <Badge key={source} variant="outline" className="bg-card text-muted-foreground h-[22px] px-2.5">
                  {source}
                </Badge>
              ))}
            </div>
          )}
        </div>
        {/* Retry sits to the right of the error text. The slot has a fixed width, so "Retrying..." taking the
            button's place does not rewrap the text beside it. */}
        {error && (retryable || retrying) && (
          <div className="flex w-28 shrink-0 justify-end">
            {retryable && <RetryButton agentId={item.agentId} label="Retry" />}
            {retrying && <span className="text-muted-foreground flex h-9 items-center text-sm">Retrying...</span>}
          </div>
        )}
      </div>
    </li>
  )
}
