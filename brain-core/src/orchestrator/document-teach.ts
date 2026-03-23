import type { DocumentTeachRunOptions, InterpretationResult } from '../lib/types.js';

/**
 * Intake for document_teach: deterministic categories/tags without a second LLM call.
 */
export function syntheticInterpretationForDocumentTeach(
  userDescription: string,
  doc: DocumentTeachRunOptions,
  primaryCategoryHint?: string
): InterpretationResult {
  const names = doc.sourceFiles.map((f) => f.name).join(', ');
  const mimeTags = doc.sourceFiles.map((f) => `mime:${f.mime}`);
  const goal = doc.focusNote?.trim()
    ? `${userDescription.trim()} — Focus: ${doc.focusNote.trim()}`
    : userDescription.trim() || `Learn from uploaded files: ${names}`;

  return {
    interpretedGoal: goal.slice(0, 2000),
    canonicalQuery: `${userDescription.trim()} ${names}`.slice(0, 500),
    primaryCategory: primaryCategoryHint?.trim() || 'knowledge',
    tags: ['source:upload', `ingest:${doc.ingestId}`, ...mimeTags].slice(0, 20),
    constraints: ['Extracted text was Law 25–masked before model calls.'],
    assumptions: [
      'Document structure and tables may be lossy after extraction.',
      'Scanned PDFs or photos may use vision/OCR fallback when text is empty.'
    ],
    clarificationsNeeded: [],
    confidence: 0.88,
    memoryLinks: [],
    synthesizedLessons: ['Prefer citing source filenames when storing facts from uploads.']
  };
}
