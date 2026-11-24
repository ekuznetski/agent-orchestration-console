# Agent Orchestration Console - candidate write-up

A front end for the provided mock orchestrator: one request fans out to three agents, each agent shows one
status line and its trace, decisions that need the user (approve an email, answer a question, retry a failed
agent) wait in a panel, and the aggregate result appears above the agents. Details of every rule:
[docs/architecture.md](../docs/architecture.md).

## 1. Run

Requirements: Node 22.12 or newer (developed on 26.13), pnpm 11.

```bash
cd app
pnpm install
pnpm dev          # http://localhost:5173
pnpm build        # type check (tsc -b) and production build
pnpm test         # Vitest: unit and component tests (jsdom, fake orchestrator)
pnpm e2e          # Playwright, Chromium, against the real mock; starts its own server on 5298
pnpm e2e:jitter   # the same suite with the mock's timing jitter (out-of-order delivery)
pnpm lint         # oxlint
pnpm format       # prettier
```

The mock is imported unchanged from `../mock` through the Vite alias `@mock`. The debug row (speed, jitter,
event log) is part of the UI, so the e2e suite sets speed and jitter the way a user would. The event log is a
debug view, not built for long runs.

## 2. Architecture in one picture

```
mock orchestrator --events--> subscription manager --apply--> reduce (pure, ordered by seq) --> run store
        ^                    (the only module that                                              |
        |                     talks to the mock)                                       selectors / hooks
        +---- approve / edit / resolve / retry <--------------- components <---------------------+
                                                                    |
                                                        view store (screen-only state)
```

- `src/subscriptionManager/subscription.ts` creates the one orchestrator, subscribes before `start()`, sends
  every command and records only commands the mock accepted.
- `src/store/console.reducer.ts` turns events into the run model. It is the only place run state changes.
- `src/store/selectors.ts` and `src/store/hooks.ts` derive what components show.
- `src/components/console/*` render and take input; nothing else.

## 3. Where state lives and why

Two stores, because they change for different reasons and have different lifetimes.

- **Run store** (`console.store.ts`, built only by `reduce`): the model of what the agents did, rebuilt from
  events alone. Everything is ordered by `seq`, not by arrival: a stale status is dropped, a late step is
  inserted in its place, a gate (approval or question) is open only while it is the agent's newest event, so
  gates are states derived from the event order rather than flags someone has to reset. Results are versioned
  and marked outdated by a newer status until the next result replaces them. The user's accepted commands are
  part of the model (`command_sent`), which is how a pending command is known without any acknowledgement.
- **View store** (`view.store.ts`): what this screen shows and what the user is typing: the selected decision,
  panel mode (decisions or an agent's record), the outcome of the last action, open edits, question answers,
  request text, speed, jitter, the run clock. None of it is derived from events, and none of it should be
  replayed into the run model.
- **Component state**, deliberately local: an open trace, the open event log, a "the agent did not accept this
  action" message. Nothing else needs them.

## 4. Component boundaries

| Component                         | Subscribes to                                                  | Why                                                             |
| --------------------------------- | -------------------------------------------------------------- | --------------------------------------------------------------- |
| `TopBar` / `StartCard`            | run header (phase, counts), plan task, request, speed, jitter  | One run card: request, Cancel / Run again, run line, debug row. |
| `AgentList` / `AgentCard`         | plan order; each card its own agent by reference               | An event for one agent re-renders one card.                     |
| `AgentTrace`                      | its agent                                                      | Numbered timeline grouped by attempt, capped at 400px.          |
| `DecisionPanel` / `DecisionViews` | shown decision, outcome, waiting count                         | One decision at a time; the outcome of the last action.         |
| `AgentRecord`                     | one agent, its result items                                    | What an agent did and what the user sent it.                    |
| `ResultBlock`                     | the result, two primitive retry flags; each item its own agent | Another agent's event does not re-render it.                    |
| `RetryButton`                     | nothing until clicked                                          | The one Retry for the panel and the partial result.             |
| `EventLog`                        | the raw log                                                    | Debug view of every event in arrival order.                     |

## 5. Decisions and trade-offs

- **The panel never moves by itself.** Async events never move, resize or replace what the user is reading or
  the control under the cursor; only the user's click switches the panel. There is no auto-advance: after an
  action the panel keeps its outcome ("Approved", "Answer sent: ...") and offers "Next decision: <agent>". New
  decisions are announced by the card badge, the "K need you" count and that button.
- **Allowed layout changes**, all bounded: the first result appearing above the agents; that result replaced
  by a newer one after the user's Retry; a trace the user expanded (capped at 400px, then it scrolls); the event
  log, a debug view the user opened. Everything else has reserved space. An e2e watch checks every frame that
  agent cards move only in those cases.
- **The effect line sits under Approve / Edit** ("Irreversible: cannot be undone once it happens", red for
  irreversible), because that is where the eye and the cursor are at the moment of clicking.
- **Free-text answers.** The README allows a free-text answer to a question; the console sends it. The mock
  scripts the same follow-up whatever the answer, and the UI does not hide that.
- **Mock texts are shown verbatim**, even when they repeat a badge ("Done - 4 sources") or disagree with other
  fields. The console does not correct the backend.

### What the console does not check, and why

The console guards only situations the contract allows. These it does not check:

| Case                                      | Contract line                                                                           | What would happen if it happened anyway                                                                                                                                       |
| ----------------------------------------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Events before `plan`                      | README, `plan`: "Fired once, first."                                                    | The agent is not in the model yet; the reducer throws, the `try/catch` drops that event's change and the top bar warns "The screen may not match what the agents did".        |
| A second `plan`                           | Same line                                                                               | It replaces the plan and resets every agent to queued; the run so far is lost from the screen, without a warning.                                                             |
| An agent outside `plan.subtasks`          | README, `plan`: "`subtask.id === agentId` - that's your join key."                      | Same as an event before `plan`: dropped, with the warning.                                                                                                                    |
| Events of an old run after `reset()`      | README, `reset()`: "Cancels every pending timer"                                        | None arrive: the old run is unsubscribed before `reset()`, so an event it still fired would not reach the store.                                                              |
| Malformed events, missing `type` or `seq` | README: "Every event is a plain object with `type`, `seq`, `ts`, plus its own payload." | A missing `type` is logged and skipped as an unknown type. A missing `seq` makes every ordering comparison false, so the event may be dropped or misplaced without a warning. |
| Duplicate `seq`                           | README, `seq`: "monotonic, unique, 1-based"                                             | For one agent's status the second is dropped as stale; a step with the same `seq` as another is kept next to it.                                                              |
| A command throwing                        | README, commands: "They never throw."                                                   | The exception leaves the click handler, the command is not recorded, and the panel stays as it was; the error boundary does not see errors in event handlers.                 |

What it does handle, because the contract allows it:

- Out-of-order delivery: everything is ordered by `seq`, not by arrival (stale statuses dropped, late steps
  inserted in place, a gate open only while it is the agent's newest event).
- Optional fields: `attempt`, `error`, `revision`, a draft's `subject` and `body`, step `detail`, `degraded` and
  `sources` may be missing.
- Refused commands: a command answered `false` is not recorded, and the panel says "The agent did not accept
  this action".
- Three deliberate exceptions: an unknown event type is logged and skipped; a `try/catch` around `reduce`, so a
  reducer bug drops that event's model change and the top bar shows the warning instead of the store freezing;
  an error boundary that offers "Start over".

## 6. Scale: what breaks first

Fine for 3 agents and about 33 events. In order of what would hurt first with many agents or long runs:

- Every agent card recomputes and sorts the waiting queue on every event (`AgentCard.tsx`, through
  `waitingQueue`), so with N agents each event costs N sorts and re-renders cards whose own state did not
  change. Next: compute the queue once per event (in the reducer or one memoized selector) and let each card
  subscribe only to a boolean "this agent waits", so another agent's event does not re-render it.
- A long trace renders every step. Next: a virtualized list.
- Every event is one store update and one render pass. Next: coalesce events per animation frame.

## 7. What I cut and why

- Toasts: the badge, the counter and the Next decision button already announce new decisions.
- shadcn scroll-area: native overflow is enough; it is the first polish item.
- Narrow screens, dark theme, i18n.
- Live chat with the orchestrator, multi-turn refinement, run history, result history.
- Trace virtualization and event coalescing (see Scale).
- A diff between draft revisions, per-event timestamps in the UI.

## 8. Definition of done, and where it is proven

Each item is an e2e test in `e2e/definition-of-done.e2e.ts` against the real mock:

| Item                                         | Test                                                                                        |
| -------------------------------------------- | ------------------------------------------------------------------------------------------- |
| One status line per agent                    | `1. submitting a request renders exactly one status line per agent`                         |
| Lines update in place                        | `2. a line updates in place: same element, no duplicates`                                   |
| Ordered trace, empty state                   | `3. an expanded line shows its ordered trace; an agent without steps shows the empty state` |
| Confirmation gating, Edit forces re-approval | `4. a confirmation does not fire until approved; Edit forces a fresh approval`              |
| Escalation pauses only its agent             | `5. an escalation pauses only its own agent; an answer resumes it`                          |
| Failure, Retry, separate result              | `6. a failed agent shows its error and a retry; the result is separate and reads Complete`  |

Also covered: a partial result retried from its error item, Cancel during that retry, Cancel and Run again,
layout stability every frame, and form controls under a dark system theme. Unit and component tests cover the
reducer (late events, attempts, gates, revisions, result replacement), selectors, the subscription manager
against a fake orchestrator, and every panel flow.

## 9. Time spent

Time spent: _to be filled in_.
