import type { HTMLAttributes, ReactNode } from 'react'

// truncate needs a block box; line-clamp sets its own display (-webkit-box), so no display class with it.
const CLAMP = { 1: 'block truncate', 2: 'line-clamp-2' } as const

/** Text we do not control (agent labels, mock strings, the user's words) in a slot of bounded size: one line
 * with an ellipsis or at most two lines, the full text in the tooltip. overflow-wrap:anywhere breaks an
 * unbroken string, so it can never widen its container. `children` replaces the shown content when it needs
 * markup (a bold label); `text` is still the tooltip. */
export function ClampedText({
  text,
  lines,
  className = '',
  children,
  ...rest
}: { text: string; lines: 1 | 2; className?: string; children?: ReactNode } & HTMLAttributes<HTMLSpanElement>) {
  return (
    <span {...rest} className={`min-w-0 ${CLAMP[lines]} [overflow-wrap:anywhere] ${className}`} title={text}>
      {children ?? text}
    </span>
  )
}
