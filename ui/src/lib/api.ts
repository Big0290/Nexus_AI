async function errorBody(res: Response): Promise<string> {
  const t = await res.text();
  try {
    const j = JSON.parse(t) as { error?: string };
    if (typeof j?.error === 'string' && j.error.trim()) return j.error.trim();
  } catch {
    /* not JSON */
  }
  return t.trim() || `${res.status} ${res.statusText}`;
}

function apiKeyHeaders(): Record<string, string> {
  if (typeof localStorage === 'undefined') return {};
  const key = localStorage.getItem('nexus_api_key')?.trim();
  if (!key) return {};
  return { Authorization: `Bearer ${key}` };
}

function eventsUrl(): string {
  const key = typeof localStorage !== 'undefined' ? localStorage.getItem('nexus_api_key')?.trim() : '';
  if (key) return `/api/events?api_key=${encodeURIComponent(key)}`;
  return '/api/events';
}

export async function fetchHealth(): Promise<unknown> {
  const res = await fetch('/api/health', { headers: { ...apiKeyHeaders() } });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function fetchSession(sessionId: string): Promise<{ session: unknown }> {
  const res = await fetch(`/api/session/${encodeURIComponent(sessionId)}`, { headers: { ...apiKeyHeaders() } });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(t || res.statusText);
  }
  return res.json() as Promise<{ session: unknown }>;
}

export function connectBrainEvents(
  onEvent: (ev: { type: string; state?: unknown; entry?: unknown; result?: unknown }) => void,
  onError?: (e: Event) => void
): () => void {
  const es = new EventSource(eventsUrl());
  es.onmessage = (msg) => {
    try {
      const data = JSON.parse(msg.data) as { type: string; state?: unknown; entry?: unknown; result?: unknown };
      onEvent(data);
    } catch {
      /* ignore parse errors */
    }
  };
  es.onerror = (e) => onError?.(e);
  return () => es.close();
}

export async function postTask(
  description: string,
  taskType: string,
  sessionId?: string | null,
  opts?: { ingestId?: string; focusNote?: string }
): Promise<{ sessionId: string }> {
  const res = await fetch('/api/tasks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...apiKeyHeaders() },
    body: JSON.stringify({
      description,
      taskType,
      ...(sessionId ? { sessionId } : {}),
      ...(opts?.ingestId ? { ingestId: opts.ingestId } : {}),
      ...(opts?.focusNote?.trim() ? { focusNote: opts.focusNote.trim() } : {})
    })
  });
  if (!res.ok) {
    const j = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(j.error ?? res.statusText);
  }
  return res.json() as Promise<{ sessionId: string; accepted?: boolean }>;
}

export async function postTeachUpload(
  files: FileList | File[],
  sessionId?: string | null
): Promise<{
  ingestId: string;
  sessionId: string;
  maskedTextChars: number;
  sourceFiles: { name: string; mime: string }[];
}> {
  const fd = new FormData();
  if (sessionId?.trim()) {
    fd.append('sessionId', sessionId.trim());
  }
  for (const f of Array.from(files)) {
    fd.append('files', f);
  }
  const res = await fetch('/api/teach/upload', {
    method: 'POST',
    headers: { ...apiKeyHeaders() },
    body: fd
  });
  if (!res.ok) {
    throw new Error(await errorBody(res));
  }
  return res.json() as Promise<{
    ingestId: string;
    sessionId: string;
    maskedTextChars: number;
    sourceFiles: { name: string; mime: string }[];
  }>;
}

export async function postDocumentTeachTask(opts: {
  ingestId: string;
  description?: string;
  focusNote?: string;
  sessionId?: string | null;
}): Promise<{ sessionId: string }> {
  return postTask(opts.description ?? '', 'document_teach', opts.sessionId, {
    ingestId: opts.ingestId,
    focusNote: opts.focusNote
  });
}

export async function approveIntervention(id: string, humanInstruction?: string): Promise<void> {
  const res = await fetch(`/api/interventions/${encodeURIComponent(id)}/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...apiKeyHeaders() },
    body: JSON.stringify({ humanInstruction })
  });
  if (!res.ok) throw new Error(await res.text());
}

export async function injectIntervention(id: string, humanInstruction: string): Promise<void> {
  const res = await fetch(`/api/interventions/${encodeURIComponent(id)}/inject`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...apiKeyHeaders() },
    body: JSON.stringify({ humanInstruction })
  });
  if (!res.ok) throw new Error(await res.text());
}

export async function overrideIntervention(
  id: string,
  outcome: 'success' | 'failure',
  failureReason?: string
): Promise<void> {
  const res = await fetch(`/api/interventions/${encodeURIComponent(id)}/override`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...apiKeyHeaders() },
    body: JSON.stringify({ outcome, failureReason })
  });
  if (!res.ok) throw new Error(await res.text());
}

export async function teachOutcome(
  outcomeId: string,
  outcome: 'success' | 'failure',
  failureReason?: string
): Promise<void> {
  const res = await fetch(`/api/memory/${encodeURIComponent(outcomeId)}/teach`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...apiKeyHeaders() },
    body: JSON.stringify({ outcome, failureReason })
  });
  if (!res.ok) throw new Error(await errorBody(res));
}

export async function fetchAudit(limit = 80): Promise<{ entries: unknown[] }> {
  const res = await fetch(`/api/audit?limit=${limit}`, { headers: { ...apiKeyHeaders() } });
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<{ entries: unknown[] }>;
}

export async function fetchMemory(
  limit = 40,
  opts?: { category?: string; tag?: string; q?: string }
): Promise<{ outcomes: unknown[] }> {
  const p = new URLSearchParams();
  p.set('limit', String(limit));
  if (opts?.category?.trim()) p.set('category', opts.category.trim());
  if (opts?.tag?.trim()) p.set('tag', opts.tag.trim());
  if (opts?.q?.trim()) p.set('q', opts.q.trim());
  const res = await fetch(`/api/memory?${p}`, { headers: { ...apiKeyHeaders() } });
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<{ outcomes: unknown[] }>;
}

export async function fetchMemoryMeta(): Promise<{ categories: string[]; tags: string[] }> {
  const res = await fetch('/api/memory/meta', { headers: { ...apiKeyHeaders() } });
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<{ categories: string[]; tags: string[] }>;
}

export async function submitClarification(id: string, answers: string): Promise<void> {
  const res = await fetch(`/api/interventions/${encodeURIComponent(id)}/clarify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...apiKeyHeaders() },
    body: JSON.stringify({ answers })
  });
  if (!res.ok) throw new Error(await res.text());
}

/** Latest orchestrator snapshot (same as SSE `state` events). Use after mutations if the event stream is stale. */
export async function fetchOrchestratorState(): Promise<unknown> {
  const res = await fetch('/api/state', { headers: { ...apiKeyHeaders() } });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
