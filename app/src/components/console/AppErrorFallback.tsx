import type { FallbackProps } from 'react-error-boundary'
import { Button } from '@/components/ui/button'
import { reset } from '@/subscriptionManager/subscription'

/** Error boundary fallback: "Start over" stops the run and goes back to the start card. */
export function AppErrorFallback({ error, resetErrorBoundary }: FallbackProps) {
  return (
    <div role="alert" className="mx-auto mt-20 flex w-[560px] max-w-[calc(100%-2rem)] flex-col gap-2.5 rounded-lg border p-5">
      <h1 className="text-lg font-bold">The console stopped working</h1>
      <p className="text-muted-foreground">{error instanceof Error ? error.message : String(error)}</p>
      <div>
        <Button
          onClick={() => {
            reset()
            resetErrorBoundary()
          }}
        >
          Start over
        </Button>
      </div>
    </div>
  )
}
