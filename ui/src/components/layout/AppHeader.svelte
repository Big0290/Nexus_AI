<script lang="ts">
  import type { OrchestratorState } from '../../lib/types.js';

  let {
    orchestrator,
    lastSuccessLine = null as string | null,
    hitlCount = 0
  } = $props<{
    orchestrator: OrchestratorState;
    lastSuccessLine?: string | null;
    hitlCount?: number;
  }>();
</script>

<header class="app-header">
  <div class="app-header-main">
    <h1 class="app-title">Nexus Brain</h1>
    <div class="app-status-pills" role="status" aria-live="polite">
      <span class="app-pill">{orchestrator.orchestratorId}</span>
      <span class="app-pill">{orchestrator.status}</span>
      {#if orchestrator.processing}
        <span class="app-pill app-pill--accent">processing</span>
      {/if}
      <span class="app-pill app-pill--dim">{orchestrator.modelMode}</span>
      <span class="app-pill" class:app-pill--hitl={hitlCount > 0}>HITL {hitlCount}</span>
    </div>
  </div>
  {#if lastSuccessLine}
    <p class="app-last-line" title={lastSuccessLine}>Last: {lastSuccessLine}</p>
  {/if}
</header>

<style>
  .app-header {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.5rem 1.25rem;
  }

  .app-header-main {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem 0.85rem;
    min-width: 0;
  }

  .app-title {
    margin: 0;
    font-size: 1.15rem;
    font-weight: 650;
    letter-spacing: -0.02em;
    color: var(--text);
  }

  .app-status-pills {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem;
  }

  .app-pill {
    font-size: 0.72rem;
    padding: 0.15rem 0.45rem;
    border-radius: 999px;
    border: 1px solid var(--border);
    color: var(--text-muted);
    background: var(--surface);
  }

  .app-pill--dim {
    color: var(--text-dim);
  }

  .app-pill--accent {
    border-color: color-mix(in srgb, var(--teal) 55%, var(--border));
    background: var(--teal-soft);
    color: var(--success);
  }

  .app-pill--hitl {
    border-color: color-mix(in srgb, var(--phase-hitl) 55%, var(--border));
    color: color-mix(in srgb, var(--phase-hitl) 92%, white);
    background: color-mix(in srgb, var(--phase-hitl) 14%, var(--surface));
    font-weight: 650;
    animation: app-hitl-pulse 2.2s ease-in-out infinite;
  }

  @keyframes app-hitl-pulse {
    0%,
    100% {
      box-shadow: 0 0 0 0 color-mix(in srgb, var(--phase-hitl) 0%, transparent);
    }
    50% {
      box-shadow: 0 0 0 3px color-mix(in srgb, var(--phase-hitl) 22%, transparent);
    }
  }

  .app-last-line {
    margin: 0;
    font-size: 0.78rem;
    color: var(--text-muted);
    max-width: min(42rem, 100%);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
