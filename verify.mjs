#!/usr/bin/env node
/**
 * verify.mjs — run the mock end-to-end and assert the published contract holds.
 *
 *   node verify.mjs
 *
 * No dependencies. If this prints "ALL CHECKS PASSED", your environment is
 * fine and the mock is behaving. You do not need to edit this file — but
 * reading it is the fastest way to learn exactly how the stream behaves.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  createMockOrchestrator,
  AGENT_IDS,
  EVENT_TYPES,
  AGENT_STATES,
  STEP_ACTS,
} from './mock/orchestrator.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SPEED = 4; // 1 tick = 80ms — fast, but wide enough for stable ordering.

/* ------------------------------------------------------------------ *
 * Micro test harness
 * ------------------------------------------------------------------ */

let passed = 0;
let failed = 0;
const failures = [];

function check(label, condition, extra) {
  if (condition) {
    passed++;
    console.log(`PASS  ${label}`);
  } else {
    failed++;
    failures.push(label);
    console.log(`FAIL  ${label}${extra ? `\n        → ${extra}` : ''}`);
  }
}

function section(title) {
  console.log(`\n--- ${title} ${'-'.repeat(Math.max(0, 58 - title.length))}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(predicate, { timeout = 15000, label = 'condition' } = {}) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await sleep(10);
  }
  throw new Error(`timed out waiting for ${label}`);
}

const byType = (events, type) => events.filter((e) => e.type === type);
const forAgent = (events, agentId) => events.filter((e) => e.agentId === agentId);

/* ------------------------------------------------------------------ *
 * Scenario A — canonical run (retry, approve, resolve as soon as asked)
 * ------------------------------------------------------------------ */

async function canonicalRun() {
  const orc = createMockOrchestrator({ speed: SPEED, onWarn: () => {} });
  const events = [];
  orc.subscribe((e) => {
    events.push(e);
    if (e.type === 'agent_status' && e.state === 'failed') orc.retry(e.agentId);
    if (e.type === 'confirmation_required') orc.approve(e.agentId);
    if (e.type === 'escalation_required') orc.resolve(e.agentId, 'week_of_9_mar');
  });
  orc.start();
  await waitFor(() => events.some((e) => e.type === 'result'), { label: 'result event' });
  await sleep(200); // let any straggler land — nothing should.
  return events;
}

async function scenarioA() {
  section('A. Canonical run (auto retry / approve / resolve)');
  const events = await canonicalRun();

  // --- envelope -----------------------------------------------------
  const emitted = new Set(events.map((e) => e.type));
  check(
    'all six event types are emitted',
    EVENT_TYPES.every((t) => emitted.has(t)),
    `missing: ${EVENT_TYPES.filter((t) => !emitted.has(t)).join(', ')}`
  );
  check('every event has a numeric seq and an ISO ts', events.every((e) => Number.isInteger(e.seq) && typeof e.ts === 'string' && !Number.isNaN(Date.parse(e.ts))));

  const seqs = events.map((e) => e.seq);
  const unique = new Set(seqs);
  check('seq values are unique', unique.size === seqs.length);
  const sorted = [...seqs].sort((a, b) => a - b);
  check(
    'seq values are a gapless 1..N run',
    sorted.every((s, i) => s === i + 1),
    `got ${sorted.length} events, max seq ${sorted[sorted.length - 1]}`
  );

  const bySeq = [...events].sort((a, b) => a.seq - b.seq);
  check(
    'ts is non-decreasing when sorted by seq',
    bySeq.every((e, i) => i === 0 || Date.parse(e.ts) >= Date.parse(bySeq[i - 1].ts))
  );

  // --- out-of-order -------------------------------------------------
  let inversions = 0;
  for (let i = 1; i < events.length; i++) if (events[i].seq < events[i - 1].seq) inversions++;
  check(
    'stream contains deliberately out-of-order events (arrival order != seq order)',
    inversions >= 2,
    `found ${inversions} inversions, expected >= 2`
  );

  // --- plan ---------------------------------------------------------
  const plan = byType(events, 'plan')[0];
  check('plan is the first event', events[0]?.type === 'plan');
  check('plan has runId + task + 3 subtasks', !!plan?.runId && typeof plan.task === 'string' && plan.subtasks?.length === 3);
  check(
    'each subtask has id / type / label, and id === agentId',
    plan.subtasks.every((s) => s.id && s.type && s.label) &&
      plan.subtasks.map((s) => s.id).join(',') ===
        [AGENT_IDS.research, AGENT_IDS.drafting, AGENT_IDS.scheduling].join(',')
  );

  // --- agent_status / agent_step -----------------------------------
  const statuses = byType(events, 'agent_status');
  check('every agent_status.state is in the enum', statuses.every((e) => AGENT_STATES.includes(e.state)));
  check('every agent_status has agentId + statusLine', statuses.every((e) => e.agentId && typeof e.statusLine === 'string' && e.statusLine.length > 0));
  const steps = byType(events, 'agent_step');
  check('every agent_step.act is in the enum', steps.every((e) => STEP_ACTS.includes(e.act)));
  check('every agent_step has agentId + detail + ts', steps.every((e) => e.agentId && e.detail && e.ts));

  const agentsSeen = new Set(events.filter((e) => e.agentId).map((e) => e.agentId));
  check('all three agents emit events', agentsSeen.size === 3);

  // interleaving: no agent's events form one contiguous block
  const streamOfAgents = events.filter((e) => e.agentId).map((e) => e.agentId);
  const blocks = streamOfAgents.filter((a, i) => i === 0 || a !== streamOfAgents[i - 1]).length;
  check('agents interleave (they do not run one after another)', blocks > 6, `only ${blocks} agent switches`);

  // --- failure + retry ---------------------------------------------
  const failedAgents = new Set(statuses.filter((e) => e.state === 'failed').map((e) => e.agentId));
  check('exactly one agent fails', failedAgents.size === 1, `failed: ${[...failedAgents].join(', ')}`);
  check('the failing agent is the research agent', failedAgents.has(AGENT_IDS.research));
  const researchStatuses = forAgent(statuses, AGENT_IDS.research).sort((a, b) => a.seq - b.seq);
  check(
    'retry() recovers the failed agent to done',
    researchStatuses.some((e) => e.state === 'failed') &&
      researchStatuses[researchStatuses.length - 1].state === 'done'
  );
  check(
    'the retry re-runs the trace (attempt 2 emits fresh steps)',
    forAgent(steps, AGENT_IDS.research).some((e) => e.detail.includes('(retry)'))
  );

  // --- confirmation gate -------------------------------------------
  const conf = byType(events, 'confirmation_required')[0];
  check('confirmation_required has agentId/action/target/effectClass/draft', !!conf && !!conf.agentId && !!conf.action && !!conf.target && !!conf.effectClass && !!conf.draft);
  check("confirmation_required declares effectClass 'irreversible'", conf.effectClass === 'irreversible');
  check('the drafting agent only reaches done after approval', (() => {
    const done = statuses.find((e) => e.agentId === AGENT_IDS.drafting && e.state === 'done');
    return !!done && done.seq > conf.seq;
  })());

  // --- escalation ---------------------------------------------------
  const esc = byType(events, 'escalation_required')[0];
  check('escalation_required has question/context/options[]', !!esc && !!esc.question && !!esc.context && Array.isArray(esc.options) && esc.options.length >= 2);
  check('every escalation option has id + label', esc.options.every((o) => o.id && o.label));
  check('the scheduling agent only reaches done after resolve', (() => {
    const done = statuses.find((e) => e.agentId === AGENT_IDS.scheduling && e.state === 'done');
    return !!done && done.seq > esc.seq;
  })());
  check('the resolved choice is echoed into the trace', forAgent(steps, AGENT_IDS.scheduling).some((e) => e.detail.includes('Week of 9 Mar')));

  // --- result -------------------------------------------------------
  const results = byType(events, 'result');
  check('exactly one result event in the canonical run', results.length === 1, `got ${results.length}`);
  const result = results[0];
  check('result is the highest-seq event', result.seq === Math.max(...seqs));
  check('result is the last event to arrive', events[events.length - 1] === result);
  check('result has summary + items[]', typeof result.summary === 'string' && Array.isArray(result.items) && result.items.length === 3);
  check('result is not degraded when the retry succeeded', result.degraded === false);
  check('result arrives only after every agent settled', (() => {
    const terminal = ['done', 'failed'];
    for (const id of Object.values(AGENT_IDS)) {
      const last = forAgent(statuses, id).sort((a, b) => a.seq - b.seq).pop();
      if (!last || !terminal.includes(last.state)) return false;
      if (last.seq > result.seq) return false;
    }
    return true;
  })());

  return events;
}

/* ------------------------------------------------------------------ *
 * Scenario B — gates really block; edit(); degraded result; late retry
 * ------------------------------------------------------------------ */

async function scenarioB() {
  section('B. Blocking gates, edit(), degraded result, late retry');
  const orc = createMockOrchestrator({ speed: SPEED, onWarn: () => {} });
  const events = [];
  orc.subscribe((e) => events.push(e));
  orc.start();

  // 1. Confirmation gate blocks.
  await waitFor(() => events.some((e) => e.type === 'confirmation_required'), { label: 'confirmation_required' });
  const afterGate = events.length;
  await sleep(1000); // ~12 ticks of doing nothing
  check(
    'confirmation gate: the drafting agent emits nothing while parked',
    events.slice(afterGate).every((e) => e.agentId !== AGENT_IDS.drafting),
    events.slice(afterGate).filter((e) => e.agentId === AGENT_IDS.drafting).map((e) => e.type).join(', ')
  );
  check('confirmation gate: no result while an agent is parked', !events.some((e) => e.type === 'result'));

  // 2. edit() re-asks instead of sending.
  const before = events.length;
  const edited = orc.edit(AGENT_IDS.drafting, { body: 'Hi Maya — short version. Can we talk next week?' });
  check('edit() is accepted while parked', edited === true);
  await waitFor(() => events.slice(before).some((e) => e.type === 'confirmation_required'), { label: 're-confirmation' });
  const reconf = events.slice(before).find((e) => e.type === 'confirmation_required');
  check('edit() re-emits confirmation_required with the edited draft', reconf.draft.body.startsWith('Hi Maya — short version'));
  check('edit() bumps the revision', reconf.revision === 2);
  await sleep(500);
  check(
    'edit() does NOT send — the agent is still parked',
    !events.some((e) => e.type === 'agent_status' && e.agentId === AGENT_IDS.drafting && e.state === 'done')
  );

  // 3. Escalation gate blocks.
  await waitFor(() => events.some((e) => e.type === 'escalation_required'), { label: 'escalation_required' });
  const afterEsc = events.length;
  await sleep(800);
  check(
    'escalation gate: the scheduling agent emits nothing while parked',
    events.slice(afterEsc).every((e) => e.agentId !== AGENT_IDS.scheduling)
  );

  // 4. Approve + resolve → both settle. Research was never retried → degraded.
  orc.approve(AGENT_IDS.drafting);
  orc.resolve(AGENT_IDS.scheduling, 'week_of_16_mar');
  await waitFor(() => events.some((e) => e.type === 'result'), { label: 'degraded result' });
  const degradedResult = events.find((e) => e.type === 'result');
  check('a result is emitted once every agent settles (failed counts as settled)', !!degradedResult);
  check('result.degraded is true when the failed agent was never retried', degradedResult.degraded === true);
  check('the degraded result reports the failure as an item', degradedResult.items.some((i) => i.kind === 'error'));
  check('resolve() honours the chosen option', events.some((e) => e.type === 'agent_status' && e.agentId === AGENT_IDS.scheduling && e.state === 'done' && e.statusLine.includes('17 Mar')));

  // 5. Retrying after the degraded result re-opens aggregation.
  const beforeRetry = events.length;
  check('retry() is accepted on the failed agent', orc.retry(AGENT_IDS.research) === true);
  await waitFor(() => events.slice(beforeRetry).some((e) => e.type === 'result'), { label: 'second result' });
  const second = events.slice(beforeRetry).find((e) => e.type === 'result');
  check('a fresh result supersedes the degraded one after a successful retry', second.degraded === false);
  check('the fresh result is the last event', events[events.length - 1] === second);
  orc.reset();
  return events;
}

/* ------------------------------------------------------------------ *
 * Scenario C — handler guards and reset()
 * ------------------------------------------------------------------ */

async function scenarioC() {
  section('C. Handler guards, reset(), subscribe() teardown');
  const warnings = [];
  const orc = createMockOrchestrator({ speed: SPEED, onWarn: (m) => warnings.push(m) });
  const events = [];
  const off = orc.subscribe((e) => events.push(e));

  check('approve() before the gate is a no-op returning false', orc.approve(AGENT_IDS.drafting) === false);
  check('resolve() before the escalation is a no-op returning false', orc.resolve(AGENT_IDS.scheduling, 'x') === false);
  check('retry() on a healthy agent is a no-op returning false', orc.retry(AGENT_IDS.research) === false);
  check('edit() on an unknown agent is a no-op returning false', orc.edit('nope', 'hi') === false);
  check('ignored handler calls warn instead of throwing', warnings.length === 4);

  check('start() returns true', orc.start() === true);
  check('a second start() is refused', orc.start() === false);
  await waitFor(() => events.length > 3, { label: 'a few events' });

  orc.reset();
  const countAtReset = events.length;
  await sleep(600);
  check('reset() cancels every pending timer', events.length === countAtReset, `${events.length - countAtReset} events arrived after reset()`);
  check('reset() clears the event log', orc.getEvents().length === 0);

  check('start() works again after reset()', orc.start() === true);
  await waitFor(() => orc.getEvents().length > 2, { label: 'restart' });
  check('seq restarts at 1 after reset()', orc.getEvents()[0].seq === 1);

  off();
  const seen = events.length;
  await sleep(300);
  check('unsubscribe() stops delivery', events.length === seen);
  orc.reset();
}

/* ------------------------------------------------------------------ *
 * Scenario D — fixtures/events.json matches a live run
 * ------------------------------------------------------------------ */

async function scenarioD(canonicalEvents) {
  section('D. fixtures/events.json is in sync with the mock');
  let fixture;
  try {
    fixture = JSON.parse(readFileSync(join(HERE, 'fixtures', 'events.json'), 'utf8'));
  } catch (err) {
    check('fixtures/events.json parses', false, err.message);
    return;
  }
  check('fixtures/events.json is a non-empty array', Array.isArray(fixture) && fixture.length > 0);
  check('fixture has the same number of events as a live run', fixture.length === canonicalEvents.length, `fixture ${fixture.length} vs live ${canonicalEvents.length}`);

  // Compared as a multiset, ignoring `seq`/`ts`: arrival order between two
  // concurrent agents is allowed to wobble by a millisecond on a loaded
  // machine, which is exactly why the contract carries `seq`.
  const norm = (list) =>
    list
      .map(({ seq, ts, ...rest }) => JSON.stringify(rest))
      .sort()
      .join('\n');
  const liveNorm = norm(canonicalEvents);
  const fixtureNorm = norm(fixture);
  check(
    'fixture content matches a live run (order-insensitive)',
    fixtureNorm === liveNorm,
    fixtureNorm === liveNorm ? '' : 'fixtures/events.json has drifted from mock/orchestrator.js'
  );
  check('fixture seq values are a gapless 1..N run', (() => {
    const s = fixture.map((e) => e.seq).sort((a, b) => a - b);
    return new Set(s).size === s.length && s.every((v, i) => v === i + 1);
  })());
  check('fixture ends with the result event', fixture[fixture.length - 1].type === 'result');

  let inversions = 0;
  for (let i = 1; i < fixture.length; i++) if (fixture[i].seq < fixture[i - 1].seq) inversions++;
  check('fixture preserves the recorded (out-of-order) arrival order', inversions >= 2, `found ${inversions}`);
}

/* ------------------------------------------------------------------ *
 * main
 * ------------------------------------------------------------------ */

console.log('Wandy take-home — Challenge 1 mock orchestrator: contract check\n');

try {
  const canonical = await scenarioA();
  await scenarioB();
  await scenarioC();
  await scenarioD(canonical);
} catch (err) {
  failed++;
  failures.push('unexpected error: ' + err.message);
  console.log('\nFAIL  unexpected error\n      ' + (err && err.stack ? err.stack : err));
}

console.log(`\n${'='.repeat(64)}`);
if (failed === 0) {
  console.log(`ALL CHECKS PASSED — ${passed} assertions. Your environment is good to go.`);
  process.exit(0);
} else {
  console.log(`${failed} CHECK(S) FAILED (${passed} passed):`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
