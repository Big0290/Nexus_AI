import { normalizeInterpretationResult } from '../lib/interpretation-normalize.js';
import type { DocumentTeachRunOptions, InterpretationResult } from '../lib/types.js';

function mimeCategory(mime: string): string | undefined {
  const m = mime.toLowerCase();
  if (m === 'application/pdf' || m.includes('pdf')) return 'pdf';
  if (m.startsWith('image/')) return 'image';
  if (m.includes('spreadsheet') || m.includes('excel') || m === 'text/csv') return 'spreadsheet';
  if (m.includes('word') || m.includes('document') || m === 'text/plain') return 'text_document';
  if (m.includes('json') || m.includes('xml') || m.includes('html')) return 'structured_text';
  return undefined;
}

function keywordCategories(text: string): string[] {
  const lower = text.toLowerCase();
  const out: string[] = [];
  if (/\b(legal|law|contract|litigation|compliance)\b/.test(lower)) out.push('legal');
  if (/\b(finance|budget|invoice|accounting|tax)\b/.test(lower)) out.push('finance');
  if (/\b(code|api|github|software|developer)\b/.test(lower)) out.push('code');
  return out.slice(0, 3);
}

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

  const basePrimary = primaryCategoryHint?.trim() || 'knowledge';
  const categorySet: string[] = [basePrimary, 'document_teach'];
  for (const f of doc.sourceFiles) {
    const mc = mimeCategory(f.mime);
    if (mc) categorySet.push(mc);
  }
  categorySet.push(...keywordCategories(userDescription));
  categorySet.push(...keywordCategories(names));

  const uniquePreview = [...new Set(categorySet)].slice(0, 12).join(', ');
  const intakeAcknowledgment = `Synthetic intake: assigned categories (${uniquePreview}) from task type document_teach, file MIME types and names, and optional description keywords — no LLM classification. Ingest id: ${doc.ingestId}.`;

  return normalizeInterpretationResult({
    interpretedGoal: goal.slice(0, 2000),
    canonicalQuery: `${userDescription.trim()} ${names}`.slice(0, 500),
    primaryCategory: basePrimary,
    categories: categorySet,
    tags: ['source:upload', `ingest:${doc.ingestId}`, ...mimeTags].slice(0, 20),
    constraints: ['Extracted text was Law 25–masked before model calls.'],
    assumptions: [
      'Document structure and tables may be lossy after extraction.',
      'Scanned PDFs or photos may use vision/OCR fallback when text is empty.'
    ],
    clarificationsNeeded: [],
    confidence: 0.88,
    memoryLinks: [],
    synthesizedLessons: ['Prefer citing source filenames when storing facts from uploads.'],
    intakeAcknowledgment
  });
}
