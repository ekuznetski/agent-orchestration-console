/**
 * Wand AI — Front-end take-home, Challenge 1: Agent Orchestration Console
 * Types for the mock orchestrator's event contract.
 *
 * Plain JS candidates can ignore this file. TS candidates get the whole
 * contract typed:
 *
 *   import { createMockOrchestrator, type OrchestratorEvent } from './mock/orchestrator.js';
 *
 * (If your bundler complains about importing a `.js` path, either enable
 * `allowJs`/`moduleResolution: "bundler"` or copy this file next to your code.)
 */

/* ------------------------------------------------------------------ *
 * Envelope
 * ------------------------------------------------------------------ */

export type EventType =
  | 'plan'
  | 'agent_status'
  | 'agent_step'
  | 'confirmation_required'
  | 'escalation_required'
  | 'result';

export type AgentId = 'agent_research' | 'agent_drafting' | 'agent_scheduling';

export type AgentType = 'research' | 'drafting' | 'scheduling';

export type AgentState = 'queued' | 'running' | 'done' | 'failed';

export type StepAct = 'searched' | 'read' | 'decided';

export type EffectClass = 'irreversible' | 'reversible' | 'read_only';

/** Every event carries these. `seq` is monotonic in LOGICAL order — which is
 *  NOT always the order events are delivered to you. Key by `agentId`, order
 *  by `seq`. */
export interface EventBase {
  type: EventType;
  /** Monotonic, unique, 1-based. Logical order — use this to sort. */
  seq: number;
  /** ISO-8601 timestamp. */
  ts: string;
}

/* ------------------------------------------------------------------ *
 * Events
 * ------------------------------------------------------------------ */

export interface Subtask {
  /** Equal to the `agentId` that will run it. */
  id: AgentId;
  type: AgentType;
  label: string;
}

/** Fired once, first: the orchestrator's decomposition of the request. */
export interface PlanEvent extends EventBase {
  type: 'plan';
  runId: string;
  task: string;
  subtasks: Subtask[];
}

/** One agent's collapsed status line changed. Render this in place. */
export interface AgentStatusEvent extends EventBase {
  type: 'agent_status';
  agentId: AgentId;
  state: AgentState;
  statusLine: string;
  /** Optional extra (not part of the published contract): 1 or 2. */
  attempt?: number;
  /** Optional extra: present on `state: 'failed'`. */
  error?: { code: string; message: string; retryable: boolean };
}

/** One entry in an agent's drill-down trace. */
export interface AgentStepEvent extends EventBase {
  type: 'agent_step';
  agentId: AgentId;
  act: StepAct;
  detail: string;
}

/** The agent has PARKED before an irreversible side-effect. It will emit
 *  nothing further until `approve(agentId)` is called. `edit()` re-drafts and
 *  re-emits this event with a bumped `revision`. */
export interface ConfirmationRequiredEvent extends EventBase {
  type: 'confirmation_required';
  agentId: AgentId;
  /** e.g. `'send_email'`. */
  action: string;
  /** e.g. `'maya.chen@northwind.example'`. */
  target: string;
  effectClass: EffectClass;
  draft: Draft;
  /** Optional extra: 1 for the first draft, incremented by each `edit()`. */
  revision?: number;
}

export interface Draft {
  subject?: string;
  body?: string;
  [key: string]: unknown;
}

/** The agent hit a decision beyond its authority and PARKED. It will emit
 *  nothing further until `resolve(agentId, choice)` is called. */
export interface EscalationRequiredEvent extends EventBase {
  type: 'escalation_required';
  agentId: AgentId;
  question: string;
  context: string;
  options: EscalationOption[];
}

export interface EscalationOption {
  id: string;
  label: string;
  detail?: string;
}

/** The aggregate. Emitted only once every agent has settled (`done` or
 *  `failed`) and no gate is outstanding. A `retry()` after a degraded result
 *  re-opens aggregation and a fresh `result` is emitted. */
export interface ResultEvent extends EventBase {
  type: 'result';
  summary: string;
  items: ResultItem[];
  /** Optional extra. */
  runId?: string;
  /** Optional extra: true when an agent settled as `failed`. */
  degraded?: boolean;
}

export interface ResultItem {
  id: string;
  agentId: AgentId;
  kind: 'summary' | 'email_sent' | 'calendar_hold' | 'error' | (string & {});
  title: string;
  detail: string;
  sources?: string[];
}

export type OrchestratorEvent =
  | PlanEvent
  | AgentStatusEvent
  | AgentStepEvent
  | ConfirmationRequiredEvent
  | EscalationRequiredEvent
  | ResultEvent;

/** Narrow an event by its `type`: `EventOf<'agent_step'>`. */
export type EventOf<T extends EventType> = Extract<OrchestratorEvent, { type: T }>;

/* ------------------------------------------------------------------ *
 * Orchestrator
 * ------------------------------------------------------------------ */

export interface OrchestratorOptions {
  /** Time multiplier. 2 = twice as fast, 0.25 = four times slower. Default 1. */
  speed?: number;
  /** Milliseconds in one tick at speed 1. Default 320. */
  tickMs?: number;
  /** Seed for the jitter PRNG. Default 42. */
  seed?: number;
  /** Deterministic ±0.25-tick timing jitter. Default false. */
  jitter?: boolean;
  /** `'virtual'` (default) stamps `ts` from a fixed origin so runs reproduce. */
  clock?: 'virtual' | 'wall';
  /** Task text echoed in the `plan` event. */
  task?: string;
  /** Called instead of `console.warn` for ignored handler calls. */
  onWarn?: (message: string) => void;
}

export type Unsubscribe = () => void;

export interface MockOrchestrator {
  /** Subscribe to the stream. Only receives events emitted AFTER subscribing. */
  subscribe(cb: (event: OrchestratorEvent) => void): Unsubscribe;
  /** Start the run. `request` overrides the task text only. */
  start(request?: string): boolean;
  /** Approve a parked confirmation → the agent sends and finishes. */
  approve(agentId: AgentId | string): boolean;
  /** Replace the parked draft → the agent re-asks for approval. Does NOT send. */
  edit(agentId: AgentId | string, draft: string | Draft): boolean;
  /** Answer a parked escalation → the agent resumes. */
  resolve(agentId: AgentId | string, choice: string | EscalationOption): boolean;
  /** Retry the failed agent. Attempt 2 always succeeds. */
  retry(agentId: AgentId | string): boolean;
  /** Cancel all pending timers and return to a pre-start state. */
  reset(): void;
  /** Every event emitted so far, in ARRIVAL order. */
  getEvents(): OrchestratorEvent[];
  /** The resolved options. */
  getConfig(): Required<Omit<OrchestratorOptions, 'onWarn'>> & {
    onWarn: (message: string) => void;
  };
}

export declare function createMockOrchestrator(options?: OrchestratorOptions): MockOrchestrator;
export default createMockOrchestrator;

export declare const DEFAULT_TASK: string;
export declare const RUN_ID: string;
export declare const AGENT_IDS: { research: AgentId; drafting: AgentId; scheduling: AgentId };
export declare const EVENT_TYPES: EventType[];
export declare const AGENT_STATES: AgentState[];
export declare const STEP_ACTS: StepAct[];
export declare const SUBTASKS: Subtask[];
export declare const ESCALATION_OPTIONS: EscalationOption[];
export declare const CLOCK_BASE_ISO: string;
