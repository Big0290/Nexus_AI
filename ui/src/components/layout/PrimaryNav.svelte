<script lang="ts">
  import { PRIMARY_NAV, primaryTabShowsHitlBadge, type PrimaryTabId } from '../../lib/app-navigation.js';

  let {
    activeTab,
    hitlCount = 0,
    onSelect
  } = $props<{
    activeTab: PrimaryTabId;
    hitlCount?: number;
    onSelect: (id: PrimaryTabId) => void;
  }>();
</script>

<nav class="app-primary-nav" aria-label="Workspace">
  {#each PRIMARY_NAV as item (item.id)}
    <button
      type="button"
      class="app-tab"
      class:app-tab--active={activeTab === item.id}
      class:app-tab--hitl-pending={primaryTabShowsHitlBadge(item.id) && hitlCount > 0}
      title={item.hint}
      onclick={() => onSelect(item.id)}
    >
      {item.label}
      {#if primaryTabShowsHitlBadge(item.id) && hitlCount > 0}
        <span class="app-tab-badge" aria-hidden="true">{hitlCount}</span>
      {/if}
    </button>
  {/each}
</nav>

<style>
  .app-primary-nav {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
    padding-bottom: 0.45rem;
    border-bottom: 1px solid var(--border);
  }

  .app-tab {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    font: inherit;
    font-size: 0.84rem;
    font-weight: 500;
    padding: 0.4rem 0.75rem;
    border-radius: var(--radius-sm);
    border: 1px solid transparent;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    transition:
      background 0.12s ease,
      color 0.12s ease,
      border-color 0.12s ease;
  }

  .app-tab:hover {
    background: var(--surface-elevated);
    color: var(--text);
  }

  .app-tab--active {
    border-color: var(--accent-border);
    background: var(--accent-soft);
    color: var(--text);
  }

  .app-tab--hitl-pending:not(.app-tab--active) {
    border-color: color-mix(in srgb, var(--phase-hitl) 45%, var(--border));
    color: color-mix(in srgb, var(--phase-hitl) 88%, white);
    background: color-mix(in srgb, var(--phase-hitl) 10%, var(--surface-elevated));
  }

  .app-tab-badge {
    font-size: 0.62rem;
    font-weight: 750;
    min-width: 1.1rem;
    height: 1.1rem;
    padding: 0 0.28rem;
    border-radius: 999px;
    background: color-mix(in srgb, var(--phase-hitl) 88%, #400);
    color: var(--bg);
    line-height: 1.1rem;
    text-align: center;
  }
</style>
