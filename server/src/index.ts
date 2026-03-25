import './load-env.js';

import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { serve } from '@hono/node-server';
import { SessionStore } from '@nexus/brain-core';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { streamSSE } from 'hono/streaming';
import { createBrainRuntime } from './brain-runtime.js';
import { ingestUploadedFiles, isSafeIngestId, loadDocumentIngest } from './document-ingest.js';
import { ingestWebCrawl } from './web-crawl-ingest.js';
import { WebCrawlIngestError } from './web-crawl-error.js';
import { scheduleUploadCleanup } from './upload-cleanup.js';

const DATA_DIR = process.env.DATA_DIR ?? './data';
const PORT = Number(process.env.PORT ?? 8787);
const GEMINI_MODEL = process.env.GEMINI_MODEL ?? 'gemini-2.5-flash';
const GEMINI_EMBEDDING_MODEL = process.env.GEMINI_EMBEDDING_MODEL ?? 'text-embedding-004';
const USE_EMBEDDINGS = process.env.GEMINI_EMBEDDINGS === '1';
const API_KEY = process.env.NEXUS_API_KEY?.trim();
const GEMINI_API_KEY = process.env.GEMINI_API_KEY?.trim();
const UPLOAD_MAX_MB = Number(process.env.UPLOAD_MAX_MB ?? '25');
const UPLOAD_MAX_BYTES = (Number.isFinite(UPLOAD_MAX_MB) && UPLOAD_MAX_MB > 0 ? UPLOAD_MAX_MB : 25) * 1024 * 1024;
const UPLOAD_MAX_PER_FILE_MB = process.env.UPLOAD_MAX_PER_FILE_MB
  ? Number(process.env.UPLOAD_MAX_PER_FILE_MB)
  : UPLOAD_MAX_MB;
const UPLOAD_MAX_PER_FILE_BYTES =
  (Number.isFinite(UPLOAD_MAX_PER_FILE_MB) && UPLOAD_MAX_PER_FILE_MB > 0 ? UPLOAD_MAX_PER_FILE_MB : UPLOAD_MAX_MB) *
  1024 *
  1024;
const GEMINI_VISION_ON_INGEST = process.env.GEMINI_VISION_ON_INGEST !== '0' && process.env.GEMINI_VISION_ON_INGEST !== 'false';
const WEB_CRAWL_MAX_TOTAL_BYTES_ENV = (() => {
  const v = process.env.WEB_CRAWL_MAX_TOTAL_MB;
  if (v === undefined || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n * 1024 * 1024 : undefined;
})();
const UPLOAD_TTL_DAYS = process.env.UPLOAD_TTL_DAYS ? Number(process.env.UPLOAD_TTL_DAYS) : 30;
const UPLOAD_CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;

const ingestStats = {
  uploadsOk: 0,
  crawlOk: 0,
  uploadFailures: 0,
  visionFiles: 0
};

let ingestBusy = false;

const SQLITE_PATH = process.env.SQLITE_PATH?.trim();
const CLARIFY_MIN = process.env.CLARIFY_MIN_CONFIDENCE
  ? Number(process.env.CLARIFY_MIN_CONFIDENCE)
  : undefined;
const CLARIFY_ALWAYS = process.env.CLARIFY_ALWAYS_QUESTIONS === '1';

const brain = await createBrainRuntime({
  dataDir: DATA_DIR,
  orchestratorId: process.env.ORCHESTRATOR_ID ?? 'brain-1',
  geminiApiKey: process.env.GEMINI_API_KEY,
  geminiModel: GEMINI_MODEL,
  geminiEmbeddingModel: GEMINI_EMBEDDING_MODEL,
  useEmbeddings: USE_EMBEDDINGS,
  sqlitePath: SQLITE_PATH || undefined,
  clarifyMinConfidence: Number.isFinite(CLARIFY_MIN) ? CLARIFY_MIN : undefined,
  clarifyAlwaysQuestions: CLARIFY_ALWAYS
});

const sessionStore = new SessionStore(join(DATA_DIR, 'sessions'));

let busy = false;

scheduleUploadCleanup(DATA_DIR, UPLOAD_TTL_DAYS, UPLOAD_CLEANUP_INTERVAL_MS, (removed) => {
  if (removed > 0) {
    console.log(JSON.stringify({ event: 'upload_cleanup', removed, ttlDays: UPLOAD_TTL_DAYS }));
  }
});

const app = new Hono();

function verifyApiKey(c: { req: { header: (n: string) => string | undefined; query: (n: string) => string | undefined } }): boolean {
  if (!API_KEY) return true;
  const auth = c.req.header('Authorization');
  const keyHeader = c.req.header('X-API-Key');
  const q = c.req.query('api_key');
  return auth === `Bearer ${API_KEY}` || keyHeader === API_KEY || q === API_KEY;
}

app.use(
  '*',
  cors({
    origin: ['http://localhost:5173', 'http://127.0.0.1:5173'],
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'X-API-Key']
  })
);

app.use('*', async (c, next) => {
  if (c.req.method === 'OPTIONS') return next();
  if (!API_KEY) return next();
  if (c.req.path === '/api/health') return next();
  if (!verifyApiKey(c)) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  return next();
});

app.get('/api/health', (c) => {
  const st = brain.getState();
  return c.json({
    ok: true,
    busy: busy || st.processing,
    serverQueueBusy: busy,
    uploadBusy: ingestBusy,
    ingestBusy,
    orchestratorProcessing: st.processing,
    model: st.modelMode,
    authEnabled: Boolean(API_KEY),
    dataDir: DATA_DIR,
    orchestratorId: st.orchestratorId,
    ingestStats: { ...ingestStats }
  });
});

app.get('/api/state', (c) => c.json(brain.getState()));

app.get('/api/audit', (c) => {
  const limit = Number(c.req.query('limit') ?? '100');
  return c.json({ entries: brain.listComplianceAudit(limit) });
});

app.get('/api/memory', (c) => {
  const limit = Number(c.req.query('limit') ?? '50');
  const category = c.req.query('category')?.trim();
  const tag = c.req.query('tag')?.trim();
  const q = c.req.query('q')?.trim();
  const filter =
    category || tag || q ? { category: category || undefined, tag: tag || undefined, q: q || undefined } : undefined;
  return c.json({ outcomes: brain.listOutcomeMemory(limit, filter) });
});

app.get('/api/memory/meta', (c) => {
  return c.json({
    categories: brain.listMemoryCategories(),
    tags: brain.listMemoryTags()
  });
});

app.get('/api/session/:id', async (c) => {
  const id = c.req.param('id');
  const session = await sessionStore.load(id);
  if (!session) return c.json({ error: 'Session not found' }, 404);
  return c.json({ session });
});

app.post('/api/teach/upload', async (c) => {
  if (ingestBusy) {
    return c.json({ error: 'Ingest in progress (upload or crawl)' }, 429);
  }
  const body = await c.req.parseBody({ all: true });
  const raw = body.files;
  if (!raw) {
    return c.json({ error: 'files field is required (multipart)' }, 400);
  }

  let sessionId =
    typeof body.sessionId === 'string' && body.sessionId.trim() ? body.sessionId.trim() : '';
  if (!sessionId) {
    sessionId = randomUUID();
  } else if (!isSafeIngestId(sessionId)) {
    return c.json({ error: 'Invalid sessionId (expected UUID)' }, 400);
  }

  const fileList = Array.isArray(raw) ? raw : [raw];
  const buffers: { name: string; mime: string; buffer: Buffer }[] = [];
  let total = 0;
  for (const entry of fileList) {
    if (!(entry instanceof File)) continue;
    const buf = Buffer.from(await entry.arrayBuffer());
    if (buf.length > UPLOAD_MAX_PER_FILE_BYTES) {
      return c.json(
        {
          error: `File exceeds per-file limit (${UPLOAD_MAX_PER_FILE_MB} MB)`
        },
        413
      );
    }
    total += buf.length;
    if (total > UPLOAD_MAX_BYTES) {
      return c.json({ error: `Total upload exceeds ${UPLOAD_MAX_MB} MB` }, 413);
    }
    buffers.push({
      name: entry.name || 'unnamed',
      mime: entry.type || 'application/octet-stream',
      buffer: buf
    });
  }
  if (!buffers.length) {
    return c.json({ error: 'No valid files in upload' }, 400);
  }

  const t0 = Date.now();
  ingestBusy = true;
  try {
    const result = await ingestUploadedFiles({
      dataDir: DATA_DIR,
      auditor: brain.getLaw25Auditor(),
      files: buffers,
      geminiApiKey: GEMINI_API_KEY,
      visionOnIngest: GEMINI_VISION_ON_INGEST
    });
    await sessionStore.setDocumentIngest(sessionId, result.ingestId);
    const visionUsedCount = result.manifest.files.filter((f) => f.visionUsed).length;
    ingestStats.uploadsOk += 1;
    ingestStats.visionFiles += visionUsedCount;
    console.log(
      JSON.stringify({
        event: 'ingest_complete',
        source: 'upload',
        ingestId: result.ingestId,
        sessionId,
        fileCount: buffers.length,
        totalBytes: total,
        visionUsedCount,
        durationMs: Date.now() - t0
      })
    );
    return c.json({
      ingestId: result.ingestId,
      sessionId,
      manifest: result.manifest,
      maskedTextChars: result.manifest.maskedTextChars,
      sourceFiles: result.sourceFiles
    });
  } catch (e) {
    ingestStats.uploadFailures += 1;
    const message = e instanceof Error ? e.message : String(e);
    console.log(
      JSON.stringify({
        event: 'ingest_error',
        message,
        sessionId,
        durationMs: Date.now() - t0
      })
    );
    console.error('ingest failed', e);
    return c.json({ error: message }, 500);
  } finally {
    ingestBusy = false;
  }
});

type TeachCrawlBody = {
  sessionId?: string;
  seedUrl?: string;
  maxPages?: number;
  maxDepth?: number;
  attestationAccepted?: boolean;
  allowedHosts?: string[];
  /** Honored only when WEB_CRAWL_ALLOW_IGNORE_ROBOTS=1 (dev/testing). */
  ignoreRobots?: boolean;
};

app.post('/api/teach/crawl', async (c) => {
  if (ingestBusy) {
    return c.json({ error: 'Ingest in progress (upload or crawl)' }, 429);
  }
  const body = (await c.req.json().catch(() => ({}))) as TeachCrawlBody;

  let sessionId =
    typeof body.sessionId === 'string' && body.sessionId.trim() ? body.sessionId.trim() : '';
  if (!sessionId) {
    sessionId = randomUUID();
  } else if (!isSafeIngestId(sessionId)) {
    return c.json({ error: 'Invalid sessionId (expected UUID)' }, 400);
  }

  const seedUrl = typeof body.seedUrl === 'string' ? body.seedUrl.trim() : '';
  if (!seedUrl) {
    return c.json({ error: 'seedUrl is required' }, 400);
  }

  const t0 = Date.now();
  ingestBusy = true;
  try {
    const result = await ingestWebCrawl({
      dataDir: DATA_DIR,
      auditor: brain.getLaw25Auditor(),
      seedUrl,
      geminiApiKey: GEMINI_API_KEY,
      visionOnIngest: GEMINI_VISION_ON_INGEST,
      maxPages: Number.isFinite(body.maxPages) ? body.maxPages : undefined,
      maxDepth: Number.isFinite(body.maxDepth) ? body.maxDepth : undefined,
      maxTotalBytes: WEB_CRAWL_MAX_TOTAL_BYTES_ENV,
      attestationAccepted: body.attestationAccepted === true,
      allowedHosts: Array.isArray(body.allowedHosts)
        ? body.allowedHosts.filter((h: unknown): h is string => typeof h === 'string' && h.trim() !== '')
        : undefined,
      ignoreRobots: body.ignoreRobots === true
    });
    await sessionStore.setDocumentIngest(sessionId, result.ingestId);
    const cj = result.manifest.crawlJob;
    ingestStats.crawlOk += 1;
    console.log(
      JSON.stringify({
        event: 'web_crawl_complete',
        ingestId: result.ingestId,
        sessionId,
        seedUrl: result.manifest.seedUrl,
        maskedTextChars: result.manifest.maskedTextChars,
        crawlJob: cj,
        skippedByRobots: cj?.skippedByRobots,
        skippedByPolicy: cj?.skippedByPolicy,
        ignoreRobotsApplied: cj?.ignoreRobotsApplied === true,
        durationMs: Date.now() - t0
      })
    );
    return c.json({
      ingestId: result.ingestId,
      sessionId,
      manifest: result.manifest,
      maskedTextChars: result.manifest.maskedTextChars,
      sourceFiles: result.sourceFiles
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    ingestStats.uploadFailures += 1;
    const diagnostics = e instanceof WebCrawlIngestError ? e.diagnostics : undefined;
    console.log(
      JSON.stringify({
        event: 'web_crawl_error',
        message,
        sessionId,
        durationMs: Date.now() - t0,
        ...(diagnostics
          ? {
              crawlDiagnosticsSummary: {
                originsWithRobots: Object.keys(diagnostics.robotsTxtByOrigin),
                pagesTried: diagnostics.pagesTried.length,
                lastHtmlFetchError: diagnostics.lastHtmlFetchError
              }
            }
          : {})
      })
    );
    console.error('web crawl ingest failed', e);
    return c.json(
      diagnostics ? { error: message, crawlDiagnostics: diagnostics } : { error: message },
      500
    );
  } finally {
    ingestBusy = false;
  }
});

app.post('/api/tasks', async (c) => {
  if (busy) {
    return c.json({ error: 'Orchestrator is busy with another task' }, 429);
  }
  const body = await c.req.json<{
    description?: string;
    taskType?: string;
    sessionId?: string;
    ingestId?: string;
    focusNote?: string;
  }>();
  const taskType = body.taskType?.trim() || 'general';
  let description = body.description?.trim() ?? '';

  if (taskType === 'document_teach' || taskType === 'web_teach') {
    const sessionIdRaw = body.sessionId?.trim();
    if (!sessionIdRaw) {
      return c.json(
        {
          error: `sessionId is required for ${taskType} (use sessionId returned by POST /api/teach/upload or /api/teach/crawl)`
        },
        400
      );
    }
    if (!isSafeIngestId(sessionIdRaw)) {
      return c.json({ error: 'Invalid sessionId' }, 400);
    }
    const sessionId = sessionIdRaw;
    const ingestId = body.ingestId?.trim();
    if (!ingestId) {
      return c.json(
        {
          error: `ingestId is required for ${taskType} (run POST /api/teach/upload or POST /api/teach/crawl first)`
        },
        400
      );
    }
    const bound = await sessionStore.load(sessionId);
    if (!bound?.documentIngestId || bound.documentIngestId !== ingestId) {
      return c.json(
        { error: 'ingestId does not match this session; run upload or crawl again for this session' },
        403
      );
    }
    const loaded = await loadDocumentIngest(DATA_DIR, ingestId);
    if (!loaded) {
      return c.json({ error: 'Unknown or empty ingest; upload or crawl again' }, 400);
    }
    if (taskType === 'web_teach' && loaded.source !== 'web_crawl') {
      return c.json({ error: 'web_teach requires an ingest produced by POST /api/teach/crawl' }, 400);
    }
    const documentTeach = {
      ingestId,
      maskedDocumentText: loaded.maskedCombinedText,
      sourceFiles: loaded.sourceFiles,
      focusNote: body.focusNote?.trim(),
      ...(loaded.source ? { source: loaded.source } : {}),
      ...(loaded.crawlJob && loaded.seedUrl
        ? {
            crawlSummary: {
              seedUrl: loaded.seedUrl,
              skippedByRobots: loaded.crawlJob.skippedByRobots,
              skippedByPolicy: loaded.crawlJob.skippedByPolicy,
              skippedBySsr: loaded.crawlJob.skippedBySsr,
              skippedByCap: loaded.crawlJob.skippedByCap,
              pagesFetched: loaded.crawlJob.pagesFetched,
              assetsFetched: loaded.crawlJob.assetsFetched
            }
          }
        : {})
    };
    if (!description) {
      if (loaded.source === 'web_crawl') {
        description = `Teach from web crawl: ${loaded.seedUrl ?? ingestId}`;
      } else {
        description = `Teach from uploaded documents: ${loaded.sourceFiles.map((f) => f.name).join(', ')}`;
      }
    }
    const { priorTurns } = await sessionStore.appendUser(sessionId, description);
    busy = true;
    void brain
      .runTask(description, taskType, {
        sessionId,
        priorSessionTurns: priorTurns,
        documentTeach
      })
      .then(async (r) => {
        try {
          if (r.status === 'completed' && r.finalResult) {
            await sessionStore.appendAssistant(sessionId, r.finalResult.slice(0, 6000));
          } else if (r.status === 'error' && r.error) {
            await sessionStore.appendAssistant(sessionId, `[Brain error] ${r.error}`);
          }
        } catch (e) {
          console.error('session appendAssistant failed', e);
        }
      })
      .catch((e) => console.error('runTask failed', e))
      .finally(() => {
        busy = false;
      });
    return c.json({ accepted: true, sessionId });
  }

  const sessionId = body.sessionId?.trim() || randomUUID();
  if (!description) {
    return c.json({ error: 'description is required' }, 400);
  }

  const { priorTurns } = await sessionStore.appendUser(sessionId, description);
  busy = true;
  void brain
    .runTask(description, taskType, {
      sessionId,
      priorSessionTurns: priorTurns
    })
    .then(async (r) => {
      try {
        if (r.status === 'completed' && r.finalResult) {
          await sessionStore.appendAssistant(sessionId, r.finalResult.slice(0, 6000));
        } else if (r.status === 'error' && r.error) {
          await sessionStore.appendAssistant(sessionId, `[Brain error] ${r.error}`);
        }
      } catch (e) {
        console.error('session appendAssistant failed', e);
      }
    })
    .catch((e) => console.error('runTask failed', e))
    .finally(() => {
      busy = false;
    });
  return c.json({ accepted: true, sessionId });
});

app.post('/api/interventions/:id/approve', async (c) => {
  const id = c.req.param('id');
  const body = (await c.req.json<{ humanInstruction?: string }>().catch(() => ({}))) as {
    humanInstruction?: string;
  };
  try {
    brain.submitHumanAction(id, { type: 'approve', humanInstruction: body.humanInstruction });
    return c.json({ ok: true });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 400);
  }
});

app.post('/api/interventions/:id/inject', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json<{ humanInstruction?: string }>();
  const hi = body.humanInstruction?.trim();
  if (!hi) return c.json({ error: 'humanInstruction is required' }, 400);
  try {
    brain.submitHumanAction(id, { type: 'inject_context', humanInstruction: hi });
    return c.json({ ok: true });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 400);
  }
});

app.post('/api/interventions/:id/clarify', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json<{
    answers?: string;
    confirmedAssumptions?: unknown;
    confirmedConstraints?: unknown;
  }>();
  const answers = typeof body.answers === 'string' ? body.answers.trim() : '';
  const confirmedAssumptions = Array.isArray(body.confirmedAssumptions)
    ? body.confirmedAssumptions
        .filter((x): x is string => typeof x === 'string' && x.trim() !== '')
        .map((s) => s.trim())
    : [];
  const confirmedConstraints = Array.isArray(body.confirmedConstraints)
    ? body.confirmedConstraints
        .filter((x): x is string => typeof x === 'string' && x.trim() !== '')
        .map((s) => s.trim())
    : [];
  if (!answers && confirmedAssumptions.length === 0 && confirmedConstraints.length === 0) {
    return c.json(
      {
        error:
          'Provide written answers and/or at least one confirmed assumption or constraint (see Human review UI).'
      },
      400
    );
  }
  try {
    brain.submitHumanAction(id, {
      type: 'clarification_reply',
      answers,
      ...(confirmedAssumptions.length ? { confirmedAssumptions } : {}),
      ...(confirmedConstraints.length ? { confirmedConstraints } : {})
    });
    return c.json({ ok: true });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 400);
  }
});

app.post('/api/interventions/:id/override', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json<{ outcome?: 'success' | 'failure'; failureReason?: string }>();
  if (!body.outcome) return c.json({ error: 'outcome is required' }, 400);
  try {
    brain.submitHumanAction(id, {
      type: 'override_outcome',
      outcome: body.outcome,
      failureReason: body.failureReason
    });
    return c.json({ ok: true });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 400);
  }
});

app.patch('/api/memory/:id', async (c) => {
  const id = c.req.param('id');
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const patch: {
    result?: string;
    interpretedGoal?: string;
    primaryCategory?: string;
    categories?: string[];
    canonicalQuery?: string;
    failureReason?: string;
    successScore?: number;
    tags?: string[];
  } = {};
  if (typeof body.result === 'string') patch.result = body.result;
  if (typeof body.interpretedGoal === 'string') patch.interpretedGoal = body.interpretedGoal;
  if (typeof body.primaryCategory === 'string') patch.primaryCategory = body.primaryCategory;
  if (Array.isArray(body.categories)) {
    patch.categories = body.categories.filter((c): c is string => typeof c === 'string');
  }
  if (typeof body.canonicalQuery === 'string') patch.canonicalQuery = body.canonicalQuery;
  if (body.failureReason === null || typeof body.failureReason === 'string') {
    patch.failureReason = body.failureReason ?? undefined;
  }
  if (typeof body.successScore === 'number' && Number.isFinite(body.successScore)) {
    patch.successScore = Math.max(0, Math.min(1, body.successScore));
  }
  if (Array.isArray(body.tags)) {
    const tags = body.tags.filter((t): t is string => typeof t === 'string');
    patch.tags = tags;
  }
  if (Object.keys(patch).length === 0) {
    return c.json({ error: 'No valid fields to update' }, 400);
  }
  const updated = await brain.updateOutcomeMemory(id, patch);
  if (!updated) return c.json({ error: 'Outcome not found' }, 404);
  return c.json({ ok: true, updated });
});

app.post('/api/memory/:id/teach', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json<{ outcome?: 'success' | 'failure'; failureReason?: string }>();
  if (!body.outcome) return c.json({ error: 'outcome is required' }, 400);
  const updated = await brain.teachOutcome(id, body.outcome, body.failureReason);
  if (!updated) return c.json({ error: 'Outcome not found' }, 404);
  return c.json({ ok: true, updated });
});

app.get('/api/events', async (c) => {
  return streamSSE(c, async (stream) => {
    await stream.writeSSE({
      data: JSON.stringify({ type: 'state', state: brain.getState() })
    });

    const unsub = brain.subscribe(async (ev) => {
      await stream.writeSSE({ data: JSON.stringify(ev) });
    });

    await new Promise<void>((resolve) => {
      c.req.raw.signal.addEventListener('abort', () => resolve(), { once: true });
    });
    unsub();
  });
});

serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`Brain API listening on http://localhost:${info.port}`);
});
