<script lang="ts">
  import type { ThoughtStreamEntry } from '../lib/types.js';
  import { previewText } from '../lib/format.js';

  let {
    entries = [] as ThoughtStreamEntry[],
    openDetail
  } = $props<{
    entries: ThoughtStreamEntry[];
    openDetail: (title: string, body: string, meta?: string | null) => void;
  }>();

  const phaseClass = (phase: ThoughtStreamEntry['phase']): string => {
    const map: Record<ThoughtStreamEntry['phase'], string> = {
      ingest: 'ph-ingest',
      recall: 'ph-recall',
      strategy: 'ph-strategy',
      compliance: 'ph-compliance',
      spawn: 'ph-spawn',
      reflection: 'ph-reflection',
      hitl: 'ph-hitl'
    };
    return map[phase];
  };

  function expand(e: ThoughtStreamEntry) {
    const meta = e.metadata ? JSON.stringify(e.metadata, null, 2) : null;
    openDetail(`${e.phase} · ${e.id}`, e.message, meta);
  }
</script>

<section class="card">
  <header class="head">
    <h2>Thought stream</h2>
    <span class="meta">{entries.length} events · click row for full</span>
  </header>
  <ul class="list">
    {#each entries as e (e.id)}
      <li class="row">
        <button type="button" class="row-btn" onclick={() => expand(e)}>
          <span class={'badge ' + phaseClass(e.phase)}>{e.phase}</span>
          <time datetime={e.timestamp}>{new Date(e.timestamp).toLocaleTimeString()}</time>
          <p class="msg clamp">{previewText(e.message, 160)}</p>
          <span class="hint">Open</span>
        </button>
      </li>
    {:else}
      <li class="empty">Waiting for Brain activity…</li>
    {/each}
  </ul>
</section>

<style>
  .card {
    border-radius: 0.5rem;
    background: #141821;
    border: 1px solid #2a2f3a;
    overflow: hidden;
  }

  .head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.5rem;
    padding: 0.55rem 0.75rem;
    border-bottom: 1px solid #2a2f3a;
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

  .list {
    list-style: none;
    margin: 0;
    padding: 0;
    max-height: min(70vh, 36rem);
    overflow: auto;
  }

  .row {
    margin: 0;
    border-bottom: 1px solid #1f2430;
  }

  .row-btn {
    width: 100%;
    display: grid;
    grid-template-columns: auto auto 1fr auto;
    gap: 0.4rem 0.6rem;
    align-items: start;
    padding: 0.45rem 0.65rem;
    text-align: left;
    font: inherit;
    color: inherit;
    background: transparent;
    border: none;
    cursor: pointer;
    border-radius: 0;
  }

  .row-btn:hover {
    background: #1a1f28;
  }

  time {
    font-size: 0.72rem;
    color: #7a7a8c;
    white-space: nowrap;
  }

  .msg {
    margin: 0;
    grid-column: 1 / -1;
    font-size: 0.82rem;
    color: #d8dae8;
  }

  @media (min-width: 560px) {
    .msg {
      grid-column: auto;
    }
    .row-btn {
      grid-template-columns: auto auto minmax(0, 1fr) auto;
    }
  }

  .clamp {
    display: -webkit-box;
    -webkit-box-orient: vertical;
    line-clamp: 3;
    -webkit-line-clamp: 3;
    overflow: hidden;
  }

  .hint {
    font-size: 0.7rem;
    color: #6b7390;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .badge {
    font-size: 0.65rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding: 0.12rem 0.35rem;
    border-radius: 0.25rem;
    border: 1px solid #333;
    color: #dfe0ea;
  }

  .ph-ingest {
    border-color: #7ae9ff;
    color: #c5f6ff;
  }

  .ph-recall {
    border-color: #5b8def;
    color: #b6d0ff;
  }
  .ph-strategy {
    border-color: #c9a24d;
    color: #ffe6a8;
  }
  .ph-compliance {
    border-color: #4dd0a3;
    color: #c6ffe8;
  }
  .ph-spawn {
    border-color: #c07dff;
    color: #ead4ff;
  }
  .ph-reflection {
    border-color: #ff9b6a;
    color: #ffd7c4;
  }
  .ph-hitl {
    border-color: #ff6b8a;
    color: #ffc2cf;
  }

  .empty {
    padding: 0.85rem;
    color: #8c8c9a;
    font-size: 0.85rem;
  }
</style>
