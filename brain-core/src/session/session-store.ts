import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ISOTimestamp, SessionTurn } from '../lib/types.js';

export interface SessionFile {
  id: string;
  updatedAt: ISOTimestamp;
  turns: SessionTurn[];
  /** Latest document teach ingest bound to this session (server-enforced). */
  documentIngestId?: string;
}

/** Turn prior messages into a block for LLM prompts (interpretation / strategy context). */
export function formatSessionTranscript(turns: SessionTurn[]): string {
  if (turns.length === 0) return '';
  return turns
    .map((t) => `${t.role === 'user' ? 'User' : 'Assistant'}: ${t.content}`)
    .join('\n\n');
}

/**
 * Durable session transcript: survives server restart. Stored as JSON per session id.
 */
export class SessionStore {
  constructor(
    private readonly sessionsDir: string,
    private readonly maxTurns = 40
  ) {}

  private path(id: string): string {
    const safe = id.replace(/[^a-zA-Z0-9._-]/g, '_');
    return join(this.sessionsDir, `${safe}.json`);
  }

  async load(sessionId: string): Promise<SessionFile | null> {
    try {
      const raw = await readFile(this.path(sessionId), 'utf8');
      const data = JSON.parse(raw) as SessionFile;
      if (!data?.turns || !Array.isArray(data.turns)) return null;
      return data;
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') return null;
      throw e;
    }
  }

  private async write(data: SessionFile): Promise<void> {
    await mkdir(this.sessionsDir, { recursive: true });
    await writeFile(this.path(data.id), JSON.stringify(data, null, 2), 'utf8');
  }

  /**
   * Records the user message and returns **prior** turns (everything before this message).
   */
  async appendUser(sessionId: string, content: string): Promise<{ priorTurns: SessionTurn[] }> {
    const existing = await this.load(sessionId);
    const priorTurns: SessionTurn[] = existing ? [...existing.turns] : [];
    const userTurn: SessionTurn = {
      role: 'user',
      content,
      timestamp: new Date().toISOString()
    };
    let turns = [...priorTurns, userTurn];
    if (turns.length > this.maxTurns) {
      turns = turns.slice(-this.maxTurns);
    }
    await this.write({
      id: sessionId,
      updatedAt: new Date().toISOString(),
      turns,
      ...(existing?.documentIngestId != null ? { documentIngestId: existing.documentIngestId } : {})
    });
    return { priorTurns };
  }

  /** Bind the latest document upload ingest to this session (document_teach must match). */
  async setDocumentIngest(sessionId: string, ingestId: string): Promise<void> {
    const existing = await this.load(sessionId);
    await this.write({
      id: sessionId,
      updatedAt: new Date().toISOString(),
      turns: existing?.turns ?? [],
      documentIngestId: ingestId
    });
  }

  /** Append assistant reply after a run (e.g. specialist result summary). */
  async appendAssistant(sessionId: string, content: string): Promise<void> {
    const existing = await this.load(sessionId);
    if (!existing) return;
    const assistantTurn: SessionTurn = {
      role: 'assistant',
      content,
      timestamp: new Date().toISOString()
    };
    let turns = [...existing.turns, assistantTurn];
    if (turns.length > this.maxTurns) {
      turns = turns.slice(-this.maxTurns);
    }
    await this.write({
      id: sessionId,
      updatedAt: new Date().toISOString(),
      turns,
      ...(existing.documentIngestId != null ? { documentIngestId: existing.documentIngestId } : {})
    });
  }
}
