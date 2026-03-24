<script lang="ts">
  /**
   * Toggle-list for intake assumptions/constraints shown during clarification HITL.
   * Checked = user confirms for the next intake / learning signal.
   */
  let {
    requestId,
    assumptions = [],
    constraints = [],
    onChange
  } = $props<{
    requestId: string;
    assumptions?: string[];
    constraints?: string[];
    onChange: (id: string, payload: { assumptionChecks: boolean[]; constraintChecks: boolean[] }) => void;
  }>();

  let checksA = $state<boolean[]>([]);
  let checksC = $state<boolean[]>([]);

  $effect(() => {
    const na = assumptions.length;
    const nc = constraints.length;
    if (checksA.length !== na) {
      checksA = assumptions.map(() => true);
    }
    if (checksC.length !== nc) {
      checksC = constraints.map(() => true);
    }
  });

  function emit() {
    onChange(requestId, { assumptionChecks: [...checksA], constraintChecks: [...checksC] });
  }

  function toggleA(i: number) {
    checksA = checksA.map((v, j) => (j === i ? !v : v));
    emit();
  }

  function toggleC(i: number) {
    checksC = checksC.map((v, j) => (j === i ? !v : v));
    emit();
  }

  function selectAllA() {
    checksA = assumptions.map(() => true);
    emit();
  }

  function clearAllA() {
    checksA = assumptions.map(() => false);
    emit();
  }

  function selectAllC() {
    checksC = constraints.map(() => true);
    emit();
  }

  function clearAllC() {
    checksC = constraints.map(() => false);
    emit();
  }
</script>

{#if assumptions.length > 0}
  <fieldset class="fieldset">
    <legend class="legend">What the AI assumed</legend>
    <p class="hint">
      Keep checked only what is <strong>true</strong> for your request. The Brain folds this into the next intake pass as
      ground truth.
    </p>
    <div class="bulk">
      <button type="button" class="bulk-btn" onclick={selectAllA}>Keep all</button>
      <button type="button" class="bulk-btn" onclick={clearAllA}>Clear all</button>
    </div>
    <ul class="chips" role="list">
      {#each assumptions as text, i (i)}
        <li>
          <button
            type="button"
            class="chip"
            class:on={checksA[i]}
            aria-pressed={checksA[i]}
            onclick={() => toggleA(i)}
          >
            <span class="mark" aria-hidden="true">{checksA[i] ? '✓' : '○'}</span>
            <span class="txt">{text}</span>
          </button>
        </li>
      {/each}
    </ul>
  </fieldset>
{/if}

{#if constraints.length > 0}
  <fieldset class="fieldset">
    <legend class="legend">Constraints the AI is using</legend>
    <p class="hint">Confirm which limits still apply. Uncheck anything that should not constrain the run.</p>
    <div class="bulk">
      <button type="button" class="bulk-btn" onclick={selectAllC}>Keep all</button>
      <button type="button" class="bulk-btn" onclick={clearAllC}>Clear all</button>
    </div>
    <ul class="chips chips-constraints" role="list">
      {#each constraints as text, i (i)}
        <li>
          <button
            type="button"
            class="chip chip-constraint"
            class:on={checksC[i]}
            aria-pressed={checksC[i]}
            onclick={() => toggleC(i)}
          >
            <span class="mark" aria-hidden="true">{checksC[i] ? '✓' : '○'}</span>
            <span class="txt">{text}</span>
          </button>
        </li>
      {/each}
    </ul>
  </fieldset>
{/if}

<style>
  .fieldset {
    margin: 0;
    padding: 0.55rem 0.6rem;
    border-radius: var(--radius-sm);
    border: 1px solid color-mix(in srgb, var(--amber) 28%, var(--border));
    background: color-mix(in srgb, var(--amber) 5%, var(--surface-elevated));
  }

  .legend {
    font-size: 0.72rem;
    font-weight: 750;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--amber);
    padding: 0 0.25rem;
  }

  .hint {
    margin: 0.35rem 0 0.45rem;
    font-size: 0.74rem;
    line-height: 1.45;
    color: var(--text-muted);
  }

  .hint strong {
    color: var(--text);
  }

  .bulk {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
    margin-bottom: 0.45rem;
  }

  .bulk-btn {
    font: inherit;
    font-size: 0.68rem;
    padding: 0.2rem 0.45rem;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--text-muted);
    cursor: pointer;
  }

  .bulk-btn:hover {
    border-color: var(--border-strong);
    color: var(--text);
  }

  .chips {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }

  .chip {
    display: flex;
    align-items: flex-start;
    gap: 0.45rem;
    width: 100%;
    text-align: left;
    font: inherit;
    font-size: 0.78rem;
    line-height: 1.4;
    padding: 0.45rem 0.5rem;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border);
    background: var(--bg-subtle);
    color: var(--text-muted);
    cursor: pointer;
    transition:
      border-color 0.12s ease,
      background 0.12s ease,
      color 0.12s ease;
  }

  .chip:hover {
    border-color: var(--border-strong);
    color: var(--text);
  }

  .chip.on {
    border-color: color-mix(in srgb, var(--success) 45%, var(--border));
    background: color-mix(in srgb, var(--success) 10%, var(--bg-subtle));
    color: var(--text);
  }

  .chip-constraint.on {
    border-color: color-mix(in srgb, var(--accent) 40%, var(--border));
    background: color-mix(in srgb, var(--accent) 8%, var(--bg-subtle));
  }

  .mark {
    flex-shrink: 0;
    width: 1.1rem;
    font-weight: 700;
    color: var(--text-dim);
  }

  .chip.on .mark {
    color: var(--success);
  }

  .chip-constraint.on .mark {
    color: var(--accent);
  }

  .txt {
    flex: 1;
    min-width: 0;
    word-break: break-word;
  }

  .chips-constraints .chip {
    border-style: dashed;
  }
</style>
