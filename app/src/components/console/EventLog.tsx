import type { OrchestratorEvent } from '@mock/orchestrator.js'
import { useEffect, useState } from 'react'
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
  const [copy, setCopy] = useState<'idle' | 'copied' | 'failed'>('idle')

  // The copy result shows for 2 s, then the button reads Copy JSON again.
  useEffect(() => {
    if (copy === 'idle') return
    const timer = setTimeout(() => setCopy('idle'), 2000)
    return () => clearTimeout(timer)
  }, [copy])

  const copyJson = () =>
    navigator.clipboard
      .writeText(
        JSON.stringify(
          log.map((entry) => entry.event),
          null,
          2,
        ),
      )
      .then(
        () => setCopy('copied'),
        () => setCopy('failed'),
      )
  const lateCount = log.filter((entry) => entry.late).length

  return (
    <section aria-label="Event log" className="flex flex-col gap-2 border-t px-4 pt-2 pb-4">
      <div className="flex items-center justify-between">
        <span className="text-muted-foreground text-xs">
          {log.length} events received{lateCount > 0 && ` - ${lateCount} arrived late`}. Arrival order; late: delivered after an event with
          a higher seq.
        </span>
        <Button
          variant="link"
          size="xs"
          className="text-foreground decoration-input hover:decoration-foreground h-auto min-w-24 justify-end p-0 text-xs font-semibold underline underline-offset-[3px]"
          onClick={() => void copyJson()}
        >
          {copy === 'copied' ? 'Copied' : copy === 'failed' ? 'Copy failed' : 'Copy JSON'}
        </Button>
      </div>
      <div className="h-56 overflow-auto rounded-md border">
        {/* Fixed layout with set column widths, so a long payload truncates instead of widening the table. */}
        <table className="w-full table-fixed font-mono text-xs">
          <thead className="bg-muted text-muted-foreground sticky top-0 text-left font-sans font-semibold">
            <tr className="[&>th]:px-3 [&>th]:py-2">
              <th className="w-12">#</th>
              <th className="w-20">seq</th>
              <th className="w-44">type</th>
              <th className="w-40">agent</th>
              <th>detail</th>
            </tr>
          </thead>
          <tbody>
            {log.map(({ event, late }, i) => {
              const failed = event.type === 'agent_status' && event.state === 'failed'
              return (
                <tr
                  key={i}
                  className={`border-t [&>td]:px-3 [&>td]:py-1.5 ${failed ? 'bg-failed-tint text-failed' : late ? 'bg-needs-tint' : ''}`}
                >
                  <td>{i + 1}</td>
                  <td>
                    {event.seq}
                    {late && <span className="text-needs-ink ml-1.5 font-sans font-semibold">late</span>}
                  </td>
                  <td>{event.type}</td>
                  <td>{'agentId' in event ? event.agentId : ''}</td>
                  <td className="truncate" title={summaryOf(event)}>
                    {summaryOf(event)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}
