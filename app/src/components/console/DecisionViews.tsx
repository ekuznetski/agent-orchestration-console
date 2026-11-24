import { useEffect, useRef, type ReactNode } from 'react'
import type { ConfirmationRequiredEvent, Draft, EscalationRequiredEvent } from '@mock/orchestrator.js'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Textarea } from '@/components/ui/textarea'
import { actionLabels, effectClassLabel, toneColor } from '@/config/agentTags'
import type { AgentModel, Gate } from '@/store/console.reducer'
import { useViewStore, type Answer, type Outcome } from '@/store/view.store'
import { approve, edit, resolve } from '@/subscriptionManager/subscription'
import { REFUSED, RetryButton } from './RetryButton'

/** Runs a command and reports whether the mock accepted it; on true the panel stores the outcome with what was sent. */
export type Act = (agentId: string, send: () => boolean, sent: Omit<Outcome, 'agentId'>) => boolean

const Row = ({ label, children }: { label: string; children: ReactNode }) => (
  <>
    <span className="text-muted-foreground">{label}</span>
    <span className="min-w-0 break-words">{children}</span>
  </>
)

const Refused = ({ show }: { show: boolean }) => (show ? <p style={{ color: 'var(--tone-danger)' }}>{REFUSED}</p> : null)

function EffectLine({ effectClass }: { effectClass: string }) {
  const effect = effectClassLabel(effectClass)
  return (
    <p className="text-xs" style={{ color: toneColor(effect.tone) }}>
      {effect.label}: {effect.note}
    </p>
  )
}

/** Every field that will be sent: To, subject, other draft keys as name: value, then the body. */
function DraftFields({ target, draft }: { target: string; draft: Draft }) {
  const { subject, body, ...rest } = draft
  return (
    <>
      <div className="grid grid-cols-[5rem_minmax(0,1fr)] gap-x-2.5 gap-y-1">
        <Row label="To">{target}</Row>
        {subject !== undefined && <Row label="Subject">{subject}</Row>}
        {Object.entries(rest).map(([key, value]) => (
          <Row key={key} label={key}>
            {typeof value === 'string' ? value : JSON.stringify(value)}
          </Row>
        ))}
      </div>
      {body !== undefined && <div className="bg-muted rounded-sm border p-2 break-words whitespace-pre-wrap">{body}</div>}
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
    <div className="flex flex-col gap-2.5">
      <h3 className="text-[15px] font-bold">{labels.editTitle}</h3>
      <div className="grid grid-cols-[5rem_minmax(0,1fr)] gap-x-2.5">
        <Row label="To">
          <span className="text-muted-foreground">{gate.target}</span>
        </Row>
      </div>
      {draft.subject !== undefined && (
        <>
          <Label htmlFor={`subject-${agent.id}`} className="text-muted-foreground font-normal">
            Subject
          </Label>
          <Input ref={subjectRef} id={`subject-${agent.id}`} value={draft.subject} onChange={(e) => change('subject', e.target.value)} />
        </>
      )}
      {draft.body !== undefined && (
        <>
          <Label htmlFor={`body-${agent.id}`} className="text-muted-foreground font-normal">
            {labels.bodyLabel}
          </Label>
          <Textarea
            ref={bodyRef}
            id={`body-${agent.id}`}
            value={draft.body}
            onChange={(e) => change('body', e.target.value)}
            className="min-h-48 resize-y"
          />
        </>
      )}
      <div className="flex gap-2">
        <Button onClick={save} disabled={empty}>
          Save changes
        </Button>
        <Button variant="outline" onClick={onCancel}>
          Cancel edit
        </Button>
      </div>
      <Refused show={refused} />
      <p className="text-muted-foreground">{labels.editNote}</p>
    </div>
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
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center gap-2">
        <h3 className="text-[15px] font-bold">{gate.revision > 1 ? labels.editedTitle : labels.title}</h3>
        {gate.revision > 1 && <span className="bg-muted rounded-sm border px-1.5 text-xs">Edited version</span>}
      </div>
      <DraftFields target={event.target} draft={event.draft} />
      <div className="flex gap-2">
        <Button onClick={() => act(agent.id, () => approve(agent.id), { kind: 'approve' })}>{labels.approve}</Button>
        <Button ref={editRef} variant="outline" onClick={() => setEdit(agent.id, { draft: event.draft })}>
          {labels.edit}
        </Button>
      </div>
      <EffectLine effectClass={event.effectClass} />
      <Refused show={refused} />
    </div>
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
    act(agent.id, () => resolve(agent.id, choice), { kind: 'resolve', answer: text! })
  }

  return (
    <div className="flex flex-col gap-2.5">
      <h3 className="text-[15px] font-bold">{event.question}</h3>
      <p className="text-muted-foreground">{event.context}</p>
      <RadioGroup
        aria-label={event.question}
        value={usesWords ? null : optionId}
        onValueChange={(value) => setAnswer(agent.id, { optionId: value as string, words, use: 'option' })}
        className="gap-1.5"
      >
        {event.options.map((option) => {
          const chosen = !usesWords && optionId === option.id
          return (
            <Label
              key={option.id}
              className={`grid cursor-pointer grid-cols-[16px_minmax(0,1fr)] items-center gap-x-2 gap-y-0.5 rounded-sm px-2 py-1.5 font-normal ${chosen ? 'border-foreground border-2' : 'm-px border'}`}
            >
              <RadioGroupItem value={option.id} />
              <b>{option.label}</b>
              {option.detail && <span className="text-muted-foreground col-start-2">{option.detail}</span>}
            </Label>
          )
        })}
      </RadioGroup>
      <Label htmlFor={`own-${agent.id}`} className="text-muted-foreground font-normal">
        Or answer in your own words
      </Label>
      <Input
        id={`own-${agent.id}`}
        placeholder="Type an answer"
        value={words}
        onChange={(e) => setAnswer(agent.id, { optionId, words: e.target.value, use: 'words' })}
        className={usesWords && words.trim() ? 'border-foreground border-2' : ''}
      />
      <div>
        <Button onClick={send} disabled={text === null}>
          Send answer
        </Button>
      </div>
      <Refused show={refused} />
    </div>
  )
}

export function FailureDecision({ agent }: { agent: AgentModel }) {
  const attempt = agent.attempts[agent.attempts.length - 1]
  const steps = agent.steps.filter((step) => step.seq >= attempt.startSeq).length
  return (
    <div className="flex flex-col gap-2.5">
      <h3 className="text-[15px] font-bold">Retry this agent?</h3>
      <div className="grid grid-cols-[5rem_minmax(0,1fr)] gap-x-2.5 gap-y-1">
        <Row label="Status">{agent.status?.statusLine}</Row>
        {agent.status?.error && (
          <Row label="Error">
            <span className="font-mono" style={{ color: 'var(--tone-danger)' }}>
              {agent.status.error.message}
            </span>
          </Row>
        )}
      </div>
      <p className="text-muted-foreground">
        The {steps} {steps === 1 ? 'step' : 'steps'} of attempt {attempt.n} {steps === 1 ? 'stays' : 'stay'} in its trace. Retry starts
        attempt {attempt.n + 1}.
      </p>
      <RetryButton agentId={agent.id} />
    </div>
  )
}
