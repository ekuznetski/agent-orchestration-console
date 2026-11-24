import { create } from 'zustand'
import { DEFAULT_TASK, type Draft } from '@mock/orchestrator.js'

/** What the user sent, stored when the mock accepted it. The panel shows it until the user moves. */
export interface Outcome {
  agentId: string
  kind: 'approve' | 'edit' | 'resolve' | 'retry'
  /** The answer text sent with resolve. */
  answer?: string
  /** The attempt a retry started. */
  attempt?: number
}

/** An open editor. */
export interface EditEntry {
  draft: Draft
}

/** A question's picked option and typed words; `use` says which one is the answer. */
export interface Answer {
  optionId: string | null
  words: string
  use: 'option' | 'words'
}

export interface ViewStore {
  /** What the panel shows: the decision queue, or one agent's record. */
  mode: 'decisions' | 'agent'
  /** The picked decision; kept while a record is open, so Back to decisions returns to it. */
  selectedId: string | null
  /** The agent whose record is open in agent mode. */
  recordId: string | null
  outcome: Outcome | null
  /** Bumped by the user's moves in the panel (select, open a record, back); the panel then moves focus to what it shows. */
  focusRequest: number
  request: string
  speed: number
  jitter: boolean
  runs: number
  /** The mock refused the last start; the start card says so until the next start. */
  startRefused: boolean
  edits: Record<string, EditEntry>
  answers: Record<string, Answer>
  /** Picks a decision, switches to decisions mode and clears the outcome. */
  select: (id: string) => void
  /** Opens an agent's record in the panel. */
  openRecord: (id: string) => void
  backToDecisions: () => void
  /** Keeps what the panel shows, without touching the outcome. */
  pin: (id: string) => void
  setOutcome: (outcome: Outcome | null) => void
  setRequest: (request: string) => void
  setSpeed: (speed: number) => void
  setJitter: (jitter: boolean) => void
  setEdit: (agentId: string, entry: EditEntry | null) => void
  setAnswer: (agentId: string, answer: Answer) => void
  runStarted: () => void
  runRefused: () => void
  runCancelled: () => void
  runReset: () => void
}

const cleared = {
  mode: 'decisions' as const,
  selectedId: null,
  recordId: null,
  outcome: null,
  focusRequest: 0,
  startRefused: false,
  edits: {},
  answers: {},
}

export const useViewStore = create<ViewStore>()((set) => ({
  ...cleared,
  request: DEFAULT_TASK,
  speed: 1,
  jitter: false,
  runs: 0,
  select: (id) => set((state) => ({ mode: 'decisions', selectedId: id, outcome: null, focusRequest: state.focusRequest + 1 })),
  openRecord: (id) => set((state) => ({ mode: 'agent', recordId: id, focusRequest: state.focusRequest + 1 })),
  backToDecisions: () => set((state) => ({ mode: 'decisions', focusRequest: state.focusRequest + 1 })),
  pin: (id) => set({ selectedId: id }),
  setOutcome: (outcome) => set({ outcome }),
  setRequest: (request) => set({ request }),
  setSpeed: (speed) => set({ speed }),
  setJitter: (jitter) => set({ jitter }),
  setEdit: (agentId, entry) =>
    set((state) => {
      const edits = { ...state.edits }
      if (entry) edits[agentId] = entry
      else delete edits[agentId]
      return { edits }
    }),
  setAnswer: (agentId, answer) => set((state) => ({ answers: { ...state.answers, [agentId]: answer } })),
  runStarted: () => set((state) => ({ ...cleared, runs: state.runs + 1 })),
  runRefused: () => set({ ...cleared, runs: 0, startRefused: true }),
  runCancelled: () => set({ outcome: null }),
  runReset: () => set({ ...cleared, runs: 0 }),
}))
