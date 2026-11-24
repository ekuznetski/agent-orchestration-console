# Architecture

How the console works, file by file. The contract is `README.md`, `mock/orchestrator.d.ts` and
`fixtures/events.json`; the mock is imported unchanged through the Vite alias `@mock`.

## 1. Layers

```
mock orchestrator --events--> SubscriptionManager --apply(event)--> console store (reduce)
        ^                                                                  |
        |                                                        selectors / hooks
        +-------- approve / edit / resolve / retry <-- components <--------+
                                                             |
                                                        view store (screen-only state)
```

| Layer | File | Owns |
| --- | --- | --- |
| Transport | `src/subscriptionManager/subscription.ts` | The one orchestrator of the run, the subscription, every command. No other module creates an orchestrator or sends a command; `view.store.ts` imports only the mock's `DEFAULT_TASK` constant for the default request. |
| Run model | `src/store/console.reducer.ts` | `reduce(state, event, at)`: the only place run state changes. Pure except the two documented exceptions (an unknown event type is logged and skipped; a throwing handler is caught and logged), see section 3. |
| Store | `src/store/console.store.ts` | Zustand store holding `RunState` and `apply(e)`, which calls `reduce` with `Date.now()`. |
| Derived data | `src/store/selectors.ts` | Pure functions over `RunState`: run header, phase, pending command, trace, decision queue. |
| React access | `src/store/hooks.ts` | Small selector hooks so a component subscribes only to what it renders. One agent is read by reference (`useAgent`), so an event for another agent does not re-render it; objects and arrays built by selectors (`runHeader`, `decisionQueue`) are compared field by field (`useShallow`). |
| Screen state | `src/store/view.store.ts` | Which decision is shown, the outcome of the last action, request text, speed, jitter, run count, open edits, question answers. Not part of the run model. |
| Labels | `src/config/agentTags.ts` | Words and tones per tag, agent type, action, result kind and effect class, with generic fallbacks. A confirmation whose action has no words of its own is named verbatim ("Approve archive_ticket?"), and its target row reads "Target" ("To" only for `send_email`). |
| Components | `src/components/console/*` | Rendering and user input only. |

## 2. Transport: `SubscriptionManager`

Plain module functions (an ES module is already a singleton): `start`, `cancel`, `reset`, `approve`, `edit`,
`resolve`, `retry`.

- `start(request, speed, jitter)`: stops the previous run, applies `run_reset`, clears screen state (selection,
  outcome, edits) and counts the run in `view.store.runs`, creates a new orchestrator with the speed and jitter,
  subscribes before `start()` (the mock delivers only events emitted after `subscribe`), then calls `start` and
  returns its boolean. When `start` returns `false` (`mock/orchestrator.d.ts`), nothing runs: the manager stops
  the orchestrator, applies `run_reset` and calls `runRefused`, which does not count the run (`runs` 0) and
  sets `startRefused`, so the start card shows again with "The orchestrator did not start the run."
- `cancel()`: unsubscribes, `reset()`s the mock (cancels its timers), applies `run_cancelled`.
- `reset()`: used by the error fallback's "Start over"; stops the run and goes back to the start card.

What each call clears in the view store (request, speed and jitter always stay):

| Call | Run state | Selection, outcome | Open edits | `runs` |
| --- | --- | --- | --- | --- |
| `start` | reset, then the new run | cleared | edits and answers cleared | +1 |
| `cancel` | kept, agents marked cancelled | outcome cleared | kept (no control can send them) | kept |
| `reset` | reset | cleared | edits and answers cleared | 0, so the start card shows |

- Commands are sent only from controls that exist while the run has an orchestrator: before `start`, after a
  refused start and after `cancel` the decision queue is empty, so no Approve, Edit, Send answer or Retry is
  rendered, and `send` has no guard for a missing orchestrator (`CancelledRun.test.tsx` checks the controls).
- Commands: the mock returns `true` when it accepted a command, `false` when the agent was not in a state
  that accepts it (README). Only an accepted command is recorded, as the local event `command_sent`, after
  the handler returns. That relies on the README: the mock is "driven by `setTimeout`", so an agent's answer
  never arrives inside the call. `afterSeq` is the agent's `maxSeq` read before the call. `command_sent` also
  carries what was actually sent (section 3, Actions), so the agent record can show it later. A command sent while the agent's previous command is still
  pending does not reach the mock and returns `true` (it is already in flight), so it never reads as refused.
  Components show "The agent did not accept this action" when a command is refused.

## 3. Run model: `reduce`

`RunState` (`console.reducer.ts`):

| Field | Meaning |
| --- | --- |
| `status` | `idle`, `running`, `settled` (every agent done or failed), `cancelled`. |
| `plan` | `task` and `order` (agent ids in plan order); null before the plan. |
| `agents` | `AgentModel` by agent id: latest status, steps, attempts, the user's actions, gate, own `maxSeq`, derived tag. |
| `result` | The latest result with a version number (1, then 2 after a retry), `outdated` once an agent runs again. A newer result replaces it; no history is kept. |
| `startedAt` | Wall-clock time the plan arrived; also the key that remounts the cards on a new run. |
| `log` | Every contract event in arrival order, with `late`. |
| `maxSeq` | Highest seq received in the run, for `late`. Each agent also keeps its own `maxSeq`. |
| `modelError` | Set when a handler throws; the top bar warns that the screen may not match what the agents did. |

`reduce(state, event, at)` handles three local events and every contract event:

| Event | Handling |
| --- | --- |
| `run_reset` (local) | Back to `initialState`. |
| `run_cancelled` (local) | Run status `cancelled`; every agent that is not `done` or `failed` becomes `cancelled`. |
| `command_sent` (local) | Appends the action to the agent's `actions`: `{ kind, afterSeq, ...what was sent }`; `afterSeq` is the agent's `maxSeq` read before the call. |
| `plan` | Creates one `AgentModel` per subtask, in plan order; stores `task`, `order`, `startedAt`. |
| `agent_status` | Kept only if its `seq` is newer than the stored status (a late `running` never overrides `done`). Updates attempts; a status newer than the latest result marks that result `outdated`. |
| `agent_step` | Inserted into `steps` by `seq`, so a late step lands in its place. |
| `confirmation_required`, `escalation_required` | Stored as the agent's `gate` if newer than the current one. |
| `result` | Replaces the stored result (version + 1) if newer than it. |

Every contract event is also appended to the raw `log` with `late: seq < highest seq so far`.

- `handlers` is an object with one handler per contract event type; its mapped type makes a missing
  handler a build error.
- `putAgent` stores an agent with its `maxSeq` (highest seq from that agent) and derives its tag, then
  derives the run status (`settled` once every agent is `done` or `failed`).

### Deliberate exceptions to the no-guards rule

The project rule allows no guard without a contract line. These three are deliberate, each with its reason:

1. An unknown event type is logged (`console.warn`) and skipped in `reduce`, before the raw log, so it never
   reaches a handler. Reason: the event union in `mock/orchestrator.d.ts` is the set this console knows; a
   newer backend may add a type, and one unknown event must not stop the run from updating.
2. A handler that throws is caught in `reduce`: the event stays in the log and the run's `maxSeq` moves, but
   every model change of that event is dropped and the error goes to `console.error`; `modelError` is set and
   the top bar warns "The screen may not match what the agents did". Reason: a reducer bug must not freeze the
   store for the rest of the run.
3. The app error boundary (`AppErrorFallback`) with "Start over". Reason: a render bug must leave the user a
   way back to a working screen.

### Agent tag (`tagOf`)

Checked top to bottom:

1. A gate whose `seq` equals the agent's `maxSeq` is open: `needs_approval` (confirmation) or
   `needs_answer` (question). Any newer event from that agent closes it, with one exception: while an
   `edit` sent after the current confirmation is pending, the tag stays `needs_approval`. Otherwise a step
   the agent reports between `edit()` and the re-emitted confirmation would flip the badge
   Needs approval -> Running -> Needs approval for a moment.
2. Otherwise the stored status: `running`, `failed`, `done`; anything else (`queued`, no status) is `queued`.
3. `cancelled` is set only by `run_cancelled`, directly, not through `tagOf`.

The tag is recomputed only when an orchestrator event stores the agent (`putAgent`); `command_sent` does not
change it, so an agent stays "Needs approval" until its next event.

### Attempts

`attempt` is optional in the contract. A status with `attempt` higher than the current one starts a new
attempt; without it, `failed` followed by a non-failed status does. A `failed` status records
`{ seq, message }` on the current attempt (`error.message`, or the status line when `error` is absent).

### Actions

`actions` is the agent's list of accepted commands, in the order they were sent. Each one records what was
actually sent, read when the handler returned `true` (a refused command records nothing):

| `kind` | Recorded |
| --- | --- |
| `approve` | The approved gate's `action`, `target`, `effectClass`, `revision` and the full `draft`. |
| `edit` | The sent `draft`. |
| `resolve` | The picked option's `optionId` and `label`, or the typed `words`. |
| `retry` | The `attempt` it started. |

### Gates and edits

- A confirmation keeps `openedSeq`, the seq it first opened at, for its place in the queue.
- A re-emitted confirmation is "the same gate, edited" only when the user's last command was an `edit`
  sent after that gate (README: edit() "re-emits confirmation_required with revision + 1"); then it keeps
  `openedSeq`. Steps the agent reports between the edit and the re-emit do not change that.
- `revision` is optional: without it the reducer counts revisions itself.

## 4. Derived data: `selectors.ts`

| Function | Returns |
| --- | --- |
| `phaseOf` | `idle`, `running`, `finishing` (settled, no current result yet or it is outdated), `completed`, `partial` (degraded), `cancelled`. A settled run with a command in flight (a Retry accepted after a partial result, before the agent answers) is `running`. |
| `runHeader` | Phase, done count, total, "need you" count (`waitingQueue` length). |
| `pendingCommand(agent)` | The command the agent has not answered yet, or null. There is no ack in the API, so: `edit` is answered only by a newer gate (the re-emitted confirmation); any other command by any newer event of that agent. |
| `traceOf(agent)` | Steps grouped by attempt, in seq order, with the failure row that ended an attempt (its status line, plus the raw error when `retryable` is false). No row for the user's own commands: the "Attempt N" divider says a retry happened, and after approve, edit and resolve the agent reports its own step. |
| `decisionQueue` | Agents with a decision in the panel, oldest wait first: open gate (by `openedSeq`; while an edit is in flight the confirmation stays open, so the agent keeps its place) or retryable failure (by its status seq). Empty after a cancel. |
| `waitingQueue` | `decisionQueue` without agents whose command is pending: what the user can act on now. |
| `statusLineOf(agent)` | The card's status line: the newest text by seq of the latest status and the latest step; a failed agent keeps its status line; a cancelled one shows "Last status: " + the same newest text (a step newer than its last status wins). |

`needsUser(agent)` is the single rule for "waits for the user". A failure with `error.retryable === false`
is not in the queue and gets no Retry; a failure without `error` is offered Retry.

## 5. Screen state: `view.store.ts`

| Field | Meaning |
| --- | --- |
| `mode` | `decisions` or `agent`: what the panel shows. `select(id)` and `backToDecisions()` set `decisions`; `openRecord(id)` sets `agent`. `start` and `reset` return to `decisions`; `cancel` keeps an open record. |
| `selectedId` | The decision the user picked, kept while a record is open so "Back to decisions" returns to it. `select(id)` also clears the outcome; `pin(id)` does not. |
| `recordId` | The agent whose record is open in `agent` mode. |
| `outcome` | What the user sent, stored when the mock accepted the command: `{ agentId, kind, answer?, attempt? }` for approve, edit, resolve or retry. Never rebuilt from the run model, so it cannot disappear when the agent answers. The panel shows it until the user moves. |
| `focusRequest` | A counter bumped by `select`, `openRecord` and `backToDecisions`; the panel moves focus to what it then shows. Reset to 0 by `start` and `reset`. |
| `clock` | The run clock: `total` ms of finished working spans and the open span `since`. The top bar opens it at the plan, stops it when the run ends and reopens it on an accepted Retry, so "took" and "into the run" count only the time the run worked, not the user's idle time before a Retry. Reset by `start` and `reset`. |
| `request`, `speed`, `jitter` | The request text and the mock's speed and jitter (creation options), shared by the start card and the top bar. |
| `startRefused` | The mock refused the last `start`; the start card shows the message until the next start. |
| `runs` | How many runs were started (a refused start is not counted); the start card shows until the first run has its plan. |
| `edits` | Per agent: an open editor `{ draft }`. Survives switching decisions; removed by Cancel edit and when the mock accepts the edit (what was sent is in the agent's actions). |
| `answers` | Per agent: a question's picked option and typed words. Picking an option keeps the words; typing makes the words the answer; clearing the words gives the answer back to a picked option. Survives switching decisions; removed when the mock accepts the answer (a later question from the same agent starts empty), on a new run and on reset. |

How the panel picks what to show (`hooks.ts`):

- `useShownDecision`: the selected agent while it is in `waitingQueue` (the user can act on it), otherwise
  the first in that queue. The panel pins what it shows (`pin`), so a gate that arrives later with a lower seq
  does not take its place.
- `useVisibleOutcome`: the outcome in `decisions` mode. A stored outcome replaces the decision and stays,
  also after the run ends, until the user picks something else.
- `useIsShown` and `shownDecisionNow`: the agent the panel is about: the open record's agent in `agent` mode,
  otherwise the outcome's agent first, then the shown decision. The card ring and connector use the first;
  `RetryButton` uses the second at click time.

### The panel rule

Async events never move, resize or replace what the user is reading or the control under the cursor; only the
user's click switches the panel. Focus stays where the user put it. In practice:

- A decision that arrives does not replace a shown decision, outcome or record. It is announced by its card
  badge, "K need you" in the header and the "Next decision" button under an outcome. The one exception is the
  empty panel ("Nothing needs you right now ... New decisions open here"): the first decision that arrives
  opens there, since nothing is being read.
- The outcome's second line and the button slot under it change in place: the second line has a fixed height of
  two lines (the card's status line stays one line, with the full text in its tooltip), and the slot keeps its height whether it holds the button or "Nothing else needs you right now."
- There is no auto-advance and no Prev / Next: the user moves by the Next decision button or a card click.
- The agent cards move in exactly two cases, both about the result block above them: when the first result
  arrives (once per run), and when a newer result replaces it, which follows the user's Retry (README: retrying
  after a degraded result "re-opens aggregation and a fresh `result` supersedes it"). Before the replacement the
  block keeps its height ("Retrying..." rows, "Updating" dims in place). The e2e watch (`watchLayout`) checks
  this every frame in page coordinates (the page scrolls): a card move in any other frame, or the block going away,
  fails the test. E2E waits for the fonts before measuring.
- The open event log is a debug view: closed by default; while open it grows with every event and may move the
  content below it. That is accepted for a debug tool the user opened.
- A third case is the user's own: a trace the user expands grows its card (up to the 400px cap, then it scrolls
  on its own) and moves the cards below it. It is caused by the click and bounded by the cap; new steps in an
  open trace do not grow it past the cap.
- Focus moves only after the user's own action, to the next sensible control: Edit focuses the editor's first
  field, Cancel edit gives it back to the Edit button; an outcome (after Save, Approve, Send answer, Retry) focuses the Next decision button, or the outcome
  line when nothing waits; a card click, Next decision or Back to decisions focuses the shown decision (a group
  labelled with the agent) or the record's heading. A decision that opens in the empty panel by itself does
  not take focus.

Component-local state: open trace (`AgentCard`), open event log (`TopBar`), the refused-command text (in the panel and in `RetryButton`; `useClearOnNextAction` clears it on the user's next click or input anywhere, before that action's own handler runs).

## 6. Components

| Component | Reads | Does |
| --- | --- | --- |
| `App` | plan order, plan task, run key, `runs` | Start card until the first plan; then top bar, result, agents, decision panel. Cards are keyed by run so a new run remounts them. |
| `StartCard` (`TopBar.tsx`) | request, speed, jitter, `runs` | Request, speed and jitter before the first run; "Starting..." and off until the plan arrives; off for an empty request. After a refused start: "The orchestrator did not start the run." |
| `TopBar` | run header, plan task, log size | A visually hidden h1 "Agent orchestration console" (the start card and the error fallback have their own h1). Request (shows `plan.task` while the run works), Cancel run / Run again, one-line run line (see Visual design: elapsed time, phase word or badge, counts; no counts before the plan; with "The screen may not match what the agents did" while `modelError` is set, until the next run), Debug row (speed and jitter are fixed during a run; the note "Speed is set before a run" keeps its space when hidden, so the run ending does not move the event log toggle), event log toggle. The phase with its counts and "K need you" are polite live regions, so a new decision is announced; the ticking clock is outside them. |
| `ResultBlock` | latest result, run header, request, speed, jitter | The result above the agents, appearing once it arrives (it moves the agents only as the panel rule allows: when it first appears, and when a newer result replaces it after the user's Retry); complete, partial, updating (outdated) or cancelled; Retry on an error item whose agent the user can retry now (the partial note says "Retry it to update this result" only then); after the click the item's button row and the note keep their place and read "Retrying..." (the note: "Retrying... This result updates when the agent finishes.") until a newer result replaces the block, so a retry from the result does not move the agents before that; the block never goes away once shown; after a cancel a result that already arrived stays with its own heading (Partial result or Complete, never "Updating", not dimmed), marked "From before the run was cancelled.", with no Retry and no "Retrying..." note or row (Run again is in the top bar). It subscribes only to primitives (can retry, retrying) and each item (`ResultItem`) to its own agent's label and retry state (`canRetryFromResult`, `isRetryingFromResult`), so an event for another agent does not re-render it. |
| `AgentCard` | its agent, waiting for the user, is shown | Label, badge, one truncated status line, Show steps. Clicking the card selects it: an agent the user can act on now (in `waitingQueue`) shows its decision; any other agent, one whose command is still pending included, opens its record in the panel. Footer button (the keyboard path; `aria-current` on the card the panel is about, since it navigates rather than toggles): "Decision in the panel" for an approval or a question, "Retry in the panel" for a retryable failure (Retry is in the panel only), otherwise "Details in the panel". Fixed badge column. The status line is the newest of the status and the last step (after an answer the agent reports a step before its next status); failed keeps its status line; a cancelled agent shows "Last status: " + its newest text (status or step, whichever is newer). The selected card (a decision, an outcome or a record) is white and gets the connector (see Visual design). The trace opens between the status line and the footer. |
| `AgentList` (`AgentCard.tsx`) | plan order, run status | The heading "Agents - plan order", then one card per agent in plan order; "Planning..." before the plan, or "The run was cancelled before the plan arrived." after a cancel. |
| `AgentTrace` | its agent | `traceOf` as a numbered timeline (step numbers run across attempts, a check icon per step on a teal line that turns red into the failure row, which shows its status line verbatim); "Attempt N" dividers appear once there is a second attempt; a "Working" row with the status line while the agent runs, only if that status is newer than its last gate and the attempt has steps; empty text without steps. An open trace is capped at 400px with its own scroll; a new step scrolls it to the bottom unless the user scrolled up. |
| `DecisionPanel` | shown decision, outcome, waiting count | One decision at a time in a `Frame` (see Visual design): failure, confirmation (view, editor, edited version) or question; the header shows "K need you" while decisions wait. A confirmation shows every field that will be sent; the body takes its natural height, never clipped by an inner scroll (the panel itself scrolls), so the whole draft is on screen before an irreversible action. After an accepted command the outcome replaces the decision: the first line is what was sent ("Approved", "Edit submitted", "Answer sent: ...", "Retry sent: attempt N"), the second line is the agent now ("Waiting for the agent to respond." while the command is pending, "The agent prepares the edited email; you approve it next." after an edit, then the agent's status line, verbatim (`statusLineOf`)). Under it, in a slot of fixed height, "Next decision: <agent label>" when a decision waits (the outcome's own agent first when it asks again, otherwise the longest wait), or "Nothing else needs you right now."; the switch happens only on click. Empty: "The run was cancelled." after a cancel (also before the plan), "The agents are starting" while every agent is queued, otherwise worded by phase. In `agent` mode the panel shows the record instead, with "Back to decisions (N)" (N = waiting decisions; just "Back to decisions" when none waits) in the header. The panel landmark is named "Decisions waiting for you", or "Agent record" while a record is open. The failure decision says "The 1 step ... stays" or "The N steps ... stay". |
| `AgentRecord` | its agent, its result items, its actions | What one agent did and what the user sent: current status line (two lines of fixed height, the full text in its tooltip); "You approved" with the full sent draft (To, Subject, other fields, body at its natural height, revision) and its effect class ("Irreversible: ...", red for irreversible); "You sent an edited version"; "You answered: ..."; "You retried: attempt N". The trace stays in the card. Then, below what the user did, its result items (`result.items` for that agent, marked "Updating" while the result is outdated and the run is not cancelled): a result arriving later is added under what the user is reading, not above it. |
| `RetryButton` | its agent | The one Retry used by the panel and the partial result; in `decisions` mode it stores its outcome when the panel is about that agent or already shows an outcome; a retry from the result never replaces another agent's open decision or an open record. |
| `EventLog` | raw log | Debug table of every event (region "Event log" inside the run card; #, seq with a late mark, type, agent, detail), late rows amber, failure rows red, Copy JSON (the button reads "Copied" or "Copy failed" for 2 s, from the clipboard promise). A debug view: closed by default, and when open it shows every event at full height (the page scrolls); it grows while events stream and may move the content below it. A fixed table layout with set column widths, so a long payload truncates (full text in its tooltip) instead of widening the table. |
| `AppErrorFallback` | - | Error boundary fallback with "Start over" (`SubscriptionManager.reset`). |

### Visual design

- Source: the "Design" page of the design canvas (boards 0 to 7); the theme is its `theme/theme.css`, carried into
  `src/index.css` as shadcn/ui tokens on Tailwind v4: background `#e4e9ee`, cards `#fafbfc`, primary `#25394d`,
  border `#c8d0d8`, radii 3 / 5 / 8px, Public Sans for text and IBM Plex Mono for code, seq and addresses
  (self-hosted through fontsource packages imported in `index.css`, so the app and e2e work offline). Components use only theme tokens: no hex values, and the canvas'
  13 / 15 / 12.5 / 22 / 28px sizes are type tokens (`text-label`, `text-title`, `text-code`, `text-heading`,
  `text-display`) next to Tailwind's steps.
- Layout (boards 0, 1, 4): a centred column up to 1200px with "Wand - Agent console" above; one raised card
  holds the request with Cancel run / Run again, the run line and the debug row (and the event log when open);
  below it the agents (2fr) and the decision panel (3fr, sticky; a panel taller than the window scrolls on its
  own). The start card is centred with the debug row in its footer.
- Run line (the run counts as working from an accepted Retry until the agent settles again, so Cancel run shows and
  the debug controls lock during that span): while the run works "M:SS into the run", "Running - N of M done", "K need you" and, on the right, "The
  result appears above the agents when the run ends"; once it ends a state badge (Completed, Partial result, Run
  cancelled), "N of M done" and "took M:SS" (or "at M:SS" for a cancel). The line has a fixed height, so the
  badge replacing the plain word does not move what is below.
- Status tones: colour means state only. Amber (`needs`, `needs-edge`, `needs-bar`) is "needs you" (approval or
  answer), red (`failed`, `failed-tint`) is failed, teal (`done`, `done-tint`, `done-ink`) is done; running,
  queued and cancelled are neutral. Badges are the shadcn `Badge` with one variant per state (`StatusBadge`): an
  icon and the label; the running icon spins unless reduced motion.
- Loading: a spinner (`Spinner`, lucide LoaderCircle, fixed 14px, still under reduced motion) shows the run works
  before anything else moves: in the start button ("Starting...") and the run line ("Starting") from the click
  until the plan, in "Planning..." where the agents will be, next to "Running" / "Finishing" in the run line, and
  as the icon of running agents' badges. Its size is fixed, so it never changes layout.
- Elevation: one theme shadow (`shadow-raised`) for everything raised: the run card, the result, the decision
  panel and the selected agent card. Unselected cards have none.
- Agent cards: all share the card surface and one even 2px border on all four sides, coloured only for needs
  you (bright amber `needs-bar`) and failed (`failed`); done, running, queued and cancelled have the neutral
  border. No top stripe. The selected card (its decision, outcome or record is in the panel) is raised
  (`shadow-raised`) and joined to the panel by a connector in its state colour; no ring, no outline, no size or
  border change. The trace is a numbered timeline (numbers run across attempts, a check icon per step on a teal
  line that turns red into the failure row, which shows its status line verbatim; "Attempt N" headers).
- Decision panel: a card with a 3px left edge in the colour of what it shows (amber decision, red failure, teal
  outcome (neutral after an edit), the agent's colour for a record, neutral when empty) and a header with "K need you". Each decision
  or outcome is a `Frame`: a band with the agent's label and the question (amber for approvals and questions,
  red for a failure, teal for an outcome whose action happened, neutral for a submitted edit, which sends nothing), the body, and a footer bar with the actions, pinned to the bottom of the
  panel card (minimum height 420px, so the footer does not jump between states). Under an outcome the footer holds
  "Next decision: <agent label>" on the right, or "Nothing else needs you right now." in the same fixed height.
- Form controls (Input, Textarea, Checkbox, RadioGroup, the speed toggle) are the shadcn components on the
  surface they sit on (transparent fill over the card), with the `input` border and the `ring` focus ring.
  `dark:` applies only under a `.dark` class, which the app never sets, so a system dark mode does not grey-fill
  them (e2e checks this with a dark colour scheme).
- Disabled: Base UI's Checkbox marks itself with `data-disabled`, not `:disabled`, so a Label holding a disabled
  control dims as a whole (`has-data-disabled:opacity-50`); the locked Jitter during a run looks disabled like
  the speed buttons (e2e checks its opacity).
- Question: options are bordered rows; the chosen one keeps the 1px width with the primary border and a light
  muted fill. "Or answer in your own words" is a 4-line Textarea; holding the answer it gets the primary border.
- Buttons: primary actions use the primary variant everywhere (Approve, Save, Send answer, Retry, Next
  decision, Run again); secondary actions the outline variant. Colour belongs to bands, badges and the effect
  line, not to buttons.
- Effect line: directly under the Approve / Edit buttons, normal size, semibold, with an alert icon:
  irreversible in the failed red, reversible, read only and unknown classes in the normal text colour.
  Reason: the warning sits where the eye and the cursor are at the moment of clicking, not above the draft.
  Questions have no effect line.
- Result: a band with an icon, the heading (Complete, Partial result, Updating) and one truncated note line
  ("All N agents finished", the retry notes, "From before the run was cancelled."), then the summary; items
  in a two-column list with the kind and the agent's label on the left and sources as outline badges.
- Event log: inside the run card; "N events received - K arrived late", Copy JSON, and a table with #, seq
  (with a "late" mark), type, agent and detail; late rows amber, failure rows red.
- Where the app differs from the boards, on purpose: the result sits above the agents in the left column, not
  across the page, because a block across both columns would push the decision panel down when it arrives
  (panel rule); the panel keeps the outcome after the run ends instead of "Nothing needs you" (an outcome stays
  until the user moves); the outcome shows what was sent and the agent now, not a timeline; the debug row
  keeps Jitter and the event log count, and "Speed is set before a run" keeps its space when hidden; done cards
  keep "Details in the panel" (the record); Retry is primary, not red (button rule above).

## 7. Data flow of one decision

1. The mock emits `confirmation_required` (seq 20). `apply` -> `reduce` stores the gate; `tagOf` gives
   `needs_approval`; the card badge changes in place.
2. `decisionQueue` and `waitingQueue` now hold the agent; the panel shows it if the panel is empty, and pins
   it (`pin`) so an out-of-order gate with a lower seq never swaps the content under the cursor. If another
   decision or an outcome is on screen, only the badge, the header count and the Next decision button change.
3. Approve: `SubscriptionManager.approve(id)` -> mock returns true -> `command_sent` -> `pendingCommand`
   is `approve`; the panel stores the outcome "Approved" with "Waiting for the agent to respond." and it
   replaces the decision. The agent leaves `waitingQueue`, so its card now opens the record.
4. The agent's next event (a step, seq 21) answers the command: `pendingCommand` is null, the gate is closed,
   the tag is `running`; the outcome's second line becomes the agent's status line. The first line
   never changes.
5. Edit instead: Edit opens the editor (`edits[id] = { draft }`); Save calls `edit(id, draft)`; on true the
   editor closes and the outcome "Edit submitted" shows. The re-emitted confirmation (revision 2) keeps
   `openedSeq`, so `pendingCommand` becomes null; the agent is back in `waitingQueue` and the button reads
   "Next decision: Draft a follow-up to Maya Chen" (the outcome's own agent first). Its click shows "Send the edited email?" with
   Approve. Draft fields other than subject and body are sent back unchanged; an empty subject or body cannot
   be saved. The To row (`target`) is shown read-only in the editor.
6. Question: the picked option sends its id to `resolve`, otherwise the trimmed own words; the chosen one has
   the dark border. Then an outcome as in 3, with the answer text that was sent.

## 8. Contract traps

1. Out-of-order events: the model is ordered by `seq`: stale statuses are dropped, steps inserted by seq, a
   gate is open only while it is the agent's newest event. The raw log keeps arrival order and marks late
   rows; the user's actions are kept in the order they were sent.
2. `result` can arrive twice: the result is versioned; a newer status marks it outdated
   ("Updating"), and the newer result replaces it.
3. No acknowledgements: `pendingCommand` infers the answer from the agent's next event (for an edit, its
   next gate).
4. Texts from the mock are shown verbatim even when they disagree with other fields (e.g. "after 3
   attempts" with `attempt: 1`); the console does not correct the backend.

## 9. Tests

Every test file is named after what it covers (e.g. `CancelledRun.test.tsx` for Cancel run and Run again).

Unit and component tests test the app, not the mock: every test that reaches `@mock/orchestrator.js` (directly,
through the subscription manager, or through the view store's default request) replaces it with the fake module
in `src/test/fakeOrchestrator.ts`. Only `mockAlias.test.ts` loads the real mock.

| Suite | Covers |
| --- | --- |
| `console.reducer.test.ts` | Every event type, late events, attempts, gates and revisions, result replacement, cancel, the raw log, a handler that throws, the edit seam (a step between `edit()` and the re-emitted confirmation keeps `needs_approval` and the queue place). |
| `selectors.test.ts` | Run header, phase (an accepted Retry after a partial result is running), pending command, the retry lifecycle, trace grouping, decision queue order (edit keeps its place), retryable, status line. |
| `subscription.test.ts` | The manager against a fake orchestrator (the real mock is never loaded): subscribe before start asserted directly, speed and jitter passed, a refused start stopped and not counted, a second start stops the previous run, commands recorded only when accepted, `afterSeq` read before the call, a pending command not sent again, what `start`, `cancel` and `reset` clear. |
| `AgentList.test.tsx` | With the fake mock module: N agents give N cards, a fourth agent type, a card updated in place, trace order with the late step, the empty trace, Done kept after the late step. |
| `PanelSelection.test.ts` | With the fake mock module: which decision the panel shows, the outcome kept after the run ends, the outcome first in `shownDecisionNow`, `select` vs `pin`. |
| `Actions.test.tsx` | Against a fake orchestrator: approve and its outcome with no Approve left for a second click (the manager's guard against a second command is tested in `subscription.test.ts`), the outcome kept while the agent answers and the run ends with its second line following the agent, a card click on a pending agent opening its record, edit with kept text and the re-asked confirmation offered first, an unknown action named verbatim with a Target row, answers by option and by own words, cleared words giving the answer back to the option, a second question from the same agent starting empty, retry from the panel and from a partial result (the error row and the note kept as "Retrying..."), a refused command and its clearing (also a refused Retry from the result), the Next decision button (longest wait, no switch by itself, absent while nothing waits, added when a decision arrives), a decision that arrives not replacing the one on screen; focus after Edit, Cancel edit, Save, Approve and a card click, and not taken by a decision that opens in the empty panel. |
| `AgentRecord.test.tsx` | The record shows the approved email after the gate closed; a result arriving later goes below "What you did"; an arriving decision does not replace an open record and N grows; Back to decisions returns to the pinned decision and shows no count when nothing waits; a refused command records nothing; the panel landmark is named after what it shows.; the selected card's link carries aria-current. |
| `CancelledRun.test.tsx` | Cancel mid-run with an open decision and a running agent: cards Cancelled with "Last status: ...", the queue empty and no command control left (also in a record), "Run cancelled", Run again; an open record stays; Run again starts with the edited request and clears screen state per section 2; a Run again the mock refuses returns to the start card with its message; Cancel before the plan shows the cancelled state, not "Planning..."; the console has one h1; Cancel during a retry after a partial result leaves the result with its own heading and no retrying note or row.; an accepted Retry on a partial result shows Cancel run, locks the debug controls and resumes the clock without the idle time.; the run line's live regions hold the phase, counts and need-you, not the clock; a spinner from Run again until the plan (run line and Planning...) and next to Running. |
| `ModelError.test.tsx` | A handler that throws: the top bar warns "The screen may not match what the agents did", and later events still apply. |
| `AppErrorFallback.test.tsx` | A render error shows the fallback; Start over calls `reset` (a stub manager, not the real one) and renders again. |
| `EventLog.test.tsx` | Copy JSON says "Copied" and returns to "Copy JSON" after 2 s; a refused clipboard says "Copy failed". |
| `ResultRenders.test.tsx` | An event for an agent the result does not show does not re-render the result block (React Profiler). |
| `mockAlias.test.ts` | The `@mock` alias loads the real mock (the only unit test that touches it). |
| `e2e/definition-of-done.e2e.ts` | Each Definition-of-done item from the task text in a real browser with the real mock at 4x (0.25x for the empty trace and the wait after Edit, so those states are asserted strictly), item 6 also checks that all three agents end Done and that Scheduling's late last step (seq 29 after its done, seq 30) sits in place in its trace; item 4 checks that the draft body is not clipped in the confirmation and in the record, and "not sent" only after the other agents have reached their own waits; plus agent cards keeping their position (every frame, `watchLayout`) while decisions open and close, moving only when the result first appears, a partial result retried from the result (every frame: the block stays, the cards move only when the newer result replaces it), Cancel during that retry, Cancel / Run again (the debug row items keep their place across running, cancelled and running again), the event log toggle keeping its place while events stream and the log table no wider than its box in an 800px window, form controls not grey-filled under a dark colour scheme. Every wait is on UI state. Two Playwright projects run the whole file without and with the mock's jitter, set through the UI: `pnpm e2e` runs the one without jitter (the default), `pnpm e2e:jitter` the one with it. The suite always starts its own dev server from this checkout on port 5298 (`E2E_PORT`), never reusing a running one. |
