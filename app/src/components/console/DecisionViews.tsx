import { useEffect, useRef, type ReactNode } from 'react'
import { CircleAlert, Info } from 'lucide-react'
import type { ConfirmationRequiredEvent, Draft, EscalationRequiredEvent } from '@mock/orchestrator.js'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Textarea } from '@/components/ui/textarea'
import { actionLabels, effectClassLabel } from '@/config/agentTags'
import type { AgentModel, Gate } from '@/store/console.reducer'
import { useViewStore, type Answer, type Outcome } from '@/store/view.store'
import { approve, edit, resolve } from '@/subscriptionManager/subscription'
import { REFUSED, RetryButton } from './RetryButton'
import { ClampedText } from './ClampedText'

/** Runs a command and reports whether the mock accepted it; on true the panel stores the outcome with what was sent. */
export type Act = (agentId: string, send: () => boolean, sent: Omit<Outcome, 'agentId'>) => boolean

const Row = ({ label, children }: { label: string; children: ReactNode }) => (
  <>
    <dt className="text-muted-foreground">{label}</dt>
    <dd className="m-0 min-w-0">{children}</dd>
  </>
)

const Refused = ({ show }: { show: boolean }) => (show ? <p className="text-failed text-sm">{REFUSED}</p> : null)

const BAND = {
  neutral: 'bg-muted border-border',
  needs: 'bg-needs border-needs-edge',
  failed: 'bg-failed-tint border-failed',
  done: 'bg-done-tint border-done',
}

/** The panel's frame for one decision or outcome (design canvas): a coloured band with the agent's label and
 * the question, the body, and a footer with the actions. */
export function Frame({
  band,
  who,
  title,
  children,
  footer,
}: {
  band: keyof typeof BAND
  who: string
  title: ReactNode
  children?: ReactNode
  footer?: ReactNode
}) {
  return (
    // overflow-wrap is inherited: an unbroken string from the mock or the user wraps instead of widening the panel.
    <div className="flex min-w-0 flex-1 flex-col [overflow-wrap:anywhere]">
      <div className={`border-b px-4 py-3 ${BAND[band]}`}>
        {/* The title stays in the text colour; only a failure colours the agent's label. */}
        <ClampedText text={who} lines={1} className={`text-xs font-semibold ${band === 'failed' ? 'text-failed' : ''}`} />
        <h3 className="mt-0.5 text-base font-semibold">{title}</h3>
      </div>
      {children && <div className="flex flex-col gap-3 p-4 text-sm">{children}</div>}
      {/* The footer sits at the bottom of the panel card, whatever the body's height. */}
      {footer && (
        <div data-testid="panel-footer" className="mt-auto flex flex-col items-stretch gap-2.5 border-t px-4 py-3">
          {footer}
        </div>
      )}
    </div>
  )
}

/** The effect of approving, right under the buttons where the eye and the cursor are when the user clicks.
 * Irreversible reads in the failed red; every other effect class in the normal text colour. */
function EffectLine({ effectClass }: { effectClass: string }) {
  const effect = effectClassLabel(effectClass)
  return (
    <p className={`flex items-center gap-1.5 text-sm font-semibold ${effect.tone === 'danger' ? 'text-failed' : 'text-foreground'}`}>
      <CircleAlert aria-hidden="true" className="size-4 shrink-0" />
      {effect.warning ?? `${effect.label}: ${effect.note}`}
    </p>
  )
}

const Fields = ({ children }: { children: ReactNode }) => (
  <dl className="m-0 grid grid-cols-[64px_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-label">{children}</dl>
)

/** Every field that will be sent: the target, subject, other draft keys as name: value, then the body. */
function DraftFields({ target, targetLabel, draft }: { target: string; targetLabel: string; draft: Draft }) {
  const { subject, body, ...rest } = draft
  return (
    <>
      <Fields>
        <Row label={targetLabel}>
          <span className="font-mono text-code [overflow-wrap:anywhere]">{target}</span>
        </Row>
        {subject !== undefined && <Row label="Subject">{subject}</Row>}
        {Object.entries(rest).map(([key, value]) => (
          <Row key={key} label={key}>
            {typeof value === 'string' ? value : JSON.stringify(value)}
          </Row>
        ))}
      </Fields>
      {body !== undefined && <div className="bg-muted rounded-md px-3.5 py-3 whitespace-pre-wrap">{body}</div>}
    </>
  )
}

function Editor({
  agent,
  gate,
  refused,
  act,
  onCancel,
}: {
  agent: AgentModel
  gate: ConfirmationRequiredEvent
  refused: boolean
  act: Act
  onCancel: () => void
}) {
  const labels = actionLabels(gate.action)
  const entry = useViewStore((state) => state.edits[agent.id])
  const setEdit = useViewStore((state) => state.setEdit)
  const draft = entry?.draft ?? gate.draft
  const change = (key: 'subject' | 'body', value: string) => setEdit(agent.id, { draft: { ...draft, [key]: value } })
  const empty = (draft.subject !== undefined && draft.subject.trim() === '') || (draft.body !== undefined && draft.body.trim() === '')
  // Saving an unchanged draft would only re-ask the same question: Save waits for a real change.
  const unchanged = draft.subject === gate.draft.subject && draft.body === gate.draft.body
  const subjectRef = useRef<HTMLInputElement>(null)
  const bodyRef = useRef<HTMLTextAreaElement>(null)

  // The editor mounts on the user's Edit click (or their return to an open editor): focus its first field.
  useEffect(() => {
    ;(subjectRef.current ?? bodyRef.current)?.focus()
  }, [])

  const save = () => {
    if (act(agent.id, () => edit(agent.id, draft), { kind: 'edit' })) setEdit(agent.id, null)
  }

  return (
    <Frame
      band="needs"
      who={agent.label}
      title={labels.editTitle}
      footer={
        <>
          <div className="flex gap-2">
            <Button size="lg" onClick={save} disabled={empty || unchanged}>
              Save changes
            </Button>
            <Button size="lg" variant="outline" onClick={onCancel}>
              Cancel edit
            </Button>
          </div>
          <Refused show={refused} />
          <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
            <Info aria-hidden="true" className="size-3.5 shrink-0" />
            {labels.editNote}
          </p>
        </>
      }
    >
      <Fields>
        <Row label={labels.targetLabel}>
          <span className="font-mono text-code [overflow-wrap:anywhere]">{gate.target}</span>
        </Row>
      </Fields>
      {draft.subject !== undefined && (
        <div className="flex flex-col gap-1">
          <Label htmlFor={`subject-${agent.id}`} className="text-muted-foreground text-xs font-semibold">
            Subject
          </Label>
          <Input ref={subjectRef} id={`subject-${agent.id}`} value={draft.subject} onChange={(e) => change('subject', e.target.value)} />
        </div>
      )}
      {draft.body !== undefined && (
        <div className="flex flex-col gap-1">
          <Label htmlFor={`body-${agent.id}`} className="text-muted-foreground text-xs font-semibold">
            {labels.bodyLabel}
          </Label>
          <Textarea
            ref={bodyRef}
            id={`body-${agent.id}`}
            value={draft.body}
            onChange={(e) => change('body', e.target.value)}
            className="min-h-60 resize-y"
          />
        </div>
      )}
    </Frame>
  )
}

export function ConfirmationDecision({ agent, gate, refused, act }: { agent: AgentModel; gate: Gate; refused: boolean; act: Act }) {
  const event = gate.event as ConfirmationRequiredEvent
  const labels = actionLabels(event.action)
  const entry = useViewStore((state) => state.edits[agent.id])
  const setEdit = useViewStore((state) => state.setEdit)
  const editRef = useRef<HTMLButtonElement>(null)
  const focusEdit = useRef(false)

  // Cancel edit removed the focused button; give focus back to Edit once the view is back.
  useEffect(() => {
    if (!focusEdit.current || !editRef.current) return
    focusEdit.current = false
    editRef.current.focus()
  })

  const cancelEdit = () => {
    focusEdit.current = true
    setEdit(agent.id, null)
  }

  if (entry) return <Editor agent={agent} gate={event} refused={refused} act={act} onCancel={cancelEdit} />

  return (
    <Frame
      band="needs"
      who={agent.label}
      title={gate.revision > 1 ? labels.editedTitle : labels.title}
      footer={
        <>
          <div className="flex gap-2">
            {/* Approve and Edit ignore the second click of a double click (detail > 1): the edited confirmation
                can open where Save was, and a double click on Save must not approve it. */}
            <Button
              size="lg"
              onClick={(e) => {
                if (e.detail <= 1) act(agent.id, () => approve(agent.id), { kind: 'approve' })
              }}
            >
              {labels.approve}
            </Button>
            <Button
              size="lg"
              ref={editRef}
              variant="outline"
              onClick={(e) => {
                if (e.detail <= 1) setEdit(agent.id, { draft: event.draft })
              }}
            >
              {labels.edit}
            </Button>
          </div>
          <EffectLine effectClass={event.effectClass} />
          <Refused show={refused} />
        </>
      }
    >
      {gate.revision > 1 && (
        <span className="border-primary text-primary inline-flex h-[22px] w-fit items-center rounded-sm border px-1.5 py-0.5 text-xs font-semibold">
          Edited version
        </span>
      )}
      <DraftFields target={event.target} targetLabel={labels.targetLabel} draft={event.draft} />
    </Frame>
  )
}

/** The answer the user would send: the picked option's label or the typed words. */
function answerText(gate: EscalationRequiredEvent, answer: Answer | undefined): string | null {
  if (!answer) return null
  if (answer.use === 'words') return answer.words.trim() || null
  return gate.options.find((option) => option.id === answer.optionId)?.label ?? null
}

export function QuestionDecision({ agent, gate, refused, act }: { agent: AgentModel; gate: Gate; refused: boolean; act: Act }) {
  const event = gate.event as EscalationRequiredEvent
  const answer = useViewStore((state) => state.answers[agent.id])
  const setAnswer = useViewStore((state) => state.setAnswer)
  const words = answer?.words ?? ''
  const optionId = answer?.optionId ?? null
  const usesWords = answer?.use === 'words'
  const text = answerText(event, answer)

  const send = () => {
    const choice = usesWords ? { words: words.trim() } : { optionId: optionId! }
    // An accepted answer belongs to this question only: a later question from the same agent starts empty.
    if (act(agent.id, () => resolve(agent.id, choice), { kind: 'resolve', answer: text! })) setAnswer(agent.id, null)
  }

  return (
    <Frame
      band="needs"
      who={agent.label}
      title={event.question}
      footer={
        <>
          <div>
            <Button size="lg" onClick={send} disabled={text === null}>
              Send answer
            </Button>
          </div>
          <Refused show={refused} />
        </>
      }
    >
      <p className="text-muted-foreground">{event.context}</p>
      <RadioGroup
        aria-label={event.question}
        value={usesWords ? null : optionId}
        onValueChange={(value) => setAnswer(agent.id, { optionId: value as string, words, use: 'option' })}
        className="gap-2"
      >
        {event.options.map((option) => {
          const chosen = !usesWords && optionId === option.id
          return (
            <Label
              key={option.id}
              // The chosen option keeps the 1px border width (nothing moves): primary border and a light fill.
              className={`grid cursor-pointer grid-cols-[16px_minmax(0,1fr)] items-start gap-x-2.5 gap-y-0.5 rounded-md px-3 py-2.5 text-sm font-normal border ${chosen ? 'border-primary bg-muted' : 'border-input'}`}
            >
              <RadioGroupItem value={option.id} className="mt-0.5" />
              <b className="font-semibold">{option.label}</b>
              {option.detail && <span className="text-muted-foreground col-start-2">{option.detail}</span>}
            </Label>
          )
        })}
      </RadioGroup>
      <div className="flex flex-col gap-1">
        <Label htmlFor={`own-${agent.id}`} className="text-muted-foreground text-xs font-semibold">
          Or answer in your own words
        </Label>
        <Textarea
          id={`own-${agent.id}`}
          value={words}
          onChange={(e) =>
            // Typing makes the words the answer; clearing them gives the answer back to a stored option.
            setAnswer(agent.id, {
              optionId,
              words: e.target.value,
              use: e.target.value.trim() === '' && optionId !== null ? 'option' : 'words',
            })
          }
          // Holding the answer: the primary border, same width, like a chosen option.
          className={`min-h-[120px] resize-y ${usesWords && words.trim() ? 'border-primary' : ''}`}
        />
      </div>
    </Frame>
  )
}

export function FailureDecision({ agent }: { agent: AgentModel }) {
  const attempt = agent.attempts[agent.attempts.length - 1]
  const steps = agent.steps.filter((step) => step.seq >= attempt.startSeq).length
  return (
    <Frame band="failed" who={agent.label} title="Retry this agent?" footer={<RetryButton agentId={agent.id} />}>
      <Fields>
        <Row label="Status">{agent.status?.statusLine}</Row>
        {agent.status?.error && (
          <Row label="Error">
            <span className="text-failed font-mono text-code">{agent.status.error.message}</span>
          </Row>
        )}
      </Fields>
      <p className="text-muted-foreground">
        The {steps} {steps === 1 ? 'step' : 'steps'} of attempt {attempt.n} {steps === 1 ? 'stays' : 'stay'} in its trace. Retry starts
        attempt {attempt.n + 1}.
      </p>
    </Frame>
  )
}
