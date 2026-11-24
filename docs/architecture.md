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
| Screen state | `src/store/view.store.ts` | Which decision is shown, receipt, request text, speed, jitter, run count, open edits, question answers. Not part of the run model. |
| Labels | `src/config/agentTags.ts` | Words, icons and tones per tag, action, result kind and effect class, with generic fallbacks. |
| Components | `src/components/console/*` | Rendering and user input only. |

## 2. Transport: `SubscriptionManager`

Plain module functions (an ES module is already a singleton): `start`, `cancel`, `reset`, `approve`, `edit`,
`resolve`, `retry`.

- `start(request, speed, jitter)`: stops the previous run, applies `run_reset`, clears screen state (selection,
  receipt, edits) and counts the run in `view.store.runs`, creates a new orchestrator with the speed and jitter,
  subscribes before `start()` (the mock delivers only events emitted after `subscribe`), then calls `start` and
  returns its boolean.
- `cancel()`: unsubscribes, `reset()`s the mock (cancels its timers), applies `run_cancelled`.
- `reset()`: used by the error fallback's "Start over"; stops the run and goes back to the start card.
What each call clears in the view store (request, speed and jitter always stay):

| Call | Run state | Selection, receipt | Open edits | `runs` |
| --- | --- | --- | --- | --- |
| `start` | reset, then the new run | cleared | edits and answers cleared | +1 |
| `cancel` | kept, agents marked cancelled | receipt cleared | kept (nothing can be sent) | kept |
| `reset` | reset | cleared | edits and answers cleared | 0, so the start card shows |

- Commands: the mock returns `true` when it accepted a command, `false` when the agent was not in a state
  that accepts it (README). Only an accepted command is recorded, as the local event `command_sent`, after
  the handler returns. That relies on the README: the mock is "driven by `setTimeout`", so an agent's answer
  never arrives inside the call. `afterSeq` is the agent's `maxSeq` read before the call. A command sent while the agent's previous command is still
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
| `command_sent` (local) | Appends `{ kind, afterSeq }` to the agent's `actions`; `afterSeq` is the agent's `maxSeq` read before the call. |
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
| `selectedId` | The decision the user picked. `select(id)` also clears the receipt; `pin(id)` does not. |
| `receipt` | What the panel shows after approve, resolve or retry: `{ agentId, kind, ... }`. |
| `request`, `speed`, `jitter` | The request text and the mock's speed and jitter (creation options), shared by the start card and the top bar. |
| `runs` | How many runs were started; the start card shows until the first run has its plan. |
| `edits` | Per agent: an open editor `{ draft }`, or the version sent with edit() `{ draft, sent: true }`. Survives switching decisions. A sent entry is read only while the edit is pending and stays until the next Edit or a new run. |
| `answers` | Per agent: a question's picked option and typed words. Picking an option keeps the words; typing makes the words the answer. Survives switching decisions; cleared on a new run and on reset. |

How the panel picks what to show (`hooks.ts`):

- `useShownDecision`: the selected agent if it is still in `decisionQueue`, otherwise the first in the queue.
  The panel pins what it shows (`pin`), so a gate that arrives later with a lower seq does not take its place.
- `useVisibleReceipt`: the receipt, except after the run has ended with an empty queue; then the panel shows
  "Nothing needs you right now". A visible receipt replaces the decision.
- `useIsShown` and `shownDecisionNow`: the agent the panel is about, the receipt's agent first. The card
  ring and connector use the first; `RetryButton` uses the second at click time.

Component-local state: open trace (`AgentCard`), open event log (`TopBar`), the refused-command text.

## 6. Components

| Component | Reads | Does |
| --- | --- | --- |
| `App` | plan order, plan task, run key, `runs` | Start card until the first plan; then top bar, result, agents, decision panel. Cards are keyed by run so a new run remounts them. |
| `StartCard` (`TopBar.tsx`) | request, speed, jitter, `runs` | Request, speed and jitter before the first run; "Starting..." and off until the plan arrives; off for an empty request. |
| `TopBar` | run header, plan task, log size | Request (shows `plan.task` while the run works), Cancel run / Run again, one-line summary, Debug row (speed and jitter are fixed during a run), event log toggle. |
| `ResultBlock` | latest result, run header, request, speed, jitter | The result above the agents, appearing once it arrives (when it first appears it pushes the agents down once per run: the one allowed stream-caused layout shift); complete, partial, updating (outdated) or cancelled; Retry on an error item that is still in the queue (the partial note says "retry it" only then); "Run again" on a cancelled run's result. |
| `AgentCard` | its agent, in queue, is shown | Label, badge, one truncated status line, Show steps; the whole card selects its decision; "Decision in the panel" for an approval or a question, "Retry in the panel" for a retryable failure (Retry is in the panel only). Fixed badge column. The status line is the newest of the status and the last step (after an answer the agent reports a step before its next status); failed keeps its status line; a cancelled agent shows "Last status: " + its last status line. |
| `AgentTrace` | its agent | `traceOf`; "Attempt N" dividers appear once there is a second attempt; a "Working" row with the status line while the agent runs, only if that status is newer than its last gate and the attempt has steps; empty text without steps. An open trace is capped at 400px with its own scroll; a new step scrolls it to the bottom unless the user scrolled up. |
| `DecisionPanel` | queue, shown decision, receipt, waiting count | One decision at a time with "N of M" and Prev/Next; failure, confirmation (view, editor, waiting for the edited version, edited version) or question; receipts after approve, resolve, retry with "Next: ...", or "Nothing needs you right now" when nothing else waits. After 3 seconds a receipt opens the next decision by itself, only if one was waiting when the user acted; which one is read when the time is up. Going back to a decision whose command is still pending shows its receipt (rebuilt from the model and the stored answer), so the agent's next event cannot swap another decision in. Empty: "The agents are starting" while every agent is queued, otherwise worded by phase. |
| `RetryButton` | its agent | The one Retry used by the panel and the partial result; shows a receipt when the panel is about that agent or already shows a receipt; a retry from the result never replaces another agent's open decision. |
| `EventLog` | raw log | Debug table of every event, late rows marked, failure rows red, Copy JSON. |
| `AppErrorFallback` | - | Error boundary fallback with "Start over" (`SubscriptionManager.reset`). |

## 7. Data flow of one decision

1. The mock emits `confirmation_required` (seq 20). `apply` -> `reduce` stores the gate; `tagOf` gives
   `needs_approval`; the card badge changes in place.
2. `decisionQueue` now holds the agent; the panel shows it if nothing else is shown, and pins it
   (`pin`) so an out-of-order gate with a lower seq never swaps the content under the cursor.
3. Approve: `SubscriptionManager.approve(id)` -> mock returns true -> `command_sent` -> `pendingCommand`
   is `approve`; the receipt "Approved" replaces the decision in the panel. Going back to that decision
   before the agent answers shows its receipt, not the decision.
4. The agent's next event (a step, seq 21) answers the command: `pendingCommand` is null, the
   gate is closed, the tag is `running`; the receipt words follow the agent's real state.
5. Edit instead: Edit opens the editor (`edits[id] = { draft }`); Save calls `edit(id, draft)`; on true
   the entry becomes `{ draft, sent: true }`. The panel stays on this decision ("Edited version sent to
   the agent", disabled "Waiting for the agent..."), because `needsUser` keeps an agent with a pending
   edit in the queue. The re-emitted confirmation (revision 2) keeps `openedSeq`, so `pendingCommand`
   becomes null, and the panel shows "Send the edited email?" with Approve in the same place. Draft fields
   other than subject and body are sent back unchanged; an empty subject or body cannot be saved. The To row (`target`) is shown read-only both in the editor and
   while waiting for the agent after Save.
6. Question: the picked option sends its id to `resolve`, otherwise the trimmed own words; the chosen one has
   the dark border. Then a receipt as in 3.

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
| `PanelSelection.test.ts` | Which decision the panel shows, the receipt hidden after the run ends with an empty queue, receipt first in `shownDecisionNow`, `select` vs `pin`. |
| `Actions.test.tsx` | Against a fake orchestrator: approve and its receipt, a double click sent once, the receipt shown again for a pending command, edit with kept text and re-approval, an unknown action, answers by option and by own words, retry from the panel and from a partial result, a refused command and its clearing, auto-advance only to a decision waiting at action time. |
| `mockAlias.test.ts` | The `@mock` alias loads the real mock (the only unit test that touches it). |
| `e2e/pageLoads.e2e.ts` | The page loads in a real browser. |

Planned, added as they land:

| Suite | Covers |
| --- | --- |
| `ModelError.test.tsx` | A handler that throws sets `modelError`, the top bar warns, and the store keeps applying later events. |
| `CancelledRun`, `AppErrorFallback` tests | Cancelled screen, the error fallback (with a stub reset, not the real manager). |
| `e2e/definition-of-done.e2e.ts` | Each Definition-of-done item from the task text in a real browser with the real mock, plus a partial result retried from the result and Run again; run once without and once with jitter. |
