/** ISO 8601 timestamp string */
export type ISOTimestamp = string;

/** Single turn in a multi-prompt session (persisted under DATA_DIR/sessions) */
export interface SessionTurn {
  role: 'user' | 'assistant';
  content: string;
  timestamp: ISOTimestamp;
}

/** High-level task envelope the Brain and specialists pass around */
export interface TaskContext {
  id: string;
  description: string;
  metadata?: Record<string, unknown>;
}

/**
 * Persistent post-mortem record for semantic recall (Outcome Memory).
 */
export interface OutcomeMemory {
  id: string;
  taskType: string;
  initialPlan: string;
  result: string;
  /** 0–1 normalized score; undefined if not yet scored */
  successScore: number | undefined;
  failureReason: string | undefined;
  timestamp: ISOTimestamp;
  /** From intake (SQLite-indexed); mirrors categories[0] when categories are stored */
  primaryCategory?: string;
  /** Full intake taxonomy (JSON in SQLite); falls back to [primaryCategory] for legacy rows */
  categories?: string[];
  canonicalQuery?: string;
  interpretedGoal?: string;
  tags?: string[];
  sessionId?: string;
  taskId?: string;
}

/**
 * Runtime state of the supervisor and its reflection loop.
 */
export interface AgentState {
  status: 'idle' | 'reflecting' | 'executing' | 'awaiting_human';
  currentTask: TaskContext | null;
  /** Recent outcomes relevant to the current session */
  history: OutcomeMemory[];
}

export type ThoughtPhase =
  | 'ingest'
  | 'recall'
  | 'strategy'
  | 'compliance'
  | 'spawn'
  | 'reflection'
  | 'hitl';

/** Cross-reference to a retrieved outcome (ids must come from the candidate set) */
export type MemoryLinkRelevance = 'supporting' | 'cautionary' | 'contrast';

export interface MemoryLink {
  outcomeId: string;
  relevance: MemoryLinkRelevance;
  note: string;
}

/** Retrieval-augmented intake: categorize, narrow, and link explicit memories */
export interface InterpretationResult {
  interpretedGoal: string;
  /** Used for memory search + strategy (may compress raw prompt) */
  canonicalQuery: string;
  /** Ordered intake labels; first entry is indexed as primaryCategory */
  categories: string[];
  /** Same as categories[0]; kept for backward-compatible APIs and SQLite index */
  primaryCategory: string;
  /** What the intake step believes it understood (esp. synthetic document teach) */
  intakeAcknowledgment?: string;
  tags: string[];
  constraints: string[];
  assumptions: string[];
  clarificationsNeeded: string[];
  /** Confidence that the ask is understood (0–1) */
  confidence: number;
  memoryLinks: MemoryLink[];
  synthesizedLessons: string[];
}

/** Single line in the Brain’s thought stream (dashboard / audit) */
export interface ThoughtStreamEntry {
  id: string;
  timestamp: ISOTimestamp;
  phase: ThoughtPhase;
  message: string;
  /** Optional short secondary line (safe summary; no raw PII). */
  detail?: string;
  metadata?: Record<string, unknown>;
}

export type InterventionKind = 'clarification' | 'quality_gate';

/**
 * Human-in-the-loop request when confidence is low or escalation is required.
 */
export interface InterventionRequest {
  requestId: string;
  /** Pre-flight questions vs post-execution approve/inject */
  kind: InterventionKind;
  brainContext: string;
  proposedNextStep: string;
  humanInstruction?: string;
  /** When kind === clarification — questions to present to the user */
  questions?: string[];
  rationale?: string;
  /** Intake assumptions the user can confirm/reject (clarification / learning signal) */
  assumptionOptions?: string[];
  /** Intake constraints the user can confirm (clarification / learning signal) */
  constraintOptions?: string[];
}

/**
 * Star-topology orchestrator: supervisor at center, specialists at tips.
 */
export interface OrchestratorState {
  orchestratorId: string;
  status: 'idle' | 'planning' | 'executing' | 'awaiting_human' | 'paused';
  currentTaskId: string | null;
  agentState: AgentState;
  thoughtStream: ThoughtStreamEntry[];
  pendingInterventions: InterventionRequest[];
  lastUpdated: ISOTimestamp;
  /** True while a task run is in progress (mirrors server busy for dashboards) */
  processing: boolean;
  /** Last successful intake result for the current or most recent run */
  lastInterpretation: InterpretationResult | null;
  /** Session id from the latest run (if any) */
  lastSessionId: string | null;
  /** Whether Gemini models are live or mock fallback */
  modelMode: 'live' | 'mock';
}

/** Law 25–oriented audit row for PII handling and data-lineage logging */
export interface ComplianceAuditEntry {
  id: string;
  timestamp: ISOTimestamp;
  direction: 'plan' | 'specialist_input' | 'specialist_output' | 'brain_internal';
  piiDetected: boolean;
  categories: string[];
  /** Short masked excerpt for review (not full raw payload) */
  maskedExcerpt: string;
  redactionCount: number;
}

export interface SimilarOutcome {
  memory: OutcomeMemory;
  score: number;
}

export interface StrategyPlan {
  summary: string;
  steps: string[];
  lessonsApplied: string[];
  /** 0–1 model-estimated confidence */
  confidence: number;
}

export interface ReflectionOnResult {
  ok: boolean;
  confidence: number;
  summary: string;
  escalateToHuman: boolean;
  suggestedFailureReason?: string;
}

export type HumanInterventionAction =
  | { type: 'approve'; humanInstruction?: string }
  | { type: 'inject_context'; humanInstruction: string }
  | { type: 'override_outcome'; outcome: 'success' | 'failure'; failureReason?: string }
  | {
      type: 'clarification_reply';
      answers: string;
      /** Assumptions the user marks as correct — injected into the next intake pass */
      confirmedAssumptions?: string[];
      /** Constraints the user marks as correct */
      confirmedConstraints?: string[];
    };

/** Server-prepared document teach payload (masked text + provenance) */
export interface DocumentTeachRunOptions {
  ingestId: string;
  /** Law 25–masked combined extracted text */
  maskedDocumentText: string;
  sourceFiles: { name: string; mime: string }[];
  /** User focus / instructions (optional) */
  focusNote?: string;
}

export interface TaskRunResult {
  taskId: string;
  status: 'completed' | 'awaiting_human' | 'error';
  finalResult?: string;
  outcomeMemoryId?: string;
  intervention?: InterventionRequest;
  error?: string;
}

export interface SpecialistInvokeInput {
  systemPrompt: string;
  userPayload: string;
  /** Tool names exposed to the specialist (descriptions enforced upstream) */
  tools: string[];
}

export interface SpecialistInvokeResult {
  raw: string;
  confidence?: number;
}

/** Specialist at star edge — implemented in `@nexus/agents` */
export interface SpecialistExecutor {
  execute(input: SpecialistInvokeInput): Promise<SpecialistInvokeResult>;
}

/** Minimal Gemini text model surface used by the reflection service */
export type TextCompletionModel = {
  generateContent: (prompt: string) => Promise<{ response: { text: () => string } }>;
};
