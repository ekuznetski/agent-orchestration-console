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
| Run model | `src/store/console.reducer.ts` | `reduce(state, event, at)`: the only place run state changes. Pure. |
| Store | `src/store/console.store.ts` | Zustand store holding `RunState` and `apply(e)`, which calls `reduce` with `Date.now()`. |
| Derived data | `src/store/selectors.ts` | Pure functions over `RunState`: run header, phase, pending command, trace, decision queue. |
| React access | `src/store/hooks.ts` | Small selector hooks so a component subscribes only to what it renders. One agent is read by reference (`useAgent`), so an event for another agent does not re-render it; objects and arrays built by selectors (`runHeader`, `decisionQueue`) are compared field by field (`useShallow`). |
| Screen state | `src/store/view.store.ts` | Which decision is shown, the outcome of the last action, request text, speed, jitter, run count, open edits, question answers. Not part of the run model. |
| Labels | `src/config/agentTags.ts` | Words, icons and tones per tag, action, result kind and effect class, with generic fallbacks. |
| Components | `src/components/console/*` | Rendering and user input only. |

## 2. Transport: `SubscriptionManager`

Plain module functions (an ES module is already a singleton): `start`, `cancel`, `reset`, `approve`, `edit`,
`resolve`, `retry`.

- `start(request, speed, jitter)`: stops the previous run, applies `run_reset`, clears screen state (selection,
  outcome, edits) and counts the run in `view.store.runs`, creates a new orchestrator with the speed and jitter,
  subscribes before `start()` (the mock delivers only events emitted after `subscribe`), then calls `start` and
  returns its boolean.
- `cancel()`: unsubscribes, `reset()`s the mock (cancels its timers), applies `run_cancelled`.
- `reset()`: used by the error fallback's "Start over"; stops the run and goes back to the start card.
What each call clears in the view store (request, speed and jitter always stay):

| Call | Run state | Selection, outcome | Open edits | `runs` |
| --- | --- | --- | --- | --- |
| `start` | reset, then the new run | cleared | edits and answers cleared | +1 |
| `cancel` | kept, agents marked cancelled | outcome cleared | kept (nothing can be sent) | kept |
| `reset` | reset | cleared | edits and answers cleared | 0, so the start card shows |

- Commands: the mock returns `true` when it accepted a command, `false` when the agent was not in a state
  that accepts it (README). Only an accepted command is recorded, as the local event `command_sent`, after
  the handler returns. That relies on the README: the mock is "driven by `setTimeout`", so an agent's answer
  never arrives inside the call. `afterSeq` is the agent's `maxSeq` read before the call. `command_sent` also
  carries what was actually sent (section 3, Actions), so the agent record can show it later. A command sent while the agent's previous command is still
  pending does not reach the mock and returns `true` (it is already in flight), so it never reads as refused.
  Components show their own "no longer waiting" text when a command is refused.

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
  handler a build error. An unknown event type has no handler: it is logged and ignored.
- A handler that throws is caught in `reduce`: the event stays in the log and the run's `maxSeq` moves, but
  every model change of that event is dropped and the error goes to `console.error`, so a reducer bug does
  not freeze the store; `modelError` is set and the top bar warns that the screen may not match what the agents
  did (the one deliberate exception to the no-guards rule).
- `putAgent` stores an agent with its `maxSeq` (highest seq from that agent) and derives its tag, then
  derives the run status (`settled` once every agent is `done` or `failed`).

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
| `approve` | The approved gate's `action`, `target`, `revision` and the full `draft`. |
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
| `phaseOf` | `idle`, `running`, `finishing` (settled, no current result yet or it is outdated), `completed`, `partial` (degraded), `cancelled`. |
| `runHeader` | Phase, done count, total, "need you" count (`waitingQueue` length), the attempt being retried. |
| `pendingCommand(agent)` | The command the agent has not answered yet, or null. There is no ack in the API, so: `edit` is answered only by a newer gate (the re-emitted confirmation); any other command by any newer event of that agent. |
| `traceOf(agent)` | Steps grouped by attempt, in seq order, numbered across attempts, with the failure row that ended an attempt (its status line, plus the raw error when `retryable` is false). No row for the user's own commands: the "Attempt N" divider says a retry happened, and after approve, edit and resolve the agent reports its own step. |
| `decisionQueue` | Agents with a decision in the panel, oldest wait first: open gate (by `openedSeq`), retryable failure (by its status seq), or an edit waiting for the agent. Empty after a cancel. |
| `waitingQueue` | `decisionQueue` without agents whose command is pending: what the user can act on now. |
| `statusLineOf(agent)` | The card's status line: the newest text by seq of the latest status and the latest step; a failed agent keeps its status line; a cancelled one shows "Last status: " + its last status line. |

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
| `request`, `speed`, `jitter` | The request text and the mock's speed and jitter (creation options), shared by the start card and the top bar. |
| `runs` | How many runs were started; the start card shows until the first run has its plan. |
| `edits` | Per agent: an open editor `{ draft }`. Survives switching decisions; removed by Cancel edit and when the mock accepts the edit (what was sent is in the agent's actions). |
| `answers` | Per agent: a question's picked option and typed words. Picking an option keeps the words; typing makes the words the answer. Survives switching decisions; cleared on a new run and on reset. |

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
- The outcome's second line and the button slot under it change in place: the second line is one truncated
  line, and the slot keeps its height whether it holds the button or "Nothing else needs you right now."
- There is no auto-advance and no Prev / Next: the user moves by the Next decision button or a card click.
- Focus moves only after the user's own action, to the next sensible control: Edit focuses the editor's first
  field; an outcome (after Save, Approve, Send answer, Retry) focuses the Next decision button, or the outcome
  line when nothing waits; a card click, Next decision or Back to decisions focuses the shown decision (a group
  labelled with the agent) or the record's heading. A decision that opens in the empty panel by itself does
  not take focus.

Component-local state: open trace (`AgentCard`), open event log (`TopBar`), the refused-command text.

## 6. Components

| Component | Reads | Does |
| --- | --- | --- |
| `App` | plan order, plan task, run key, `runs` | Start card until the first plan; then top bar, result, agents, decision panel. Cards are keyed by run so a new run remounts them. |
| `StartCard` (`TopBar.tsx`) | request, speed, jitter, `runs` | Request, speed and jitter before the first run; "Starting..." and off until the plan arrives; off for an empty request. |
| `TopBar` | run header, plan task, log size | Request (shows `plan.task` while the run works), Cancel run / Run again, one-line summary (with "The screen may not match what the agents did" while `modelError` is set, until the next run), Debug row (speed and jitter are fixed during a run), event log toggle. |
| `ResultBlock` | latest result, run header, request, speed, jitter | The result above the agents, appearing once it arrives (when it first appears it pushes the agents down once per run: the one allowed stream-caused layout shift); complete, partial, updating (outdated) or cancelled; Retry on an error item whose agent the user can retry now (the partial note says "retry it" only then); after the click the item's button row and the note keep their place and read "Retrying..." (the note: "Retrying... This result updates when the agent finishes.") until a newer result replaces the block, so a retry from the result does not move the agents; after a cancel a result that already arrived stays, marked "From before the run was cancelled.", with no Retry (Run again is in the top bar). |
| `AgentCard` | its agent, waiting for the user, is shown | Label, badge, one truncated status line, Show steps. Clicking the card selects it: an agent the user can act on now (in `waitingQueue`) shows its decision; any other agent, one whose command is still pending included, opens its record in the panel. Footer button (the keyboard path): "Decision in the panel" for an approval or a question, "Retry in the panel" for a retryable failure (Retry is in the panel only), otherwise "Details in the panel". Fixed badge column. The status line is the newest of the status and the last step (after an answer the agent reports a step before its next status); failed keeps its status line; a cancelled agent shows "Last status: " + its last status line. The selected card (a decision, an outcome or a record) gets the ring and connector. |
| `AgentTrace` | its agent | `traceOf`; "Attempt N" dividers appear once there is a second attempt; a "Working" row with the status line while the agent runs, only if that status is newer than its last gate and the attempt has steps; empty text without steps. An open trace is capped at 400px with its own scroll; a new step scrolls it to the bottom unless the user scrolled up. |
| `DecisionPanel` | shown decision, outcome, waiting count | One decision at a time: failure, confirmation (view, editor, edited version) or question. After an accepted command the outcome replaces the decision: the first line is what was sent ("Approved", "Edited version sent", "Answer sent: ...", "Retry sent: attempt N"), the second line is the agent now ("Waiting for the agent to respond." while the command is pending, then "Now: <tag> - <status line>"). Under it, in a slot of fixed height, "Next decision: <agent>" when a decision waits (the outcome's own agent first when it asks again, otherwise the longest wait), or "Nothing else needs you right now."; the switch happens only on click. Empty: "The agents are starting" while every agent is queued, otherwise worded by phase. In `agent` mode the panel shows the record instead, with "Back to decisions (N)" (N = waiting decisions) in the header. |
| `AgentRecord` | its agent, its result items, its actions | What one agent did and what the user sent: current status line; its result items (`result.items` for that agent, marked "Updating" while the result is outdated); "You approved" with the full sent draft (To, Subject, other fields, body, revision); "You sent an edited version"; "You answered: ..."; "You retried: attempt N". The trace stays in the card. |
| `RetryButton` | its agent | The one Retry used by the panel and the partial result; in `decisions` mode it stores its outcome when the panel is about that agent or already shows an outcome; a retry from the result never replaces another agent's open decision or an open record. |
| `EventLog` | raw log | Debug table of every event, late rows marked, failure rows red, Copy JSON. |
| `AppErrorFallback` | - | Error boundary fallback with "Start over" (`SubscriptionManager.reset`). |

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
   the tag is `running`; the outcome's second line becomes "Now: Running - <status line>". The first line
   never changes.
5. Edit instead: Edit opens the editor (`edits[id] = { draft }`); Save calls `edit(id, draft)`; on true the
   editor closes and the outcome "Edited version sent" shows. The re-emitted confirmation (revision 2) keeps
   `openedSeq`, so `pendingCommand` becomes null; the agent is back in `waitingQueue` and the button reads
   "Next decision: Drafting" (the outcome's own agent first). Its click shows "Send the edited email?" with
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

Every test file is named after what it covers (e.g. `LayoutStates.test.tsx` for the layout and state
rules).

| Suite | Covers |
| --- | --- |
| `console.reducer.test.ts` | Every event type, late events, attempts, gates and revisions, result replacement, cancel, the raw log, a handler that throws, the edit seam (a step between `edit()` and the re-emitted confirmation keeps `needs_approval` and the queue place). |
| `selectors.test.ts` | Run header, pending command, the retry lifecycle, trace grouping, decision queue order (edit keeps its place), retryable, status line. |
| `subscription.test.ts` | The manager against a fake orchestrator (the real mock is never loaded): subscribe before start asserted directly, speed and jitter passed, a second start stops the previous run, commands recorded only when accepted, `afterSeq` read before the call, a pending command not sent again, what `start`, `cancel` and `reset` clear. |
| `AgentList.test.tsx` | N agents give N cards, a fourth agent type, a card updated in place, trace order with the late step, the empty trace, Done kept after the late step. |
| `PanelSelection.test.ts` | Which decision the panel shows, the outcome kept after the run ends, the outcome first in `shownDecisionNow`, `select` vs `pin`. |
| `Actions.test.tsx` | Against a fake orchestrator: approve and its outcome, a double click sent once, the outcome kept while the agent answers and the run ends with its second line following the agent, a card click on a pending agent opening its record, edit with kept text and the re-asked confirmation offered first, an unknown action, answers by option and by own words, retry from the panel and from a partial result (the error row and the note kept as "Retrying..."), a refused command and its clearing, the Next decision button (longest wait, no switch by itself, absent while nothing waits, added when a decision arrives), a decision that arrives not replacing the one on screen; focus after Edit, Save, Approve and a card click, and not taken by a decision that opens in the empty panel. |
| `AgentRecord.test.tsx` | The record shows the approved email after the gate closed; an arriving decision does not replace an open record and N grows; Back to decisions returns to the pinned decision; a refused command records nothing. |
| `CancelledRun.test.tsx` | Cancel mid-run with an open decision and a running agent: cards Cancelled with "Last status: ...", the queue empty, "Run cancelled", Run again; an open record stays; Run again starts with the edited request and clears screen state per section 2. |
| `ModelError.test.tsx` | A handler that throws: the top bar warns "The screen may not match what the agents did", and later events still apply. |
| `AppErrorFallback.test.tsx` | A render error shows the fallback; Start over calls `reset` (a stub manager, not the real one) and renders again. |
| `mockAlias.test.ts` | The `@mock` alias loads the real mock (the only unit test that touches it). |
| `e2e/definition-of-done.e2e.ts` | Each Definition-of-done item from the task text in a real browser with the real mock at 4x (0.25x for the empty trace and the wait after Edit, so those states are asserted strictly), plus a partial result retried from the result (the agent cards keep their position while it retries) and Cancel / Run again. Every wait is on UI state. Two Playwright projects run the whole file without and with the mock's jitter, set through the UI. |
