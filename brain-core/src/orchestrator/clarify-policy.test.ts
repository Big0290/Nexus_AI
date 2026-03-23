import { describe, expect, it } from 'vitest';
import { shouldRequestClarification } from './clarify-policy.js';

describe('shouldRequestClarification', () => {
  it('returns false when there are no questions', () => {
    expect(
      shouldRequestClarification({ clarificationsNeeded: [], confidence: 0.1 }, {
        clarifyMinConfidence: 0.75,
        clarifyAlwaysQuestions: false
      })
    ).toBe(false);
  });

  it('returns true when always-questions is set', () => {
    expect(
      shouldRequestClarification(
        { clarificationsNeeded: ['What format?'], confidence: 0.99 },
        { clarifyMinConfidence: 0.75, clarifyAlwaysQuestions: true }
      )
    ).toBe(true);
  });

  it('returns true when confidence is below threshold', () => {
    expect(
      shouldRequestClarification(
        { clarificationsNeeded: ['Genre?'], confidence: 0.5 },
        { clarifyMinConfidence: 0.75, clarifyAlwaysQuestions: false }
      )
    ).toBe(true);
  });

  it('returns false when confidence is at or above threshold', () => {
    expect(
      shouldRequestClarification(
        { clarificationsNeeded: ['Optional detail'], confidence: 0.8 },
        { clarifyMinConfidence: 0.75, clarifyAlwaysQuestions: false }
      )
    ).toBe(false);
  });
});
