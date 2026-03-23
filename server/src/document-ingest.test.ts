import { describe, expect, it } from 'vitest';
import { extractTextFromFile, isSafeIngestId } from './document-ingest.js';

describe('isSafeIngestId', () => {
  it('accepts standard UUIDs', () => {
    expect(isSafeIngestId('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
    expect(isSafeIngestId(' 6ba7b810-9dad-11d1-80b4-00c04fd430c8 ')).toBe(true);
  });

  it('rejects path-like and invalid strings', () => {
    expect(isSafeIngestId('../../../etc/passwd')).toBe(false);
    expect(isSafeIngestId('not-a-uuid')).toBe(false);
    expect(isSafeIngestId('')).toBe(false);
  });
});

describe('extractTextFromFile', () => {
  it('reads plain text without vision', async () => {
    const buf = Buffer.from('hello world', 'utf8');
    const r = await extractTextFromFile('notes.txt', 'text/plain', buf, undefined, false);
    expect(r.text).toBe('hello world');
    expect(r.visionUsed).toBe(false);
  });

  it('does not use vision for images when visionOnIngest is false', async () => {
    const buf = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
    const r = await extractTextFromFile('x.jpg', 'image/jpeg', buf, 'fake-key', false);
    expect(r.visionUsed).toBe(false);
    expect(r.text).toContain('Gemini vision disabled for ingest');
  });
});
