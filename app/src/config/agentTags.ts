import { Bot, Calendar, Mail, Search, type LucideIcon } from 'lucide-react'
import type { AgentTag } from '@/store/console.reducer'

/** Colour means state only: neutral grey, active blue, one yellow, one red, one green. */
export type Tone = 'neutral' | 'active' | 'attention' | 'danger' | 'success'

export const toneColor = (tone: Tone) => `var(--tone-${tone})`
export const toneBg = (tone: Tone) => `var(--tone-${tone}-bg)`

export const TAGS: Record<AgentTag, { label: string; tone: Tone }> = {
  queued: { label: 'Queued', tone: 'neutral' },
  running: { label: 'Running', tone: 'active' },
  needs_approval: { label: 'Needs approval', tone: 'attention' },
  needs_answer: { label: 'Needs answer', tone: 'attention' },
  failed: { label: 'Failed', tone: 'danger' },
  done: { label: 'Done', tone: 'success' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
}

const AGENT_TYPES: Record<string, { name: string; icon: LucideIcon }> = {
  research: { name: 'Research', icon: Search },
  drafting: { name: 'Drafting', icon: Mail },
  scheduling: { name: 'Scheduling', icon: Calendar },
}

export const agentType = (type: string) => AGENT_TYPES[type] ?? { name: 'Agent', icon: Bot }

const ACTS: Record<string, string> = { searched: 'Searched', read: 'Read', decided: 'Decided' }

export const actLabel = (act: string): string => ACTS[act] ?? act

const ACTIONS: Record<string, { title: string; editedTitle: string; approve: string; edit: string }> = {
  send_email: {
    title: 'Send this email?',
    editedTitle: 'Send the edited email?',
    approve: 'Approve and send',
    edit: 'Edit email',
  },
}

export const actionLabels = (action: string) =>
  ACTIONS[action] ?? {
    title: 'Approve this action?',
    editedTitle: 'Approve the edited action?',
    approve: 'Approve',
    edit: 'Edit',
  }

const RESULT_KINDS: Record<string, string> = {
  summary: 'Summary',
  email_sent: 'Email sent',
  calendar_hold: 'Calendar hold',
  error: 'Error',
}

export const resultKindLabel = (kind: string): string => RESULT_KINDS[kind] ?? 'Result'

const EFFECT_CLASSES: Record<string, { label: string; note: string; tone: Tone }> = {
  irreversible: { label: 'Irreversible', note: 'cannot be undone once it happens', tone: 'danger' },
  reversible: { label: 'Reversible', note: 'can be undone afterwards', tone: 'neutral' },
  read_only: { label: 'Read only', note: 'changes nothing', tone: 'neutral' },
}

export const effectClassLabel = (effectClass: string) =>
  EFFECT_CLASSES[effectClass] ?? { label: 'Side effect', note: 'the agent acts on your behalf', tone: 'attention' as Tone }
