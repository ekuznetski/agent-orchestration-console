import type { AgentTag } from '@/store/console.reducer'

/** Colour means state only: neutral grey, active blue, one yellow, one red, one green. */
export type Tone = 'neutral' | 'active' | 'attention' | 'danger' | 'success'

/** The left edge of the decision panel by tone: the bright accent of the state, neutral otherwise. */
export const toneEdge = (tone: Tone) =>
  tone === 'attention'
    ? 'border-l-needs-bar'
    : tone === 'danger'
      ? 'border-l-failed'
      : tone === 'success'
        ? 'border-l-done'
        : 'border-l-input'

export const TAGS: Record<AgentTag, { label: string; tone: Tone }> = {
  queued: { label: 'Queued', tone: 'neutral' },
  running: { label: 'Running', tone: 'active' },
  needs_approval: { label: 'Needs approval', tone: 'attention' },
  needs_answer: { label: 'Needs answer', tone: 'attention' },
  failed: { label: 'Failed', tone: 'danger' },
  done: { label: 'Done', tone: 'success' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
}

const AGENT_TYPES: Record<string, { name: string }> = {
  research: { name: 'Research' },
  drafting: { name: 'Drafting' },
  scheduling: { name: 'Scheduling' },
}

export const agentType = (type: string) => AGENT_TYPES[type] ?? { name: 'Agent' }

const ACTS: Record<string, string> = { searched: 'Searched', read: 'Read', decided: 'Decided' }

export const actLabel = (act: string): string => ACTS[act] ?? act

type ActionLabels = {
  title: string
  editedTitle: string
  approve: string
  edit: string
  editTitle: string
  editNote: string
  bodyLabel: string
  /** The label of the gate's `target` row. */
  targetLabel: string
}

const ACTIONS: Record<string, ActionLabels> = {
  send_email: {
    title: 'Send this email?',
    editedTitle: 'Send the edited email?',
    approve: 'Approve and send',
    edit: 'Edit email',
    editTitle: 'Edit the email',
    editNote: 'Nothing is sent yet. You approve the edited email next.',
    bodyLabel: 'Message',
    targetLabel: 'To',
  },
}

/** Words for a confirmation's action. An action without its own words is named verbatim, so the user always
 * sees what they approve. */
export const actionLabels = (action: string): ActionLabels =>
  ACTIONS[action] ?? {
    title: `Approve ${action}?`,
    editedTitle: `Approve the edited ${action}?`,
    approve: 'Approve',
    edit: 'Edit',
    editTitle: `Edit ${action}`,
    editNote: 'Nothing happens yet. You approve the edited version next.',
    bodyLabel: 'Body',
    targetLabel: 'Target',
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
