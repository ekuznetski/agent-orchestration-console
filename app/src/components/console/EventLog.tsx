import type { OrchestratorEvent } from '@mock/orchestrator.js'
import { Button } from '@/components/ui/button'
import { useConsoleStore } from '@/store/console.store'

function summaryOf(event: OrchestratorEvent): string {
  switch (event.type) {
    case 'plan':
      return event.task
    case 'agent_status':
      return `${event.state}: ${event.statusLine}`
    case 'agent_step':
      return `${event.act}: ${event.detail}`
    case 'confirmation_required':
      return `${event.action} -> ${event.target} (${event.effectClass})`
    case 'escalation_required':
      return event.question
    case 'result':
      return event.summary
  }
}

/** Debug table of every event in arrival order; late rows marked, failure rows red. Raw ids only here. */
export function EventLog() {
  const log = useConsoleStore((state) => state.log)
  return (
    <div className="flex flex-col gap-1.5 border-b px-3.5 py-2">
      <div className="flex items-center justify-between">
        <span className="text-muted-foreground text-xs">Arrival order. Late: delivered after an event with a higher seq.</span>
        <Button
          variant="outline"
          size="xs"
          onClick={() =>
            void navigator.clipboard.writeText(
              JSON.stringify(
                log.map((entry) => entry.event),
                null,
                2,
              ),
            )
          }
        >
          Copy JSON
        </Button>
      </div>
      <div className="h-56 overflow-auto">
        <table className="w-full font-mono text-xs">
          <thead className="text-muted-foreground text-left">
            <tr>
              <th className="pr-3 font-normal">seq</th>
              <th className="pr-3 font-normal">type</th>
              <th className="pr-3 font-normal">agentId</th>
              <th className="pr-3 font-normal">late</th>
              <th className="font-normal">payload</th>
            </tr>
          </thead>
          <tbody>
            {log.map(({ event, late }, i) => {
              const failed = event.type === 'agent_status' && event.state === 'failed'
              return (
                <tr key={i} style={failed ? { color: 'var(--tone-danger)' } : undefined}>
                  <td className="pr-3">{event.seq}</td>
                  <td className="pr-3">{event.type}</td>
                  <td className="pr-3">{'agentId' in event ? event.agentId : ''}</td>
                  <td className="pr-3">{late ? 'late' : ''}</td>
                  <td className="truncate">{summaryOf(event)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
