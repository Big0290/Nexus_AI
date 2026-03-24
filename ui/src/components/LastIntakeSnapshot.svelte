<script lang="ts">
  import type { InterpretationResult } from '../lib/types.js';

  let {
    interpretation = null,
    processing = false,
    onGoHumanReview
  } = $props<{
    interpretation?: InterpretationResult | null;
    processing?: boolean;
    onGoHumanReview?: () => void;
  }>();

  const hasBody = $derived(
    Boolean(
      interpretation &&
        !processing &&
        ((interpretation.assumptions?.length ?? 0) > 0 ||
          (interpretation.constraints?.length ?? 0) > 0)
    )
  );
</script>

{#if hasBody && interpretation}
  <section class="snap" aria-labelledby="snap-h">
    <h3 id="snap-h" class="snap-title">Latest intake — AI assumptions</h3>
    <p class="snap-lede">
      From the most recent interpretation. During <strong>Human review</strong>, you can toggle which lines still hold
      so the next intake learns from your selections.
    </p>
    {#if interpretation.intakeAcknowledgment}
      <p class="ack">{interpretation.intakeAcknowledgment}</p>
    {/if}
    {#if interpretation.assumptions?.length}
      <div class="block">
        <span class="lbl">Assumptions</span>
        <ul class="items">
          {#each interpretation.assumptions as a, i (i)}
            <li>{a}</li>
          {/each}
        </ul>
      </div>
    {/if}
    {#if interpretation.constraints?.length}
      <div class="block">
        <span class="lbl">Constraints</span>
        <ul class="items">
          {#each interpretation.constraints as c, i (i)}
            <li>{c}</li>
          {/each}
        </ul>
      </div>
    {/if}
    {#if onGoHumanReview}
      <button type="button" class="snap-cta" onclick={onGoHumanReview}>Open Human review</button>
    {/if}
  </section>
{/if}

<style>
  .snap {
    border-radius: var(--radius);
    border: 1px solid color-mix(in srgb, var(--amber) 22%, var(--border));
    background: color-mix(in srgb, var(--amber) 4%, var(--surface));
    padding: 0.65rem 0.75rem 0.75rem;
    display: grid;
    gap: 0.45rem;
  }

  .snap-title {
    margin: 0;
    font-size: 0.85rem;
    font-weight: 650;
    color: var(--text);
  }

  .snap-lede {
    margin: 0;
    font-size: 0.74rem;
    line-height: 1.45;
    color: var(--text-muted);
  }

  .snap-lede strong {
    color: var(--text);
  }

  .ack {
    margin: 0;
    font-size: 0.74rem;
    line-height: 1.4;
    color: var(--text-dim);
    font-style: italic;
    padding: 0.35rem 0.45rem;
    border-radius: var(--radius-sm);
    background: var(--bg-subtle);
    border: 1px solid var(--border);
  }

  .block {
    display: grid;
    gap: 0.25rem;
  }

  .lbl {
    font-size: 0.62rem;
    font-weight: 750;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--amber);
  }

  .items {
    margin: 0;
    padding-left: 1.1rem;
    font-size: 0.76rem;
    line-height: 1.45;
    color: var(--text-muted);
  }

  .snap-cta {
    font: inherit;
    font-size: 0.74rem;
    justify-self: start;
    padding: 0.3rem 0.65rem;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border);
    background: var(--surface-elevated);
    color: var(--accent);
    cursor: pointer;
  }

  .snap-cta:hover {
    border-color: var(--accent-border);
  }
</style>
