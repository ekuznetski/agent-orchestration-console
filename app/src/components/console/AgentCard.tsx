import { useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { TAGS } from '@/config/agentTags'
import { useConsoleStore } from '@/store/console.store'
import { useAgent, useIsShown } from '@/store/hooks'
import { statusLineOf, waitingQueue } from '@/store/selectors'
import { useViewStore } from '@/store/view.store'
import { AgentTrace } from './AgentTrace'
import { StatusBadge } from './StatusBadge'

/** One agent: label, state badge, one status line, its trace on demand. Clicking the card opens its decision. */
export function AgentCard({ id }: { id: string }) {
  const agent = useAgent(id)
  // Waiting for the user and nothing sent yet; while a command is pending the card opens the record.
  const inQueue = useConsoleStore((state) => waitingQueue(state).includes(id))
  const shown = useIsShown(id)
  const select = useViewStore((state) => state.select)
  const openRecord = useViewStore((state) => state.openRecord)
  // An agent with an open decision shows that decision; any other agent opens its record.
  const openInPanel = () => (inQueue ? select(id) : openRecord(id))
  const [open, setOpen] = useState(false)

  const tone = TAGS[agent.tag].tone
  // Colour means state only: amber needs you, red failed; every other card has the neutral edge.
  const edge = tone === 'attention' ? 'border-needs-bar' : tone === 'danger' ? 'border-failed' : 'border-border'
  const link = tone === 'attention' ? 'bg-needs-bar' : tone === 'danger' ? 'bg-failed' : 'bg-input'
  const line = statusLineOf(agent) ?? ''
  const foot = inQueue ? (agent.tag === 'failed' ? 'Retry in the panel' : 'Decision in the panel') : 'Details in the panel'
  const linkButton =
    'text-foreground decoration-input hover:decoration-foreground inline-flex h-[19px] items-center gap-0.5 text-label underline underline-offset-[3px]'

  return (
    <div
      data-testid={`agent-card-${id}`}
      // The whole card is a mouse shortcut; the footer button is the keyboard and screen reader path,
      // so no interactive element is nested inside another.
      onClick={openInPanel}
      // One even 2px border for every state; selection only raises the card (shadow), so neither changes its size.
      className={`relative flex cursor-pointer flex-col rounded-lg border-2 ${edge} bg-card ${shown ? 'shadow-raised' : ''}`}
    >
      {shown && <span aria-hidden="true" className={`absolute top-1/2 -right-6.5 h-[3px] w-6 -translate-y-1/2 ${link}`} />}
      <div className="grid grid-cols-[minmax(0,1fr)_8rem] items-start gap-x-3 gap-y-0.5 px-4 pt-3 pb-2">
        <b className="truncate text-title font-semibold">{agent.label}</b>
        <div className="row-span-2 justify-self-end">
          <StatusBadge tag={agent.tag} testId="agent-badge" />
        </div>
        <div
          className={`h-[19px] truncate text-label ${agent.tag === 'failed' ? 'text-failed' : 'text-muted-foreground'}`}
          title={line}
          data-testid="agent-status-line"
        >
          {line}
        </div>
      </div>
      {open && <AgentTrace agent={agent} />}
      <div className="flex items-center justify-between px-4 pb-3">
        <button
          type="button"
          className={linkButton}
          onClick={(e) => {
            e.stopPropagation()
            setOpen(!open)
          }}
          aria-expanded={open}
        >
          {open ? 'Hide steps' : `Show steps (${agent.steps.length})`}
        </button>
        <button
          type="button"
          className={linkButton}
          aria-pressed={shown}
          onClick={(e) => {
            e.stopPropagation()
            openInPanel()
          }}
        >
          {foot}
          <ChevronRight aria-hidden="true" className="size-3.5" />
        </button>
      </div>
    </div>
  )
}

export function AgentList() {
  const order = useConsoleStore((state) => state.plan?.order)
  const cancelled = useConsoleStore((state) => state.status === 'cancelled')
  return (
    <div className="flex flex-col">
      <h2 className="text-muted-foreground mb-2 text-xs font-semibold">Agents - plan order</h2>
      {order ? (
        <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-3">
          {order.map((id) => (
            <AgentCard key={id} id={id} />
          ))}
        </div>
      ) : (
        <p className="text-muted-foreground">{cancelled ? 'The run was cancelled before the plan arrived.' : 'Planning...'}</p>
      )}
    </div>
  )
}
