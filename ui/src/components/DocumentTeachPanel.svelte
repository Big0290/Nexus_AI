<script lang="ts">
  import { postDocumentTeachTask, postTeachUpload } from '../lib/api.js';
  import { summarizeBrainError } from '../lib/brain-errors.js';

  const SESSION_KEY = 'nexus_brain_session_id';

  let fileInput = $state<HTMLInputElement | null>(null);
  let focusNote = $state('');
  let description = $state('');
  let busy = $state(false);
  let err = $state<string | null>(null);
  let lastIngest = $state<{ ingestId: string; maskedTextChars: number } | null>(null);
  let sessionId = $state<string | null>(null);

  $effect(() => {
    if (typeof localStorage === 'undefined') return;
    const s = localStorage.getItem(SESSION_KEY);
    if (s) sessionId = s;
  });

  function ensureSessionId(): string {
    if (sessionId?.trim()) return sessionId.trim();
    const id = crypto.randomUUID();
    sessionId = id;
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(SESSION_KEY, id);
    }
    return id;
  }

  async function onUploadAndRun(e: Event) {
    e.preventDefault();
    err = null;
    const files = fileInput?.files;
    if (!files?.length) {
      err = 'Choose one or more files (PDF, Excel, CSV, images, text).';
      return;
    }
    busy = true;
    lastIngest = null;
    try {
      const sid = ensureSessionId();
      const up = await postTeachUpload(files, sid);
      sessionId = up.sessionId;
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(SESSION_KEY, up.sessionId);
      }
      lastIngest = { ingestId: up.ingestId, maskedTextChars: up.maskedTextChars };
      const r = await postDocumentTeachTask({
        ingestId: up.ingestId,
        description: description.trim() || undefined,
        focusNote: focusNote.trim() || undefined,
        sessionId: up.sessionId
      });
      sessionId = r.sessionId;
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(SESSION_KEY, r.sessionId);
      }
      if (fileInput) fileInput.value = '';
    } catch (x) {
      const raw = x instanceof Error ? x.message : String(x);
      const s = summarizeBrainError(raw);
      err = `${s.title}: ${s.hint}`;
    } finally {
      busy = false;
    }
  }
</script>

<section class="card">
  <header class="head">
    <h2>Teach from documents</h2>
    <span class="meta">Upload → Law 25 mask → learner specialist → memory</span>
  </header>
  <form class="form" onsubmit={onUploadAndRun}>
    <label class="f">
      Optional task label
      <input
        type="text"
        bind:value={description}
        placeholder="e.g. Summarize Q3 vendor contracts"
        autocomplete="off"
      />
    </label>
    <label class="f">
      Focus / questions (optional)
      <input
        type="text"
        bind:value={focusNote}
        placeholder="What should the learner emphasize?"
        autocomplete="off"
      />
    </label>
    <label class="f">
      Files
      <input bind:this={fileInput} type="file" multiple accept=".pdf,.csv,.xlsx,.xls,.txt,.md,image/*" />
    </label>
    <button type="submit" class="send" disabled={busy}>Upload &amp; learn</button>
  </form>
  {#if lastIngest}
    <p class="ok">
      Started ingest <code>{lastIngest.ingestId}</code> · {lastIngest.maskedTextChars} chars masked text.
    </p>
  {/if}
  {#if err}
    <p class="err" role="alert">{err}</p>
  {/if}
</section>

<style>
  .card {
    border-radius: 0.5rem;
    background: #141821;
    border: 1px solid #2a2f3a;
    padding: 0.65rem 0.75rem;
    display: grid;
    gap: 0.5rem;
  }

  .head {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    align-items: baseline;
    gap: 0.35rem;
  }

  h2 {
    margin: 0;
    font-size: 0.95rem;
    font-weight: 600;
  }

  .meta {
    font-size: 0.72rem;
    color: #8c8c9a;
  }

  .form {
    display: grid;
    gap: 0.45rem;
  }

  .f {
    display: grid;
    gap: 0.2rem;
    font-size: 0.72rem;
    color: #9a9db0;
  }

  input[type='text'],
  input[type='file'] {
    font: inherit;
    font-size: 0.82rem;
  }

  input[type='text'] {
    padding: 0.4rem 0.5rem;
    border-radius: 0.35rem;
    border: 1px solid #2f3542;
    background: #0f1115;
    color: #e8e8ec;
  }

  .send {
    font: inherit;
    font-size: 0.85rem;
    padding: 0.45rem 0.85rem;
    border-radius: 0.35rem;
    border: 1px solid #2a6b5e;
    background: #1a2e28;
    color: #c6ffe8;
    cursor: pointer;
    width: fit-content;
  }

  .send:disabled {
    opacity: 0.5;
    cursor: wait;
  }

  .ok {
    margin: 0;
    font-size: 0.78rem;
    color: #9ed9b8;
  }

  code {
    font-size: 0.72rem;
    word-break: break-all;
  }

  .err {
    margin: 0;
    font-size: 0.82rem;
    color: #ff8b7a;
  }
</style>
