import { useState } from 'react'
import { TAGS, toneBg, toneColor } from '@/config/agentTags'
import { useConsoleStore } from '@/store/console.store'
import { useAgent, useIsShown } from '@/store/hooks'
import { needsUser, statusLineOf } from '@/store/selectors'
import { useViewStore } from '@/store/view.store'
import { AgentTrace } from './AgentTrace'

/** One agent: label, state badge, one status line, its trace on demand. Clicking the card opens its decision. */
export function AgentCard({ id }: { id: string }) {
  const agent = useAgent(id)
  const inQueue = useConsoleStore((state) => state.status !== 'cancelled' && needsUser(state.agents[id]))
  const shown = useIsShown(id)
  const select = useViewStore((state) => state.select)
  const openRecord = useViewStore((state) => state.openRecord)
  // An agent with an open decision shows that decision; any other agent opens its record.
  const openInPanel = () => (inQueue ? select(id) : openRecord(id))
  const [open, setOpen] = useState(false)

  const tag = TAGS[agent.tag]
  const color = toneColor(tag.tone)
  const line = statusLineOf(agent) ?? ''
  const foot = inQueue ? (agent.tag === 'failed' ? 'Retry in the panel' : 'Decision in the panel') : 'Details in the panel'
  const selected = shown

  return (
    <div
      data-testid={`agent-card-${id}`}
      // The whole card is a mouse shortcut; the footer button is the keyboard and screen reader path,
      // so no interactive element is nested inside another.
      onClick={openInPanel}
      className="bg-card relative flex cursor-pointer flex-col gap-1 rounded-md border border-t-[3px] px-3 py-2.5"
      style={{ borderTopColor: color, boxShadow: selected ? `0 0 0 2px ${color}` : undefined }}
    >
      {selected && <span aria-hidden="true" className="absolute top-1/2 -right-3.5 w-3.5 border-t-2" style={{ borderColor: color }} />}
      <div className="grid grid-cols-[minmax(0,1fr)_8rem] items-center gap-2">
        <b className="truncate">{agent.label}</b>
        <span
          className="justify-self-end rounded-full px-2 py-px text-[11px] whitespace-nowrap"
          style={{ background: toneBg(tag.tone), color }}
          data-testid="agent-badge"
        >
          {tag.label}
        </span>
      </div>
      <div className="text-muted-foreground h-5 truncate" title={line} data-testid="agent-status-line">
        {line}
      </div>
      <div className="flex h-5 justify-between text-xs" style={{ color: 'var(--tone-active)' }}>
        <button
          type="button"
          className="hover:underline"
          onClick={(e) => {
            e.stopPropagation()
            setOpen(!open)
          }}
          aria-expanded={open}
        >
          {open ? 'Hide steps' : `Show steps (${agent.steps.length})`}
        </button>
        {foot && (
          <button
            type="button"
            className="hover:underline"
            aria-pressed={selected}
            onClick={(e) => {
              e.stopPropagation()
              openInPanel()
            }}
          >
            {foot}
          </button>
        )}
      </div>
      {open && <AgentTrace agent={agent} />}
    </div>
  )
}

export function AgentList() {
  const order = useConsoleStore((state) => state.plan?.order)
  if (!order) return <p className="text-muted-foreground">Planning...</p>
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-2.5">
      {order.map((id) => (
        <AgentCard key={id} id={id} />
      ))}
    </div>
  )
}
