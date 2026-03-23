import type {
  InterpretationResult,
  OutcomeMemory,
  ReflectionOnResult,
  SimilarOutcome,
  StrategyPlan,
  TextCompletionModel
} from '../lib/types.js';

function interpretationBlock(i: InterpretationResult | undefined, mask?: (s: string) => string): string {
  if (!i) return '';
  const m = mask ?? ((s: string) => s);
  const links = i.memoryLinks.map((l) => ({ ...l, note: m(l.note) }));
  return `\n\n## Intake interpretation (categorize + memory cross-refs)\nInterpreted goal: ${m(i.interpretedGoal)}\nCategory: ${i.primaryCategory}\nTags: ${i.tags.map(m).join(', ')}\nConstraints: ${i.constraints.map(m).join('; ')}\nAssumptions: ${i.assumptions.map(m).join('; ')}\nMemory links: ${JSON.stringify(links)}\nSynthesized lessons: ${i.synthesizedLessons.map(m).join(' | ')}\nIntake confidence: ${i.confidence}\n`;
}

export interface ReflectionServiceOptions {
  model: TextCompletionModel | null;
  /** Fallback when Gemini is unavailable */
  mockMode?: boolean;
}

export interface ReflectionPromptOpts {
  mask?: (text: string) => string;
}

function parseJson<T>(raw: string): T {
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim();
  return JSON.parse(cleaned) as T;
}

function safeParseJson<T>(raw: string, fallback: T): T {
  try {
    return parseJson<T>(raw);
  } catch {
    return fallback;
  }
}

/**
 * Gemini-powered reflection: lessons from memory, strategy, post-execution review.
 */
export class ReflectionService {
  private readonly model: TextCompletionModel | null;
  private readonly mockMode: boolean;

  constructor(opts: ReflectionServiceOptions) {
    this.model = opts.model;
    this.mockMode = opts.mockMode ?? !opts.model;
  }

  async formulateStrategy(
    taskDescription: string,
    similar: SimilarOutcome[],
    sessionTranscript?: string,
    interpretation?: InterpretationResult,
    promptOpts?: ReflectionPromptOpts
  ): Promise<StrategyPlan> {
    const mask = promptOpts?.mask ?? ((t: string) => t);
    const lessons = similar
      .filter((s) => s.score > 0.05)
      .map((s) => {
        const mem = s.memory;
        const tag = mem.successScore !== undefined && mem.successScore >= 0.7 ? 'success' : 'caution';
        const excerpt = mask((mem.failureReason ?? mem.result).slice(0, 280));
        return `[${tag}] ${mem.taskType}: ${excerpt}`;
      });

    const sessionBlock = sessionTranscript?.trim()
      ? `\n\n## Prior conversation in this session (same user thread)\n${mask(sessionTranscript.trim())}\n`
      : '';
    const intakeBlock = interpretationBlock(interpretation, mask);

    if (this.mockMode || !this.model) {
      const mergedLessons = [
        ...(interpretation?.synthesizedLessons ?? []).slice(0, 5),
        ...lessons.slice(0, 5)
      ].slice(0, 8);
      return {
        summary: `Mock plan for: ${mask(taskDescription).slice(0, 120)}${interpretation ? ` [${interpretation.primaryCategory}]` : ''}${sessionTranscript?.trim() ? ' (session context applied)' : ''}`,
        steps: [
          'Recall similar outcomes and avoid known failure modes',
          'Apply compliance masking before specialist I/O',
          'Execute specialist with scoped tools',
          'Reflect and escalate if confidence < 0.7'
        ],
        lessonsApplied: mergedLessons.length ? mergedLessons : lessons.slice(0, 5),
        confidence: interpretation ? Math.min(0.85, 0.55 + interpretation.confidence * 0.3) : 0.72
      };
    }

    const prompt = `You are the metacognitive supervisor (The Brain) in a star topology.
Current user request (latest message): ${mask(taskDescription)}
${sessionBlock}${intakeBlock}
Similar past outcomes (JSON context):
${JSON.stringify(
      similar.slice(0, 8).map((s) => ({
        taskType: s.memory.taskType,
        successScore: s.memory.successScore,
        failureReason: s.memory.failureReason ? mask(String(s.memory.failureReason).slice(0, 300)) : s.memory.failureReason,
        snippet: mask(s.memory.result.slice(0, 400))
      })),
      null,
      2
    )}

Respond ONLY with valid JSON:
{"summary":"string","steps":["string"],"lessonsApplied":["string"],"confidence":0.0}`;

    const res = await this.model.generateContent(prompt);
    const text = res.response.text();
    return safeParseJson<StrategyPlan>(text, {
      summary: 'Fallback plan (model JSON parse failed)',
      steps: ['Re-run with stricter prompt'],
      lessonsApplied: lessons.slice(0, 5),
      confidence: 0.5
    });
  }

  async reflectOnSpecialistResult(
    params: {
      taskDescription: string;
      planSummary: string;
      specialistOutput: string;
      sessionTranscript?: string;
      interpretation?: InterpretationResult;
    },
    promptOpts?: ReflectionPromptOpts
  ): Promise<ReflectionOnResult> {
    const mask = promptOpts?.mask ?? ((t: string) => t);
    const sessionBlock = params.sessionTranscript?.trim()
      ? `\nPrior session messages:\n${mask(params.sessionTranscript.trim())}\n`
      : '';
    const intakeBlock = interpretationBlock(params.interpretation, mask);

    if (this.mockMode || !this.model) {
      const vague = params.specialistOutput.length < 40;
      const confidence = vague ? 0.55 : 0.82;
      return {
        ok: !vague,
        confidence,
        summary: vague ? 'Output too thin; likely incomplete.' : 'Output looks actionable.',
        escalateToHuman: confidence < 0.7,
        suggestedFailureReason: vague ? 'Insufficient specialist output' : undefined
      };
    }

    const prompt = `You evaluate specialist output for a supervisor agent.
Latest user request: ${mask(params.taskDescription)}
${sessionBlock}${intakeBlock}Plan summary: ${mask(params.planSummary)}
Specialist output:
${params.specialistOutput}

Return ONLY JSON:
{"ok":true,"confidence":0.0,"summary":"string","escalateToHuman":false,"suggestedFailureReason":"string or omit"}`;

    const res = await this.model.generateContent(prompt);
    const text = res.response.text();
    return safeParseJson<ReflectionOnResult>(text, {
      ok: false,
      confidence: 0.4,
      summary: 'Reflection parse failed; escalating by default.',
      escalateToHuman: true,
      suggestedFailureReason: 'Reflection JSON parse error'
    });
  }

  async buildSpecialistSystemPrompt(
    taskDescription: string,
    plan: StrategyPlan,
    sessionTranscript?: string,
    interpretation?: InterpretationResult,
    promptOpts?: ReflectionPromptOpts
  ): Promise<string> {
    const mask = promptOpts?.mask ?? ((t: string) => t);
    const sessionBlock = sessionTranscript?.trim()
      ? `\nSession context (earlier messages in this thread):\n${mask(sessionTranscript.trim())}\n`
      : '';
    const intakeBlock = interpretationBlock(interpretation, mask);

    if (this.mockMode || !this.model) {
      return [
        'You are a specialist agent at the edge of a star topology.',
        'Follow the plan steps; be concise and cite assumptions.',
        sessionBlock.trim() ? `Context:\n${sessionBlock}` : '',
        `Latest request: ${mask(taskDescription)}`,
        interpretation
          ? `Intake: ${mask(interpretation.interpretedGoal)} [${interpretation.primaryCategory}]`
          : '',
        `Plan: ${mask(plan.summary)}`,
        `Steps:\n- ${plan.steps.map((s) => mask(s)).join('\n- ')}`
      ]
        .filter(Boolean)
        .join('\n');
    }

    const planForModel = {
      ...plan,
      summary: mask(plan.summary),
      steps: plan.steps.map((s) => mask(s)),
      lessonsApplied: plan.lessonsApplied.map((s) => mask(s))
    };

    const prompt = `Write a short system prompt for a specialist LLM agent.
Latest user request: ${mask(taskDescription)}
${sessionBlock}${intakeBlock}Plan JSON: ${JSON.stringify(planForModel)}
Output ONLY the system prompt text, no quotes.`;

    const res = await this.model.generateContent(prompt);
    return res.response.text().trim();
  }

  /**
   * Specialist system prompt for document_teach: structured knowledge extraction.
   */
  async buildDocumentLearnerSystemPrompt(
    taskDescription: string,
    plan: StrategyPlan,
    sessionTranscript: string | undefined,
    interpretation: InterpretationResult | undefined,
    promptOpts?: ReflectionPromptOpts
  ): Promise<string> {
    const mask = promptOpts?.mask ?? ((t: string) => t);
    const sessionBlock = sessionTranscript?.trim()
      ? `\nSession context:\n${mask(sessionTranscript.trim())}\n`
      : '';
    const intakeBlock = interpretationBlock(interpretation, mask);

    const base = `You are a Learner specialist for Nexus Brain. Your job is to read the user's focus and the extracted document text (already PII-masked) and produce a structured knowledge summary suitable for long-term storage.

Output MUST use this Markdown structure:
## Summary
(3–8 sentences)

## Key facts
- Bullet list of concrete facts (with source file name in parentheses when inferable)

## Entities
- Named entities, products, dates, metrics (if any)

## Glossary / terms
- Term: short definition (only if present in the document)

## Uncertainties / gaps
- What could not be determined from the text

## Suggested tags
- comma-separated short tags for search

Be faithful to the text; do not invent citations. If the content is empty or unreadable, say so clearly.`;

    if (this.mockMode || !this.model) {
      return [
        base,
        sessionBlock.trim(),
        intakeBlock.trim(),
        `User focus / request: ${mask(taskDescription)}`,
        `Plan context: ${mask(plan.summary)}`,
        `Steps to consider: ${plan.steps.map((s) => mask(s)).join(' | ')}`
      ].join('\n\n');
    }

    const planForModel = {
      ...plan,
      summary: mask(plan.summary),
      steps: plan.steps.map((s) => mask(s)),
      lessonsApplied: plan.lessonsApplied.map((s) => mask(s))
    };

    const prompt = `Write a concise system prompt for a "Learner" specialist that extracts knowledge from uploaded documents.
User focus and document-derived request: ${mask(taskDescription)}
${sessionBlock}${intakeBlock}
Plan JSON: ${JSON.stringify(planForModel)}

The specialist must output the Markdown sections described in the base instructions. Output ONLY the system prompt text, no JSON wrapper.`;

    const res = await this.model.generateContent(prompt);
    const text = res.response.text().trim();
    return text || base;
  }

  summarizeLessons(memories: OutcomeMemory[]): string {
    return memories
      .slice(0, 10)
      .map((m) => `- ${m.taskType}: score=${m.successScore ?? 'n/a'} ${m.failureReason ?? ''}`)
      .join('\n');
  }
}
