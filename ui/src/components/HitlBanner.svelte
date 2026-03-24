<script lang="ts">
  let {
    count,
    onGoToInterventions
  } = $props<{
    count: number;
    onGoToInterventions: () => void;
  }>();
</script>

{#if count > 0}
  <div class="hitl-banner" role="status" aria-live="polite">
    <div class="hitl-inner">
      <span class="hitl-icon" aria-hidden="true">!</span>
      <div class="hitl-copy">
        <strong class="hitl-title">Human input needed</strong>
        <p class="hitl-desc">
          The Brain has paused and is waiting for you to {count === 1 ? 'respond to 1 request' : `respond to ${count} requests`} under
          <strong>Review → Human review</strong>. Nothing else will run until you choose an action.
        </p>
      </div>
      <button type="button" class="hitl-cta" onclick={onGoToInterventions}>
        Open human review
      </button>
    </div>
  </div>
{/if}

<style>
  .hitl-banner {
    margin: 0 0 0.65rem;
    border-radius: var(--radius);
    border: 1px solid color-mix(in srgb, var(--phase-hitl) 42%, var(--border));
    background: linear-gradient(
      120deg,
      color-mix(in srgb, var(--phase-hitl) 14%, var(--surface-elevated)) 0%,
      var(--surface-elevated) 55%
    );
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--phase-hitl) 8%, transparent);
  }

  .hitl-inner {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.65rem 1rem;
    padding: 0.65rem 0.85rem;
  }

  .hitl-icon {
    flex-shrink: 0;
    width: 1.85rem;
    height: 1.85rem;
    display: grid;
    place-items: center;
    border-radius: 50%;
    font-weight: 800;
    font-size: 1rem;
    line-height: 1;
    color: var(--bg);
    background: color-mix(in srgb, var(--phase-hitl) 88%, #400);
  }

  .hitl-copy {
    flex: 1 1 14rem;
    min-width: 0;
  }

  .hitl-title {
    display: block;
    font-size: 0.88rem;
    font-weight: 650;
    color: color-mix(in srgb, var(--phase-hitl) 92%, white);
    margin-bottom: 0.2rem;
    letter-spacing: -0.01em;
  }

  .hitl-desc {
    margin: 0;
    font-size: 0.78rem;
    line-height: 1.45;
    color: var(--text-muted);
  }

  .hitl-desc strong {
    color: var(--text);
    font-weight: 600;
  }

  .hitl-cta {
    font: inherit;
    font-size: 0.82rem;
    font-weight: 650;
    padding: 0.45rem 0.95rem;
    border-radius: var(--radius-sm);
    border: 1px solid color-mix(in srgb, var(--phase-hitl) 55%, var(--border));
    background: color-mix(in srgb, var(--phase-hitl) 22%, var(--surface));
    color: color-mix(in srgb, var(--phase-hitl) 95%, white);
    cursor: pointer;
    flex-shrink: 0;
    transition:
      background 0.12s ease,
      border-color 0.12s ease;
  }

  .hitl-cta:hover {
    background: color-mix(in srgb, var(--phase-hitl) 32%, var(--surface));
    border-color: color-mix(in srgb, var(--phase-hitl) 70%, var(--border));
  }

  .hitl-cta:focus-visible {
    outline: 2px solid var(--phase-hitl);
    outline-offset: 2px;
  }
</style>
