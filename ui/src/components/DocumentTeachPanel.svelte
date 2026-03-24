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

<div class="teach">
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
</div>

<style>
  .teach {
    display: grid;
    gap: 0.5rem;
  }

  .form {
    display: grid;
    gap: 0.5rem;
  }

  .f {
    display: grid;
    gap: 0.2rem;
    font-size: 0.72rem;
    color: var(--text-muted, #8b92a8);
  }

  input[type='text'],
  input[type='file'] {
    font: inherit;
    font-size: 0.82rem;
  }

  input[type='text'] {
    padding: 0.45rem 0.55rem;
    border-radius: var(--radius-sm, 0.35rem);
    border: 1px solid var(--border);
    background: var(--bg-subtle, #0f1219);
    color: var(--text);
  }

  input[type='text']:focus {
    outline: none;
    border-color: color-mix(in srgb, var(--teal) 50%, var(--border));
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--teal) 22%, transparent);
  }

  .send {
    font: inherit;
    font-size: 0.85rem;
    font-weight: 600;
    padding: 0.5rem 1rem;
    border-radius: var(--radius-sm);
    border: 1px solid color-mix(in srgb, var(--teal) 55%, var(--border));
    background: linear-gradient(180deg, color-mix(in srgb, var(--teal) 35%, #14302a) 0%, #1a3d34 100%);
    color: #d4fff0;
    cursor: pointer;
    width: fit-content;
  }

  .send:hover:not(:disabled) {
    filter: brightness(1.06);
  }

  .send:disabled {
    opacity: 0.5;
    cursor: wait;
  }

  .ok {
    margin: 0;
    font-size: 0.78rem;
    color: var(--success, #45c49a);
    padding: 0.4rem 0.5rem;
    border-radius: var(--radius-sm);
    background: var(--teal-soft);
    border: 1px solid color-mix(in srgb, var(--teal) 30%, var(--border));
  }

  code {
    font-size: 0.72rem;
    word-break: break-all;
    color: var(--text-muted);
  }

  .err {
    margin: 0;
    font-size: 0.82rem;
    color: color-mix(in srgb, var(--danger) 95%, white);
  }
</style>
