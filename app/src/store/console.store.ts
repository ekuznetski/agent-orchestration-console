import { create } from 'zustand'
import { initialState, reduce, type ConsoleEvent, type RunState } from './console.reducer'

export interface ConsoleStore extends RunState {
  apply: (event: ConsoleEvent) => void
}

export const useConsoleStore = create<ConsoleStore>()((set) => ({
  ...initialState,
  apply: (event) => set((state) => reduce(state, event, Date.now())),
}))
