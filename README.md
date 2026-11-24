# Agent Orchestration Console - candidate write-up

The assignment and the mock's contract: [mock/README.md](mock/README.md).

A front end for the provided mock orchestrator: one request fans out to three agents, and the console shows
their progress, the decisions that need the user and the result. One design rule runs through it: async events
never move what the user is reading. Every rule in detail: [docs/architecture.md](docs/architecture.md).

## 1. Run

Developed with Node 26.13 and pnpm 11 (Vite 8 needs Node 22.12 or newer).

```bash
cd app
pnpm install
pnpm dev
```

Open http://localhost:5173 (Vite prints another address if that port is taken) and press Start run.

The mock is imported unchanged from `../mock` through the Vite alias `@mock`. The debug row (speed, jitter,
event log) is part of the UI; the event log is a debug view, not built for long runs.

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
- `src/components/console/*` render and take input; components keep only view logic (for example `RetryButton`
  stores the panel's outcome); run state changes only in `reduce`.

## 3. Design

Where the decisions live decided the layout. Considered:

- A decision under each agent card: the cards below jump whenever one opens or closes.
- A decisions inbox, or a workspace with a queue beside it: both list the agents a second time next to the
  cards.

Chosen: one side panel that shows one decision at a time, and the agent cards are the queue (badge, "K need
you", the Next decision button). There is no auto-advance: after an action the panel keeps its outcome until
the user moves.

Wireframes and design: https://claude.ai/code/artifact/08d6428f-5296-428b-be51-6de7bc2385d7 (a Wireframe page
with the layout options considered and the chosen one, and a Design page). Snapshots in the repo:

- [docs/design/wireframe-options.png](docs/design/wireframe-options.png): the layout options considered.
- [docs/design/wireframe-chosen.png](docs/design/wireframe-chosen.png): the chosen layout, one decision mid-run.
- [docs/design/design-main.png](docs/design/design-main.png): the Design page's main board.

## 4. Stack and why

- React 19 with the React Compiler: memoization without hand-written `useMemo` / `memo`.
- Vite: fast dev server, and the alias that imports the mock unchanged.
- TypeScript: the contract in `orchestrator.d.ts` types every event and command.
- Zustand rather than the starter's suggested `useReducer`: two small stores, a selector subscription per agent
  so one agent's event re-renders one card, no provider, and a store the subscription manager can write to
  from outside React. The one orchestrator lives at module level in the subscription manager, not in React
  state, because nothing on screen renders from it.
- Tailwind v4 with shadcn/ui on Base UI: accessible primitives (radio group, checkbox, toggle) come for free, and
  every colour, size and radius is a token in one theme.
- react-error-boundary: the one fallback with "Start over".
- lucide-react: the icons of the design.
- Vitest with Testing Library: component and reducer tests against a fake orchestrator.
- Playwright: the definition of done against the real mock, in a real browser.
- oxlint and prettier: fast lint and one format.

## 5. Where state lives and why

Two stores, because they change for different reasons and have different lifetimes.

- **Run store** (`console.store.ts`, built only by `reduce`): the model of what the agents did, built from the
  mock's events and the commands the mock accepted (`command_sent`, which is how a pending command is known
  without any acknowledgement). Everything is ordered by `seq`, not by arrival: a stale status is dropped, a late
  step is inserted in its place, a gate (approval or question) is open only while it is the agent's newest event,
  so gates are states derived from the event order rather than flags someone has to reset. Results are versioned
  and marked outdated by a newer status until the next result replaces them. One exception to "the newest event
  decides": while an edit is pending the model keeps the gate (needs_approval, its place in the queue) until the
  agent re-emits its confirmation; the card shows "Waiting for agent" meanwhile, like any pending command. Each agent's tag is
  stored, derived on every event by `tagOf`, and set to cancelled by Cancel run.
- **View store** (`view.store.ts`): what this screen shows and what the user is typing: the selected decision,
  panel mode (decisions or an agent's record), the outcome of the last action, open edits, question answers,
  request text, speed, jitter, the run clock. None of it is part of the run model or replayed into it. The run
  clock is the one value that follows the run (an effect in `TopBar` starts and stops it from `startedAt` and the
  phase).
- **Component state**, deliberately local: an open trace, the open event log, a "the agent did not accept this
  action" message. Nothing else needs them.

## 6. Component boundaries

| Component                         | Subscribes to                                                                                      | Why                                                                                                           |
| --------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `TopBar` / `StartCard`            | run header (phase, counts), plan task, `startedAt`, `modelError`, log size, request, speed, jitter | Primitive fields: it re-renders on a phase or count change, and the debug row on every event (the log count). |
| `AgentList` / `AgentCard`         | plan order; each card its own agent by reference, and whether it waits or is shown                 | An event for one agent re-renders its card, and the others only when the waiting queue changes (see Scale).   |
| `AgentTrace`                      | its agent                                                                                          | Mounted only while open and fed the agent its card already holds: a closed trace costs nothing.               |
| `DecisionPanel` / `DecisionViews` | shown decision, outcome, waiting count                                                             | Reads the shown agent and the queue: other agents' events re-render it only when the queue changes.           |
| `AgentRecord`                     | one agent, its result items                                                                        | Reads one agent and its result items: opening a record leaves the decision state untouched.                   |
| `ResultBlock`                     | the result, two primitive retry flags; each item its own agent                                     | Another agent's event does not re-render it.                                                                  |
| `RetryButton`                     | nothing until clicked                                                                              | The one Retry for the panel and the partial result.                                                           |
| `EventLog`                        | the raw log                                                                                        | Mounted only when open: rendering the table costs nothing while closed (the top bar reads the count).         |
| `ClampedText`                     | nothing                                                                                            | One rule for long text we do not control: one line or two, tooltip.                                           |

## 7. Decisions and trade-offs

- **The panel never moves by itself.** Async events never move, resize or replace what the user is reading or
  the control under the cursor; only the user's click switches the panel. There is no auto-advance: after an
  action the panel keeps its outcome ("Approved", "Answer sent: ...") and offers "Next decision: <agent>". New
  decisions are announced by the card badge, the "K need you" count and that button.
- **Allowed layout changes**, all bounded: the first result appearing above the agents; that result replaced by a
  newer one after the user's Retry; a trace the user expanded (capped at 400px, then it scrolls); the event log,
  a debug view the user opened. The result pushes the cards down once when it first appears (and once more when a
  Retry replaces it): it is what the user looks for when the run ends, and it appears only at that moment; during
  streaming the cards never move, unless the user has opened a trace above them (it grows with new steps up to
  400px). Everything else has reserved space. An e2e watch checks every frame that agent cards move only in those
  cases.
- **The effect line sits under Approve / Edit** ("Be careful, this action cannot be undone", red for
  irreversible), because that is where the eye and the cursor are at the moment of clicking.
- **Free-text answers.** `mock/README.md` allows a free-text answer to a question; the console sends it verbatim.
  The trace and the record then show what the agent actually did next, so when the mock's scripted follow-up
  does not match the words, that mismatch is visible, not papered over.
- **The card's status line is the newest of the agent's status line and its latest step.** `mock/README.md`
  presents `statusLine` as the collapsed line and steps as the drill-down, but an agent reports a step before its
  next status (after an answer, for example), and a line that still says "Paused" after the user answered reads
  as if nothing happened. Failed keeps its status line.
- **Mock texts are shown verbatim**, even when they repeat the badge word (a Done card whose line starts with
  Done) or disagree with other fields: a card can say Running while its line says Paused, because the mock sends
  that line with state running one event before the confirmation; the event log shows the same raw event. The
  console does not correct the backend.
- **After Save changes the panel shows the outcome, not the re-asked email**; the edited email opens from "Next
  decision: <agent>". The panel never swaps in an irreversible "Approve and send" by itself, so no click lands on
  a button that appeared under the cursor.
- **"Next decision: <agent>" can change its label while the user reads the outcome** (it pointed to Research,
  then to Draft when the edited confirmation arrived): it only navigates and takes no action, and the agent that
  asks again after the user's own action is the right next step.
- **Long single-line texts end in an ellipsis**, with the full text in the tooltip and in the agent record:
  one-line slots keep the cards at a fixed height while events stream.
- **The decision panel changes height when the user switches decisions**: that change follows the user's click,
  never an event.
- **Cancel run is a text button, and the debug controls are muted and locked during a run**: Cancel is secondary
  to the decisions, and the mock takes speed and jitter only when it is created, so they can be set only before a
  run.

### What the console does not check, and why

The console guards only situations the contract allows. These it does not check:

| Case                                      | Contract line                                                                                   | What would happen if it happened anyway                                                                                                                                                                                                                           |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Events before `plan`                      | mock/README.md, `plan`: "Fired once, first."                                                    | The agent is not in the model yet; the reducer throws, the `try/catch` drops that event's change and the top bar warns "The screen may not match what the agents did"; on a first run the start card is still up and shows no warning.                            |
| A second `plan`                           | Same line                                                                                       | It replaces the plan and resets every agent to queued; the run so far is lost from the screen, without a warning.                                                                                                                                                 |
| An agent outside `plan.subtasks`          | mock/README.md, `plan`: "`subtask.id === agentId` - that's your join key."                      | Same as an event before `plan`: dropped, with the warning.                                                                                                                                                                                                        |
| Events of an old run after `reset()`      | mock/README.md, `reset()`: "Cancels every pending timer"                                        | None arrive: the old run is unsubscribed before `reset()`, so an event it still fired would not reach the store.                                                                                                                                                  |
| Malformed events, missing `type` or `seq` | mock/README.md: "Every event is a plain object with `type`, `seq`, `ts`, plus its own payload." | A missing `type` is logged and skipped as an unknown type. A missing `seq` makes every ordering comparison false, so the event may be dropped or misplaced without a warning, and the agent's `maxSeq` becomes NaN for good, so its pending command never clears. |
| Duplicate `seq`                           | mock/README.md, `seq`: "monotonic, unique, 1-based"                                             | For one agent's status the second is dropped as stale; a step with the same `seq` as another is kept next to it.                                                                                                                                                  |
| A command throwing                        | mock/README.md, commands: "They never throw."                                                   | The exception leaves the click handler, the command is not recorded, and the panel stays as it was; the error boundary does not see errors in event handlers.                                                                                                     |

What it does handle, because the contract allows it:

- Out-of-order delivery: everything is ordered by `seq`, not by arrival (stale statuses dropped, late steps
  inserted in place, a gate open only while it is the agent's newest event).
- Optional fields: `attempt`, `error`, `revision`, a draft's `subject` and `body`, `degraded` and `sources` may be
  missing.
- Refused commands: a command answered `false` is not recorded, and the panel says "The agent did not accept
  this action".
- Four deliberate exceptions: an unknown event type is logged and skipped; a `try/catch` around `reduce`, so a
  reducer bug drops that event's model change and the top bar shows the warning instead of the store freezing; an
  error boundary that offers "Start over"; and a command sent while the agent's previous one is pending does not
  reach the mock (it reports `true`, already in flight), because after `edit()` the mock still accepts
  `approve()` until it re-emits the confirmation and would send the replaced draft.

## 8. Scale: what breaks first

Fine for 3 agents and about 33 events. In order of what would hurt first with many agents or long runs:

- Every agent card computes and sorts the waiting queue twice on every event (its own "waits" boolean in
  `AgentCard.tsx`, and `useIsShown` through `useWaitingQueue` in `hooks.ts`), so with N agents each event costs
  2N sorts; a card re-renders only when the queue it reads changes. Next: compute the queue once per event (in
  the reducer or one memoized selector) and let each card read its own entry.
- A long trace renders every step. Next: a virtualized list.
- Every event is one store update and one render pass. Next: coalesce events per animation frame.

## 9. What I cut and why

- Toasts: the badge, the counter and the Next decision button already announce new decisions.
- shadcn scroll-area: native overflow works; scroll-area is the first polish item.
- Narrow screens: the console is a desktop work tool, and the layout stability rules were designed for two
  columns.
- Dark theme and i18n: no requirement asks for them, and the time went to the core flows.
- Live chat with the orchestrator and multi-turn refinement: stretch goals; the core flows came first.
- Run history and result history: one run is the unit of the task.
- A diff between draft revisions: the record shows the full approved draft.
- Trace virtualization and event coalescing: see Scale.

## 10. Tests and checks

```bash
pnpm exec playwright install chromium   # once, before the first e2e run
pnpm build        # type check (tsc -b) and production build
pnpm test         # Vitest: unit and component tests (jsdom, fake orchestrator)
pnpm e2e          # Playwright, Chromium, against the real mock; starts its own server on 5298
pnpm e2e:jitter   # the same suite with the mock's timing jitter
pnpm lint         # oxlint
pnpm format       # prettier
```

The e2e suite sets speed and jitter through the debug row, the way a user would. It runs against the real mock,
with one exception: the long-label test serves the mock module with one plan label replaced (`page.route`), since
the mock's labels are fixed. Lint reports only `only-export-components` warnings, in the generated shadcn files
(`badge.tsx`, `button.tsx`, `toggle.tsx`).

## 11. What we're evaluating, and where

| Criterion (mock/README.md)                                            | Mechanism                                                                                                                                                                                                                                        | Tests                                                                                                                                  |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| Streaming: lines update in place                                      | One card per agent keyed by id, its own selector; one status line slot                                                                                                                                                                           | e2e `2. a line updates in place`; `AgentList` "updates a card in place"                                                                |
| Concurrent agents stay independent                                    | Per-agent model and subscriptions; a gate pauses only its agent                                                                                                                                                                                  | e2e `5. an escalation pauses only its own agent`; `ResultRenders`                                                                      |
| Out-of-order and terminal events                                      | Everything ordered by `seq`; a late step inserted, a stale status dropped, Done kept                                                                                                                                                             | reducer "orders every trace by seq", "places the step that arrives after done", "never lets an older status override"; e2e with jitter |
| Run / agent / trace model                                             | `reduce` over events and accepted commands; `traceOf` groups by attempt                                                                                                                                                                          | reducer and selectors tests                                                                                                            |
| Paused states the run resumes from                                    | Gates derived from the newest event; attempts for failures; Retry, answer and approve resume                                                                                                                                                     | reducer "splits research into two attempts", "keeps needs_approval ... between edit() and the re-emitted gate"                         |
| A fourth agent type                                                   | Tags and labels fall back for an unknown type (`agentTags.ts`)                                                                                                                                                                                   | reducer "handles a fourth agent type and a ten-agent plan"; `AgentList` "renders ten cards ... a fourth agent type"                    |
| Trust: the gate blocks, Edit forces re-approval, effect class visible | Approve is the only path to `approve()`; an edit re-opens the gate; effect line under the buttons                                                                                                                                                | e2e `4. a confirmation does not fire until approved`; `Actions` approve and edit tests                                                 |
| States under ambiguity                                                | Starting and Planning spinners (they guard a slow backend; this mock sends the plan synchronously inside `start()`, so they do not show in the demo), empty trace text, failed with Retry, needs approval / answer, waiting for agent, cancelled | e2e `3.`, `6.`, Cancel tests; `CancelledRun`; `Actions` "the card badge says Waiting for agent"                                        |
| Design taste                                                          | One raised card per region, colour only for state, the panel rule                                                                                                                                                                                | design check against the boards (`docs/architecture.md`, Visual design); e2e layout watch                                              |

## 12. Definition of done, and where it is proven

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

## 13. Time spent

Time spent: _to be filled in_.
