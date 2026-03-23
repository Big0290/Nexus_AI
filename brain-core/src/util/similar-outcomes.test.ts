import { describe, expect, it } from 'vitest';
import type { OutcomeMemory, SimilarOutcome } from '../lib/types.js';
import { mergeSimilarOutcomes } from './similar-outcomes.js';

function mem(id: string, result: string, score: number): SimilarOutcome {
  const m: OutcomeMemory = {
    id,
    taskType: 't',
    initialPlan: '',
    result,
    successScore: 0.5,
    failureReason: undefined,
    timestamp: new Date().toISOString()
  };
  return { memory: m, score };
}

describe('mergeSimilarOutcomes', () => {
  it('keeps higher score per id and sorts by score', () => {
    const a = [mem('a', 'one', 0.3), mem('b', 'two', 0.9)];
    const b = [mem('a', 'one-b', 0.7), mem('c', 'three', 0.4)];
    const out = mergeSimilarOutcomes(a, b);
    expect(out.map((x) => x.memory.id)).toEqual(['b', 'a', 'c']);
    expect(out.find((x) => x.memory.id === 'a')?.score).toBe(0.7);
  });
});
