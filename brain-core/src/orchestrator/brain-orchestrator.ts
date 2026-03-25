import type {
  ComplianceAuditEntry,
  DocumentTeachRunOptions,
  HumanInterventionAction,
  InterpretationResult,
  InterventionRequest,
  OrchestratorState,
  OutcomeMemory,
  SessionTurn,
  SpecialistExecutor,
  TaskContext,
  TaskRunResult,
  ThoughtPhase,
  ThoughtStreamEntry
} from '../lib/types.js';
import type { Law25Auditor } from '../compliance/law25-auditor.js';
import type { InterpretationService } from '../interpretation/interpretation-service.js';
import type { OutcomeMemoryService } from '../memory/outcome-memory-service.js';
import type { ReflectionService } from '../reflection/reflection-service.js';
import { formatSessionTranscript } from '../session/session-store.js';
import { newId } from '../util/id.js';
import { brainLog } from '../util/log.js';
import { shouldRequestClarification } from './clarify-policy.js';
import {
  syntheticInterpretationForDocumentTeach,
  syntheticInterpretationForWebTeach
} from './document-teach.js';
import { mergeSimilarOutcomes } from '../util/similar-outcomes.js';

const DEFAULT_CONFIDENCE = 0.7;

function shortPreview(s: string | undefined | null, max: number): string {
  if (!s) return '';
  const t = s.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max)}…`;
}

function intakeCategoriesPreview(ir: InterpretationResult, max = 96): string {
  const line = ir.categories.join(', ');
  return shortPreview(line, max);
}

export type BrainEvent =
  | { type: 'thought'; entry: ThoughtStreamEntry }
  | { type: 'state'; state: OrchestratorState }
  | { type: 'task_complete'; result: TaskRunResult };

export interface BrainOrchestratorDeps {
  orchestratorId: string;
  memory: OutcomeMemoryService;
  auditor: Law25Auditor;
  interpretation: InterpretationService;
  reflection: ReflectionService;
  specialist: SpecialistExecutor;
  confidenceThreshold?: number;
  modelMode: 'live' | 'mock';
  /** Pre-flight clarification when intake lists questions and confidence is below this (default 0.75) */
  clarifyMinConfidence?: number;
  /** If true, any non-empty clarificationsNeeded triggers HITL before execution */
  clarifyAlwaysQuestions?: boolean;
}

export interface RunTaskOptions {
  /** Persisted chat id from SessionStore */
  sessionId?: string;
  /** Turns before the current user message (excludes latest prompt) */
  priorSessionTurns?: SessionTurn[];
  /** When taskType is document_teach or web_teach — masked extract + provenance from server ingest */
  documentTeach?: DocumentTeachRunOptions;
}

/**
 * Star-topology supervisor: recall → strategy → compliance → specialist → reflection → optional HITL.
 */
export class BrainOrchestrator {
  private readonly memory: OutcomeMemoryService;
  private readonly auditor: Law25Auditor;
  private readonly interpretation: InterpretationService;
  private readonly reflection: ReflectionService;
  private readonly specialist: SpecialistExecutor;
  private readonly confidenceThreshold: number;
  private readonly modelMode: 'live' | 'mock';
  private readonly clarifyMinConfidence: number;
  private readonly clarifyAlwaysQuestions: boolean;

  private state: OrchestratorState;
  private listeners = new Set<(e: BrainEvent) => void>();
  private humanWait:
    | { requestId: string; resolve: (a: HumanInterventionAction) => void }
    | null = null;

  constructor(deps: BrainOrchestratorDeps) {
    this.memory = deps.memory;
    this.auditor = deps.auditor;
    this.interpretation = deps.interpretation;
    this.reflection = deps.reflection;
    this.specialist = deps.specialist;
    this.confidenceThreshold = deps.confidenceThreshold ?? DEFAULT_CONFIDENCE;
    this.modelMode = deps.modelMode;
    this.clarifyMinConfidence = deps.clarifyMinConfidence ?? 0.75;
    this.clarifyAlwaysQuestions = deps.clarifyAlwaysQuestions ?? false;

    this.state = {
      orchestratorId: deps.orchestratorId,
      status: 'idle',
      currentTaskId: null,
      agentState: {
        status: 'idle',
        currentTask: null,
        history: []
      },
      thoughtStream: [],
      pendingInterventions: [],
      lastUpdated: new Date().toISOString(),
      processing: false,
      lastInterpretation: null,
      lastSessionId: null,
      modelMode: deps.modelMode
    };
  }

  getState(): OrchestratorState {
    return structuredClone(this.state);
  }

  listComplianceAudit(limit: number): ComplianceAuditEntry[] {
    return this.auditor.listAudit(limit);
  }

  /** Shared Law 25 auditor (e.g. document ingest on the server uses the same instance as task runs so audit API stays consistent). */
  getLaw25Auditor(): Law25Auditor {
    return this.auditor;
  }

  listOutcomeMemory(
    limit: number,
    filter?: { category?: string; tag?: string; q?: string }
  ): OutcomeMemory[] {
    if (filter?.category || filter?.tag || filter?.q) {
      return this.memory.listFiltered({ limit, ...filter });
    }
    return this.memory.listRecent(limit);
  }

  listMemoryCategories(): string[] {
    return this.memory.listCategories();
  }

  listMemoryTags(): string[] {
    return this.memory.listTags();
  }

  /** Update stored outcome fields (human edit of acquired knowledge). */
  async updateOutcomeMemory(
    outcomeId: string,
    patch: Partial<
      Pick<
        OutcomeMemory,
        | 'successScore'
        | 'failureReason'
        | 'result'
        | 'primaryCategory'
        | 'categories'
        | 'canonicalQuery'
        | 'interpretedGoal'
        | 'tags'
      >
    >
  ): Promise<OutcomeMemory | undefined> {
    return this.memory.updateOutcome(outcomeId, patch);
  }

  subscribe(fn: (e: BrainEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(ev: BrainEvent): void {
    for (const fn of this.listeners) fn(ev);
  }

  private emitTaskComplete(result: TaskRunResult): void {
    this.emit({ type: 'task_complete', result });
  }

  private emitState(): void {
    this.emit({ type: 'state', state: structuredClone(this.state) });
  }

  private pushThought(
    phase: ThoughtPhase,
    message: string,
    metadata?: Record<string, unknown>,
    detail?: string
  ): void {
    const entry: ThoughtStreamEntry = {
      id: newId('thought'),
      timestamp: new Date().toISOString(),
      phase,
      message,
      metadata,
      ...(detail ? { detail } : {})
    };
    this.state.thoughtStream.unshift(entry);
    if (this.state.thoughtStream.length > 400) this.state.thoughtStream.length = 400;
    this.state.lastUpdated = entry.timestamp;
    this.emit({ type: 'thought', entry });
    this.emitState();
  }

  submitHumanAction(requestId: string, action: HumanInterventionAction): void {
    if (!this.humanWait || this.humanWait.requestId !== requestId) {
      throw new Error(`No pending intervention for ${requestId}`);
    }
    const { resolve } = this.humanWait;
    this.humanWait = null;
    resolve(action);
  }

  private async waitForHuman(intervention: InterventionRequest): Promise<HumanInterventionAction> {
    return new Promise((resolve) => {
      this.humanWait = { requestId: intervention.requestId, resolve };
    });
  }

  private shouldAskClarification(ir: InterpretationResult): boolean {
    return shouldRequestClarification(ir, {
      clarifyMinConfidence: this.clarifyMinConfidence,
      clarifyAlwaysQuestions: this.clarifyAlwaysQuestions
    });
  }

  async runTask(description: string, taskType: string, opts?: RunTaskOptions): Promise<TaskRunResult> {
    const taskId = newId('task');
    const mask = (text: string) => this.auditor.scanAndMask(text).text;

    const sessionTranscript =
      opts?.priorSessionTurns && opts.priorSessionTurns.length > 0
        ? formatSessionTranscript(opts.priorSessionTurns)
        : '';

    const task: TaskContext = {
      id: taskId,
      description,
      metadata: {
        taskType,
        ...(opts?.sessionId ? { sessionId: opts.sessionId } : {}),
        ...(opts?.priorSessionTurns?.length
          ? { priorSessionTurnCount: opts.priorSessionTurns.length }
          : {})
      }
    };

    this.state.status = 'planning';
    this.state.currentTaskId = taskId;
    this.state.agentState.status = 'reflecting';
    this.state.agentState.currentTask = task;
    this.state.processing = true;
    this.state.lastSessionId = opts?.sessionId ?? null;
    this.state.modelMode = this.modelMode;
    this.emitState();
    brainLog('task', `start ${taskId} (${taskType})`, { sessionId: opts?.sessionId });

    try {
      if (
        (taskType === 'document_teach' || taskType === 'web_teach') &&
        !opts?.documentTeach
      ) {
        throw new Error('document_teach or web_teach requires ingest payload; upload or crawl first.');
      }

      let workingDescription = description;
      const isIngestTeach =
        (taskType === 'document_teach' || taskType === 'web_teach') && Boolean(opts?.documentTeach);
      const webDerivedIntake =
        taskType === 'web_teach' || opts?.documentTeach?.source === 'web_crawl';

      if (isIngestTeach && opts?.documentTeach) {
        const dt = opts.documentTeach;
        task.metadata = {
          ...task.metadata,
          ingestId: dt.ingestId,
          documentTeach: true,
          sourceFiles: dt.sourceFiles
        };
        workingDescription = [
          dt.focusNote?.trim() || description.trim(),
          '',
          '--- Extracted document content (Law 25 masked) ---',
          dt.maskedDocumentText
        ].join('\n');
      }

      const recallQuery = isIngestTeach
        ? `${description.trim()} ${opts!.documentTeach!.sourceFiles.map((f) => f.name).join(' ')}`
        : workingDescription;

      // 1) Historical recall (+ session thread for “full brain” continuity)
      if (sessionTranscript && opts?.priorSessionTurns?.length) {
        this.pushThought(
          'recall',
          `Session thread: ${opts.priorSessionTurns.length} prior message(s) included in strategy`,
          { sessionId: opts.sessionId }
        );
      }
      this.pushThought('recall', `Searching outcome memory for similar tasks: ${taskType}`);
      let similar = await this.memory.searchSimilar(recallQuery, 8);
      this.pushThought(
        'recall',
        `Recall: ${similar.length} similar outcomes (top score ${similar[0]?.score != null ? similar[0].score.toFixed(3) : 'n/a'})`,
        {
          similar: similar.slice(0, 5).map((s) => ({ id: s.memory.id, score: s.score })),
          topMatches: similar.slice(0, 3).map((s) => ({
            id: s.memory.id,
            score: s.score,
            label: shortPreview(s.memory.primaryCategory || s.memory.canonicalQuery || s.memory.taskType, 56)
          }))
        },
        similar[0]
          ? `Top match: ${shortPreview(similar[0].memory.primaryCategory || similar[0].memory.canonicalQuery, 72)}`
          : undefined
      );

      // 2) Intake: LLM interpret — or synthetic for document_teach / web_teach
      let interpreted: InterpretationResult;
      let interpretAudit: { masked: string; entry: ComplianceAuditEntry };

      if (isIngestTeach && opts?.documentTeach) {
        interpreted = webDerivedIntake
          ? syntheticInterpretationForWebTeach(description, opts.documentTeach)
          : syntheticInterpretationForDocumentTeach(description, opts.documentTeach);
        this.state.lastInterpretation = structuredClone(interpreted);
        interpretAudit = this.auditor.auditPayload('brain_internal', JSON.stringify(interpreted));
        this.pushThought(
          'ingest',
          `${webDerivedIntake ? 'Web' : 'Document'} teach (synthetic intake): ${intakeCategoriesPreview(interpreted)} · ingest ${opts.documentTeach.ingestId}`,
          {
            categories: interpreted.categories,
            category: interpreted.primaryCategory,
            intakeAcknowledgment: interpreted.intakeAcknowledgment,
            tags: interpreted.tags,
            ingestId: opts.documentTeach.ingestId,
            auditId: interpretAudit.entry.id
          },
          interpreted.intakeAcknowledgment ? shortPreview(interpreted.intakeAcknowledgment, 140) : undefined
        );
      } else {
        interpreted = await this.interpretation.interpret(
          {
            rawPrompt: workingDescription,
            taskType,
            candidates: similar,
            sessionTranscript: sessionTranscript || undefined
          },
          { mask }
        );
        this.state.lastInterpretation = structuredClone(interpreted);
        interpretAudit = this.auditor.auditPayload('brain_internal', JSON.stringify(interpreted));
        this.pushThought(
          'ingest',
          `Intake: ${intakeCategoriesPreview(interpreted, 72)} — ${interpreted.interpretedGoal.slice(0, 120)}${interpreted.interpretedGoal.length > 120 ? '…' : ''}`,
          {
            categories: interpreted.categories,
            category: interpreted.primaryCategory,
            intakeAcknowledgment: interpreted.intakeAcknowledgment,
            tags: interpreted.tags,
            confidence: interpreted.confidence,
            memoryLinks: interpreted.memoryLinks,
            auditId: interpretAudit.entry.id
          },
          interpreted.intakeAcknowledgment ? shortPreview(interpreted.intakeAcknowledgment, 140) : undefined
        );
      }

      // 2b) Pre-flight clarification (reduce wrong assumptions before strategy/specialist)
      if (!isIngestTeach && this.shouldAskClarification(interpreted)) {
        const clarifyIntervention: InterventionRequest = {
          kind: 'clarification',
          requestId: newId('int'),
          questions: interpreted.clarificationsNeeded,
          rationale: `Intake confidence ${interpreted.confidence.toFixed(2)} · clarify before execution`,
          assumptionOptions: interpreted.assumptions.slice(0, 12),
          constraintOptions: interpreted.constraints.slice(0, 12),
          brainContext: [
            `The Brain needs a bit more detail before running tools.`,
            `Interpreted goal: ${mask(interpreted.interpretedGoal)}`,
            `Categories: ${interpreted.categories.join(' | ')}`,
            `Assumptions noted: ${interpreted.assumptions.slice(0, 5).join(' · ') || '(none)'}`
          ].join('\n'),
          proposedNextStep:
            'Confirm which AI assumptions still hold, then answer the questions (or add a short note) so the next intake can learn.'
        };
        this.state.status = 'awaiting_human';
        this.state.agentState.status = 'awaiting_human';
        this.state.pendingInterventions.unshift(clarifyIntervention);
        this.pushThought('hitl', 'Pausing for clarification before strategy', {
          requestId: clarifyIntervention.requestId,
          questions: interpreted.clarificationsNeeded
        });
        this.emitState();

        const clarifyAction = await this.waitForHuman(clarifyIntervention);
        this.state.pendingInterventions = this.state.pendingInterventions.filter(
          (i) => i.requestId !== clarifyIntervention.requestId
        );
        this.state.status = 'planning';
        this.state.agentState.status = 'reflecting';
        this.emitState();

        if (clarifyAction.type === 'clarification_reply') {
          const ans = clarifyAction.answers.trim();
          const confA = clarifyAction.confirmedAssumptions?.filter((s) => typeof s === 'string' && s.trim()) ?? [];
          const confC = clarifyAction.confirmedConstraints?.filter((s) => typeof s === 'string' && s.trim()) ?? [];
          if (ans || confA.length || confC.length) {
            const parts: string[] = [];
            if (confA.length) {
              parts.push(
                `User confirmed these intake assumptions (treat as ground truth for re-intake): ${confA.join(' | ')}`
              );
            }
            if (confC.length) {
              parts.push(`User confirmed these constraints: ${confC.join(' | ')}`);
            }
            if (ans) {
              parts.push(`Answers / free-form detail: ${ans}`);
            }
            workingDescription = `${workingDescription}\n\n[User clarification / learning signal]:\n${parts.join('\n')}`;
            similar = await this.memory.searchSimilar(workingDescription, 8);
            if (isIngestTeach && opts?.documentTeach) {
              interpreted = webDerivedIntake
                ? syntheticInterpretationForWebTeach(description, opts.documentTeach)
                : syntheticInterpretationForDocumentTeach(description, opts.documentTeach);
              this.state.lastInterpretation = structuredClone(interpreted);
              interpretAudit = this.auditor.auditPayload('brain_internal', JSON.stringify(interpreted));
            } else {
              interpreted = await this.interpretation.interpret(
                {
                  rawPrompt: workingDescription,
                  taskType,
                  candidates: similar,
                  sessionTranscript: sessionTranscript || undefined
                },
                { mask }
              );
              this.state.lastInterpretation = structuredClone(interpreted);
              interpretAudit = this.auditor.auditPayload('brain_internal', JSON.stringify(interpreted));
            }
            this.pushThought('ingest', `Intake (after clarification): ${intakeCategoriesPreview(interpreted, 72)}`, {
              categories: interpreted.categories,
              category: interpreted.primaryCategory,
              intakeAcknowledgment: interpreted.intakeAcknowledgment,
              confidence: interpreted.confidence,
              auditId: interpretAudit.entry.id
            });
          }
        }
      }

      let similarForPlan = similar;
      const cq = interpreted.canonicalQuery?.trim();
      if (cq && cq !== workingDescription.trim()) {
        const extra = await this.memory.searchSimilar(cq, 8);
        similarForPlan = mergeSimilarOutcomes(similar, extra);
        this.pushThought(
          'recall',
          `Merged recall on canonical query (${similarForPlan.length} outcomes)`,
          {
            canonicalQuery: cq.slice(0, 160),
            mergedSampleIds: similarForPlan.slice(0, 3).map((s) => s.memory.id)
          },
          shortPreview(cq, 90)
        );
      }

      const taskLine = cq || workingDescription;
      task.metadata = {
        ...task.metadata,
        interpretationGoal: interpreted.interpretedGoal,
        primaryCategory: interpreted.primaryCategory,
        interpretationCategories: interpreted.categories,
        intakeAcknowledgment: interpreted.intakeAcknowledgment,
        intakeConfidence: interpreted.confidence
      };

      // 3) Strategy formulation (intake + session + merged similar outcomes)
      this.state.status = 'planning';
      this.pushThought('strategy', 'Formulating strategy with lessons learned');
      const plan = await this.reflection.formulateStrategy(
        taskLine,
        similarForPlan,
        sessionTranscript || undefined,
        interpreted,
        { mask }
      );

      const planText = JSON.stringify(plan);
      const planAudit = this.auditor.auditPayload('plan', planText);
      this.pushThought(
        'strategy',
        `Plan ready (confidence ${plan.confidence.toFixed(2)}): ${plan.summary}`,
        {
          maskedPlanExcerpt: planAudit.masked.slice(0, 200),
          lessonsCount: plan.lessonsApplied.length,
          lessonPreview: plan.lessonsApplied[0] ? shortPreview(plan.lessonsApplied[0], 120) : undefined
        },
        plan.lessonsApplied[0] ? `Lesson: ${shortPreview(plan.lessonsApplied[0], 100)}` : undefined
      );

      // 3) Compliance on plan (audited above)
      this.pushThought('compliance', 'Law 25 audit on plan complete', {
        auditId: planAudit.entry.id,
        pii: planAudit.entry.piiDetected
      });

      // 4) Specialist spawning (prompt)
      this.state.status = 'executing';
      this.state.agentState.status = 'executing';
      const systemPrompt = isIngestTeach
        ? webDerivedIntake
          ? await this.reflection.buildWebLearnerSystemPrompt(
              taskLine,
              plan,
              sessionTranscript || undefined,
              interpreted,
              { mask }
            )
          : await this.reflection.buildDocumentLearnerSystemPrompt(
              taskLine,
              plan,
              sessionTranscript || undefined,
              interpreted,
              { mask }
            )
        : await this.reflection.buildSpecialistSystemPrompt(
            taskLine,
            plan,
            sessionTranscript || undefined,
            interpreted,
            { mask }
          );
      this.pushThought('spawn', 'Building specialist system prompt and tool surface', {
        systemPromptChars: systemPrompt.length
      });
      const tools = ['finish', 'clarify', 'lookup'];

      const docPayloadMax = 120_000;
      let userPayload: string;
      if (isIngestTeach && opts?.documentTeach) {
        const dt = opts.documentTeach;
        const docExcerpt = dt.maskedDocumentText.slice(0, docPayloadMax);
        const specialistMode = webDerivedIntake ? 'web_teach' : 'document_teach';
        userPayload = JSON.stringify({
          task: taskLine,
          mode: specialistMode,
          ingestId: dt.ingestId,
          sourceFiles: dt.sourceFiles,
          documentText: docExcerpt,
          documentTruncated: dt.maskedDocumentText.length > docPayloadMax,
          rawUserMessage: workingDescription.slice(0, 8000),
          taskType,
          ...(dt.crawlSummary ? { crawlSummary: dt.crawlSummary } : {}),
          interpretation: {
            goal: interpreted.interpretedGoal,
            category: interpreted.primaryCategory,
            categories: interpreted.categories,
            intakeAcknowledgment: interpreted.intakeAcknowledgment,
            tags: interpreted.tags,
            memoryLinks: interpreted.memoryLinks
          },
          plan: plan.summary,
          lessons: plan.lessonsApplied
        });
      } else {
        userPayload = JSON.stringify({
          task: taskLine,
          rawUserMessage: workingDescription,
          taskType,
          interpretation: {
            goal: interpreted.interpretedGoal,
            category: interpreted.primaryCategory,
            categories: interpreted.categories,
            intakeAcknowledgment: interpreted.intakeAcknowledgment,
            tags: interpreted.tags,
            memoryLinks: interpreted.memoryLinks
          },
          plan: plan.summary,
          lessons: plan.lessonsApplied
        });
      }
      const inputAudit = this.auditor.auditPayload('specialist_input', userPayload);
      userPayload = inputAudit.masked;

      // 5) Specialist execution
      this.pushThought(
        'spawn',
        'Executing specialist at star edge',
        {
          maskedSpecialistInputChars: userPayload.length,
          specialistInputAuditId: inputAudit.entry.id
        },
        `Masked payload: ${userPayload.length.toLocaleString()} chars`
      );
      let specResult = await this.specialist.execute({
        systemPrompt,
        userPayload,
        tools
      });

      let outputAudit = this.auditor.auditPayload('specialist_output', specResult.raw);
      let maskedOutput = outputAudit.masked;

      // 6) Reflection
      this.state.agentState.status = 'reflecting';
      let reflection = await this.reflection.reflectOnSpecialistResult(
        {
          taskDescription: taskLine,
          planSummary: plan.summary,
          specialistOutput: maskedOutput,
          sessionTranscript: sessionTranscript || undefined,
          interpretation: interpreted
        },
        { mask }
      );
      this.pushThought(
        'reflection',
        `Reflection (confidence ${reflection.confidence.toFixed(2)}): ${shortPreview(reflection.summary, 220)}`,
        {
          confidence: reflection.confidence,
          ok: reflection.ok,
          escalateToHuman: reflection.escalateToHuman,
          specialistOutputAuditId: outputAudit.entry.id,
          maskedOutputChars: maskedOutput.length
        },
        reflection.ok ? 'Outcome accepted by reflection gate' : 'Reflection flagged issues or low confidence'
      );

      const needsHitl =
        reflection.escalateToHuman ||
        reflection.confidence < this.confidenceThreshold ||
        !reflection.ok;

      if (needsHitl) {
        const intervention: InterventionRequest = {
          kind: 'quality_gate',
          requestId: newId('int'),
          brainContext: [
            `Task (interpreted): ${mask(taskLine)}`,
            `Raw message: ${mask(workingDescription)}`,
            `Intake confidence: ${interpreted.confidence.toFixed(2)} · ${interpreted.categories.join(' | ')}`,
            `Reflection: ${reflection.summary}`,
            `Confidence: ${reflection.confidence.toFixed(2)} (threshold ${this.confidenceThreshold})`
          ].join('\n'),
          proposedNextStep: 'Approve, inject context for a retry, or override outcome for training.'
        };
        this.state.status = 'awaiting_human';
        this.state.agentState.status = 'awaiting_human';
        this.state.pendingInterventions.unshift(intervention);
        this.pushThought('hitl', 'Escalating to human (confidence or quality gate)', {
          requestId: intervention.requestId
        });
        this.emitState();

        const action = await this.waitForHuman(intervention);
        this.state.pendingInterventions = this.state.pendingInterventions.filter(
          (i) => i.requestId !== intervention.requestId
        );
        this.state.status = 'executing';
        this.state.agentState.status = 'executing';
        this.emitState();

        if (action.type === 'override_outcome') {
          const successScore = action.outcome === 'success' ? 1 : 0;
          const om = await this.memory.logPostMortem({
            taskType,
            taskId,
            sessionId: opts?.sessionId,
            primaryCategory: interpreted.primaryCategory,
            categories: interpreted.categories,
            canonicalQuery: interpreted.canonicalQuery,
            interpretedGoal: interpreted.interpretedGoal,
            tags: interpreted.tags,
            initialPlan: planAudit.masked,
            result: `[human_override] ${action.outcome}`,
            successScore,
            failureReason: action.failureReason ?? (action.outcome === 'failure' ? 'Human marked failure' : undefined)
          });
          this.state.agentState.history.unshift(om);
          if (this.state.agentState.history.length > 50) this.state.agentState.history.length = 50;
          this.finalizeTask();
          const done: TaskRunResult = {
            taskId,
            status: 'completed',
            finalResult: `Overridden as ${action.outcome}`,
            outcomeMemoryId: om.id
          };
          this.emitTaskComplete(done);
          return done;
        }

        let instruction = '';
        if (action.type === 'inject_context') {
          instruction = action.humanInstruction;
        } else if (action.type === 'approve') {
          instruction = action.humanInstruction ?? '';
        }

        if (instruction) {
          if (isIngestTeach && opts?.documentTeach) {
            const dt = opts.documentTeach;
            const docExcerpt = dt.maskedDocumentText.slice(0, docPayloadMax);
            const specialistMode = webDerivedIntake ? 'web_teach' : 'document_teach';
            userPayload = JSON.stringify({
              task: taskLine,
              mode: specialistMode,
              ingestId: dt.ingestId,
              sourceFiles: dt.sourceFiles,
              documentText: docExcerpt,
              documentTruncated: dt.maskedDocumentText.length > docPayloadMax,
              rawUserMessage: workingDescription.slice(0, 8000),
              taskType,
              ...(dt.crawlSummary ? { crawlSummary: dt.crawlSummary } : {}),
              plan: plan.summary,
              humanInstruction: instruction
            });
          } else {
            userPayload = JSON.stringify({
              task: taskLine,
              rawUserMessage: workingDescription,
              taskType,
              plan: plan.summary,
              humanInstruction: instruction
            });
          }
          const secondInputAudit = this.auditor.auditPayload('specialist_input', userPayload);
          userPayload = secondInputAudit.masked;
          this.pushThought('spawn', 'Retrying specialist with human-injected context', {
            maskedSpecialistInputChars: userPayload.length,
            specialistInputAuditId: secondInputAudit.entry.id
          });
          specResult = await this.specialist.execute({ systemPrompt, userPayload, tools });
          outputAudit = this.auditor.auditPayload('specialist_output', specResult.raw);
          maskedOutput = outputAudit.masked;
          reflection = await this.reflection.reflectOnSpecialistResult(
            {
              taskDescription: taskLine,
              planSummary: plan.summary,
              specialistOutput: maskedOutput,
              sessionTranscript: sessionTranscript || undefined,
              interpretation: interpreted
            },
            { mask }
          );
          this.pushThought(
            'reflection',
            `Reflection after HITL retry (confidence ${reflection.confidence.toFixed(2)}): ${shortPreview(reflection.summary, 200)}`,
            {
              confidence: reflection.confidence,
              ok: reflection.ok,
              afterRetry: true,
              specialistOutputAuditId: outputAudit.entry.id
            }
          );
        }
      }

      const successScore = Math.max(0, Math.min(1, reflection.confidence));
      const om = await this.memory.logPostMortem({
        taskType,
        taskId,
        sessionId: opts?.sessionId,
        primaryCategory: interpreted.primaryCategory,
        categories: interpreted.categories,
        canonicalQuery: interpreted.canonicalQuery,
        interpretedGoal: interpreted.interpretedGoal,
        tags: interpreted.tags,
        initialPlan: planAudit.masked,
        result: maskedOutput,
        successScore,
        failureReason:
          successScore < this.confidenceThreshold ? reflection.suggestedFailureReason ?? 'Below confidence threshold' : undefined
      });

      this.state.agentState.history.unshift(om);
      if (this.state.agentState.history.length > 50) this.state.agentState.history.length = 50;

      this.finalizeTask();

      const done: TaskRunResult = {
        taskId,
        status: 'completed',
        finalResult: maskedOutput,
        outcomeMemoryId: om.id
      };
      this.emitTaskComplete(done);
      brainLog('task', `completed ${taskId}`, { outcomeMemoryId: om.id });
      return done;
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      this.pushThought('reflection', `Error: ${err}`, { error: err });
      brainLog('task', `error ${taskId}`, { error: err });
      this.finalizeTask();
      const failed: TaskRunResult = { taskId, status: 'error', error: err };
      this.emitTaskComplete(failed);
      return failed;
    }
  }

  private finalizeTask(): void {
    this.state.status = 'idle';
    this.state.currentTaskId = null;
    this.state.agentState.status = 'idle';
    this.state.agentState.currentTask = null;
    this.state.processing = false;
    this.state.lastUpdated = new Date().toISOString();
    this.emitState();
  }

  /** Teach the brain by relabeling an outcome (writes to memory) */
  async teachOutcome(
    outcomeId: string,
    outcome: 'success' | 'failure',
    failureReason?: string
  ): Promise<OutcomeMemory | undefined> {
    const score = outcome === 'success' ? 1 : 0;
    return this.memory.updateOutcome(outcomeId, {
      successScore: score,
      failureReason: outcome === 'failure' ? failureReason ?? 'Human relabeled' : undefined
    });
  }
}
