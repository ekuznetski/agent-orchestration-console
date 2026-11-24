import { expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { ErrorBoundary } from 'react-error-boundary'
import { reset } from '@/subscriptionManager/subscription'
import { AppErrorFallback } from './AppErrorFallback'

// A stub manager: the fallback must call reset, the real run is not under test here.
vi.mock('@/subscriptionManager/subscription', () => ({ reset: vi.fn() }))

let broken = true
function Boom() {
  if (broken) throw new Error('Render failed')
  return <p>Back on the start card</p>
}

it('shows the fallback on a render error, and Start over resets the run and renders again', () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  render(
    <ErrorBoundary FallbackComponent={AppErrorFallback}>
      <Boom />
    </ErrorBoundary>,
  )
  expect(screen.getByRole('alert').textContent).toContain('Render failed')
  broken = false
  fireEvent.click(screen.getByRole('button', { name: 'Start over' }))
  expect(reset).toHaveBeenCalledTimes(1)
  expect(screen.getByText('Back on the start card')).toBeTruthy()
  error.mockRestore()
})
