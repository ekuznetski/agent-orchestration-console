import { Ban, Check, CircleDashed, LoaderCircle, Triangle, X, type LucideIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { TAGS } from '@/config/agentTags'
import type { AgentTag } from '@/store/console.reducer'

/** Badge variant and icon per tag (design canvas): amber needs you, red failed, teal done, the rest neutral. */
const LOOK: Record<
  AgentTag,
  { variant: 'needs' | 'failed' | 'done' | 'running' | 'queued' | 'cancelled'; Icon: LucideIcon; iconClass?: string }
> = {
  queued: { variant: 'queued', Icon: CircleDashed },
  running: { variant: 'running', Icon: LoaderCircle, iconClass: 'motion-safe:animate-spin' },
  needs_approval: { variant: 'needs', Icon: Triangle, iconClass: 'fill-current' },
  needs_answer: { variant: 'needs', Icon: Triangle, iconClass: 'fill-current' },
  failed: { variant: 'failed', Icon: X },
  done: { variant: 'done', Icon: Check, iconClass: 'text-done' },
  cancelled: { variant: 'cancelled', Icon: Ban },
}

/** The state badge of an agent, or of the run with its own words (`label`). */
export function StatusBadge({ tag, label, testId }: { tag: AgentTag; label?: string; testId?: string }) {
  const { variant, Icon, iconClass } = LOOK[tag]
  return (
    <Badge variant={variant} data-testid={testId} className="h-auto rounded-sm px-1.5 font-semibold">
      <Icon aria-hidden="true" className={iconClass} />
      {label ?? TAGS[tag].label}
    </Badge>
  )
}
