import { LoaderCircle } from 'lucide-react'
import { cn } from '@/lib/utils'

/** A loading spinner (as shadcn's Spinner): fixed size, so it never changes layout; still under reduced motion.
 * `decorative` hides it from assistive tech where the words beside it already say it (inside a live region a
 * second status would nest). */
function Spinner({ className, decorative = false }: { className?: string; decorative?: boolean }) {
  const a11y = decorative ? { 'aria-hidden': true } : { role: 'status', 'aria-label': 'Loading' }
  return <LoaderCircle {...a11y} className={cn('size-3.5 shrink-0 motion-safe:animate-spin', className)} />
}

export { Spinner }
