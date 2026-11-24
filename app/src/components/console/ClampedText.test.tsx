import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ClampedText } from './ClampedText'

const long = 'x'.repeat(500)

describe('ClampedText', () => {
  it('one line: truncates, breaks unbroken strings, full text in the tooltip', () => {
    render(<ClampedText text={long} lines={1} data-testid="t" />)
    const el = screen.getByTestId('t')
    expect(el.getAttribute('title')).toBe(long)
    expect(el.textContent).toBe(long)
    expect(el.className).toContain('truncate')
    expect(el.className).toContain('[overflow-wrap:anywhere]')
  })

  it('two lines: line-clamp-2; markup children shown, the text stays the tooltip', () => {
    render(
      <ClampedText text={`Decided: ${long}`} lines={2} data-testid="t">
        <b>Decided:</b> {long}
      </ClampedText>,
    )
    const el = screen.getByTestId('t')
    expect(el.getAttribute('title')).toBe(`Decided: ${long}`)
    expect(el.className).toContain('line-clamp-2')
    expect(el.querySelector('b')?.textContent).toBe('Decided:')
  })
})
