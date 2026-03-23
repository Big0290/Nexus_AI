import Database from 'better-sqlite3';
import { existsSync, readFileSync, renameSync } from 'node:fs';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { OutcomeMemory } from '../lib/types.js';

const SCHEMA_VERSION = 1;

function rowToMemory(
  row: {
    id: string;
    created_at: string;
    task_type: string;
    primary_category: string | null;
    canonical_query: string | null;
    interpreted_goal: string | null;
    initial_plan: string;
    result: string;
    success_score: number | null;
    failure_reason: string | null;
    session_id: string | null;
    task_id: string | null;
    embedding: Buffer | null;
  },
  tags: string[]
): OutcomeMemory {
  return {
    id: row.id,
    timestamp: row.created_at,
    taskType: row.task_type,
    primaryCategory: row.primary_category ?? undefined,
    canonicalQuery: row.canonical_query ?? undefined,
    interpretedGoal: row.interpreted_goal ?? undefined,
    initialPlan: row.initial_plan,
    result: row.result,
    successScore: row.success_score ?? undefined,
    failureReason: row.failure_reason ?? undefined,
    sessionId: row.session_id ?? undefined,
    taskId: row.task_id ?? undefined,
    tags: tags.length ? tags : undefined
  };
}

export function encodeEmbedding(vec: number[]): Buffer {
  return Buffer.from(new Float32Array(vec).buffer);
}

export function decodeEmbedding(buf: Buffer | null): number[] | undefined {
  if (!buf?.length) return undefined;
  const arr = new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4);
  return Array.from(arr);
}

export class SqliteOutcomeStore {
  readonly db: Database.Database;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS outcomes (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        task_type TEXT NOT NULL,
        primary_category TEXT,
        canonical_query TEXT,
        interpreted_goal TEXT,
        initial_plan TEXT NOT NULL,
        result TEXT NOT NULL,
        success_score REAL,
        failure_reason TEXT,
        session_id TEXT,
        task_id TEXT,
        embedding BLOB
      );
      CREATE INDEX IF NOT EXISTS idx_outcomes_category ON outcomes(primary_category, created_at);
      CREATE INDEX IF NOT EXISTS idx_outcomes_created ON outcomes(created_at);
      CREATE TABLE IF NOT EXISTS outcome_tags (
        outcome_id TEXT NOT NULL REFERENCES outcomes(id) ON DELETE CASCADE,
        tag TEXT NOT NULL,
        PRIMARY KEY (outcome_id, tag)
      );
      CREATE INDEX IF NOT EXISTS idx_outcome_tags_tag ON outcome_tags(tag);
    `);
    const v = this.db.prepare('SELECT value FROM schema_meta WHERE key = ?').get('version') as { value: string } | undefined;
    const current = v ? Number(v.value) : 0;
    if (current < SCHEMA_VERSION) {
      this.db.prepare('INSERT OR REPLACE INTO schema_meta (key, value) VALUES (?, ?)').run('version', String(SCHEMA_VERSION));
    }
  }

  /** Import legacy JSON array once; renames file to .bak on success */
  importFromLegacyJson(jsonPath: string): number {
    if (!existsSync(jsonPath)) return 0;
    let data: unknown;
    try {
      data = JSON.parse(readFileSync(jsonPath, 'utf8')) as unknown;
    } catch {
      return 0;
    }
    if (!Array.isArray(data) || data.length === 0) return 0;
    const count = this.db.transaction(() => {
      let n = 0;
      for (const raw of data) {
        const m = raw as Record<string, unknown>;
        const id = typeof m.id === 'string' ? m.id : null;
        if (!id) continue;
        const exists = this.db.prepare('SELECT 1 FROM outcomes WHERE id = ?').get(id);
        if (exists) continue;
        const om: OutcomeMemory = {
          id,
          taskType: String(m.taskType ?? 'general'),
          initialPlan: String(m.initialPlan ?? ''),
          result: String(m.result ?? ''),
          successScore: typeof m.successScore === 'number' ? m.successScore : undefined,
          failureReason: typeof m.failureReason === 'string' ? m.failureReason : undefined,
          timestamp: String(m.timestamp ?? new Date().toISOString()),
          primaryCategory: typeof m.primaryCategory === 'string' ? m.primaryCategory : undefined,
          canonicalQuery: typeof m.canonicalQuery === 'string' ? m.canonicalQuery : undefined,
          interpretedGoal: typeof m.interpretedGoal === 'string' ? m.interpretedGoal : undefined,
          sessionId: typeof m.sessionId === 'string' ? m.sessionId : undefined,
          taskId: typeof m.taskId === 'string' ? m.taskId : undefined,
          tags: Array.isArray(m.tags) ? (m.tags as unknown[]).filter((t): t is string => typeof t === 'string') : undefined
        };
        this.insertOutcome(om);
        n++;
      }
      return n;
    })();
    if (count > 0) {
      try {
        renameSync(jsonPath, `${jsonPath}.bak`);
      } catch {
        /* keep json if rename fails */
      }
    }
    return count;
  }

  private setTags(outcomeId: string, tags: string[] | undefined): void {
    this.db.prepare('DELETE FROM outcome_tags WHERE outcome_id = ?').run(outcomeId);
    if (!tags?.length) return;
    const ins = this.db.prepare('INSERT OR IGNORE INTO outcome_tags (outcome_id, tag) VALUES (?, ?)');
    for (const t of tags) {
      const tag = t.trim().slice(0, 120);
      if (tag) ins.run(outcomeId, tag);
    }
  }

  insertOutcome(m: OutcomeMemory, embedding?: number[]): void {
    const emb = embedding?.length ? encodeEmbedding(embedding) : null;
    this.db
      .prepare(
        `INSERT INTO outcomes (
          id, created_at, task_type, primary_category, canonical_query, interpreted_goal,
          initial_plan, result, success_score, failure_reason, session_id, task_id, embedding
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        m.id,
        m.timestamp,
        m.taskType,
        m.primaryCategory ?? null,
        m.canonicalQuery ?? null,
        m.interpretedGoal ?? null,
        m.initialPlan,
        m.result,
        m.successScore ?? null,
        m.failureReason ?? null,
        m.sessionId ?? null,
        m.taskId ?? null,
        emb
      );
    this.setTags(m.id, m.tags);
  }

  updateOutcome(
    id: string,
    patch: Partial<
      Pick<
        OutcomeMemory,
        | 'successScore'
        | 'failureReason'
        | 'result'
        | 'primaryCategory'
        | 'canonicalQuery'
        | 'interpretedGoal'
        | 'tags'
      >
    >
  ): OutcomeMemory | undefined {
    const cur = this.getById(id);
    if (!cur) return undefined;
    const next: OutcomeMemory = {
      ...cur,
      ...patch,
      tags: patch.tags !== undefined ? patch.tags : cur.tags
    };
    this.db
      .prepare(
        `UPDATE outcomes SET
          success_score = ?,
          failure_reason = ?,
          result = ?,
          primary_category = ?,
          canonical_query = ?,
          interpreted_goal = ?
        WHERE id = ?`
      )
      .run(
        next.successScore ?? null,
        next.failureReason ?? null,
        next.result,
        next.primaryCategory ?? null,
        next.canonicalQuery ?? null,
        next.interpretedGoal ?? null,
        id
      );
    if (patch.tags !== undefined) {
      this.setTags(id, next.tags);
    }
    return this.getById(id);
  }

  getById(id: string): OutcomeMemory | undefined {
    const row = this.db
      .prepare(
        `SELECT id, created_at, task_type, primary_category, canonical_query, interpreted_goal,
          initial_plan, result, success_score, failure_reason, session_id, task_id, embedding
        FROM outcomes WHERE id = ?`
      )
      .get(id) as
      | {
          id: string;
          created_at: string;
          task_type: string;
          primary_category: string | null;
          canonical_query: string | null;
          interpreted_goal: string | null;
          initial_plan: string;
          result: string;
          success_score: number | null;
          failure_reason: string | null;
          session_id: string | null;
          task_id: string | null;
          embedding: Buffer | null;
        }
      | undefined;
    if (!row) return undefined;
    const tags = this.getTagsFor(id);
    return rowToMemory(row, tags);
  }

  getTagsFor(outcomeId: string): string[] {
    const rows = this.db.prepare('SELECT tag FROM outcome_tags WHERE outcome_id = ? ORDER BY tag').all(outcomeId) as {
      tag: string;
    }[];
    return rows.map((r) => r.tag);
  }

  getEmbedding(id: string): number[] | undefined {
    const row = this.db.prepare('SELECT embedding FROM outcomes WHERE id = ?').get(id) as { embedding: Buffer | null } | undefined;
    return decodeEmbedding(row?.embedding ?? null);
  }

  setEmbedding(id: string, vec: number[]): void {
    this.db.prepare('UPDATE outcomes SET embedding = ? WHERE id = ?').run(encodeEmbedding(vec), id);
  }

  listAllForEmbedding(): OutcomeMemory[] {
    const rows = this.db
      .prepare(
        `SELECT id, created_at, task_type, primary_category, canonical_query, interpreted_goal,
          initial_plan, result, success_score, failure_reason, session_id, task_id, embedding
        FROM outcomes ORDER BY created_at ASC`
      )
      .all() as {
      id: string;
      created_at: string;
      task_type: string;
      primary_category: string | null;
      canonical_query: string | null;
      interpreted_goal: string | null;
      initial_plan: string;
      result: string;
      success_score: number | null;
      failure_reason: string | null;
      session_id: string | null;
      task_id: string | null;
      embedding: Buffer | null;
    }[];
    return rows.map((r) => rowToMemory(r, this.getTagsFor(r.id)));
  }

  listRecent(limit: number): OutcomeMemory[] {
    const rows = this.db
      .prepare(
        `SELECT id, created_at, task_type, primary_category, canonical_query, interpreted_goal,
          initial_plan, result, success_score, failure_reason, session_id, task_id, embedding
        FROM outcomes ORDER BY created_at DESC LIMIT ?`
      )
      .all(limit) as {
      id: string;
      created_at: string;
      task_type: string;
      primary_category: string | null;
      canonical_query: string | null;
      interpreted_goal: string | null;
      initial_plan: string;
      result: string;
      success_score: number | null;
      failure_reason: string | null;
      session_id: string | null;
      task_id: string | null;
      embedding: Buffer | null;
    }[];
    return rows.map((r) => rowToMemory(r, this.getTagsFor(r.id)));
  }

  listFiltered(opts: {
    limit: number;
    category?: string;
    tag?: string;
    q?: string;
  }): OutcomeMemory[] {
    const conditions: string[] = [];
    const params: (string | number)[] = [];
    if (opts.category?.trim()) {
      conditions.push('primary_category = ?');
      params.push(opts.category.trim());
    }
    if (opts.tag?.trim()) {
      conditions.push(`id IN (SELECT outcome_id FROM outcome_tags WHERE tag = ?)`);
      params.push(opts.tag.trim());
    }
    if (opts.q?.trim()) {
      const needle = `%${opts.q.trim().replace(/%/g, '\\%').replace(/_/g, '\\_')}%`;
      conditions.push(
        `(result LIKE ? ESCAPE '\\' OR interpreted_goal LIKE ? ESCAPE '\\' OR canonical_query LIKE ? ESCAPE '\\' OR initial_plan LIKE ? ESCAPE '\\')`
      );
      params.push(needle, needle, needle, needle);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const sql = `SELECT id, created_at, task_type, primary_category, canonical_query, interpreted_goal,
      initial_plan, result, success_score, failure_reason, session_id, task_id, embedding
      FROM outcomes ${where} ORDER BY created_at DESC LIMIT ?`;
    params.push(opts.limit);
    const rows = this.db.prepare(sql).all(...params) as {
      id: string;
      created_at: string;
      task_type: string;
      primary_category: string | null;
      canonical_query: string | null;
      interpreted_goal: string | null;
      initial_plan: string;
      result: string;
      success_score: number | null;
      failure_reason: string | null;
      session_id: string | null;
      task_id: string | null;
      embedding: Buffer | null;
    }[];
    return rows.map((r) => rowToMemory(r, this.getTagsFor(r.id)));
  }

  listCategories(): string[] {
    const rows = this.db
      .prepare(
        `SELECT DISTINCT primary_category FROM outcomes WHERE primary_category IS NOT NULL AND trim(primary_category) != '' ORDER BY primary_category`
      )
      .all() as { primary_category: string }[];
    return rows.map((r) => r.primary_category);
  }

  listTags(): string[] {
    const rows = this.db.prepare(`SELECT DISTINCT tag FROM outcome_tags ORDER BY tag`).all() as { tag: string }[];
    return rows.map((r) => r.tag);
  }

  getOutcomeCount(): number {
    const row = this.db.prepare('SELECT COUNT(*) as c FROM outcomes').get() as { c: number };
    return row.c;
  }

  close(): void {
    this.db.close();
  }
}
