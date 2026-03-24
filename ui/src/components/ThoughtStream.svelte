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

  let expanded = $state<Set<string>>(new Set());

  function toggleRow(id: string) {
    const next = new Set(expanded);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    expanded = next;
  }

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

  const phaseLabel = (phase: ThoughtStreamEntry['phase']): string => {
    const map: Record<ThoughtStreamEntry['phase'], string> = {
      ingest: 'Intake',
      recall: 'Memory recall',
      strategy: 'Strategy',
      compliance: 'Law 25 check',
      spawn: 'Specialist',
      reflection: 'Reflection',
      hitl: 'Human review'
    };
    return map[phase];
  };

  type Chip = { k: string; v: string };

  function chipsFromEntry(e: ThoughtStreamEntry): Chip[] {
    const m = e.metadata;
    if (!m || typeof m !== 'object') return [];
    const out: Chip[] = [];
    const add = (k: string, v: unknown) => {
      if (v === undefined || v === null) return;
      if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
        out.push({ k, v: String(v) });
      }
    };
    add('audit', m.auditId);
    add('ingest', m.ingestId);
    add('session', m.sessionId);
    add('request', m.requestId);
    add('confidence', m.confidence !== undefined ? Number(m.confidence).toFixed(2) : undefined);
    if (Array.isArray(m.topMatches) && m.topMatches.length) {
      const first = m.topMatches[0] as { id?: string; label?: string };
      if (first?.id) add('top', `${first.id.slice(0, 12)}…`);
    }
    add('lessons', m.lessonsCount);
    add('payloadChars', m.maskedSpecialistInputChars ?? m.maskedOutputChars);
    if (out.length > 6) return out.slice(0, 6);
    return out;
  }

  function expand(e: ThoughtStreamEntry) {
    const meta = e.metadata ? JSON.stringify(e.metadata, null, 2) : null;
    openDetail(`${phaseLabel(e.phase)} · ${e.id}`, [e.message, e.detail ? `\n\n${e.detail}` : ''].join(''), meta);
  }
</script>

<section class="card stream-card">
  <header class="head">
    <h2>Thought stream</h2>
    <span class="meta">{entries.length} events · expand row or open full</span>
  </header>
  <ul class="list">
    {#each entries as e (e.id)}
      {@const chips = chipsFromEntry(e)}
      <li class="row">
        <div class="row-main">
          <button type="button" class="row-btn" onclick={() => toggleRow(e.id)} aria-expanded={expanded.has(e.id)}>
            <span class={'badge ' + phaseClass(e.phase)} title={e.phase}>{phaseLabel(e.phase)}</span>
            <time datetime={e.timestamp}>{new Date(e.timestamp).toLocaleTimeString()}</time>
            <p class="msg clamp">{previewText(e.message, 200)}</p>
            {#if e.detail}
              <p class="detail clamp">{previewText(e.detail, 120)}</p>
            {/if}
            <span class="hint">{expanded.has(e.id) ? 'Less' : 'More'}</span>
          </button>
          <button type="button" class="open-json" title="Full message and JSON metadata" onclick={() => expand(e)}>
            JSON
          </button>
        </div>
        {#if chips.length}
          <div class="chips" aria-hidden={expanded.has(e.id) ? 'false' : 'true'}>
            {#each chips as c (c.k + c.v)}
              <span class="chip"><span class="ck">{c.k}</span> {previewText(c.v, 48)}</span>
            {/each}
          </div>
        {/if}
        {#if expanded.has(e.id)}
          <div class="expanded">
            {#if e.detail}
              <p class="detail-full"><strong>Summary</strong> · {e.detail}</p>
            {/if}
            <pre class="meta-block">{e.metadata ? JSON.stringify(e.metadata, null, 2) : '—'}</pre>
          </div>
        {/if}
      </li>
    {:else}
      <li class="empty">Waiting for Brain activity…</li>
    {/each}
  </ul>
</section>

<style>
  .stream-card {
    border-radius: var(--radius, 0.5rem);
    background: var(--surface, #12161f);
    border: 1px solid var(--border, #2a3142);
    overflow: hidden;
  }

  .head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.5rem;
    padding: 0.55rem 0.75rem;
    border-bottom: 1px solid var(--border, #2a3142);
  }

  h2 {
    margin: 0;
    font-size: 0.95rem;
    font-weight: 600;
    color: var(--text);
  }

  .meta {
    font-size: 0.72rem;
    color: var(--text-muted, #8b92a8);
  }

  .list {
    list-style: none;
    margin: 0;
    padding: 0;
    max-height: min(72vh, 38rem);
    overflow: auto;
  }

  .row {
    margin: 0;
    border-bottom: 1px solid color-mix(in srgb, var(--border) 80%, transparent);
  }

  .row-main {
    display: flex;
    align-items: stretch;
    gap: 0;
  }

  .row-btn {
    flex: 1;
    min-width: 0;
    display: grid;
    grid-template-columns: auto auto 1fr auto;
    gap: 0.35rem 0.55rem;
    align-items: start;
    padding: 0.5rem 0.6rem;
    text-align: left;
    font: inherit;
    color: inherit;
    background: transparent;
    border: none;
    cursor: pointer;
  }

  .row-btn:hover {
    background: color-mix(in srgb, var(--accent) 6%, var(--surface));
  }

  .open-json {
    flex-shrink: 0;
    font: inherit;
    font-size: 0.65rem;
    padding: 0.35rem 0.45rem;
    margin: 0.35rem 0.45rem 0.35rem 0;
    align-self: start;
    border-radius: var(--radius-sm, 0.35rem);
    border: 1px solid var(--border);
    background: var(--surface-elevated, #161c28);
    color: var(--text-muted);
    cursor: pointer;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .open-json:hover {
    border-color: var(--accent-border, #3d5a9e);
    color: var(--text);
  }

  time {
    font-size: 0.72rem;
    color: var(--text-dim, #6a7088);
    white-space: nowrap;
  }

  .msg {
    margin: 0;
    grid-column: 1 / -1;
    font-size: 0.82rem;
    color: var(--text);
  }

  .detail {
    margin: 0;
    grid-column: 1 / -1;
    font-size: 0.76rem;
    color: var(--text-muted);
  }

  @media (min-width: 560px) {
    .msg,
    .detail {
      grid-column: 3;
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
    font-size: 0.68rem;
    color: var(--text-dim);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem;
    padding: 0 0.65rem 0.4rem 0.65rem;
  }

  .chip {
    font-size: 0.68rem;
    padding: 0.12rem 0.4rem;
    border-radius: 999px;
    background: color-mix(in srgb, var(--accent) 10%, var(--surface));
    border: 1px solid color-mix(in srgb, var(--border) 90%, var(--accent));
    color: var(--text-muted);
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .ck {
    font-weight: 600;
    color: var(--accent);
    margin-right: 0.2rem;
  }

  .expanded {
    padding: 0 0.75rem 0.65rem;
    border-top: 1px dashed color-mix(in srgb, var(--border) 70%, transparent);
  }

  .detail-full {
    margin: 0 0 0.45rem;
    font-size: 0.78rem;
    color: var(--text-muted);
    line-height: 1.4;
  }

  .meta-block {
    margin: 0;
    font-size: 0.68rem;
    line-height: 1.35;
    padding: 0.45rem 0.5rem;
    border-radius: var(--radius-sm);
    background: var(--bg-subtle, #0f1219);
    border: 1px solid var(--border);
    color: var(--text-muted);
    overflow: auto;
    max-height: 14rem;
  }

  .badge {
    font-size: 0.62rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding: 0.14rem 0.38rem;
    border-radius: 0.25rem;
    border: 1px solid var(--border);
    color: var(--text);
    white-space: nowrap;
  }

  .ph-ingest {
    border-color: color-mix(in srgb, var(--phase-ingest, #5ee0ff) 55%, var(--border));
    color: var(--phase-ingest);
  }

  .ph-recall {
    border-color: color-mix(in srgb, var(--phase-recall, #6b9fff) 55%, var(--border));
    color: var(--phase-recall);
  }
  .ph-strategy {
    border-color: color-mix(in srgb, var(--phase-strategy, #e8c06a) 55%, var(--border));
    color: var(--phase-strategy);
  }
  .ph-compliance {
    border-color: color-mix(in srgb, var(--phase-compliance, #4dd0a3) 55%, var(--border));
    color: var(--phase-compliance);
  }
  .ph-spawn {
    border-color: color-mix(in srgb, var(--phase-spawn, #b894ff) 55%, var(--border));
    color: var(--phase-spawn);
  }
  .ph-reflection {
    border-color: color-mix(in srgb, var(--phase-reflection, #ff9b6a) 55%, var(--border));
    color: var(--phase-reflection);
  }
  .ph-hitl {
    border-color: color-mix(in srgb, var(--phase-hitl, #ff7a9a) 55%, var(--border));
    color: var(--phase-hitl);
  }

  .empty {
    padding: 0.85rem;
    color: var(--text-muted);
    font-size: 0.85rem;
  }
</style>
