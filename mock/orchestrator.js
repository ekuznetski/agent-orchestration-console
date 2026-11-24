/**
 * Wand AI — Front-end take-home, Challenge 1: Agent Orchestration Console
 * ----------------------------------------------------------------------
 * MOCK ORCHESTRATOR — this is the "backend" for the exercise. It is a scripted,
 * deterministic event stream. There is no LLM, no network call, no API key, no
 * agent logic. Nothing here talks to anything.
 *
 * It is a dependency-free ES module: import it from React, Vue, Svelte, Solid,
 * Angular, or a plain <script type="module">. It does not touch the DOM.
 *
 *   import { createMockOrchestrator } from './mock/orchestrator.js';
 *   const orc = createMockOrchestrator({ speed: 1 });
 *   const off = orc.subscribe(evt => console.log(evt));
 *   orc.start();
 *
 * You do not need to read this file to do the exercise — README.md documents
 * the whole contract. It is here, readable and unminified, on purpose.
 */

/* ------------------------------------------------------------------ *
 * Constants (exported — feel free to use them in your UI)
 * ------------------------------------------------------------------ */

export const DEFAULT_TASK =
  'Research the Northwind renewal and draft a follow-up to Maya, then find time for a call next week.';

export const RUN_ID = 'run_northwind_7f3a';

/** The three agent ids. `agentId` on every event is one of these. */
export const AGENT_IDS = {
  research: 'agent_research',
  drafting: 'agent_drafting',
  scheduling: 'agent_scheduling',
};

/** Every event `type` the stream can emit. */
export const EVENT_TYPES = [
  'plan',
  'agent_status',
  'agent_step',
  'confirmation_required',
  'escalation_required',
  'result',
];

/** Every `state` an `agent_status` event can carry. */
export const AGENT_STATES = ['queued', 'running', 'done', 'failed'];

/** Every `act` an `agent_step` event can carry. */
export const STEP_ACTS = ['searched', 'read', 'decided'];

/** The plan's subtasks. `subtask.id === agentId`. */
export const SUBTASKS = [
  { id: AGENT_IDS.research, type: 'research', label: 'Research the Northwind renewal' },
  { id: AGENT_IDS.drafting, type: 'drafting', label: 'Draft a follow-up to Maya Chen' },
  { id: AGENT_IDS.scheduling, type: 'scheduling', label: 'Find time for a call next week' },
];

/** Options offered by the scheduling agent's escalation. */
export const ESCALATION_OPTIONS = [
  {
    id: 'week_of_9_mar',
    label: 'Week of 9 Mar',
    detail: 'Before the 31 Mar renewal date — leaves room for one more round.',
  },
  {
    id: 'week_of_16_mar',
    label: 'Week of 16 Mar',
    detail: 'After the security review is due to close.',
  },
  {
    id: 'ask_maya',
    label: 'Ask Maya to pick',
    detail: 'Send a scheduling link instead of holding a slot.',
  },
];

/** Virtual clock origin — Monday 2 March 2026, 09:00 UTC. See `clock` option. */
export const CLOCK_BASE_ISO = '2026-03-02T09:00:00.000Z';

const CLOCK_BASE_MS = Date.parse(CLOCK_BASE_ISO);

/** How far behind its delivery a deliberately out-of-order event is stamped. */
const OOO_LAG_TICKS = 0.45;

/**
 * Each agent's timeline is phase-shifted by a fraction of a tick so that two
 * agents never schedule an event for the exact same millisecond. Without this,
 * arrival order between concurrent agents would be decided by timer luck.
 */
const AGENT_PHASE_TICKS = {
  agent_research: 0,
  agent_drafting: 0.13,
  agent_scheduling: 0.27,
};

const INITIAL_DRAFT = {
  subject: 'Northwind renewal — security sign-off and next steps',
  body: [
    'Hi Maya,',
    '',
    'Following up on the renewal. From our side the only open blocker is the',
    'security review sign-off on NW-2291 — everything else is ready to go before',
    'the 31 Mar term end.',
    '',
    'I know the 12% uplift is the sticking point. Happy to walk through how we',
    'landed on it and what we can flex.',
    '',
    'Would a 30-minute call next week work? I can send a couple of times.',
    '',
    'Best,',
    'Alex',
  ].join('\n'),
};

/** Slot chosen per escalation option — keeps the mock deterministic. */
const SCHEDULING_OUTCOMES = {
  week_of_9_mar: {
    detail: 'Placed a 30-min hold — Tue 10 Mar, 14:00–14:30 (reversible, auto-applied and logged)',
    statusLine: 'Hold placed — Tue 10 Mar, 14:00',
  },
  week_of_16_mar: {
    detail: 'Placed a 30-min hold — Tue 17 Mar, 15:00–15:30 (reversible, auto-applied and logged)',
    statusLine: 'Hold placed — Tue 17 Mar, 15:00',
  },
  ask_maya: {
    detail: 'Sent Maya a scheduling link for 9–20 Mar instead of holding a slot',
    statusLine: 'Scheduling link sent to Maya',
  },
};

const DEFAULT_OUTCOME = {
  detail: 'Placed a 30-min hold — Tue 10 Mar, 14:00–14:30 (reversible, auto-applied and logged)',
  statusLine: 'Hold placed — Tue 10 Mar, 14:00',
};

/* ------------------------------------------------------------------ *
 * Tiny deterministic PRNG (only used when `jitter: true`)
 * ------------------------------------------------------------------ */

function makeRandom(seed) {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/* ------------------------------------------------------------------ *
 * Event shorthands
 * ------------------------------------------------------------------ */

const status = (agentId, state, statusLine, extra) => ({
  type: 'agent_status',
  agentId,
  state,
  statusLine,
  ...extra,
});

const step = (agentId, act, detail) => ({ type: 'agent_step', agentId, act, detail });

/* ------------------------------------------------------------------ *
 * The script
 *
 * Each segment is a list of `{ t, ev }` entries, where `t` is a time in
 * "ticks" (1 tick = `tickMs` / `speed` milliseconds of real time).
 *
 * `{ t, pair: [a, b] }` is the deliberate OUT-OF-ORDER hook: `a` gets the
 * LOWER `seq` and the EARLIER `ts`, but `b` is delivered to subscribers FIRST.
 * ------------------------------------------------------------------ */

const R = AGENT_IDS.research;
const D = AGENT_IDS.drafting;
const S = AGENT_IDS.scheduling;

/** Research, attempt 1 — ends in failure. */
const researchAttempt1 = () => [
  { t: 0, ev: status(R, 'queued', 'Queued — research', { attempt: 1 }) },
  { t: 2, ev: status(R, 'running', 'Searching Slack and Jira…', { attempt: 1 }) },
  { t: 3, ev: step(R, 'searched', 'Slack #northwind-renewal — 42 messages since 12 Feb') },
  {
    // OUT-OF-ORDER #1: the Jira search (lower seq, earlier ts) lands AFTER the
    // Slack read that logically followed it.
    t: 5,
    pair: [
      step(R, 'searched', "Jira NW-2291 'Renewal blockers' — 3 open issues"),
      step(R, 'read', 'Slack thread (18 Feb) — Maya flags the 12% uplift'),
    ],
  },
  { t: 7, ev: step(R, 'read', 'Jira NW-2291 — blocked on security review sign-off') },
  {
    t: 9,
    ev: status(R, 'failed', 'Failed — Jira fetch timed out after 3 attempts', {
      attempt: 1,
      error: { code: 'upstream_timeout', message: 'jira.search timed out after 30s', retryable: true },
    }),
  },
];

/** Research, attempt 2 — only ever runs if `retry()` is called. Succeeds. */
const researchAttempt2 = () => [
  { t: 0, ev: status(R, 'queued', 'Retrying — attempt 2', { attempt: 2 }) },
  { t: 2, ev: status(R, 'running', 'Re-fetching Jira with backoff…', { attempt: 2 }) },
  { t: 3, ev: step(R, 'searched', 'Jira NW-2291 (retry) — 3 issues fetched') },
  { t: 5, ev: step(R, 'read', 'Renewal doc v4 — term ends 31 Mar 2026, 12% uplift proposed') },
  {
    t: 7,
    ev: step(R, 'decided', 'Summary: renewal at risk on security sign-off; Maya owns the pricing objection'),
  },
  { t: 8, ev: status(R, 'done', 'Done — 4 sources, 1 summary', { attempt: 2 }) },
];

/** Drafting — runs up to the confirmation gate, then parks. */
const draftingIntro = (draft) => [
  { t: 1, ev: status(D, 'queued', 'Queued — drafting') },
  { t: 4, ev: status(D, 'running', 'Drafting the follow-up to Maya Chen…') },
  { t: 6, ev: step(D, 'read', 'Last 3 email threads with maya.chen@northwind.example') },
  { t: 8, ev: step(D, 'decided', 'Tone: concise; lead with the security sign-off blocker') },
  { t: 10, ev: status(D, 'running', 'Paused — waiting for your approval') },
  {
    t: 11,
    ev: {
      type: 'confirmation_required',
      agentId: D,
      action: 'send_email',
      target: 'maya.chen@northwind.example',
      effectClass: 'irreversible',
      draft,
      revision: 1,
    },
  },
];

/** Drafting — `edit()` re-drafts and asks for approval again. */
const draftingEdit = (draft, revision) => [
  {
    t: 0,
    ev: step(D, 'decided', `Draft edited by you — approval reset (revision ${revision})`),
  },
  { t: 1, ev: status(D, 'running', 'Paused — waiting for your approval (edited draft)') },
  {
    t: 2,
    ev: {
      type: 'confirmation_required',
      agentId: D,
      action: 'send_email',
      target: 'maya.chen@northwind.example',
      effectClass: 'irreversible',
      draft,
      revision,
    },
  },
];

/** Drafting — after `approve()`. */
const draftingApprove = () => [
  { t: 0, ev: step(D, 'decided', 'Approved by you — sending as drafted') },
  { t: 1, ev: status(D, 'running', 'Sending…') },
  { t: 3, ev: status(D, 'done', 'Sent to maya.chen@northwind.example') },
];

/** Scheduling — runs up to the escalation, then parks. */
const schedulingIntro = () => [
  { t: 2, ev: status(S, 'queued', 'Queued — scheduling') },
  { t: 5, ev: status(S, 'running', 'Checking calendars for next week…') },
  { t: 7, ev: step(S, 'searched', 'Your calendar — 6 free 30-min slots, 9–13 Mar') },
  { t: 9, ev: step(S, 'read', "Maya's free/busy is not visible (external org)") },
  { t: 11, ev: status(S, 'running', 'Paused — needs your decision') },
  {
    t: 12,
    ev: {
      type: 'escalation_required',
      agentId: S,
      question: 'Which week should I target for the Northwind call?',
      context:
        "Maya's calendar is external, so I can't see her availability. The renewal term ends 31 Mar and the security review is due to close 13 Mar.",
      options: ESCALATION_OPTIONS,
    },
  },
];

/** Scheduling — after `resolve()`. */
const schedulingResolve = (choiceLabel, outcome) => [
  { t: 0, ev: step(S, 'decided', `You chose: ${choiceLabel}`) },
  {
    // OUT-OF-ORDER #2: the final trace step (lower seq, earlier ts) lands AFTER
    // the terminal `done` status for the same agent.
    t: 2,
    pair: [step(S, 'decided', outcome.detail), status(S, 'done', outcome.statusLine)],
  },
];

/* ------------------------------------------------------------------ *
 * The orchestrator
 * ------------------------------------------------------------------ */

/**
 * Create a mock orchestrator.
 *
 * @param {object} [options]
 * @param {number} [options.speed=1]    Time multiplier. 2 = twice as fast,
 *                                      0.25 = four times slower (good for
 *                                      debugging). Must be > 0.
 * @param {number} [options.tickMs=320] Milliseconds in one tick at speed 1.
 * @param {number} [options.seed=42]    Seed for the jitter PRNG.
 * @param {boolean} [options.jitter=false] Add deterministic ±0.25-tick jitter to
 *                                      timings. Off by default so runs are
 *                                      byte-identical.
 * @param {'virtual'|'wall'} [options.clock='virtual'] `virtual` stamps `ts` from
 *                                      a fixed origin so runs are reproducible;
 *                                      `wall` uses real `Date.now()`.
 * @param {string} [options.task]       Task text echoed in the `plan` event.
 * @param {(msg: string) => void} [options.onWarn] Called instead of console.warn.
 */
export function createMockOrchestrator(options = {}) {
  const cfg = {
    speed: options.speed ?? 1,
    tickMs: options.tickMs ?? 320,
    seed: options.seed ?? 42,
    jitter: options.jitter ?? false,
    clock: options.clock ?? 'virtual',
    task: options.task ?? DEFAULT_TASK,
    onWarn:
      options.onWarn ??
      ((msg) => {
        if (typeof console !== 'undefined') console.warn('[mock-orchestrator] ' + msg);
      }),
  };
  if (!(cfg.speed > 0)) throw new Error('createMockOrchestrator: `speed` must be > 0');
  if (!(cfg.tickMs > 0)) throw new Error('createMockOrchestrator: `tickMs` must be > 0');

  const subscribers = new Set();
  const timers = new Set();
  const agents = new Map();

  let log = [];
  let seqCounter = 0;
  let started = false;
  let vMax = 0;
  let random = makeRandom(cfg.seed);
  let resultTimer = null;
  let resultEmitted = false;
  let task = cfg.task;

  /* -- timing -------------------------------------------------------- */

  const realMs = (ticks) => Math.max(0, (ticks * cfg.tickMs) / cfg.speed);

  function later(ticks, fn) {
    const id = setTimeout(() => {
      timers.delete(id);
      fn();
    }, realMs(ticks));
    timers.add(id);
    return id;
  }

  function clearTimers() {
    for (const id of timers) clearTimeout(id);
    timers.clear();
    resultTimer = null;
  }

  /**
   * Stamp an event. `ts` is a logical clock: it never goes backwards in `seq`
   * order (parked/retried agents resume "later" than they were scheduled), so
   * sorting by `ts` and sorting by `seq` agree. Neither agrees with the order
   * events actually arrive — that is the point of the exercise.
   */
  function stamp(vAtMs) {
    const v = Math.max(vAtMs, vMax + 1);
    vMax = v;
    if (cfg.clock === 'wall') return new Date().toISOString();
    return new Date(CLOCK_BASE_MS + Math.round(v)).toISOString();
  }

  /* -- emission ------------------------------------------------------ */

  function makeEvent(spec, vAtMs, seq) {
    const { type, ...payload } = spec;
    return { type, seq, ts: stamp(vAtMs), ...payload };
  }

  function deliver(evt) {
    // Keep the mock's own bookkeeping in sync with what the UI just saw.
    if (evt.type === 'agent_status') {
      const a = agents.get(evt.agentId);
      if (a) a.state = evt.state;
    } else if (evt.type === 'confirmation_required') {
      const a = agents.get(evt.agentId);
      if (a) {
        a.waiting = 'confirmation';
        a.draft = evt.draft;
      }
    } else if (evt.type === 'escalation_required') {
      const a = agents.get(evt.agentId);
      if (a) a.waiting = 'escalation';
    }

    log.push(evt);
    for (const cb of [...subscribers]) {
      try {
        cb(evt);
      } catch (err) {
        cfg.onWarn('subscriber threw: ' + (err && err.message ? err.message : String(err)));
      }
    }

    if (evt.type !== 'result') maybeScheduleResult();
  }

  function fireEntry(entry, vBase, t) {
    if (entry.pair) {
      const [a, b] = entry.pair;
      const seqA = ++seqCounter;
      const seqB = ++seqCounter;
      const evA = makeEvent(a, vBase + t * cfg.tickMs, seqA);
      const evB = makeEvent(b, vBase + (t + OOO_LAG_TICKS) * cfg.tickMs, seqB);
      deliver(evB); // later event first…
      later(OOO_LAG_TICKS, () => deliver(evA)); // …earlier event after. On purpose.
    } else {
      deliver(makeEvent(entry.ev, vBase + t * cfg.tickMs, ++seqCounter));
    }
  }

  /**
   * Schedule one segment for one agent.
   * @param {object} agent
   * @param {Array} entries
   * @param {{absolute?: boolean}} [opts] absolute = ticks are measured from run start.
   */
  function runSegment(agent, entries, opts = {}) {
    const vBase = opts.absolute ? 0 : Math.max(agent.vCursor, vMax) + cfg.tickMs * 0.5;
    const phase = AGENT_PHASE_TICKS[agent.id] ?? 0;
    let lastT = 0;
    for (const entry of entries) {
      const t = entry.t + phase + (cfg.jitter ? random() * 0.25 : 0);
      if (t > lastT) lastT = t;
      later(t, () => fireEntry(entry, vBase, t));
    }
    agent.vCursor = vBase + (lastT + 1) * cfg.tickMs;
  }

  /* -- aggregation --------------------------------------------------- */

  function allSettled() {
    if (!started) return false;
    for (const a of agents.values()) {
      if (a.waiting) return false;
      if (a.state !== 'done' && a.state !== 'failed') return false;
    }
    return true;
  }

  function maybeScheduleResult() {
    if (resultTimer) {
      clearTimeout(resultTimer);
      timers.delete(resultTimer);
      resultTimer = null;
    }
    if (resultEmitted) return;
    if (!allSettled()) return;
    resultTimer = later(2, () => {
      resultTimer = null;
      emitResult();
    });
  }

  function emitResult() {
    if (resultEmitted) return;
    resultEmitted = true;

    const research = agents.get(R);
    const scheduling = agents.get(S);
    const degraded = research.state === 'failed';
    const outcome = scheduling.outcome ?? DEFAULT_OUTCOME;

    const items = [];
    if (degraded) {
      items.push({
        id: 'item_research',
        agentId: R,
        kind: 'error',
        title: 'Research incomplete',
        detail:
          'The research agent failed (Jira fetch timed out) and was not retried, so the renewal summary is missing.',
        sources: [],
      });
    } else {
      items.push({
        id: 'item_research',
        agentId: R,
        kind: 'summary',
        title: 'Northwind renewal — status',
        detail:
          'Term ends 31 Mar 2026 with a 12% uplift proposed. The renewal is blocked on security review sign-off (NW-2291). Maya owns the pricing objection raised on 18 Feb.',
        sources: [
          'Slack #northwind-renewal',
          'Jira NW-2291',
          'Slack thread — 18 Feb',
          'Renewal doc v4',
        ],
      });
    }

    items.push({
      id: 'item_email',
      agentId: D,
      kind: 'email_sent',
      title: 'Follow-up sent to Maya Chen',
      detail: `Subject: ${agents.get(D).draft?.subject ?? INITIAL_DRAFT.subject} — sent to maya.chen@northwind.example after your approval.`,
      sources: [],
    });

    items.push({
      id: 'item_hold',
      agentId: S,
      kind: 'calendar_hold',
      title: outcome.statusLine,
      detail: outcome.detail,
      sources: [],
    });

    const summary = degraded
      ? 'Partial result. The follow-up went to Maya and a call slot is held, but the renewal research failed — retry the research agent for the full picture.'
      : 'Northwind renewal is blocked on security sign-off. A follow-up went to Maya Chen and a 30-minute call slot is held for next week.';

    deliver(
      makeEvent(
        { type: 'result', runId: RUN_ID, degraded, summary, items },
        vMax + cfg.tickMs,
        ++seqCounter
      )
    );
  }

  /* -- public API ---------------------------------------------------- */

  /**
   * Subscribe to the stream. Returns an unsubscribe function.
   * Note: subscribers only receive events emitted AFTER they subscribe —
   * subscribe before calling `start()`. `getEvents()` returns the log so far.
   */
  function subscribe(cb) {
    if (typeof cb !== 'function') throw new TypeError('subscribe(cb): cb must be a function');
    subscribers.add(cb);
    return () => subscribers.delete(cb);
  }

  /** Start the run. Optional `request` string overrides the task text only. */
  function start(request) {
    if (started) {
      cfg.onWarn('start() ignored — already started. Call reset() first.');
      return false;
    }
    started = true;
    if (typeof request === 'string' && request.trim()) task = request.trim();

    agents.clear();
    for (const st of SUBTASKS) {
      agents.set(st.id, {
        id: st.id,
        type: st.type,
        state: null,
        vCursor: 0,
        waiting: null,
        draft: null,
        revision: 1,
        outcome: null,
      });
    }

    deliver(
      makeEvent({ type: 'plan', runId: RUN_ID, task, subtasks: SUBTASKS.map((s) => ({ ...s })) }, 0, ++seqCounter)
    );

    runSegment(agents.get(R), researchAttempt1(), { absolute: true });
    runSegment(agents.get(D), draftingIntro(INITIAL_DRAFT), { absolute: true });
    runSegment(agents.get(S), schedulingIntro(), { absolute: true });
    return true;
  }

  /** Approve a parked confirmation. The agent proceeds and sends. */
  function approve(agentId) {
    const a = agents.get(agentId);
    if (!a || a.waiting !== 'confirmation') {
      cfg.onWarn(`approve(${agentId}) ignored — that agent is not waiting for confirmation.`);
      return false;
    }
    a.waiting = null;
    runSegment(a, draftingApprove());
    return true;
  }

  /**
   * Edit the parked draft. The agent does NOT send — it re-drafts and asks for
   * approval again with a bumped `revision`.
   * @param {string} agentId
   * @param {string|{subject?: string, body?: string}} draft
   */
  function edit(agentId, draft) {
    const a = agents.get(agentId);
    if (!a || a.waiting !== 'confirmation') {
      cfg.onWarn(`edit(${agentId}) ignored — that agent is not waiting for confirmation.`);
      return false;
    }
    const patch = typeof draft === 'string' ? { body: draft } : draft || {};
    const next = { ...(a.draft ?? INITIAL_DRAFT), ...patch };
    a.revision += 1;
    a.draft = next;
    // Stays `waiting` — the new confirmation_required re-arms the gate anyway.
    runSegment(a, draftingEdit(next, a.revision));
    return true;
  }

  /**
   * Answer a parked escalation. `choice` may be an option id, an option object,
   * or any free-text string.
   */
  function resolve(agentId, choice) {
    const a = agents.get(agentId);
    if (!a || a.waiting !== 'escalation') {
      cfg.onWarn(`resolve(${agentId}) ignored — that agent is not waiting for an escalation.`);
      return false;
    }
    const id = choice && typeof choice === 'object' ? choice.id : choice;
    const known = ESCALATION_OPTIONS.find((o) => o.id === id || o.label === id);
    const label = known ? known.label : String(id ?? 'unspecified');
    const outcome = (known && SCHEDULING_OUTCOMES[known.id]) || DEFAULT_OUTCOME;
    a.waiting = null;
    a.outcome = outcome;
    runSegment(a, schedulingResolve(label, outcome));
    return true;
  }

  /** Retry the failed agent. Attempt 2 always succeeds. */
  function retry(agentId) {
    const a = agents.get(agentId);
    if (!a || a.state !== 'failed') {
      cfg.onWarn(`retry(${agentId}) ignored — that agent is not in a failed state.`);
      return false;
    }
    if (resultTimer) {
      clearTimeout(resultTimer);
      timers.delete(resultTimer);
      resultTimer = null;
    }
    resultEmitted = false; // a retry re-opens aggregation
    a.state = 'queued';
    runSegment(a, researchAttempt2());
    return true;
  }

  /** Cancel everything and return to a pre-start state. Subscribers are kept. */
  function reset() {
    clearTimers();
    agents.clear();
    log = [];
    seqCounter = 0;
    started = false;
    vMax = 0;
    resultEmitted = false;
    random = makeRandom(cfg.seed);
    task = cfg.task;
  }

  /** Every event emitted so far, in ARRIVAL order (copy). */
  function getEvents() {
    return log.slice();
  }

  /** The resolved config (copy). */
  function getConfig() {
    return { ...cfg };
  }

  return {
    subscribe,
    start,
    approve,
    edit,
    resolve,
    retry,
    reset,
    getEvents,
    getConfig,
  };
}

export default createMockOrchestrator;
