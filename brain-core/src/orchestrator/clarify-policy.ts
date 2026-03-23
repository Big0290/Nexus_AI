import type { InterpretationResult } from '../lib/types.js';

export function shouldRequestClarification(
  ir: Pick<InterpretationResult, 'clarificationsNeeded' | 'confidence'>,
  opts: { clarifyMinConfidence: number; clarifyAlwaysQuestions: boolean }
): boolean {
  if (!ir.clarificationsNeeded?.length) return false;
  if (opts.clarifyAlwaysQuestions) return true;
  return ir.confidence < opts.clarifyMinConfidence;
}
