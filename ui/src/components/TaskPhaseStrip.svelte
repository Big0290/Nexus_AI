<script lang="ts">
  import type { OrchestratorState, ThoughtPhase } from '../lib/types.js';

  let {
    orchestrator,
    lastThoughtPhase
  }: {
    orchestrator: OrchestratorState;
    lastThoughtPhase?: ThoughtPhase | null;
  } = $props();

  const pipeline: { phase: ThoughtPhase | 'idle'; label: string }[] = [
    { phase: 'ingest', label: 'Intake' },
    { phase: 'recall', label: 'Recall' },
    { phase: 'strategy', label: 'Plan' },
    { phase: 'compliance', label: 'Law 25' },
    { phase: 'spawn', label: 'Specialist' },
    { phase: 'reflection', label: 'Reflect' },
    { phase: 'hitl', label: 'Human' }
  ];

  const idx = $derived.by(() => {
    if (!orchestrator.processing && orchestrator.status === 'idle') return -1;
    if (orchestrator.status === 'awaiting_human') return 6;
    const p = lastThoughtPhase;
    if (!p) return orchestrator.status === 'planning' ? 2 : 0;
    const order: ThoughtPhase[] = ['ingest', 'recall', 'strategy', 'compliance', 'spawn', 'reflection', 'hitl'];
    const i = order.indexOf(p);
    return i >= 0 ? i : 0;
  });
</script>

<div class="strip" role="status" aria-live="polite">
  <span class="strip-title">Pipeline</span>
  {#each pipeline as step, i (step.label)}
    <span
      class="step"
      class:active={idx === i}
      class:passed={idx > i}
      class:pending={idx >= 0 && idx < i}
      class:idle={idx < 0}
    >
      {step.label}
    </span>
    {#if i < pipeline.length - 1}
      <span class="arrow" aria-hidden="true">→</span>
    {/if}
  {/each}
  {#if idx < 0}
    <span class="note">Idle — start a task on Run</span>
  {/if}
</div>

<style>
  .strip {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.25rem 0.35rem;
    padding: 0.45rem 0.65rem;
    margin-bottom: 0.65rem;
    border-radius: var(--radius-sm, 0.35rem);
    border: 1px solid var(--border, #2a3142);
    background: var(--surface, #12161f);
    font-size: 0.72rem;
  }

  .strip-title {
    font-weight: 600;
    color: var(--text-muted, #8b92a8);
    margin-right: 0.35rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  .step {
    padding: 0.15rem 0.4rem;
    border-radius: 999px;
    border: 1px solid var(--border);
    color: var(--text-dim, #6a7088);
    background: var(--bg-subtle, #0f1219);
  }

  .step.passed {
    border-color: color-mix(in srgb, var(--teal) 40%, var(--border));
    color: var(--text-muted);
  }

  .step.active {
    border-color: var(--accent, #5b8cef);
    background: var(--accent-soft);
    color: var(--text);
    font-weight: 600;
  }

  .step.pending:not(.active) {
    opacity: 0.65;
  }

  .step.idle {
    opacity: 0.45;
  }

  .arrow {
    color: var(--text-dim);
    font-size: 0.65rem;
    user-select: none;
  }

  .note {
    margin-left: 0.35rem;
    color: var(--text-muted);
    font-style: italic;
  }
</style>
