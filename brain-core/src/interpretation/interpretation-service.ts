import type {
  InterpretationResult,
  MemoryLink,
  MemoryLinkRelevance,
  SimilarOutcome
} from '../lib/types.js';
import type { TextCompletionModel } from '../lib/types.js';

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
      return {
        interpretedGoal: `Address: ${maskedPrompt.slice(0, 160)}`,
        canonicalQuery: maskedPrompt.slice(0, 400),
        primaryCategory: input.taskType || 'general',
        tags: ['mock', input.taskType || 'general'],
        constraints: [],
        assumptions: vagueCreative
          ? ['User request is underspecified — prefer clarifying before executing']
          : ['Mock interpretation — set GEMINI_API_KEY for live intake'],
        clarificationsNeeded,
        confidence,
        memoryLinks: links,
        synthesizedLessons: ['Review similar outcomes before executing']
      };
    }

    const sessionBlock = maskedSession
      ? `\n## Prior session (same thread)\n${maskedSession}\n`
      : '';

    const prompt = `You are the intake interpreter for a metacognitive AI orchestrator (star topology).
Narrow the user's request, assign a category, and cross-reference ONLY the candidate outcome ids listed below (do not invent ids).

When the user is vague, open-ended, or underspecified (e.g. "tell me a story", "help with something", "make it better"), prefer listing concrete clarifying questions in clarificationsNeeded instead of guessing genre, tone, audience, or constraints. Keep confidence lower when important details are missing.

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
  "primaryCategory": "string",
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
    const fallback: InterpretationResult = {
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
    const parsed = safeParseJson<InterpretationResult>(text, fallback);
    return {
      ...parsed,
      memoryLinks: sanitizeLinks(parsed.memoryLinks, validIds),
      tags: Array.isArray(parsed.tags) ? parsed.tags.slice(0, 20) : [],
      clarificationsNeeded: Array.isArray(parsed.clarificationsNeeded)
        ? parsed.clarificationsNeeded.slice(0, 10)
        : [],
      synthesizedLessons: Array.isArray(parsed.synthesizedLessons)
        ? parsed.synthesizedLessons.slice(0, 15)
        : []
    };
  }
}
