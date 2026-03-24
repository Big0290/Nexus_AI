<script lang="ts">
  import type { TaskRunResult } from '../lib/types.js';

  type LastRunSnapshot = TaskRunResult & { receivedAt: string };

  let {
    result,
    onClear,
    onGoKnowledge,
    onGoReview
  } = $props<{
    result: LastRunSnapshot | null;
    onClear?: () => void;
    onGoKnowledge?: () => void;
    onGoReview?: () => void;
  }>();

  let copied = $state(false);
  let copyTimer: ReturnType<typeof setTimeout> | null = null;

  function formatBody(text: string): { mode: 'json'; body: string } | { mode: 'text'; body: string } {
    const t = text.trim();
    if (!t) return { mode: 'text', body: '' };
    const looksJson =
      (t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']'));
    if (looksJson) {
      try {
        const j = JSON.parse(t) as unknown;
        return { mode: 'json', body: JSON.stringify(j, null, 2) };
      } catch {
        /* keep as text */
      }
    }
    return { mode: 'text', body: text };
  }

  async function copyResult() {
    const text = result?.finalResult?.trim();
    if (!text || typeof navigator?.clipboard?.writeText !== 'function') return;
    try {
      await navigator.clipboard.writeText(text);
      copied = true;
      if (copyTimer) clearTimeout(copyTimer);
      copyTimer = setTimeout(() => {
        copied = false;
      }, 2000);
    } catch {
      /* ignore */
    }
  }

  function timeLabel(iso: string): string {
    try {
      return new Date(iso).toLocaleString();
    } catch {
      return iso;
    }
  }
</script>

{#if result}
  <section
    class="last-run"
    class:status-ok={result.status === 'completed'}
    class:status-err={result.status === 'error'}
    class:status-hitl={result.status === 'awaiting_human'}
    aria-label="Last run result"
  >
    <header class="head">
      <div class="titles">
        <h2 class="h">Last run result</h2>
        <p class="sub">
          <span class="badge" data-status={result.status}>{result.status}</span>
          <span class="meta" title={result.taskId}>Task <code>{result.taskId}</code></span>
          <span class="meta dim">{timeLabel(result.receivedAt)}</span>
        </p>
      </div>
      <div class="actions">
        {#if result.finalResult?.trim()}
          <button type="button" class="btn" onclick={() => void copyResult()}>
            {copied ? 'Copied' : 'Copy output'}
          </button>
        {/if}
        {#if onClear}
          <button type="button" class="btn ghost" onclick={onClear}>Dismiss</button>
        {/if}
      </div>
    </header>

    {#if result.outcomeMemoryId}
      <p class="memory-hint">
        Logged to outcome memory
        <code class="om-id">{result.outcomeMemoryId}</code>
        {#if onGoKnowledge}
          <button type="button" class="linkish" onclick={onGoKnowledge}>Open Knowledge</button>
        {/if}
      </p>
    {/if}

    {#if result.status === 'error' && result.error}
      <div class="err-block" role="alert">
        <strong>Error</strong>
        <pre class="err-pre">{result.error}</pre>
      </div>
    {/if}

    {#if result.status === 'awaiting_human'}
      <p class="hitl-note">
        This run needs human input. Use <strong>Review → Human review</strong> to continue.
        {#if onGoReview}
          <button type="button" class="linkish" onclick={onGoReview}>Open interventions</button>
        {/if}
      </p>
      {#if result.intervention}
        <pre class="intervention-pre">{JSON.stringify(result.intervention, null, 2)}</pre>
      {/if}
    {/if}

    {#if result.finalResult != null && result.finalResult !== ''}
      {@const fmt = formatBody(result.finalResult)}
      <div class="body-wrap" class:json={fmt.mode === 'json'}>
        <div class="body-toolbar">
          <span class="fmt-label">{fmt.mode === 'json' ? 'Formatted JSON' : 'Plain text'}</span>
        </div>
        <pre class="body-pre" class:json={fmt.mode === 'json'}>{fmt.body}</pre>
      </div>
    {:else if result.status === 'completed'}
      <p class="empty-out">No text output (check Knowledge for logged outcome).</p>
    {/if}
  </section>
{/if}

<style>
  .last-run {
    border-radius: var(--radius);
    border: 1px solid var(--border);
    background: var(--surface-elevated);
    padding: 0.75rem 0.85rem 0.85rem;
    display: grid;
    gap: 0.55rem;
    box-shadow: 0 1px 0 color-mix(in srgb, var(--border) 35%, transparent);
  }

  .last-run.status-ok {
    border-color: color-mix(in srgb, var(--success) 35%, var(--border));
    background: linear-gradient(
      165deg,
      color-mix(in srgb, var(--success) 8%, var(--surface-elevated)) 0%,
      var(--surface-elevated) 55%
    );
  }

  .last-run.status-err {
    border-color: color-mix(in srgb, var(--danger) 40%, var(--border));
    background: linear-gradient(
      165deg,
      color-mix(in srgb, var(--danger) 7%, var(--surface-elevated)) 0%,
      var(--surface-elevated) 55%
    );
  }

  .last-run.status-hitl {
    border-color: color-mix(in srgb, var(--phase-hitl) 35%, var(--border));
  }

  .head {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.5rem 1rem;
  }

  .titles {
    min-width: 0;
  }

  .h {
    margin: 0 0 0.25rem;
    font-size: 0.95rem;
    font-weight: 650;
    color: var(--text);
    letter-spacing: -0.02em;
  }

  .sub {
    margin: 0;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.4rem 0.65rem;
    font-size: 0.72rem;
    color: var(--text-muted);
  }

  .badge {
    font-size: 0.62rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    padding: 0.12rem 0.45rem;
    border-radius: 999px;
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--text-muted);
  }

  .badge[data-status='completed'] {
    border-color: color-mix(in srgb, var(--success) 45%, var(--border));
    color: var(--success);
    background: color-mix(in srgb, var(--success) 10%, var(--surface));
  }

  .badge[data-status='error'] {
    border-color: color-mix(in srgb, var(--danger) 45%, var(--border));
    color: color-mix(in srgb, var(--danger) 95%, white);
    background: var(--danger-soft);
  }

  .badge[data-status='awaiting_human'] {
    border-color: color-mix(in srgb, var(--phase-hitl) 45%, var(--border));
    color: var(--phase-hitl);
    background: color-mix(in srgb, var(--phase-hitl) 12%, var(--surface));
  }

  .meta code {
    font-size: 0.68rem;
    word-break: break-all;
  }

  .meta.dim {
    color: var(--text-dim);
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
    align-items: center;
  }

  .btn {
    font: inherit;
    font-size: 0.78rem;
    font-weight: 600;
    padding: 0.35rem 0.65rem;
    border-radius: var(--radius-sm);
    border: 1px solid var(--accent-border);
    background: linear-gradient(180deg, color-mix(in srgb, var(--accent) 80%, #1a3a8a) 0%, #2a4ab0 100%);
    color: #fff;
    cursor: pointer;
  }

  .btn.ghost {
    background: transparent;
    border-color: var(--border);
    color: var(--text-muted);
    font-weight: 500;
  }

  .btn.ghost:hover {
    border-color: var(--border-strong);
    color: var(--text);
  }

  .memory-hint {
    margin: 0;
    font-size: 0.74rem;
    color: var(--text-muted);
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.35rem 0.5rem;
  }

  .om-id {
    font-size: 0.68rem;
    word-break: break-all;
    padding: 0.08rem 0.3rem;
    border-radius: var(--radius-sm);
    background: var(--bg-subtle);
    border: 1px solid var(--border);
  }

  .linkish {
    font: inherit;
    font-size: 0.74rem;
    padding: 0;
    border: none;
    background: none;
    color: var(--accent);
    cursor: pointer;
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  .linkish:hover {
    color: color-mix(in srgb, var(--accent) 85%, white);
  }

  .err-block {
    margin: 0;
    padding: 0.5rem 0.55rem;
    border-radius: var(--radius-sm);
    border: 1px solid color-mix(in srgb, var(--danger) 40%, var(--border));
    background: var(--danger-soft);
    font-size: 0.78rem;
  }

  .err-block strong {
    display: block;
    margin-bottom: 0.35rem;
    color: color-mix(in srgb, var(--danger) 90%, white);
  }

  .err-pre {
    margin: 0;
    white-space: pre-wrap;
    word-break: break-word;
    font-size: 0.76rem;
    line-height: 1.45;
    color: var(--text);
  }

  .hitl-note {
    margin: 0;
    font-size: 0.78rem;
    line-height: 1.45;
    color: var(--text-muted);
  }

  .intervention-pre {
    margin: 0;
    max-height: 10rem;
    overflow: auto;
    padding: 0.45rem 0.5rem;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border);
    background: var(--bg-subtle);
    font-size: 0.68rem;
    line-height: 1.35;
  }

  .body-wrap {
    display: grid;
    gap: 0.25rem;
    min-width: 0;
  }

  .body-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .fmt-label {
    font-size: 0.65rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-dim);
  }

  .body-pre {
    margin: 0;
    max-height: min(50vh, 28rem);
    overflow: auto;
    padding: 0.55rem 0.65rem;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border);
    background: var(--bg);
    font-size: 0.78rem;
    line-height: 1.45;
    white-space: pre-wrap;
    word-break: break-word;
    color: var(--text);
    font-family: ui-monospace, 'Cascadia Code', 'Source Code Pro', Menlo, monospace;
  }

  .body-pre.json {
    white-space: pre;
    word-break: normal;
  }

  .empty-out {
    margin: 0;
    font-size: 0.78rem;
    color: var(--text-dim);
  }
</style>
