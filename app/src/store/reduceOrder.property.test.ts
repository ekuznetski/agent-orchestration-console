import { describe, expect, it } from 'vitest'
import type { OrchestratorEvent } from '@mock/orchestrator.js'
import fixture from '../../../fixtures/events.json'
import { initialState, reduce, type RunState } from './console.reducer'
import { needsUser, waitingQueue } from './selectors'

// Property test: the run model depends on seq, not on arrival order. The recorded run's events after the plan
// are delivered in seeded random orders; every order must give the same model as the logical (seq) order.
const events = fixture as OrchestratorEvent[]
const plan = events.find((event) => event.type === 'plan')!
const rest = events.filter((event) => event !== plan)

/** mulberry32: a small seeded generator, so a failing order can be replayed from its seed. */
function random(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function shuffled<T>(list: T[], seed: number): T[] {
  const next = random(seed)
  const copy = [...list]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

const run = (list: OrchestratorEvent[]): RunState => list.reduce((state, event) => reduce(state, event, 0), initialState)
const logical = run([plan, ...[...rest].sort((a, b) => a.seq - b.seq)])

describe('arrival order', () => {
  it('gives the same model as seq order for 300 seeded permutations', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const state = run([plan, ...shuffled(rest, seed)])
      const where = `seed ${seed}`
      for (const id of state.plan!.order) {
        const agent = state.agents[id]
        const seqs = agent.steps.map((step) => step.seq)
        // Trace sorted by seq, no duplicates.
        expect(seqs, where).toEqual([...new Set(seqs)].sort((a, b) => a - b))
        // Status is the agent's newest status, so done never regresses to an older running.
        expect(agent.status, where).toEqual(logical.agents[id].status)
        // The open gate is the agent's newest gate (this run has no edits).
        expect(agent.gate?.event.seq, where).toEqual(logical.agents[id].gate?.event.seq)
        expect(agent.tag, where).toEqual(logical.agents[id].tag)
      }
      // The waiting queue is exactly the agents that need the user, oldest wait first.
      expect(waitingQueue(state), where).toEqual(waitingQueue(logical))
      expect(new Set(waitingQueue(state)), where).toEqual(new Set(state.plan!.order.filter((id) => needsUser(state.agents[id]))))
      // The result is the newest by seq, outdated exactly when a newer status exists.
      expect(state.result?.event.seq, where).toEqual(logical.result?.event.seq)
      const newer = Object.values(state.agents).some((agent) => agent.status !== null && agent.status.seq > state.result!.event.seq)
      expect(state.result?.outdated, where).toBe(newer)
    }
  })
})
