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

<form class="card" onsubmit={submit}>
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
  .card {
    display: grid;
    gap: 0.45rem;
    padding: 0.65rem 0.75rem;
    border-radius: 0.5rem;
    background: #141821;
    border: 1px solid #2a2f3a;
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
    color: #9a9db0;
  }

  input,
  textarea {
    font: inherit;
    font-size: 0.85rem;
    padding: 0.4rem 0.5rem;
    border-radius: 0.35rem;
    border: 1px solid #2f3542;
    background: #0f1115;
    color: #e8e8ec;
    width: 100%;
    box-sizing: border-box;
    resize: vertical;
    min-height: 2.4rem;
  }

  .send {
    font: inherit;
    font-size: 0.85rem;
    padding: 0.45rem 0.85rem;
    border-radius: 0.35rem;
    border: 1px solid #3d6df4;
    background: #2f4fd4;
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
    padding: 0.45rem 0.5rem;
    border-radius: 0.35rem;
    border: 1px solid #5c2a2a;
    background: #1a1418;
  }

  .err-title {
    display: block;
    font-size: 0.82rem;
    color: #ffb4a8;
    margin-bottom: 0.35rem;
  }

  .err-hint {
    margin: 0;
    color: #d8c4c0;
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
    color: #8b8fa3;
  }

  .sess {
    font-family: ui-monospace, monospace;
    word-break: break-all;
  }

  .sess.dim {
    color: #6b7080;
  }

  .newsess {
    font: inherit;
    font-size: 0.72rem;
    padding: 0.15rem 0.45rem;
    border-radius: 0.3rem;
    border: 1px solid #3a4150;
    background: #1a1f28;
    color: #c9cad8;
    cursor: pointer;
  }
</style>
