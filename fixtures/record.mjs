#!/usr/bin/env node
/**
 * Maintenance script — candidates do not need this.
 *
 * Re-records `fixtures/events.json` from `mock/orchestrator.js` by running the
 * canonical path (retry the failure, approve the confirmation, resolve the
 * escalation with `week_of_9_mar`) and capturing every event in arrival order.
 *
 *   node fixtures/record.mjs
 *
 * Run it if you change the mock and `node verify.mjs` reports fixture drift.
 */

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { createMockOrchestrator } from '../mock/orchestrator.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'events.json');

const orc = createMockOrchestrator({ speed: 4, onWarn: () => {} });
const events = [];

orc.subscribe((evt) => {
  events.push(evt);
  if (evt.type === 'agent_status' && evt.state === 'failed') orc.retry(evt.agentId);
  if (evt.type === 'confirmation_required') orc.approve(evt.agentId);
  if (evt.type === 'escalation_required') orc.resolve(evt.agentId, 'week_of_9_mar');
});

orc.start();

await new Promise((r) => setTimeout(r, 8000));
orc.reset();

writeFileSync(OUT, JSON.stringify(events, null, 2) + '\n');
console.log(`wrote ${events.length} events → ${OUT}`);
