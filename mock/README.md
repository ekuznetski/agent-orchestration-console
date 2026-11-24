# Challenge 1 — Agent Orchestration Console (starter repo)

**You build the front end. Everything else is already here.**

This repo is the mock "backend" for the exercise: a scripted, deterministic
stream of agent events plus the handlers your UI calls back into. Import it,
subscribe, render.

---

## 🚫 You do NOT build any AI or backend

There is **no LLM, no model call, no API key, no agent logic, no server** in this
repo — and you should not add any. The "agents" are a hand-written event script
driven by `setTimeout`. Nothing here talks to the network.

If you find yourself writing a prompt, an orchestrator, a retrieval step, a
websocket server, or an API route, **stop** — you are spending your 8 hours on
the wrong thing. The mock already emits everything the challenge asks you to
display, including the failures and the awkward cases.

**What you own:** the console UI — its state model, its streaming behaviour, its
interaction design, its handling of the messy states. That's the whole test.

---

## What's in the box

| File | What it is |
| --- | --- |
| `mock/orchestrator.js` | The mock. A dependency-free ES module. **This is the only file you need to import.** |
| `mock/orchestrator.d.ts` | TypeScript types for the whole contract. Optional. |
| `fixtures/events.json` | A recorded run — all 33 events, in arrival order. Handy for tests, storybook states, or building offline. |
| `fixtures/record.mjs` | Maintenance script that re-records the fixture. You will not need it. |
| `index.html` | An **ugly wire-check harness**. Proves the mock works and shows you the raw events. **Not a design reference — do not copy it.** |
| `verify.mjs` | `node verify.mjs` — asserts the contract holds. Run it first to confirm your environment. |

No `package.json`, no dependencies, no build step. Use whatever stack you like.

---

## Run it

**Contract check (10 seconds, no browser):**

```bash
node verify.mjs
# → ALL CHECKS PASSED — 64 assertions. Your environment is good to go.
```

**The wire-check harness:**

```bash
npx serve .            # or: python3 -m http.server 8000
# open http://localhost:3000
```

Then hit **start()** and watch the raw events land. (Opening `index.html`
directly off the filesystem won't work — browsers block ES module imports over
`file://`. The page tells you so.)

**In your own app:** copy the `mock/` folder into your project (or import it by
relative path). It's a plain ES module — no bundler config needed.

---

## The scenario

> "Research the Northwind renewal and draft a follow-up to Maya, then find time
> for a call next week."

Three agents run **concurrently** and their events **interleave**:

| Agent | `agentId` | What it does |
| --- | --- | --- |
| Research | `agent_research` | Searches Slack + Jira, reads sources, summarises. **Fails on attempt 1.** Succeeds on `retry()`. |
| Drafting | `agent_drafting` | Drafts an email to `maya.chen@northwind.example`, then **parks** on an irreversible confirmation. |
| Scheduling | `agent_scheduling` | Checks calendars, **parks** on an escalation ("which week?"), then places a hold. |

Once all three settle, a single `result` aggregates the run.

---

## The event contract

Every event is a plain object with `type`, `seq`, `ts`, plus its own payload.

| Field | Type | Notes |
| --- | --- | --- |
| `type` | string | one of the six below |
| `seq` | number | **monotonic, unique, 1-based — logical order.** Not always arrival order. |
| `ts` | string | ISO-8601. Non-decreasing in `seq` order. |

### `plan`
Fired once, first.

```js
{ type: 'plan', seq, ts,
  runId: 'run_northwind_7f3a',
  task: 'Research the Northwind renewal and…',
  subtasks: [ { id: 'agent_research', type: 'research', label: 'Research the Northwind renewal' }, … ] }
```

`subtask.id === agentId` — that's your join key.

### `agent_status`
One agent's collapsed status line changed. Render it **in place**.

```js
{ type: 'agent_status', seq, ts,
  agentId: 'agent_research',
  state: 'queued' | 'running' | 'done' | 'failed',
  statusLine: 'Searching Slack and Jira…' }
```

Extras beyond the published contract, use them if useful: `attempt` (1 or 2) and,
on failures, `error: { code, message, retryable }`.

### `agent_step`
One entry in that agent's drill-down trace.

```js
{ type: 'agent_step', seq, ts,
  agentId: 'agent_research',
  act: 'searched' | 'read' | 'decided',
  detail: 'Jira NW-2291 — blocked on security review sign-off' }
```

### `confirmation_required`
The agent has **parked** before an irreversible side-effect. It emits nothing
further until you call `approve()`.

```js
{ type: 'confirmation_required', seq, ts,
  agentId: 'agent_drafting',
  action: 'send_email',
  target: 'maya.chen@northwind.example',
  effectClass: 'irreversible',
  draft: { subject: '…', body: '…' },
  revision: 1 }                       // extra: bumped by each edit()
```

### `escalation_required`
The agent hit a decision beyond its authority and **parked**. It emits nothing
further until you call `resolve()`.

```js
{ type: 'escalation_required', seq, ts,
  agentId: 'agent_scheduling',
  question: 'Which week should I target for the Northwind call?',
  context: "Maya's calendar is external, so I can't see her availability…",
  options: [ { id: 'week_of_9_mar', label: 'Week of 9 Mar', detail: '…' }, … ] }
```

### `result`
The aggregate. Only after every agent has settled.

```js
{ type: 'result', seq, ts,
  summary: 'Northwind renewal is blocked on security sign-off…',
  items: [ { id, agentId, kind: 'summary'|'email_sent'|'calendar_hold'|'error', title, detail, sources: [] }, … ],
  runId: 'run_northwind_7f3a',        // extra
  degraded: false }                   // extra: true if an agent settled as failed
```

---

## The handler API

```js
import { createMockOrchestrator, AGENT_IDS } from './mock/orchestrator.js';

const orc = createMockOrchestrator({ speed: 1 });
const unsubscribe = orc.subscribe((event) => { /* your reducer */ });
orc.start();
```

| Call | What it does |
| --- | --- |
| `subscribe(cb)` | Returns an `unsubscribe()` function. Only delivers events emitted **after** you subscribe — subscribe before `start()`. |
| `start(request?)` | Starts the run. `request` overrides the task text only; the script is fixed. |
| `approve(agentId)` | Releases a parked confirmation. The agent sends and finishes. |
| `edit(agentId, draft)` | Replaces the parked draft. The agent **does not send** — it re-emits `confirmation_required` with `revision + 1`. `draft` is `{ subject?, body? }` or a plain string (treated as the body). |
| `resolve(agentId, choice)` | Answers a parked escalation and resumes the agent. `choice` is an option `id`, an option object, or free text. |
| `retry(agentId)` | Retries the failed agent. Attempt 2 always succeeds. |
| `reset()` | Cancels every pending timer and returns to a pre-start state. Subscribers are kept. |
| `getEvents()` | Every event so far, in arrival order. |

Handlers return `true` if they did something, `false` (plus a `console.warn`) if
the agent wasn't in a state that accepts them. They never throw.

**Options:** `{ speed = 1, tickMs = 320, seed = 42, jitter = false, clock = 'virtual', task, onWarn }`.
`speed: 0.25` slows everything to a crawl while you debug; `speed: 4` is good for
tests. `jitter: true` adds deterministic timing wobble (seeded by `seed`) if you
want a less metronomic feel.

**Deliberately not provided:** there is no `getState()` that hands you a derived
map of agents and their traces. Building that model out of the event stream is
the exercise.

---

## Three things that will bite you if you don't read this

**1. Events arrive out of order — on purpose.**
Two events in every run are delivered *after* an event with a higher `seq`. One
is a `searched` step that lands after the `read` step that followed it; the other
is a final trace step that lands *after* its agent's terminal `done` status.

> Key everything by `agentId`, order by `seq`, and don't assume the last event you
> received for an agent is its latest state. A UI that appends blindly will show a
> trace in the wrong order and can flip a finished agent back to "running".

(Arrival order between two *different* agents can also wobble by a millisecond on
a loaded machine. That's realistic, and it's why `seq` exists.)

**2. One agent fails.**
`agent_research` always fails on its first attempt with
`state: 'failed'` and a retryable error. It stays failed until you call
`retry(agentId)`. Design that state — a run that just sits there dead is a bad
console.

If you never retry, the run still completes: `failed` counts as settled, so a
`result` arrives with `degraded: true` and an `error` item. Retrying *after* that
re-opens aggregation and a fresh `result` supersedes it — so treat `result` as
"the latest aggregate", not "the one and only final event".

**3. The gates really block.**
After `confirmation_required`, `agent_drafting` emits **nothing** until
`approve()`. After `escalation_required`, `agent_scheduling` emits **nothing**
until `resolve()`. Neither blocks the *other* agents — the rest of the run keeps
streaming. `edit()` does not send; it re-arms the gate and requires fresh
approval.

---

## Hooking it up

### Vanilla

```js
import { createMockOrchestrator } from './mock/orchestrator.js';

const orc = createMockOrchestrator();
const agents = new Map();

orc.subscribe((evt) => {
  switch (evt.type) {
    case 'plan':
      for (const s of evt.subtasks) agents.set(s.id, { ...s, steps: [], status: null });
      break;
    case 'agent_status': {
      const a = agents.get(evt.agentId);
      if (!a.status || evt.seq > a.status.seq) a.status = evt;   // ignore stale
      break;
    }
    case 'agent_step': {
      const a = agents.get(evt.agentId);
      a.steps.push(evt);
      a.steps.sort((x, y) => x.seq - y.seq);                     // re-order
      break;
    }
    // confirmation_required / escalation_required / result …
  }
  render(agents);
});

orc.start();
```

### React

```jsx
import { useEffect, useMemo, useReducer } from 'react';
import { createMockOrchestrator } from './mock/orchestrator.js';

function reducer(state, evt) { /* your state model — the interesting bit */ }

export function Console() {
  const orc = useMemo(() => createMockOrchestrator({ speed: 1 }), []);
  const [state, dispatch] = useReducer(reducer, initialState);

  useEffect(() => {
    const off = orc.subscribe(dispatch);
    orc.start();
    return () => { off(); orc.reset(); };   // StrictMode double-mounts in dev
  }, [orc]);

  return <Runs state={state} onApprove={orc.approve} onResolve={orc.resolve} onRetry={orc.retry} />;
}
```

### Vue 3

```js
import { onMounted, onUnmounted, reactive } from 'vue';
import { createMockOrchestrator } from './mock/orchestrator.js';

const orc = createMockOrchestrator();
const state = reactive({ agents: {}, result: null });
let off;
onMounted(() => { off = orc.subscribe((e) => apply(state, e)); orc.start(); });
onUnmounted(() => { off?.(); orc.reset(); });
```

### Svelte

```js
import { writable } from 'svelte/store';
import { createMockOrchestrator } from './mock/orchestrator.js';

export const orc = createMockOrchestrator();
export const runs = writable(initialState);
orc.subscribe((e) => runs.update((s) => apply(s, e)));
```

### Tests / offline

```js
import events from './fixtures/events.json' with { type: 'json' };
// or: const events = await fetch('/fixtures/events.json').then(r => r.json());

events.forEach(dispatch);   // same reducer, no timers
```

The fixture is a real recording (arrival order preserved, out-of-order events
included), taken from the canonical path: retry the failure, approve the
confirmation, resolve with `week_of_9_mar`.

---

## What we're evaluating

**The UI and UX are yours to design.** There is no mock-up to match and no
"correct" layout — `index.html` is intentionally hideous so you have nothing to
copy. We're looking at:

- **Streaming & concurrency** — do agents update *in place* as a live line, or
  does every event append/re-render the world? Do concurrent agents stay
  independent? Are out-of-order and terminal events handled?
- **State architecture** — is there a clear run/agent/trace model? Are the
  paused states (confirmation, escalation, failed) first-class states the run
  *resumes* from, rather than hacks? Would it survive a fourth agent type?
- **Trust UX** — the confirmation gate is the product, not a dialog. Is the
  irreversible action genuinely blocked? Does `edit()` force re-approval? Is the
  effect class visible?
- **States under ambiguity** — loading, empty trace, failed/retry,
  needs-confirmation, escalated. The happy path is the easy 20%.
- **Design taste** — calm, scannable progress; clear hierarchy between plan,
  agent lines, and result; restrained colour.

**The scope exceeds 8 hours on purpose.** What you cut, and why, is part of what
we're assessing — tell us in your README. A small, well-argued console beats a
sprawling half-finished one.

Using Claude Code or similar is expected and fine. We'll ask you to walk us
through your state model and defend where state lives, so make sure you
understand every line you ship.

Good luck — and if anything in this repo doesn't run, that's our bug, not yours.
Tell us and we'll fix it.
