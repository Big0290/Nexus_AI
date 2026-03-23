import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SessionStore } from './session-store.js';

describe('SessionStore document ingest binding', () => {
  it('preserves documentIngestId across appendUser', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nexus-sess-'));
    try {
      const store = new SessionStore(dir);
      await store.setDocumentIngest('abc-session', 'ingest-uuid-1');
      let s = await store.load('abc-session');
      expect(s?.documentIngestId).toBe('ingest-uuid-1');
      expect(s?.turns).toEqual([]);

      await store.appendUser('abc-session', 'Hello');
      s = await store.load('abc-session');
      expect(s?.documentIngestId).toBe('ingest-uuid-1');
      expect(s?.turns).toHaveLength(1);

      await store.appendAssistant('abc-session', 'Hi');
      s = await store.load('abc-session');
      expect(s?.documentIngestId).toBe('ingest-uuid-1');
      expect(s?.turns).toHaveLength(2);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('overwrites documentIngestId on setDocumentIngest', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nexus-sess-'));
    try {
      const store = new SessionStore(dir);
      await store.setDocumentIngest('s1', 'a');
      await store.setDocumentIngest('s1', 'b');
      const s = await store.load('s1');
      expect(s?.documentIngestId).toBe('b');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
