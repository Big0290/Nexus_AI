import type { OutcomeMemory, SimilarOutcome } from '../lib/types.js';
import { newId } from '../util/id.js';
import { cosineSimilarityTfIdf } from '../util/tfidf.js';
import { SqliteOutcomeStore } from './sqlite-outcome-store.js';

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const d = Math.sqrt(na) * Math.sqrt(nb);
  return d === 0 ? 0 : dot / d;
}

export interface OutcomeMemoryServiceOptions {
  /** SQLite database file (required) */
  sqlitePath: string;
  /** If set and DB is empty, import this legacy JSON file then rename to `.bak` */
  legacyJsonPath?: string;
  /** Gemini embedding helper; when set, used instead of TF-IDF */
  embedText?: (text: string) => Promise<number[]>;
}

/**
 * Outcome Memory: post-mortem logging + semantic-ish recall (SQLite-backed).
 */
export class OutcomeMemoryService {
  private store!: SqliteOutcomeStore;
  private readonly sqlitePath: string;
  private readonly legacyJsonPath?: string;
  private readonly embedText?: (text: string) => Promise<number[]>;

  constructor(opts: OutcomeMemoryServiceOptions) {
    if (!opts.sqlitePath?.trim()) {
      throw new Error('OutcomeMemoryService requires sqlitePath');
    }
    this.sqlitePath = opts.sqlitePath;
    this.legacyJsonPath = opts.legacyJsonPath;
    this.embedText = opts.embedText;
  }

  async load(): Promise<void> {
    this.store = new SqliteOutcomeStore(this.sqlitePath);
    if (this.legacyJsonPath && this.store.getOutcomeCount() === 0) {
      this.store.importFromLegacyJson(this.legacyJsonPath);
    }
  }

  async logPostMortem(
    entry: Omit<OutcomeMemory, 'id' | 'timestamp'> & { id?: string; taskId?: string }
  ): Promise<OutcomeMemory> {
    const id = entry.id ?? newId('om');
    const row: OutcomeMemory = {
      ...entry,
      id,
      timestamp: new Date().toISOString()
    };
    let emb: number[] | undefined;
    if (this.embedText) {
      emb = await this.embedText(memorySearchKey(row));
    }
    this.store.insertOutcome(row, emb);
    return this.store.getById(id)!;
  }

  async searchSimilar(query: string, k: number): Promise<SimilarOutcome[]> {
    const memories = this.store.listAllForEmbedding();
    if (memories.length === 0) return [];

    if (this.embedText) {
      const qv = await this.embedText(query);
      const scored: SimilarOutcome[] = [];
      for (const m of memories) {
        let vec = this.store.getEmbedding(m.id);
        if (!vec) {
          vec = await this.embedText(memorySearchKey(m));
          this.store.setEmbedding(m.id, vec);
        }
        scored.push({ memory: m, score: cosine(qv, vec) });
      }
      return scored.sort((a, b) => b.score - a.score).slice(0, k);
    }

    const corpus = memories.map(memorySearchKey);
    const scored = memories.map((m) => {
      const score = cosineSimilarityTfIdf(query, memorySearchKey(m), corpus);
      return { memory: m, score };
    });
    return scored.sort((a, b) => b.score - a.score).slice(0, k);
  }

  listRecent(limit: number): OutcomeMemory[] {
    return this.store.listRecent(limit);
  }

  listFiltered(opts: { limit: number; category?: string; tag?: string; q?: string }): OutcomeMemory[] {
    return this.store.listFiltered(opts);
  }

  listCategories(): string[] {
    return this.store.listCategories();
  }

  listTags(): string[] {
    return this.store.listTags();
  }

  getById(id: string): OutcomeMemory | undefined {
    return this.store.getById(id);
  }

  async updateOutcome(
    id: string,
    patch: Partial<
      Pick<OutcomeMemory, 'successScore' | 'failureReason' | 'result' | 'primaryCategory' | 'canonicalQuery' | 'interpretedGoal' | 'tags'>
    >
  ): Promise<OutcomeMemory | undefined> {
    return this.store.updateOutcome(id, patch);
  }

  /** @internal tests */
  _getStore(): SqliteOutcomeStore {
    return this.store;
  }
}

function memorySearchKey(m: OutcomeMemory): string {
  return [m.taskType, m.primaryCategory ?? '', m.initialPlan, m.result, m.failureReason ?? '', m.canonicalQuery ?? ''].join('\n');
}

export { SqliteOutcomeStore };
