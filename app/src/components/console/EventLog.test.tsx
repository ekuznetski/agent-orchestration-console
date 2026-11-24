import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { EventLog } from './EventLog'

vi.mock('@mock/orchestrator.js', async () => (await import('@/test/fakeOrchestrator')).fakeModule)

function clipboard(writeText: () => Promise<void>) {
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
}

afterEach(() => vi.useRealTimers())

describe('event log Copy JSON', () => {
  it('says Copied, then Copy JSON again after 2 s', async () => {
    vi.useFakeTimers()
    clipboard(() => Promise.resolve())
    render(<EventLog />)
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Copy JSON' })))
    expect(screen.getByRole('button', { name: 'Copied' })).toBeTruthy()
    act(() => vi.advanceTimersByTime(2000))
    expect(screen.getByRole('button', { name: 'Copy JSON' })).toBeTruthy()
  })

  it('says Copy failed when the clipboard refuses', async () => {
    clipboard(() => Promise.reject(new Error('denied')))
    render(<EventLog />)
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Copy JSON' })))
    expect(screen.getByRole('button', { name: 'Copy failed' })).toBeTruthy()
  })
})
