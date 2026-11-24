import { Bot, Calendar, Mail, Search, type LucideIcon } from 'lucide-react'
import type { AgentTag } from '@/store/console.reducer'

export type Tone = 'neutral' | 'active' | 'attention' | 'danger' | 'success'

export const TAGS: Record<AgentTag, { label: string; tone: Tone }> = {
  queued: { label: 'Queued', tone: 'neutral' },
  running: { label: 'Running', tone: 'active' },
  needs_approval: { label: 'Needs approval', tone: 'attention' },
  needs_answer: { label: 'Needs answer', tone: 'attention' },
  failed: { label: 'Failed', tone: 'danger' },
  done: { label: 'Done', tone: 'success' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
}

const AGENT_ICONS: Record<string, LucideIcon> = {
  research: Search,
  drafting: Mail,
  scheduling: Calendar,
}

export const agentIcon = (type: string): LucideIcon => AGENT_ICONS[type] ?? Bot

const ACTIONS: Record<string, { title: string; editedTitle: string; approve: string }> = {
  send_email: {
    title: 'Send this email?',
    editedTitle: 'Send the edited email?',
    approve: 'Approve and send',
  },
}

export const actionLabels = (action: string) =>
  ACTIONS[action] ?? {
    title: 'Approve this action?',
    editedTitle: 'Approve the edited action?',
    approve: 'Approve',
  }

const RESULT_KINDS: Record<string, string> = {
  summary: 'Summary',
  email_sent: 'Email sent',
  calendar_hold: 'Calendar hold',
  error: 'Error',
}

export const resultKindLabel = (kind: string): string => RESULT_KINDS[kind] ?? 'Result'

const EFFECT_CLASSES: Record<string, { label: string; tone: Tone }> = {
  irreversible: { label: 'Irreversible', tone: 'danger' },
  reversible: { label: 'Reversible', tone: 'neutral' },
  read_only: { label: 'Read only', tone: 'neutral' },
}

export const effectClassLabel = (effectClass: string) =>
  EFFECT_CLASSES[effectClass] ?? {
    label: 'Side effect',
    tone: 'attention' as Tone,
  }
