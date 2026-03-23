<script lang="ts">
  import type { ComplianceAuditEntry } from '../lib/types.js';
  import { previewText } from '../lib/format.js';

  let {
    entries = [] as ComplianceAuditEntry[],
    openDetail
  } = $props<{
    entries: ComplianceAuditEntry[];
    openDetail: (title: string, body: string, meta?: string | null) => void;
  }>();

  function expand(a: ComplianceAuditEntry) {
    const meta = JSON.stringify(
      {
        id: a.id,
        timestamp: a.timestamp,
        direction: a.direction,
        piiDetected: a.piiDetected,
        categories: a.categories,
        redactionCount: a.redactionCount
      },
      null,
      2
    );
    openDetail(`Audit · ${a.direction} · ${a.id}`, a.maskedExcerpt, meta);
  }
</script>

<section class="card">
  <header class="head">
    <h2>Law 25 audit</h2>
    <span class="meta">Masked · {entries.length} rows</span>
  </header>
  <ul class="list">
    {#each entries as a (a.id)}
      <li class="row">
        <button type="button" class="row-btn" onclick={() => expand(a)}>
          <div class="top">
            <span class="dir">{a.direction}</span>
            <time datetime={a.timestamp}>{new Date(a.timestamp).toLocaleString()}</time>
          </div>
          <div class="flags">
            {#if a.piiDetected}
              <span class="pill warn">PII</span>
            {:else}
              <span class="pill ok">OK</span>
            {/if}
            <span class="pill">{a.redactionCount}×</span>
            {#each a.categories.slice(0, 3) as c}
              <span class="pill subtle">{c}</span>
            {/each}
          </div>
          <p class="excerpt">{previewText(a.maskedExcerpt, 180)}</p>
          <span class="hint">Open</span>
        </button>
      </li>
    {:else}
      <li class="empty">No compliance events yet.</li>
    {/each}
  </ul>
</section>

<style>
  .card {
    border-radius: 0.5rem;
    background: #141821;
    border: 1px solid #2a2f3a;
  }

  .head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
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
    max-height: min(70vh, 40rem);
    overflow: auto;
  }

  .row {
    margin: 0;
    border-bottom: 1px solid #1f2430;
  }

  .row-btn {
    width: 100%;
    display: grid;
    gap: 0.3rem;
    padding: 0.45rem 0.65rem;
    text-align: left;
    font: inherit;
    color: inherit;
    background: transparent;
    border: none;
    cursor: pointer;
  }

  .row-btn:hover {
    background: #1a1f28;
  }

  .top {
    display: flex;
    justify-content: space-between;
    gap: 0.5rem;
    font-size: 0.72rem;
    color: #9a9aaa;
  }

  .dir {
    text-transform: uppercase;
    letter-spacing: 0.04em;
    font-weight: 600;
    color: #c9cad8;
  }

  .flags {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem;
  }

  .pill {
    font-size: 0.65rem;
    padding: 0.08rem 0.35rem;
    border-radius: 999px;
    border: 1px solid #333;
    color: #dfe0ea;
  }

  .warn {
    border-color: #ff9b6a;
    color: #ffd7c4;
  }

  .ok {
    border-color: #4dd0a3;
    color: #c6ffe8;
  }

  .subtle {
    opacity: 0.75;
  }

  .excerpt {
    margin: 0;
    font-size: 0.78rem;
    color: #c4c6d4;
    line-height: 1.35;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    line-clamp: 2;
    -webkit-line-clamp: 2;
    overflow: hidden;
  }

  .hint {
    font-size: 0.65rem;
    color: #6b7390;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    justify-self: end;
  }

  .empty {
    padding: 0.85rem;
    color: #8c8c9a;
    font-size: 0.85rem;
  }
</style>
