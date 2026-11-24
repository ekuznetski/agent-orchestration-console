import { LoaderCircle } from 'lucide-react'
import { cn } from 'cn'

/** A loading spinner (as shadcn's Spinner): fixed size, so it never changes layout; still under reduced motion. */
function Spinner({ className }: { className?: string }) {
  return <LoaderCircle role="status" aria-label="Loading" className={cn('size-3.5 shrink-0 motion-safe:animate-spin', className)} />
}

export { Spinner }
