import {
  BrainOrchestrator,
  InterpretationService,
  Law25Auditor,
  OutcomeMemoryService,
  ReflectionService,
  createGenAI,
  embedTextGemini,
  wrapTextModelWithRetry
} from '@nexus/brain-core';
import { createSpecialistExecutor } from '@nexus/agents';

export interface BrainRuntimeOptions {
  dataDir: string;
  orchestratorId: string;
  geminiApiKey?: string;
  geminiModel: string;
  geminiEmbeddingModel: string;
  useEmbeddings: boolean;
  sqlitePath?: string;
  legacyOutcomesJsonPath?: string;
  clarifyMinConfidence?: number;
  clarifyAlwaysQuestions?: boolean;
}

export async function createBrainRuntime(opts: BrainRuntimeOptions): Promise<BrainOrchestrator> {
  const sqlitePath = opts.sqlitePath ?? `${opts.dataDir}/nexus.db`;
  const legacyOutcomesJson = opts.legacyOutcomesJsonPath ?? `${opts.dataDir}/outcomes.json`;
  const auditPath = `${opts.dataDir}/compliance-audit.jsonl`;

  const genAI = createGenAI(opts.geminiApiKey);

  const embedText =
    genAI && opts.useEmbeddings
      ? async (text: string) =>
          embedTextGemini(genAI, opts.geminiEmbeddingModel, text)
      : undefined;

  const memory = new OutcomeMemoryService({
    sqlitePath,
    legacyJsonPath: legacyOutcomesJson,
    embedText
  });
  await memory.load();

  const auditor = new Law25Auditor({ persistPath: auditPath });
  await auditor.loadFromDisk();

  const textModel = genAI ? wrapTextModelWithRetry(genAI, opts.geminiModel) : null;
  const modelMode = genAI ? ('live' as const) : ('mock' as const);
  const interpretation = new InterpretationService({
    model: textModel,
    mockMode: !genAI
  });
  const reflection = new ReflectionService({
    model: textModel,
    mockMode: !genAI
  });

  const specialist = createSpecialistExecutor(opts.geminiApiKey, opts.geminiModel);

  return new BrainOrchestrator({
    orchestratorId: opts.orchestratorId,
    memory,
    auditor,
    interpretation,
    reflection,
    specialist,
    confidenceThreshold: 0.7,
    modelMode,
    clarifyMinConfidence: opts.clarifyMinConfidence,
    clarifyAlwaysQuestions: opts.clarifyAlwaysQuestions
  });
}
