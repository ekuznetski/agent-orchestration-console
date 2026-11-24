import { beforeEach, describe, expect, it } from 'vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import type { OrchestratorEvent } from '@mock/orchestrator.js'
import fixture from '../../../../fixtures/events.json'
import { initialState, type ConsoleEvent } from '@/store/console.reducer'
import { useConsoleStore } from '@/store/console.store'
import { AgentList } from './AgentCard'

const events = fixture as OrchestratorEvent[]
const apply = (list: ConsoleEvent[]) => act(() => list.forEach((event) => useConsoleStore.getState().apply(event)))
const upTo = (seq: number) => events.slice(0, events.findIndex((e) => e.seq === seq) + 1)
const card = (id: string) => screen.getByTestId(`agent-card-${id}`)

beforeEach(() => useConsoleStore.setState(initialState))

describe('agent list', () => {
  it('renders exactly one card per agent in plan order', () => {
    render(<AgentList />)
    apply(upTo(1))
    expect(screen.getAllByTestId(/^agent-card-/).map((el) => el.dataset.testid)).toEqual([
      'agent-card-agent_research',
      'agent-card-agent_drafting',
      'agent-card-agent_scheduling',
    ])
  })

  it('renders ten cards for a ten-agent plan, a fourth agent type included', () => {
    render(<AgentList />)
    const ids = Array.from({ length: 10 }, (_, i) => `agent_${i}`)
    apply([
      {
        type: 'plan',
        seq: 1,
        ts: '',
        runId: 'r',
        task: 'T',
        subtasks: ids.map((id, i) => ({ id, type: i === 3 ? 'billing' : 'research', label: `Label ${i}` })),
      } as unknown as ConsoleEvent,
    ])
    expect(screen.getAllByTestId(/^agent-card-/)).toHaveLength(10)
    expect(within(card('agent_3')).getByText('Label 3')).toBeTruthy()
    expect(within(card('agent_3')).getByTestId('agent-badge').textContent).toBe('Queued')
  })

  it('updates a card in place when its status changes: same node, no duplicate', () => {
    render(<AgentList />)
    apply(upTo(2))
    const before = card('agent_research')
    expect(within(before).getByTestId('agent-status-line').textContent).toBe('Queued \u2014 research')
    apply(upTo(4).slice(2))
    const after = card('agent_research')
    expect(after).toBe(before)
    expect(screen.getAllByTestId('agent-card-agent_research')).toHaveLength(1)
    expect(within(after).getByTestId('agent-badge').textContent).toBe('Running')
    expect(within(after).getByTestId('agent-status-line').textContent).toBe('Searching Slack and Jira…')
  })

  it('shows the trace in seq order, so the late searched step (8) sits before read (9)', () => {
    render(<AgentList />)
    apply(upTo(8))
    fireEvent.click(within(card('agent_research')).getByRole('button', { name: /Show steps/ }))
    const rows = within(card('agent_research'))
      .getAllByText(/^(Searched|Read|Decided):$/)
      .map((b) => b.parentElement!.textContent)
    expect(rows).toEqual([
      'Searched: Slack #northwind-renewal \u2014 42 messages since 12 Feb',
      "Searched: Jira NW-2291 'Renewal blockers' \u2014 3 open issues",
      'Read: Slack thread (18 Feb) \u2014 Maya flags the 12% uplift',
    ])
  })

  it('shows the empty trace text for an agent without steps', () => {
    render(<AgentList />)
    apply(upTo(1))
    fireEvent.click(within(card('agent_drafting')).getByRole('button', { name: 'Show steps (0)' }))
    expect(within(card('agent_drafting')).getByText('No steps yet. Steps appear here as the agent reports them.')).toBeTruthy()
  })

  it('keeps Done when the last step arrives after done (seq 29 after 30)', () => {
    render(<AgentList />)
    apply(upTo(30))
    expect(within(card('agent_scheduling')).getByTestId('agent-badge').textContent).toBe('Done')
    apply(upTo(29).slice(upTo(30).length))
    expect(within(card('agent_scheduling')).getByTestId('agent-badge').textContent).toBe('Done')
    expect(within(card('agent_scheduling')).getByTestId('agent-status-line').textContent).toBe('Hold placed \u2014 Tue 10 Mar, 14:00')
    expect(within(card('agent_scheduling')).getByRole('button', { name: 'Show steps (4)' })).toBeTruthy()
  })
})
