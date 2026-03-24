import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { SqliteOutcomeStore } from './sqlite-outcome-store.js';
import type { OutcomeMemory } from '../lib/types.js';

function baseOm(id: string, overrides: Partial<OutcomeMemory> = {}): OutcomeMemory {
  return {
    id,
    taskType: 'general',
    initialPlan: 'plan',
    result: 'hello world outcome',
    successScore: 1,
    failureReason: undefined,
    timestamp: '2025-01-01T00:00:00.000Z',
    primaryCategory: 'creative',
    ...overrides
  };
}

describe('SqliteOutcomeStore', () => {
  let dir: string;
  let store: SqliteOutcomeStore;

  afterEach(() => {
    try {
      store?.close();
    } catch {
      /* ignore */
    }
    if (dir) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  });

  it('filters by category and tag', () => {
    dir = mkdtempSync(join(tmpdir(), 'nexus-sqlite-'));
    const path = join(dir, 't.db');
    store = new SqliteOutcomeStore(path);

    store.insertOutcome(
      baseOm('a1', {
        primaryCategory: 'creative',
        tags: ['alpha', 'shared'],
        result: 'unique zebra'
      })
    );
    store.insertOutcome(
      baseOm('a2', {
        primaryCategory: 'code',
        tags: ['beta', 'shared'],
        result: 'typescript rocks'
      })
    );

    const byCat = store.listFiltered({ limit: 10, category: 'creative' });
    expect(byCat.map((m) => m.id)).toEqual(['a1']);

    const byTag = store.listFiltered({ limit: 10, tag: 'beta' });
    expect(byTag.map((m) => m.id)).toEqual(['a2']);

    const q = store.listFiltered({ limit: 10, q: 'zebra' });
    expect(q.map((m) => m.id)).toEqual(['a1']);
  });

  it('lists distinct categories and tags', () => {
    dir = mkdtempSync(join(tmpdir(), 'nexus-sqlite-'));
    store = new SqliteOutcomeStore(join(dir, 't.db'));
    store.insertOutcome(baseOm('b1', { primaryCategory: 'a', tags: ['z', 'y'] }));
    store.insertOutcome(baseOm('b2', { primaryCategory: 'b', tags: ['y'] }));

    expect(store.listCategories()).toEqual(['a', 'b']);
    expect(store.listTags()).toEqual(['y', 'z']);
  });

  it('filters by any stored category in categories_json', () => {
    dir = mkdtempSync(join(tmpdir(), 'nexus-sqlite-'));
    store = new SqliteOutcomeStore(join(dir, 't.db'));
    store.insertOutcome(
      baseOm('c1', {
        primaryCategory: 'alpha',
        categories: ['alpha', 'beta'],
        result: 'multi-cat'
      })
    );
    expect(store.listFiltered({ limit: 10, category: 'beta' }).map((m) => m.id)).toEqual(['c1']);
    expect(store.listCategories().sort()).toEqual(['alpha', 'beta']);
  });
});
