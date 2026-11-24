import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { useConsoleStore } from '@/store/console.store'
import { useRunHeader } from '@/store/hooks'
import type { Phase } from '@/store/selectors'
import { useViewStore } from '@/store/view.store'
import { cancel, start } from '@/subscriptionManager/subscription'
import { EventLog } from './EventLog'

const SPEEDS = [0.25, 0.5, 1, 2, 4]

const SUMMARY: Record<Phase, string> = {
  idle: 'Starting',
  running: 'Running',
  finishing: 'Finishing',
  completed: 'Complete',
  partial: 'Partial result',
  cancelled: 'Run cancelled',
}

/** A run is active from Start until the agents settle; speed and jitter are fixed meanwhile. */
const isActive = (phase: Phase) => phase === 'idle' || phase === 'running' || phase === 'finishing'

function useStartRun() {
  const [refused, setRefused] = useState(false)
  const run = () => {
    const { request, speed, jitter } = useViewStore.getState()
    setRefused(!start(request.trim(), speed, jitter))
  }
  return { run, refused }
}

function DebugRow({ locked, logOpen, onToggleLog }: { locked: boolean; logOpen?: boolean; onToggleLog?: () => void }) {
  const speed = useViewStore((state) => state.speed)
  const jitter = useViewStore((state) => state.jitter)
  const setSpeed = useViewStore((state) => state.setSpeed)
  const setJitter = useViewStore((state) => state.setJitter)
  const logSize = useConsoleStore((state) => state.log.length)
  return (
    <div className="text-muted-foreground flex flex-wrap items-center gap-2 text-xs">
      <span>Debug:</span>
      <ToggleGroup
        aria-label="Mock speed"
        size="sm"
        variant="outline"
        spacing={0}
        disabled={locked}
        value={[String(speed)]}
        onValueChange={(value) => value[0] && setSpeed(Number(value[0]))}
      >
        {SPEEDS.map((s) => (
          <ToggleGroupItem key={s} value={String(s)} className="aria-pressed:text-foreground h-6 px-2 text-xs aria-pressed:font-semibold">
            {s}x
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <Label className="text-muted-foreground gap-1.5 text-xs font-normal">
        <Checkbox checked={jitter} disabled={locked} onCheckedChange={(checked) => setJitter(checked)} />
        Jitter
      </Label>
      {locked && <span>Speed is set before a run</span>}
      {onToggleLog && (
        <Button variant="link" size="xs" className="h-auto p-0 text-xs" aria-expanded={logOpen} onClick={onToggleLog}>
          Event log ({logSize})
        </Button>
      )}
    </div>
  )
}

/** Before the first run: the request and the mock's speed and jitter. */
export function StartCard() {
  const request = useViewStore((state) => state.request)
  const setRequest = useViewStore((state) => state.setRequest)
  const starting = useViewStore((state) => state.runs > 0)
  const { run, refused } = useStartRun()
  return (
    <div className="flex h-dvh flex-col">
      <div className="border-b px-3.5 py-2.5">
        <DebugRow locked={starting} />
      </div>
      <div className="mx-auto mt-20 flex w-[560px] max-w-[calc(100%-2rem)] flex-col gap-2.5 rounded-lg border p-5">
        <h1 className="text-lg font-bold">What should the agents do?</h1>
        <Label htmlFor="request" className="text-muted-foreground text-xs font-normal">
          Request
        </Label>
        <Textarea
          id="request"
          value={request}
          onChange={(e) => setRequest(e.target.value)}
          disabled={starting}
          className="min-h-20 resize-none"
        />
        <div className="flex items-center gap-3">
          <Button onClick={run} disabled={starting || request.trim() === ''}>
            {starting ? 'Starting...' : 'Start run'}
          </Button>
          {refused && <span style={{ color: 'var(--tone-danger)' }}>The orchestrator did not start the run.</span>}
        </div>
      </div>
    </div>
  )
}

/** Request, Cancel run / Run again, one-line summary, debug row and event log. */
export function TopBar() {
  const header = useRunHeader()
  const task = useConsoleStore((state) => state.plan?.task)
  const modelError = useConsoleStore((state) => state.modelError)
  const request = useViewStore((state) => state.request)
  const setRequest = useViewStore((state) => state.setRequest)
  const [logOpen, setLogOpen] = useState(false)
  const { run, refused } = useStartRun()
  const active = isActive(header.phase)

  const counts = [`${header.done} of ${header.total} done`]
  if (header.needYou > 0) counts.push(`${header.needYou} ${header.needYou === 1 ? 'needs' : 'need'} you`)

  return (
    <header className="flex flex-col border-b">
      <div className="flex flex-col gap-1.5 px-3.5 py-2.5">
        <div className="flex items-center gap-2">
          {active ? (
            <div
              className="bg-muted text-muted-foreground h-9 flex-1 truncate rounded-md border px-2 leading-[34px]"
              title={task ?? request}
            >
              {task ?? request}
            </div>
          ) : (
            <Textarea
              aria-label="Request"
              rows={1}
              value={request}
              onChange={(e) => setRequest(e.target.value)}
              className="h-9 min-h-0 flex-1 resize-none py-1.5"
            />
          )}
          {active ? (
            <Button variant="outline" onClick={cancel}>
              Cancel run
            </Button>
          ) : (
            <Button onClick={run} disabled={request.trim() === ''}>
              Run again
            </Button>
          )}
        </div>
        <div className="flex items-baseline gap-1.5 overflow-hidden whitespace-nowrap" data-testid="run-summary">
          <b>{SUMMARY[header.phase]}</b>
          <span>- {counts.join(', ')}</span>
          {refused && <span style={{ color: 'var(--tone-danger)' }}>The orchestrator did not start the run.</span>}
          {modelError && (
            <span style={{ color: 'var(--tone-danger)' }}>
              The screen may not match what the agents did: an event could not be applied.
            </span>
          )}
        </div>
        <DebugRow locked={active} logOpen={logOpen} onToggleLog={() => setLogOpen(!logOpen)} />
      </div>
      {logOpen && <EventLog />}
    </header>
  )
}
