import { useEffect, useState } from 'react'
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
import { StatusBadge } from './StatusBadge'

const SPEEDS = [0.25, 0.5, 1, 2, 4]

const SUMMARY: Record<Phase, string> = {
  idle: 'Starting',
  running: 'Running',
  finishing: 'Finishing',
  completed: 'Completed',
  partial: 'Partial result',
  cancelled: 'Run cancelled',
}

/** A run is active from Start until the agents settle; speed and jitter are fixed meanwhile. */
const isActive = (phase: Phase) => phase === 'idle' || phase === 'running' || phase === 'finishing'

/** A refused start goes back to the start card, which shows the message (`startRefused`). */
function run() {
  const { request, speed, jitter } = useViewStore.getState()
  start(request.trim(), speed, jitter)
}

function DebugRow({ locked, logOpen, onToggleLog }: { locked: boolean; logOpen?: boolean; onToggleLog?: () => void }) {
  const speed = useViewStore((state) => state.speed)
  const jitter = useViewStore((state) => state.jitter)
  const setSpeed = useViewStore((state) => state.setSpeed)
  const setJitter = useViewStore((state) => state.setJitter)
  const logSize = useConsoleStore((state) => state.log.length)
  return (
    <div className="text-muted-foreground flex flex-wrap items-center gap-4 text-xs">
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
          <ToggleGroupItem
            key={s}
            value={String(s)}
            className="border-input aria-pressed:bg-accent aria-pressed:text-foreground h-6 px-2 font-mono text-xs tabular-nums aria-pressed:font-semibold"
          >
            {s}x
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <Label className="text-muted-foreground gap-1.5 text-xs font-normal">
        <Checkbox checked={jitter} disabled={locked} onCheckedChange={(checked) => setJitter(checked)} />
        Jitter
      </Label>
      {/* Always rendered, hidden when unlocked: the run ending must not move the event log toggle. */}
      <span className={locked ? 'text-faint' : 'invisible'} aria-hidden={!locked}>
        Speed is set before a run
      </span>
      {onToggleLog && (
        <Button
          variant="link"
          size="xs"
          className="text-foreground decoration-input hover:decoration-foreground h-auto p-0 text-label underline underline-offset-[3px]"
          aria-expanded={logOpen}
          onClick={onToggleLog}
        >
          Event log ({logSize})
        </Button>
      )}
    </div>
  )
}

/** The product name above both screens (design canvas). The h1 of each screen is its own. */
export function Brand() {
  return (
    <div className="mb-4 flex items-baseline gap-3">
      <span className="text-title font-bold">Wand</span>
      <span className="text-muted-foreground text-label">Agent console</span>
    </div>
  )
}

/** Before the first run: the request and the mock's speed and jitter. */
export function StartCard() {
  const request = useViewStore((state) => state.request)
  const setRequest = useViewStore((state) => state.setRequest)
  const starting = useViewStore((state) => state.runs > 0)
  const refused = useViewStore((state) => state.startRefused)
  return (
    <div className="mx-auto max-w-[1200px] px-6 pt-6 pb-12">
      <Brand />
      <section className="bg-card mx-auto mt-24 flex max-w-[720px] flex-col overflow-hidden rounded-lg border shadow-sm">
        <div className="flex flex-col px-9 pt-8 pb-5">
          <h1 className="mb-5 text-display font-semibold tracking-[-0.015em]">What should the agents do?</h1>
          <Label htmlFor="request" className="text-muted-foreground mb-1 text-xs font-semibold">
            Request
          </Label>
          <Textarea
            id="request"
            value={request}
            onChange={(e) => setRequest(e.target.value)}
            disabled={starting}
            className="border-input min-h-[120px] resize-y text-base"
          />
          <div className="mt-4 flex items-center justify-end gap-4">
            {refused && <span className="text-failed text-sm">The orchestrator did not start the run.</span>}
            <Button className="h-10 px-6" onClick={run} disabled={starting || request.trim() === ''}>
              {starting ? 'Starting...' : 'Start run'}
            </Button>
          </div>
        </div>
        <div className="border-t px-4 pt-2 pb-3">
          <DebugRow locked={starting} />
        </div>
      </section>
      <p className="text-muted-foreground mx-auto mt-4 max-w-[720px] text-label">
        The agents, their steps and the result appear here once the run starts.
      </p>
    </div>
  )
}

const clock = (ms: number) => {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

/** Time since the plan arrived: ticking while the run works, frozen when it ends ("took", or "at" for a cancel). */
function Elapsed({ startedAt, phase }: { startedAt: number; phase: Phase }) {
  const active = isActive(phase)
  const [now, setNow] = useState(() => Date.now())
  // A working run ticks every second; an ended run mounts its own instance, so its first reading is the end.
  useEffect(() => {
    if (!active) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [active])
  const time = <b>{clock(now - startedAt)}</b>
  if (active) return <span className="mr-2">{time} into the run</span>
  if (phase === 'cancelled') return <span className="ml-2">at {time}</span>
  return <span className="ml-2">took {time}</span>
}

/** The run state as a chip once the run has ended; plain words while it works. */
function PhaseWord({ phase }: { phase: Phase }) {
  if (phase === 'completed') return <StatusBadge tag="done" label={SUMMARY.completed} />
  if (phase === 'partial') return <StatusBadge tag="failed" label={SUMMARY.partial} />
  if (phase === 'cancelled') return <StatusBadge tag="cancelled" label={SUMMARY.cancelled} />
  return <span>{SUMMARY[phase]}</span>
}

/** Request, Cancel run / Run again, one-line summary, debug row and event log. */
export function TopBar() {
  const header = useRunHeader()
  const task = useConsoleStore((state) => state.plan?.task)
  const modelError = useConsoleStore((state) => state.modelError)
  const request = useViewStore((state) => state.request)
  const setRequest = useViewStore((state) => state.setRequest)
  const [logOpen, setLogOpen] = useState(false)
  const active = isActive(header.phase)
  const startedAt = useConsoleStore((state) => state.startedAt)

  return (
    <header className="bg-card shadow-raised flex flex-col overflow-hidden rounded-lg border">
      <h1 className="sr-only">Agent orchestration console</h1>
      <div className="flex items-center gap-2 px-4 py-3">
        {active ? (
          <div
            className="bg-muted text-muted-foreground h-9 min-w-0 flex-1 truncate rounded-md px-3 text-sm leading-9"
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
            className="border-input h-9 min-h-0 flex-1 resize-none py-1.5 text-sm"
          />
        )}
        {active ? (
          <Button variant="ghost" size="lg" className="text-muted-foreground" onClick={cancel}>
            Cancel run
          </Button>
        ) : (
          <Button size="lg" onClick={run} disabled={request.trim() === ''}>
            Run again
          </Button>
        )}
      </div>
      <div
        className="text-muted-foreground [&_b]:text-foreground flex h-10 items-center gap-1.5 overflow-hidden border-t px-4 text-label whitespace-nowrap [&_b]:font-semibold [&_b]:tabular-nums"
        data-testid="run-summary"
      >
        {startedAt !== null && active && <Elapsed startedAt={startedAt} phase={header.phase} />}
        <PhaseWord phase={header.phase} />
        {header.total > 0 && (
          <span className={active ? undefined : 'ml-1.5'}>
            {active && '- '}
            <b>
              {header.done} of {header.total}
            </b>{' '}
            done
          </span>
        )}
        {startedAt !== null && !active && <Elapsed startedAt={startedAt} phase={header.phase} />}
        {header.needYou > 0 && (
          <span className="ml-2">
            <b>{header.needYou}</b> {header.needYou === 1 ? 'needs' : 'need'} you
          </span>
        )}
        {modelError && <span className="text-failed ml-2">The screen may not match what the agents did</span>}
        {active && <span className="text-faint ml-auto">The result appears above the agents when the run ends</span>}
      </div>
      <div className="border-t px-4 pt-2 pb-3">
        <DebugRow locked={active} logOpen={logOpen} onToggleLog={() => setLogOpen(!logOpen)} />
      </div>
      {logOpen && <EventLog />}
    </header>
  )
}
