# Architecture

How the console works, file by file. The contract is `mock/README.md`, `mock/orchestrator.d.ts` and
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
| React access | `src/store/hooks.ts` | Small selector hooks so a component subscribes only to what it renders. One agent is read by reference (`useAgent`), so an event for another agent does not re-render it; objects and arrays built by selectors (`runHeader`, `waitingQueue`) are compared field by field (`useShallow`). |
| Screen state | `src/store/view.store.ts` | Which decision is shown, the outcome of the last action, request text, speed, jitter, run count, open edits, question answers. Not part of the run model. |
| Labels | `src/config/agentTags.ts` | Words and tones per tag, agent type, action, result kind and effect class, with generic fallbacks. A confirmation whose action has no words of its own is named verbatim ("Approve archive_ticket?"), and its target row reads "Target" ("To" only for `send_email`). An unknown result kind is named verbatim ("ledger_update"); an unknown step act is shown with its first letter capitalized ("Reconciled:"), like the known acts. |
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
  that accepts it (mock/README.md). Only an accepted command is recorded, as the local event `command_sent`, after
  the handler returns. That relies on `mock/README.md`: the mock is "driven by `setTimeout`", so an agent's answer
  never arrives inside the call. `afterSeq` is the agent's `maxSeq` read before the call. `command_sent` also
  carries what was actually sent (section 3, Actions), so the agent record can show it later. A command sent while the agent's previous command is still
  pending does not reach the mock and returns `'in-flight'` (`send` returns `'sent'`, `'in-flight'` or `'refused'`),
  so it never reads as refused and never shows an outcome again; only `'sent'` stores an outcome. The next retry's
  attempt number is computed once, by `retry`, and the outcome reads it from the recorded action
  (deliberate exception 4 below).
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
| `run_cancelled` (local) | Run status `cancelled`; every agent that is not `done` or `failed` becomes `cancelled`, and so does a failed agent whose accepted Retry it has not answered yet (it is working again). |
| `command_sent` (local) | Appends the action to the agent's `actions`: `{ kind, afterSeq, ...what was sent }`; `afterSeq` is the agent's `maxSeq` read before the call. |
| `plan` | Creates one `AgentModel` per subtask, in plan order; stores `task`, `order`, `startedAt`. |
| `agent_status` | Kept only if its `seq` is newer than the stored status (a late `running` never overrides `done`). Updates attempts; a status newer than the latest result marks that result `outdated`. |
| `agent_step` | Inserted into `steps` by `seq`, so a late step lands in its place. |
| `confirmation_required`, `escalation_required` | Stored as the agent's `gate` if newer than the current one. |
| `result` | Replaces the stored result (version + 1) if newer than it; it is outdated on arrival when an agent's status with a higher seq came first. |

Every contract event is also appended to the raw `log` with `late: seq < highest seq so far`.

- `handlers` is an object with one handler per contract event type; its mapped type makes a missing
  handler a build error.
- `putAgent` stores an agent with its `maxSeq` (highest seq from that agent) and derives its tag, then
  derives the run status (`settled` once every agent is `done` or `failed`).

### Deliberate exceptions to the no-guards rule

No guard without a contract line. These four are deliberate, each with its reason:

1. An unknown event type is logged (`console.warn`) and skipped in `reduce`, before the raw log, so it never
   reaches a handler. Reason: the event union in `mock/orchestrator.d.ts` is the set this console knows; a
   newer backend may add a type, and one unknown event must not stop the run from updating.
2. A handler that throws is caught in `reduce`: the event stays in the log and the run's `maxSeq` moves, but
   every model change of that event is dropped and the error goes to `console.error`; `modelError` is set and
   the top bar warns "The screen may not match what the agents did". Reason: a reducer bug must not freeze the
   store for the rest of the run.
3. The app error boundary (`AppErrorFallback`) with "Start over". Reason: a render bug must leave the user a
   way back to a working screen.
4. `send` does not call the mock for a command while the agent's previous one is pending, and returns `'in-flight'`.
   Reason: a real contract case. After `edit()` the mock keeps the confirmation parked until it re-emits it, so
   it would accept an `approve()` in that window and send the draft the user had just replaced; the same
   guard stops a double click from sending twice.

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
`{ seq, message, status }` on the current attempt: `message` is `error.message`, or the status line when `error`
is absent; `status` is the failed status event itself, for the failure row of the trace.

### Actions

`actions` is the agent's list of accepted commands, in the order they were sent. Each one records what was
actually sent, read when the handler returned `true` (a refused command records nothing):

| `kind` | Recorded |
| --- | --- |
| `approve` | The approved gate's `action`, `target`, `effectClass`, `revision` and the full `draft`. |
| `edit` | The sent `draft`. |
| `resolve` | The picked option's `optionId` and `label`, or, for typed words, only `label` (the words). |
| `retry` | The `attempt` it started. |

### Gates and edits

- A confirmation keeps `openedSeq`, the seq it first opened at, for its place in the queue.
- A re-emitted confirmation is "the same gate, edited" only when the user's last command was an `edit`
  sent after that gate (mock/README.md: edit() "re-emits confirmation_required with revision + 1"); then it keeps
  `openedSeq`. Steps the agent reports between the edit and the re-emit do not change that.
- `revision` is optional: without it the reducer counts revisions itself.

## 4. Derived data: `selectors.ts`

| Function | Returns |
| --- | --- |
| `phaseOf` | `idle`, `running`, `finishing` (settled, no current result yet or it is outdated), `completed`, `partial` (degraded), `cancelled`. A settled run with a command in flight (a Retry accepted after a partial result, before the agent answers) is `running`. |
| `runHeader` | Phase, done count, total, "need you" count (`waitingQueue` length). |
| `pendingCommand(agent)` | The command the agent has not answered yet, or null (always null for a cancelled agent: Cancel run ends the wait). There is no ack in the API, so: `edit` is answered only by a newer gate (the re-emitted confirmation); any other command by any newer event of that agent. |
| `traceOf(agent)` | Steps grouped by attempt, in seq order, with the failure row that ended an attempt (its status line, plus the raw error when `retryable` is false). No row for the user's own commands: the "Attempt N" divider says a retry happened, and after approve, edit and resolve the agent reports its own step. |
| `decisionQueue` | Agents with a decision in the panel, oldest wait first: open gate (by `openedSeq`; while an edit is in flight the confirmation stays open, so the agent keeps its place) or retryable failure (by its status seq). Empty after a cancel. |
| `waitingQueue` | `decisionQueue` without agents whose command is pending: what the user can act on now. |
| `statusLineOf(agent)` | The card's status line: the newest text by seq of the latest status and the latest step; a failed agent keeps its status line; a cancelled one shows "Last status: " + the same newest text (a step newer than its last status wins). |

`needsUser(agent)` is the single rule for "waits for the user". A failure with `error.retryable === false`
is not in the queue and gets no Retry; a failure without `error` is offered Retry.

## 5. Screen state: `view.store.ts`

| Field | Meaning |
| --- | --- |
| `mode` | `decisions` or `agent`: what the panel shows. `select(id)` and `showDecision(id)` (the panel's own switch) set `decisions`; `openRecord(id)` sets `agent`. `start` and `reset` return to `decisions`; `cancel` keeps an open record. |
| `selectedId` | The decision the user picked, kept while a record is open so the record's "Next decision" returns to it while it still waits. `select(id)` and `showDecision(id)` also clear the outcome; `pin(id)` does not. |
| `recordId` | The agent whose record is open in `agent` mode. |
| `outcome` | What the user sent, stored when the mock accepted the command: `{ agentId, kind, answer?, attempt? }` for approve, edit, resolve or retry. Never rebuilt from the run model, so it cannot disappear when the agent answers. The panel shows it until the user moves. |
| `focusRequest` | A counter bumped by `select` and `openRecord` (user actions); the panel moves focus to what it then shows. `showDecision` does not bump it: an event never moves focus (the panel calls `select` instead only when focus was inside the content being replaced). Reset to 0 by `start` and `reset`. |
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
  otherwise the outcome's agent first, then the shown decision. The card's raised look, shift and connector use the first;
  `RetryButton` uses the second at click time.

### The panel rule

Async events never move, resize or replace what the user is reading or the control under the cursor; only the
user's click switches the panel. Focus stays where the user put it. In practice:

- A decision that arrives does not replace a shown decision, outcome or record. It is announced by its card
  badge, "K need you" in the header and the "Next decision" button under an outcome. The one exception is the
  empty panel ("Nothing needs you right now ... New decisions open here"): the first decision that arrives
  opens there, since nothing is being read. The second exception is the answer to the user's own Save: while
  the panel still shows that Save's outcome ("Edit submitted" with a spinner and "The agent is preparing the
  edited email..."), the re-asked confirmation opens by itself (focus outside the panel stays where it is; focus inside the panel content being replaced moves to the new decision group of the same agent, so it never drops to the page body); Every
  command button in the panel (Approve, Edit, Save changes, Send answer, Retry) ignores the second click of a double
  click (`detail > 1`), so a double click on Save, or on Next decision, cannot act on what opens under it.
  If the user moved away first (a card click or Next decision), there is no switch.
  The third: when the agent whose record is open starts waiting for the user (its confirmation or question
  arrives while the user reads its record), the panel opens that agent's decision, with the same double-click and focus rules. The record's footer offers its own agent first when it waits.
- The outcome's second line and the button slot under it change in place: the second line has a fixed height of
  two lines (the card's status line stays one line, with the full text in its tooltip), and the slot keeps its height whether it holds the button or "Nothing else needs you right now."
- There is no auto-advance and no Prev / Next: the user moves by the Next decision button or a card click.
- The agent cards and the panel move in exactly two cases, both about the full-width result block above them: when
  the first result arrives (once per run), and when a newer result replaces it, which follows the user's Retry (mock/README.md: retrying
  after a degraded result "re-opens aggregation and a fresh `result` supersedes it"). Before the replacement the
  block keeps its height ("Retrying..." rows, "Updating" dims in place). The e2e watch (`watchLayout`) checks
  this every frame in page coordinates (the page scrolls): a card or panel move in any other frame, or the block
  going away, fails the test. E2E waits for the fonts before measuring.
- The open event log is a debug view: closed by default; while open it grows with every event and may move the
  content below it. That is accepted for a debug tool the user opened.
- A third case is the user's own: a trace the user expands grows its card (up to the 400px cap, then it scrolls
  on its own) and moves the cards below it. While it stays open it may also grow or shrink with the stream (new
  steps; the Working row appearing, and going when the agent's gate arrives), within the cap, moving only the cards
  below it. The e2e watch allows exactly that, and checks the panel too: its height and its footer's position may
  change only right after the user's own input, when the result moves it, or when a decision opens in the empty
  panel. The panel is sticky, so the watch reads its position in the viewport and skips frames where the page or
  the panel's own scroll box scrolled (the user, or focus moving into view after a click).
- An asynchronous event never moves keyboard focus elsewhere, including the three switches above: focus outside the
  panel stays where the user left it (no scroll jump either). If the focused element is inside the panel content
  being replaced (the outcome's Next decision button, the record heading), focus stays in the panel on the new
  decision group of the same agent, so it never drops to the page body. The editor takes focus only when the
  user's Edit click opened it.
- Focus moves only after the user's own action, to the next sensible control: Edit focuses the editor's first
  field, Cancel edit gives it back to the Edit button; an outcome (after Save, Approve, Send answer, Retry) focuses the Next decision button, or the outcome
  line when nothing waits; a card click or Next decision focuses the shown decision (a group
  labelled with the agent) or the record's heading. A decision that opens in the empty panel by itself does
  not take focus.

Component-local state: open trace (`AgentCard`), open event log (`TopBar`), the refused-command text (in the panel and in `RetryButton`; `useClearOnNextAction` clears it on the user's next click or input anywhere, before that action's own handler runs).

### Panel: what it shows x what happens

Count = "K need you" (`waitingQueue`, without pending commands). Tests: A = `Actions.test.tsx`, R =
`AgentRecord.test.tsx`, C = `CancelledRun.test.tsx`, E = `e2e/definition-of-done.e2e.ts`; "matrix" = the
`panel matrix` group in A.

| Panel shows | What happens | Panel / count / badges / focus | Test |
| --- | --- | --- | --- |
| empty | A starts waiting | A's decision opens (nothing is being read); count +1; focus untouched | A "stays where the user put it" |
| empty | result arrives or is replaced; phase changes | text by phase ("The agents are done...", "The run is finished..."); moves down with a new result | matrix "names the phase" |
| empty | click A's card (A not waiting) | A's record; focus on its heading | R |
| decision of A | B starts waiting | stays on A; count +1; B's badge Needs | A "does not replace the decision on screen" |
| decision or editor of A | A's gate closes without the user | the next open decision (or empty); an editor goes, its draft is kept | matrix (two tests) |
| confirmation or question of A | A fails | A's failure view in place (same agent); badge Failed | matrix |
| decision of A | click a card, Next decision | that agent's decision (or its record if it does not wait); focus on the decision group | A focus tests |
| decision / editor / outcome | double click on any command button | the second click (`detail > 1`) is ignored: Approve, Edit, Save, Send answer, Retry | A, matrix; E DoD 4 |
| editor of A | B starts waiting; switch away and back | editor stays; the typed text survives | A "keeps typed text" |
| outcome of A, pending | A answers | second line changes in place; badge Waiting for agent, then A's tag | A "keeps the outcome while the agent answers" |
| outcome of A | B starts waiting | outcome stays; footer offers B; count +1 | A "adds the button and leaves the outcome" |
| outcome of A | A asks again (not an edit) | outcome stays; footer offers A first | matrix |
| outcome of A | A fails | outcome stays; second line is the failure; footer offers A | matrix |
| waiting after Save of A | A's edited confirmation arrives | opens by itself (exception 2); focus outside the panel unchanged, focus inside it moves to the decision group | A; E DoD 4 |
| waiting after Save of A | the user moved away first | no switch; Next decision points to A | A "does not switch ... moved away" |
| waiting after Save of A | A fails or finishes instead of asking again | ruled out by the contract (`edit()` "re-emits `confirmation_required`"): not handled, the spinner would stay | none (by design) |
| record of A (not waiting) | A starts waiting, also with a pending command | A's decision opens (exception 3); focus outside the panel unchanged, focus inside it moves to the decision group | R; matrix |
| record of A (already waiting, opened from the result) | none | stays a record; footer offers A | R |
| record of A | B starts waiting; the result arrives | record stays; footer offers B; a result arriving goes below "What you did" | R |
| any | Cancel run | the record marks a last command the agent never answered ("Run cancelled before the agent confirmed this"); outcome cleared, "The run was cancelled."; a record stays; unfinished and pending agents Cancelled; focus stays on the slot, now Run again | C; matrix |
| any | Run again | everything cleared; the new run starts with the empty panel | C |
| any | double click Run again | the second click on Cancel run is ignored | E |

## 6. Components

| Component | Reads | Does |
| --- | --- | --- |
| `App` | `hasPlan`, `startedAt` (the run key), `runs` | Start card until the first plan; then the top bar, the full-width result, then the agents and the decision panel side by side. Cards are keyed by run so a new run remounts them. |
| `StartCard` (`TopBar.tsx`) | request, speed, jitter, `runs` | Request, speed and jitter before the first run; "Starting..." and off until the plan arrives; off for an empty request. After a refused start: "The orchestrator did not start the run." |
| `TopBar` | run header, plan task, log size | A visually hidden h1 "Agent orchestration console" (the start card and the error fallback have their own h1). Request (shows `plan.task` while the run works) with Run again at its right, replaced by the text button Cancel run while the run works (a click that is the second of a double click, `detail > 1`, is ignored, so a double click on Run again does not cancel the new run), one-line run line (see Visual design: elapsed time, phase word or badge, counts; no counts before the plan; with "The screen may not match what the agents did" while `modelError` is set, until the next run), Debug row (speed and jitter are fixed during a run; the note "Speed is set before a run" keeps its space when hidden, so the run ending does not move the event log toggle), event log toggle. The phase with its counts and "K need you" are polite live regions, so a new decision is announced; the ticking clock is outside them. |
| `ResultBlock` | the result, the cancelled flag, the plan length, two retry flags | The result full width above the agents and the panel, appearing once it arrives (it moves both columns only as the panel rule allows: when it first appears, and when a newer result replaces it after the user's Retry); complete, partial, updating (outdated) or cancelled; Retry on an error item whose agent the user can retry now (the partial note says "K of N agents failed - retry it to complete the result" only then; with nothing retryable it says "K of N agents failed"); after the click the item's button row and the note keep their place and read "Retrying..." while the agent runs (once it is done the row is empty and keeps its size) (the note: "This result is outdated - attempt N of <agent> is running") until a newer result replaces the block, so a retry from the result does not move anything before that; the block never goes away once shown; after a cancel a result that already arrived stays under the heading "Run cancelled" in a neutral band (never "Updating", not dimmed), noted "This is the result from before the run was cancelled." (with "K of N agents had failed." when an item is an error), with no Retry and no "Retrying..." note or row (Run again is in the top bar). It subscribes only to primitives (can retry, retrying) and each item (`ResultItem`) to its own agent's label and retry state (`canRetryFromResult`, `isRetryingFromResult`), so an event for another agent does not re-render it. |
| `AgentCard` | its agent, waiting for the user, is shown | Label, badge, one truncated status line, Show steps. Clicking the card selects it: an agent the user can act on now (in `waitingQueue`) shows its decision; any other agent, one whose command is still pending included, opens its record in the panel. Footer button (the keyboard path; `aria-current` on the card the panel is about, since it navigates rather than toggles): "Decision in the panel" for an approval or a question, "Retry in the panel" for a retryable failure (Retry is in the panel only), otherwise "Details in the panel". Fixed badge column. The card is a group named by its title (`aria-labelledby`), so its buttons are told apart per agent. Before the first status the line names the state ("Queued"). The status line is the newest of the status and the last step (after an answer the agent reports a step before its next status); failed keeps its status line; a cancelled agent shows "Last status: " + its newest text (status or step, whichever is newer). The selected card (a decision, an outcome or a record) is white and gets the connector (see Visual design). The trace opens between the status line and the footer. |
| `AgentList` (`AgentCard.tsx`) | plan order, run status | The heading "Agents - plan order", then one card per agent in plan order; "Planning..." before the plan, or "The run was cancelled before the plan arrived." after a cancel. |
| `AgentTrace` | its agent | `traceOf` as a numbered timeline (step numbers run across attempts, a check icon per step on a teal line that turns red into the failure row, which shows its status line verbatim); "Attempt N" dividers appear once there is a second attempt; a "Working" row with the status line while the agent runs, only if that status is newer than its last gate and the attempt has steps; empty text without steps; under a newest attempt that has no step yet (after a Retry), "No steps in attempt N yet. Steps appear here as the agent reports them." An open trace is capped at 400px with its own scroll; a new step or the Working row appearing or going scrolls it to the bottom unless the user scrolled up. |
| `DecisionPanel` | shown decision, outcome, waiting count | One decision at a time in a `Frame` (see Visual design): failure, confirmation (view, editor, edited version) or question; the header shows "K need you" while decisions wait. A confirmation shows every field that will be sent; the body takes its natural height, never clipped by an inner scroll (the panel itself scrolls), so the whole draft is on screen before an irreversible action. After an accepted command the outcome replaces the decision: the first line is what was sent ("Approved", "Edit submitted", "Answer sent: ...", "Retry sent: attempt N"; at most two lines, the full answer in the tooltip and the record), the second line is the agent now ("Waiting for the agent to respond." while the command is pending, "The agent is preparing the edited email..." with a spinner after an edit (then the re-asked confirmation opens by itself), otherwise the agent's status line, verbatim (`statusLineOf`)). In the editor the body is capped at 320px with its own scroll, so Save stays reachable for a very long draft (the approval view still shows the whole draft); Save changes stays disabled until the draft differs from the current revision, so an unchanged Save cannot re-ask the same question. Under it, in a slot of fixed height, "Next decision: <agent label>" when a decision waits (the outcome's own agent first when it asks again, otherwise the longest wait), or "Nothing else needs you right now."; the switch happens only on click. Empty: "The run was cancelled." after a cancel (also before the plan), "The agents are starting" while every agent is queued, otherwise worded by phase. In `agent` mode the panel shows the record instead, under the header "Agent record", with the same footer: "Next decision: <agent>" (the picked decision while it still waits, otherwise the longest wait) or "Nothing else needs you right now." The panel header and landmark read "Decisions" (true in every state, with "K need you" beside it only while decisions wait), or "Agent record" while a record is open. The failure decision says "The 1 step ... stays" or "The N steps ... stay". |
| `AgentRecord` | its agent, its result items, its actions | What one agent did and what the user sent: current status line (two lines of fixed height, the full text in its tooltip); "You approved" with the full sent draft (To, Subject, other fields, body at its natural height, revision) and its effect class ("Irreversible: ...", red for irreversible); "You sent an edited version"; "You answered: ..."; "You retried: attempt N". When Cancel run came before the agent answered the last command (`unansweredAtCancel`: no event after its `afterSeq`; for an edit, no newer gate), a line under it says "Run cancelled before the agent confirmed this": for an approved irreversible send, whether it went out is unknown. The trace stays in the card. Then, below what the user did, its result items (`result.items` for that agent, marked "Updating" while the result is outdated and the run is not cancelled): a result arriving later is added under what the user is reading, not above it. |
| `RetryButton` | its agent | The one Retry used by the panel and the partial result; in `decisions` mode it stores its outcome when the panel is about that agent or already shows an outcome; a retry from the result never replaces another agent's open decision or an open record. |
| `EventLog` | raw log | Debug table of every event (region "Event log" inside the run card; #, seq with a late mark, time, type, agent, detail), late rows amber, failure rows red, Copy JSON (the button reads "Copied" or "Copy failed" for 2 s, from the clipboard promise). A debug view: closed by default, and when open it shows every event at full height (the page scrolls); it grows while events stream and may move the content below it. A fixed table layout with set column widths; type and agent are one line and the detail at most two (`ClampedText`, full text in the tooltip), so a long payload never widens the table. |
| `ClampedText` | - | The one rule for text the console does not control in a bounded slot: one line with an ellipsis or at most two lines, `overflow-wrap:anywhere`, the full text in `title`. Used for card titles and status lines, trace rows, the band's agent label, the record header and status, the outcome's second line, the Next decision label, result item labels and titles, the result note, the request while a run works and the event log cells. |
| `AppErrorFallback` | - | Error boundary fallback with "Start over" (`SubscriptionManager.reset`). |

### Visual design

- Source: the "Design" page of the design canvas (boards 0 to 7); the theme is its `theme/theme.css`, carried into
  `src/index.css` as shadcn/ui tokens on Tailwind v4: background `#e4e9ee`, cards `#fafbfc`, primary `#25394d`,
  border `#c8d0d8`, radii 3 / 5 / 8px, Public Sans for text and IBM Plex Mono for code, seq and addresses
  (self-hosted through fontsource packages imported in `index.css`, so the app and e2e work offline). Components use only theme tokens: no hex values, and the canvas'
  13 / 15 / 12.5 / 22 / 28px sizes are type tokens (`text-label`, `text-title`, `text-code`, `text-heading`,
  `text-display`) next to Tailwind's steps. The class merger (`cn` in `src/lib/utils.ts`, used by every shadcn
  component) is configured to know these tokens as font sizes, so a token passed to a component is not dropped.
- Layout (boards 0, 1, 4): a centred column up to 1200px with "Wand - Agent console" above; one raised card
  holds the request with Run again (Cancel run in its place while the run works), the run line and the debug
  row (and the event log when open); below it the result across the full width once it arrives, then the agents (2fr) and the decision panel (3fr, sticky; a panel taller than the window scrolls on its
  own). The start card is centred with the debug row in its footer.
- Run line (the run counts as working from an accepted Retry until the agent settles again, so Cancel run shows and
  the debug controls lock during that span): while the run works "M:SS into the run", "Running - N of M done", "K need you" and, on the right, "The
  result appears at the top when the run ends"; once it ends a state badge (Completed, Partial result, Run
  cancelled), "N of M done" and "took M:SS"; a cancel reads "Run cancelled at M:SS - N of M done". The line has a fixed height, so the
  badge replacing the plain word does not move what is below.
- Status tones: colour means state only. Amber (`needs`, `needs-edge`, `needs-bar`) is "needs you" (approval or
  answer), red (`failed`, `failed-tint`) is failed, teal (`done`, `done-tint`, `done-ink`) is done; running,
  queued and cancelled are neutral. Badges are the shadcn `Badge` with one variant per state (`StatusBadge`): an
  icon and the label; the running icon spins unless reduced motion. While a command the mock accepted is on its
  way (`isWaitingForAgent`: pending, not yet answered by the agent; for an edit, until the re-asked confirmation), the card
  and record show a neutral "Waiting for agent" badge and the card's border turns neutral, matching the header count, which
  already leaves the agent out; the model's tag and queue place stay as they are.
- Loading: a spinner (`Spinner`, lucide LoaderCircle, fixed 14px, still under reduced motion) shows the run works
  before anything else moves: in the start button ("Starting...") and the run line ("Starting") from the click
  until the plan, in "Planning..." where the agents will be, next to "Running" / "Finishing" in the run line, and
  as the icon of running agents' badges. Its size is fixed, so it never changes layout. In the run line it is
  decorative (`aria-hidden`): the phase word beside it is already in a live region.
- Elevation: one theme shadow (`shadow-raised`: 0 4px 14px at 12% and 0 1px 3px at 8% of the ink colour) for everything raised: the run card, the result, the decision
  panel and the selected agent card. Unselected cards have none.
- Agent cards: all share the card surface and one even 2px border on all four sides, coloured only for needs
  you (bright amber `needs-bar`) and failed (`failed`); done, running, queued and cancelled have the neutral
  border. No top stripe. The selected card (its decision, outcome or record is in the panel) is raised
  (`shadow-raised`), steps 12px toward the panel (`translate-x-3`, a 150ms transform, none under reduced motion,
  so no other box moves and the layout watch, which reads tops, is unaffected) and is joined to the panel by a
  connector in its state colour across the rest of the gap; no ring, no outline, no size or
  border change. The trace is a numbered timeline (numbers run across attempts, a check icon per step on a teal
  line that turns red into the failure row, which shows its status line verbatim; "Attempt N" headers). Each row's text is clamped to two lines, with the full
  text in its tooltip, so a long free-text answer ("You chose: ...") cannot stretch the card; the text stays
  verbatim and the record shows it whole.
- Decision panel: a card with a 3px left edge in the colour of what it shows (amber decision, red failure, teal
  outcome (neutral after an edit), the agent's colour for a record, neutral when empty) and a header with "K need you". Each decision
  or outcome is a `Frame`: a band with the agent's label and the question (amber for approvals and questions,
  red for a failure, teal for an outcome whose action happened, neutral for a submitted edit, which sends nothing; the title stays in the text colour and only a failure colours the agent's label), the body, and a footer bar with the actions, pinned to the bottom of the
  panel card (minimum height 420px, so the footer does not jump between states). Under an outcome the footer holds
  "Next decision: <agent label>" on the right, or "Nothing else needs you right now." in the same fixed height.
- Long text: text the console does not control (agent labels, mock strings, the user's words, draft fields) never widens anything. Single-line slots truncate with the full text in the tooltip (`ClampedText`; the Next decision button keeps its prefix and truncates the label inside the footer); multi-line text wraps with `overflow-wrap:anywhere` (inherited from the card, the panel frame, the record and the result) and is clamped where its area is bounded (trace rows, status lines). e2e checks a 200-character label and a 500-character unbroken answer.
- Form controls (Input, Textarea, Checkbox, RadioGroup, the speed toggle) are the shadcn components as on the
  boards: the card fill, the `input` border, a 5px radius (`rounded-md`), `shadow-xs` and the `ring` focus
  ring; a checked radio keeps the card fill with a primary border and a primary dot.
  `dark:` applies only under a `.dark` class, which the app never sets, so a system dark mode does not grey-fill
  them (e2e checks this with a dark colour scheme).
- Disabled: Base UI's Checkbox marks itself with `data-disabled`, not `:disabled`, so a Label holding a disabled
  control dims as a whole (`has-data-disabled:opacity-50`); the locked Jitter during a run looks disabled like
  the speed buttons (e2e checks its opacity).
- Question: options are bordered rows; the chosen one keeps the 1px width with the primary border and a light
  muted fill. "Or answer in your own words" is a Textarea of at least 120px, without a placeholder; holding the answer it gets the primary border.
- Buttons: primary actions use the primary variant everywhere (Approve, Save, Send answer, Retry, Run again);
  secondary actions the outline variant, Next decision included (it navigates, it acts on nothing). Colour belongs to bands, badges and the effect
  line, not to buttons.
- Effect line: directly under the Approve / Edit buttons, normal size, semibold, with an alert icon:
  irreversible in the failed red, reading "Be careful, this action cannot be undone"; reversible ("You can undo
  this action later") and read only ("This action changes nothing") in the normal text colour; an unknown class by
  name and as the worst case, in red: 'Unknown effect "financial". Assume it cannot be undone' (never the
  irreversible wording: the console does not know that). The record of an approval says it as a fact: "This
  action cannot be undone" (red), "This action can be undone", "This action changed nothing", and for an unknown
  class 'Effect "financial", unknown to this console' (red).
  Reason: the warning sits where the eye and the cursor are at the moment of clicking, not above the draft.
  Questions have no effect line.
- Result: the heading follows the run's phase (`phaseOf`, the same rule as the top bar): Complete or Partial result
  only when the phase is completed or partial, Run cancelled after a cancel, otherwise Updating (also right after
  an accepted Retry, before the agent's next event). The notes under Updating: "This result is outdated - attempt N of <agent> is running" while a retried agent runs,
  "Every agent has finished; collecting the new result. It replaces this one." once all have settled, and "An
  agent is still finishing; this result may still change." for a result that arrived before the last Done.
- Result: a band with an icon, the heading (Complete, Partial result, Updating, Run cancelled in a neutral band)
  and one truncated note line ("All N agents finished", plus "Updated after retry." after a replacement, the retry notes, "This is the result from before the run
  was cancelled. K of N agents had failed."), then the summary (at most 64ch); items in a two-column list (148px
  for the kind and the agent's label, which opens the agent's record; an error item is tinted red with its
  Retry (top-aligned, to the right of its text, in a fixed-width slot); an item's detail at most three lines (the
  full text in its tooltip and the record); Updating dims the summary and the items to 72%) and sources as outline badges (22px high).
- Debug row: speed 0.25x / 0.5x / 1x / 2x / 4x, Jitter, and the toggle "Event log (N)" / "Hide event log (N)".
- Event log: inside the run card; "N events received - K arrived late", Copy JSON, and a table with #, seq
  (with a "late" mark), time (UTC, to the millisecond), type, agent and detail ("state - status line",
  "act - detail", "N agents: types" for the plan), muted and wrapping; late rows amber, failure rows red.
- Where the app differs from the boards, on purpose: the panel keeps the outcome after the run ends instead of "Nothing needs you" (an outcome stays
  until the user moves); the outcome shows what was sent and the agent now, not a timeline; the debug row
  keeps Jitter and the event log count, and "Speed is set before a run" keeps its space when hidden; done cards
  keep "Details in the panel" (the record). Also:
  - every card keeps its footer link ("Details in the panel" while running, too) instead of "Attempt N": it
    is the keyboard and screen reader path to the panel; the attempt shows in the trace headers and the record;
  - the failure row of the trace shows the mock's status line verbatim ("Failed - ..." as sent), not a
    "Failed:" label with the prefix cut (texts from the mock are verbatim);
  - the card status line is one line with the full text in its tooltip, also for "Last status: ..." of a
    cancelled agent, so a long line never changes the card's height;
  - the open event log shows every event at full height with the page scrolling, not a 600px box: it is a
    debug view;
  - the cancelled result band has no Run again of its own: the run card holds the one Run again;
  - the Complete note reads "All N agents finished" without "took M:SS": the run line shows the time once;
  - the chosen option keeps a 1px primary border with a muted fill instead of a 1px ring, the own-words field
    holding the answer keeps the same 1px primary border without the ring, and the effect line is normal size
    (all above);
  - an outcome is a frame (a coloured band, the panel's 420px minimum height) rather than a compact grey
    receipt, so the footer with Next decision stays in one place across states; its heading says what was sent
    ("Retry sent: attempt N"), and the panel's left edge is teal on an outcome, like its band;
  - "K need you" is hidden at 0: "0 need you" says nothing the empty panel does not;
  - the run card hint reads "The result appears at the top when the run ends", since the result sits at the top;
  - the agent label in a result item truncates to one line (the long-text rule), with the full text in its
    tooltip;
  - Save changes stays disabled until the draft changes: an unchanged Save would only re-ask the same question;
  - the run card can be a few pixels taller than the board: the run line keeps a fixed slot for the spinner.

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
5. Edit instead: Edit opens the editor (`edits[id] = { draft }`); Save changes is enabled once the draft differs
   from the current revision; Save calls `edit(id, draft)`; on true the editor closes and the outcome "Edit
   submitted" shows with a spinner and "The agent is preparing the edited email...". The re-emitted confirmation
   (revision 2) has a seq newer than the edit's `afterSeq`, so `pendingCommand` becomes null, and while the
   outcome is still shown the panel opens "Send the edited email?" by itself (panel rule, second exception).
   The editor always shows Subject and the body (both are optional in the contract): a missing one starts empty
   and may be filled in, which counts as a change; a missing one left empty is not sent. Emptying a field the
   agent sent blocks Save, and Save stays disabled until what it would send differs from the current revision
   (spaces typed into a missing field do not count). Draft fields other than subject and body are sent back unchanged.
   The To row (`target`) is shown read-only in the editor.
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
| `reduceOrder.property.test.ts` | The recorded run's events after the plan in 300 seeded random orders give the same model as seq order: traces sorted without duplicates, newest status (done never regresses), newest gate, the waiting queue, the newest result with `outdated` computed. |
| `console.reducer.test.ts` | Every event type, late events, attempts, gates and revisions, result replacement, cancel, the raw log, a handler that throws, the edit seam (a step between `edit()` and the re-emitted confirmation keeps `needs_approval` and the queue place). |
| `selectors.test.ts` | Run header, phase (an accepted Retry after a partial result is running), pending command, the retry lifecycle, trace grouping, decision queue order (edit keeps its place), retryable, status line. |
| `subscription.test.ts` | The manager against a fake orchestrator (the real mock is never loaded): subscribe before start asserted directly, speed and jitter passed, a refused start stopped and not counted, a second start stops the previous run, commands recorded only when accepted, `afterSeq` read before the call, a pending command not sent again, what `start`, `cancel` and `reset` clear. |
| `AgentList.test.tsx` | With the fake mock module: N agents give N cards, a fourth agent type, a card updated in place, trace order with the late step, the empty trace, Done kept after the late step. |
| `PanelSelection.test.ts` | With the fake mock module: which decision the panel shows, the outcome kept after the run ends, the outcome first in `shownDecisionNow`, `select` vs `pin`. |
| `Actions.test.tsx` | Against a fake orchestrator: approve and its outcome with no Approve left for a second click (the manager's guard against a second command is tested in `subscription.test.ts`), the outcome kept while the agent answers and the run ends with its second line following the agent, a card click on a pending agent opening its record, edit with kept text and the re-asked confirmation offered first, an unknown action named verbatim with a Target row, answers by option and by own words, cleared words giving the answer back to the option, a second question from the same agent starting empty, retry from the panel and from a partial result (the error row and the note kept as "Retrying..."), a refused command and its clearing (also a refused Retry from the result), the Next decision button (longest wait, no switch by itself, absent while nothing waits, added when a decision arrives), a decision that arrives not replacing the one on screen; focus after Edit, Cancel edit, Save, Approve and a card click, and not taken by a decision that opens in the empty panel. |
| `AgentRecord.test.tsx` | The record shows the approved email after the gate closed; a result arriving later goes below "What you did"; an arriving decision does not replace an open record and N grows; the record's Next decision returns to the pinned decision, and its footer says "Nothing else needs you right now." when nothing waits; a refused command records nothing; the panel landmark is named after what it shows.; the selected card's link carries aria-current. |
| `CancelledRun.test.tsx` | Cancel mid-run with an open decision and a running agent: cards Cancelled with "Last status: ...", the queue empty and no command control left (also in a record), "Run cancelled", Run again; an open record stays; Run again starts with the edited request and clears screen state per section 2; a Run again the mock refuses returns to the start card with its message; Cancel before the plan shows the cancelled state, not "Planning..."; the console has one h1; Cancel during a retry after a partial result leaves the result with its own heading and no retrying note or row.; an accepted Retry on a partial result shows Cancel run, locks the debug controls and resumes the clock without the idle time.; the run line's live regions hold the phase, counts and need-you, not the clock; a spinner from Run again until the plan (run line and Planning...) and next to Running. |
| `ModelError.test.tsx` | A handler that throws: the top bar warns "The screen may not match what the agents did", and later events still apply. |
| `AppErrorFallback.test.tsx` | A render error shows the fallback; Start over calls `reset` (a stub manager, not the real one) and renders again. |
| `EventLog.test.tsx` | Copy JSON says "Copied" and returns to "Copy JSON" after 2 s; a refused clipboard says "Copy failed". |
| `FourthAgent.test.tsx` | A fourth agent of an unknown type through its whole life next to the usual three: unknown act capitalized for display, an unknown action, effect class and extra draft keys in the confirmation, a picked and a typed answer, a retry traced as attempt 2, a result item of an unknown kind in the result and the record. |
| `ClampedText.test.tsx` | The clamp classes, `overflow-wrap:anywhere` and the full text in `title` (class names only: jsdom has no layout; the long-text e2e checks real truncation and overflow). |
| `ResultRenders.test.tsx` | An event for an agent the result does not show does not re-render the result block (React Profiler). |
| `CardRenders.test.tsx` | An event for one agent does not re-render another agent's card (React Profiler). |
| `mockAlias.test.ts` | The `@mock` alias loads the real mock (the only unit test that touches it). |
| `e2e/definition-of-done.e2e.ts` | Each Definition-of-done item from the task text in a real browser with the real mock at 4x (0.25x for the empty trace and the wait after Edit, so those states are asserted strictly), item 6 also checks that all three agents end Done and that Scheduling's late last step (seq 29 after its done, seq 30) sits in place in its trace; item 4 checks that the draft body is not clipped in the confirmation and in the record, and "not sent" only after the other agents have reached their own waits; plus agent cards keeping their position (every frame, `watchLayout`) while decisions open and close, moving only when the result first appears, a partial result retried from the result (every frame: the block stays, the cards move only when the newer result replaces it), Cancel during that retry, Cancel / Run again (the debug row items keep their place across running, cancelled and running again), the event log toggle keeping its place while events stream and the log table no wider than its box in an 800px window, form controls not grey-filled under a dark colour scheme. Every wait is on UI state. Two Playwright projects run the whole file without and with the mock's jitter, set through the UI: `pnpm e2e` runs the one without jitter (the default), `pnpm e2e:jitter` the one with it. The suite always starts its own dev server from this checkout on port 5298 (`E2E_PORT`), never reusing a running one. |
