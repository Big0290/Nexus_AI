import type { InterpretationResult, MemoryLink } from './types.js';

const MAX_CATEGORIES = 16;
const MAX_ACK_LEN = 2000;

function dedupeOrdered(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of items) {
    const k = x.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(x);
  }
  return out;
}

/** Raw shape from LLM JSON (may omit categories). */
export type InterpretationResultDraft = {
  interpretedGoal: string;
  canonicalQuery: string;
  tags: string[];
  constraints: string[];
  assumptions: string[];
  clarificationsNeeded: string[];
  confidence: number;
  memoryLinks: MemoryLink[];
  synthesizedLessons: string[];
  categories?: string[];
  primaryCategory?: string;
  intakeAcknowledgment?: string;
};

/**
 * Canonical intake: non-empty ordered categories, primaryCategory === categories[0].
 */
export function normalizeInterpretationResult(draft: InterpretationResultDraft): InterpretationResult {
  let cats: string[] = [];
  if (Array.isArray(draft.categories)) {
    cats = draft.categories
      .filter((c): c is string => typeof c === 'string')
      .map((c) => c.trim())
      .filter(Boolean);
  }
  const primaryTrim = draft.primaryCategory?.trim();
  if (!cats.length && primaryTrim) {
    cats = [primaryTrim];
  }
  if (!cats.length) {
    cats = ['general'];
  }
  cats = dedupeOrdered(cats).slice(0, MAX_CATEGORIES);
  const primaryCategory = cats[0];
  const intakeAcknowledgment =
    typeof draft.intakeAcknowledgment === 'string' && draft.intakeAcknowledgment.trim()
      ? draft.intakeAcknowledgment.trim().slice(0, MAX_ACK_LEN)
      : undefined;

  return {
    interpretedGoal: draft.interpretedGoal,
    canonicalQuery: draft.canonicalQuery,
    categories: cats,
    primaryCategory,
    tags: Array.isArray(draft.tags) ? draft.tags.slice(0, 20) : [],
    constraints: draft.constraints,
    assumptions: draft.assumptions,
    clarificationsNeeded: Array.isArray(draft.clarificationsNeeded) ? draft.clarificationsNeeded.slice(0, 10) : [],
    confidence: draft.confidence,
    memoryLinks: draft.memoryLinks,
    synthesizedLessons: Array.isArray(draft.synthesizedLessons) ? draft.synthesizedLessons.slice(0, 15) : [],
    intakeAcknowledgment
  };
}
