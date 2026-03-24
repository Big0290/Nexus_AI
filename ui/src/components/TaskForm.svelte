<script lang="ts">
  import { postTask } from '../lib/api.js';
  import { summarizeBrainError } from '../lib/brain-errors.js';

  const SESSION_KEY = 'nexus_brain_session_id';

  let description = $state('');
  let taskType = $state('general');
  let busy = $state(false);
  let errorTitle = $state<string | null>(null);
  let errorHint = $state<string | null>(null);
  let sessionId = $state<string | null>(null);

  $effect(() => {
    if (typeof localStorage === 'undefined') return;
    const s = localStorage.getItem(SESSION_KEY);
    if (s) sessionId = s;
  });

  async function submit(e: Event) {
    e.preventDefault();
    errorTitle = null;
    errorHint = null;
    busy = true;
    try {
      const r = await postTask(description, taskType, sessionId);
      sessionId = r.sessionId;
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(SESSION_KEY, r.sessionId);
      }
      description = '';
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      const s = summarizeBrainError(raw);
      errorTitle = s.title;
      errorHint = `${s.hint}\n\n(${raw})`;
    } finally {
      busy = false;
    }
  }

  function newSession() {
    sessionId = null;
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(SESSION_KEY);
    }
  }
</script>

<form class="task-form" onsubmit={submit}>
  <div class="row">
    <label class="type">
      Type
      <input name="taskType" bind:value={taskType} placeholder="general" autocomplete="off" />
    </label>
    <label class="desc">
      Task
      <textarea
        name="description"
        rows="2"
        bind:value={description}
        placeholder="What should the Brain do?"
      ></textarea>
    </label>
    <button type="submit" class="send" disabled={busy || !description.trim()}>Run</button>
  </div>
  <div class="session-row">
    {#if sessionId}
      <span class="sess" title={sessionId}>Session: {sessionId.slice(0, 8)}…</span>
      <button type="button" class="newsess" onclick={newSession}>New session</button>
    {:else}
      <span class="sess dim">New session id on first run</span>
    {/if}
  </div>
  {#if errorTitle}
    <div class="err-box" role="alert">
      <strong class="err-title">{errorTitle}</strong>
      {#if errorHint}
        <p class="err-hint">{errorHint}</p>
      {/if}
    </div>
  {/if}
</form>

<style>
  .task-form {
    display: grid;
    gap: 0.5rem;
  }

  .row {
    display: grid;
    gap: 0.45rem;
    align-items: end;
    grid-template-columns: 1fr;
  }

  @media (min-width: 640px) {
    .row {
      grid-template-columns: 7.5rem minmax(0, 1fr) auto;
    }
  }

  label {
    display: grid;
    gap: 0.2rem;
    font-size: 0.72rem;
    color: var(--text-muted, #8b92a8);
  }

  input,
  textarea {
    font: inherit;
    font-size: 0.85rem;
    padding: 0.45rem 0.55rem;
    border-radius: var(--radius-sm, 0.35rem);
    border: 1px solid var(--border);
    background: var(--bg-subtle, #0f1219);
    color: var(--text);
    width: 100%;
    box-sizing: border-box;
    resize: vertical;
    min-height: 2.4rem;
  }

  input:focus,
  textarea:focus {
    outline: none;
    border-color: color-mix(in srgb, var(--accent) 55%, var(--border));
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent) 25%, transparent);
  }

  .send {
    font: inherit;
    font-size: 0.85rem;
    font-weight: 600;
    padding: 0.5rem 1rem;
    border-radius: var(--radius-sm);
    border: 1px solid var(--accent-border);
    background: linear-gradient(180deg, color-mix(in srgb, var(--accent) 85%, #1a3a8a) 0%, #2a4ab0 100%);
    color: #fff;
    cursor: pointer;
    height: fit-content;
  }

  .send:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  .err-box {
    margin: 0;
    padding: 0.5rem 0.55rem;
    border-radius: var(--radius-sm);
    border: 1px solid color-mix(in srgb, var(--danger) 45%, var(--border));
    background: var(--danger-soft);
  }

  .err-title {
    display: block;
    font-size: 0.82rem;
    color: color-mix(in srgb, var(--danger) 90%, white);
    margin-bottom: 0.35rem;
  }

  .err-hint {
    margin: 0;
    color: var(--text-muted);
    font-size: 0.78rem;
    line-height: 1.45;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .session-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.72rem;
    color: var(--text-muted);
    padding-top: 0.15rem;
    border-top: 1px dashed color-mix(in srgb, var(--border) 80%, transparent);
  }

  .sess {
    font-family: ui-monospace, monospace;
    word-break: break-all;
  }

  .sess.dim {
    color: var(--text-dim);
  }

  .newsess {
    font: inherit;
    font-size: 0.72rem;
    padding: 0.2rem 0.5rem;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border);
    background: var(--surface-elevated);
    color: var(--text-muted);
    cursor: pointer;
  }

  .newsess:hover {
    border-color: var(--border-strong);
    color: var(--text);
  }
</style>
