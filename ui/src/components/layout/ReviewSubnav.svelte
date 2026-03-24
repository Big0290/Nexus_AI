<script lang="ts">
  import { REVIEW_NAV, type ReviewPanelId } from '../../lib/app-navigation.js';

  let {
    activePanel,
    hitlCount = 0,
    onSelect
  } = $props<{
    activePanel: ReviewPanelId;
    hitlCount?: number;
    onSelect: (id: ReviewPanelId) => void;
  }>();
</script>

<nav class="app-review-subnav" aria-label="Review sections">
  {#each REVIEW_NAV as item (item.id)}
    <button
      type="button"
      class="app-subtab"
      class:app-subtab--active={activePanel === item.id}
      class:app-subtab--hitl-pending={item.id === 'hitl' && hitlCount > 0}
      title={item.hint}
      onclick={() => onSelect(item.id)}
    >
      {item.label}
    </button>
  {/each}
</nav>

<style>
  .app-review-subnav {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
    margin-top: -0.1rem;
    margin-bottom: 0.5rem;
    padding-left: 0.05rem;
  }

  .app-subtab {
    font: inherit;
    font-size: 0.78rem;
    padding: 0.28rem 0.55rem;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--text-muted);
    cursor: pointer;
  }

  .app-subtab:hover {
    border-color: var(--border-strong);
    color: var(--text);
  }

  .app-subtab--active {
    border-color: var(--violet);
    color: var(--text);
    background: color-mix(in srgb, var(--violet) 12%, var(--surface));
  }

  .app-subtab--hitl-pending:not(.app-subtab--active) {
    border-color: color-mix(in srgb, var(--phase-hitl) 40%, var(--border));
    color: color-mix(in srgb, var(--phase-hitl) 85%, white);
  }
</style>
