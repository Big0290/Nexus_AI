import type {
  InterpretationResult,
  MemoryLink,
  MemoryLinkRelevance,
  SimilarOutcome
} from '../lib/types.js';
import type { TextCompletionModel } from '../lib/types.js';
import {
  normalizeInterpretationResult,
  type InterpretationResultDraft
} from '../lib/interpretation-normalize.js';

export interface InterpretationServiceOptions {
  model: TextCompletionModel | null;
  mockMode?: boolean;
}

export interface InterpretationInput {
  rawPrompt: string;
  taskType: string;
  /** Top-K from OutcomeMemoryService.searchSimilar — only these ids may appear in memoryLinks */
  candidates: SimilarOutcome[];
  sessionTranscript?: string;
}

export interface InterpretInterpretOpts {
  /** Applied to user/session text and candidate excerpts before any LLM call (e.g. Law 25 scan) */
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

function candidateIds(candidates: SimilarOutcome[]): Set<string> {
  return new Set(candidates.map((c) => c.memory.id));
}

function sanitizeLinks(links: MemoryLink[] | undefined, valid: Set<string>): MemoryLink[] {
  if (!links?.length) return [];
  return links
    .filter((l) => valid.has(l.outcomeId))
    .map((l) => ({
      outcomeId: l.outcomeId,
      relevance: (['supporting', 'cautionary', 'contrast'] as const).includes(l.relevance)
        ? l.relevance
        : 'cautionary',
      note: typeof l.note === 'string' ? l.note.slice(0, 500) : ''
    }));
}

/**
 * Intake step: categorize, narrow the ask, and cross-reference candidate outcome memories.
 */
export class InterpretationService {
  private readonly model: TextCompletionModel | null;
  private readonly mockMode: boolean;

  constructor(opts: InterpretationServiceOptions) {
    this.model = opts.model;
    this.mockMode = opts.mockMode ?? !opts.model;
  }

  async interpret(input: InterpretationInput, opts?: InterpretInterpretOpts): Promise<InterpretationResult> {
    const mask = opts?.mask ?? ((t: string) => t);
    const validIds = candidateIds(input.candidates);
    const candidatePayload = input.candidates.slice(0, 8).map((s) => ({
      id: s.memory.id,
      score: s.score,
      taskType: s.memory.taskType,
      successScore: s.memory.successScore,
      failureReason: s.memory.failureReason ? mask(s.memory.failureReason.slice(0, 320)) : s.memory.failureReason,
      resultExcerpt: mask(s.memory.result.slice(0, 320))
    }));

    const maskedPrompt = mask(input.rawPrompt);
    const maskedSession = input.sessionTranscript?.trim() ? mask(input.sessionTranscript.trim()) : '';

    if (this.mockMode || !this.model) {
      const links: MemoryLink[] = input.candidates.slice(0, 3).map((s, i) => ({
        outcomeId: s.memory.id,
        relevance: (i === 0 ? 'supporting' : 'cautionary') as MemoryLinkRelevance,
        note: `Mock cross-ref to prior ${s.memory.taskType} outcome`
      }));
      const lower = maskedPrompt.toLowerCase();
      const vagueCreative =
        /\b(tell me (a )?story|write me (a )?story|a story about|creative writing|poem|fiction)\b/i.test(
          lower
        ) || (/\bstory\b/i.test(lower) && maskedPrompt.length < 140);
      const clarificationsNeeded: string[] = vagueCreative
        ? [
            'What genre, tone, and approximate length do you want?',
            'Who is the audience (age, context, language)?',
            'Any must-have themes or things to avoid?'
          ]
        : [];
      const confidence = vagueCreative ? 0.58 : 0.78;
      const taskCat = input.taskType || 'general';
      return normalizeInterpretationResult({
        interpretedGoal: `Address: ${maskedPrompt.slice(0, 160)}`,
        canonicalQuery: maskedPrompt.slice(0, 400),
        primaryCategory: taskCat,
        categories: [taskCat, 'mock'],
        tags: ['mock', taskCat],
        constraints: [],
        assumptions: vagueCreative
          ? ['User request is underspecified — prefer clarifying before executing']
          : ['Mock interpretation — set GEMINI_API_KEY for live intake'],
        clarificationsNeeded,
        confidence,
        memoryLinks: links,
        synthesizedLessons: ['Review similar outcomes before executing'],
        intakeAcknowledgment: vagueCreative
          ? 'Mock intake: vague or creative prompt — categories default to declared task type plus mock until live Gemini intake is enabled.'
          : 'Mock intake: categories include declared task type and mock label; enable GEMINI_API_KEY for LLM classification.'
      });
    }

    const sessionBlock = maskedSession
      ? `\n## Prior session (same thread)\n${maskedSession}\n`
      : '';

    const prompt = `You are the intake interpreter for a metacognitive AI orchestrator (star topology).
Narrow the user's request, assign a category, and cross-reference ONLY the candidate outcome ids listed below (do not invent ids).

When the user is vague, open-ended, or underspecified (e.g. "tell me a story", "help with something", "make it better"), prefer listing concrete clarifying questions in clarificationsNeeded instead of guessing genre, tone, audience, or constraints. Keep confidence lower when important details are missing.

If the message contains a block "[User clarification / learning signal]" with "User confirmed these intake assumptions" or "User confirmed these constraints", treat those as authoritative: align assumptions, constraints, and categories with that human feedback; do not contradict confirmed items without listing clarificationsNeeded.

Latest user message:
${maskedPrompt}

Declared task type: ${input.taskType}
${sessionBlock}
Candidate past outcomes (JSON — use only these "id" values in memoryLinks):
${JSON.stringify(candidatePayload, null, 2)}

Return ONLY valid JSON with this shape:
{
  "interpretedGoal": "string",
  "canonicalQuery": "string (compressed query for search/planning)",
  "categories": ["string (ordered labels; first is primary focus)"],
  "primaryCategory": "string (optional if same as categories[0])",
  "intakeAcknowledgment": "string (one sentence: what you understood and why these categories)",
  "tags": ["string"],
  "constraints": ["string"],
  "assumptions": ["string"],
  "clarificationsNeeded": ["string"],
  "confidence": 0.0,
  "memoryLinks": [{"outcomeId":"string","relevance":"supporting|cautionary|contrast","note":"string"}],
  "synthesizedLessons": ["string"]
}`;

    const res = await this.model.generateContent(prompt);
    const text = res.response.text();
    const fallback: InterpretationResultDraft = {
      interpretedGoal: maskedPrompt.slice(0, 200),
      canonicalQuery: maskedPrompt.slice(0, 400),
      primaryCategory: input.taskType,
      tags: [],
      constraints: [],
      assumptions: [],
      clarificationsNeeded: [],
      confidence: 0.5,
      memoryLinks: [],
      synthesizedLessons: []
    };
    const parsed = safeParseJson<InterpretationResultDraft & Record<string, unknown>>(text, fallback);
    const merged: InterpretationResultDraft = {
      interpretedGoal: typeof parsed.interpretedGoal === 'string' ? parsed.interpretedGoal : fallback.interpretedGoal,
      canonicalQuery: typeof parsed.canonicalQuery === 'string' ? parsed.canonicalQuery : fallback.canonicalQuery,
      primaryCategory:
        typeof parsed.primaryCategory === 'string' ? parsed.primaryCategory : fallback.primaryCategory,
      categories: Array.isArray(parsed.categories) ? (parsed.categories as unknown[]).filter((c): c is string => typeof c === 'string') : fallback.categories,
      intakeAcknowledgment:
        typeof parsed.intakeAcknowledgment === 'string' ? parsed.intakeAcknowledgment : fallback.intakeAcknowledgment,
      tags: Array.isArray(parsed.tags) ? parsed.tags.filter((t): t is string => typeof t === 'string') : fallback.tags,
      constraints: Array.isArray(parsed.constraints)
        ? parsed.constraints.filter((t): t is string => typeof t === 'string')
        : fallback.constraints,
      assumptions: Array.isArray(parsed.assumptions)
        ? parsed.assumptions.filter((t): t is string => typeof t === 'string')
        : fallback.assumptions,
      clarificationsNeeded: Array.isArray(parsed.clarificationsNeeded)
        ? parsed.clarificationsNeeded.filter((t): t is string => typeof t === 'string')
        : fallback.clarificationsNeeded,
      confidence: typeof parsed.confidence === 'number' && Number.isFinite(parsed.confidence) ? parsed.confidence : fallback.confidence,
      memoryLinks: Array.isArray(parsed.memoryLinks) ? parsed.memoryLinks : fallback.memoryLinks,
      synthesizedLessons: Array.isArray(parsed.synthesizedLessons)
        ? parsed.synthesizedLessons.filter((t): t is string => typeof t === 'string')
        : fallback.synthesizedLessons
    };
    return normalizeInterpretationResult({
      ...merged,
      memoryLinks: sanitizeLinks(merged.memoryLinks, validIds),
      tags: merged.tags ? merged.tags.slice(0, 20) : [],
      clarificationsNeeded: merged.clarificationsNeeded ? merged.clarificationsNeeded.slice(0, 10) : [],
      synthesizedLessons: merged.synthesizedLessons ? merged.synthesizedLessons.slice(0, 15) : []
    });
  }
}
