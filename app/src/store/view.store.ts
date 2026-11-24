import { create } from 'zustand'
import { DEFAULT_TASK, type Draft } from '@mock/orchestrator.js'

export interface Receipt {
  agentId: string
  kind: 'approve' | 'resolve' | 'retry'
  /** The answer text sent with resolve. */
  answer?: string
  /** Agents that were waiting when the user acted; auto-advance only goes to one of these. */
  waitingAtAction: string[]
}

/** An open editor, or the version sent with edit(). */
export interface EditEntry {
  draft: Draft
  sent?: true
}

/** A question's picked option and typed words; `use` says which one is the answer. */
export interface Answer {
  optionId: string | null
  words: string
  use: 'option' | 'words'
}

export interface ViewStore {
  selectedId: string | null
  receipt: Receipt | null
  request: string
  speed: number
  jitter: boolean
  runs: number
  edits: Record<string, EditEntry>
  answers: Record<string, Answer>
  /** Picks a decision and clears the receipt. */
  select: (id: string) => void
  /** Keeps what the panel shows, without touching the receipt. */
  pin: (id: string) => void
  setReceipt: (receipt: Receipt | null) => void
  setRequest: (request: string) => void
  setSpeed: (speed: number) => void
  setJitter: (jitter: boolean) => void
  setEdit: (agentId: string, entry: EditEntry | null) => void
  setAnswer: (agentId: string, answer: Answer) => void
  runStarted: () => void
  runCancelled: () => void
  runReset: () => void
}

const cleared = { selectedId: null, receipt: null, edits: {}, answers: {} }

export const useViewStore = create<ViewStore>()((set) => ({
  ...cleared,
  request: DEFAULT_TASK,
  speed: 1,
  jitter: false,
  runs: 0,
  select: (id) => set({ selectedId: id, receipt: null }),
  pin: (id) => set({ selectedId: id }),
  setReceipt: (receipt) => set({ receipt }),
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
  runCancelled: () => set({ receipt: null }),
  runReset: () => set({ ...cleared, runs: 0 }),
}))
