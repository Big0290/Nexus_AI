<script lang="ts">
  let { title, hint, onDismiss, onOpenDetail } = $props<{
    title: string;
    hint: string;
    onDismiss: () => void;
    onOpenDetail: () => void;
  }>();
</script>

<div class="app-alert app-alert--error" role="alert">
  <div class="app-alert-body">
    <strong class="app-alert-title">{title}</strong>
    <p class="app-alert-hint">{hint}</p>
  </div>
  <div class="app-alert-actions">
    <button type="button" class="app-alert-btn" onclick={onOpenDetail}>Full error</button>
    <button type="button" class="app-alert-btn app-alert-btn--ghost" onclick={onDismiss}>Dismiss</button>
  </div>
</div>

<style>
  .app-alert {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.65rem 1rem;
    padding: 0.65rem 0.85rem;
    border-radius: var(--radius-sm);
    border: 1px solid color-mix(in srgb, var(--danger) 45%, var(--border));
    background: var(--danger-soft);
  }

  .app-alert--error {
    border-color: color-mix(in srgb, var(--danger) 55%, var(--border));
  }

  .app-alert-body {
    flex: 1 1 16rem;
    min-width: 0;
  }

  .app-alert-title {
    display: block;
    font-size: 0.88rem;
    font-weight: 650;
    color: color-mix(in srgb, var(--danger) 85%, white);
    margin-bottom: 0.35rem;
  }

  .app-alert-hint {
    margin: 0;
    font-size: 0.8rem;
    line-height: 1.45;
    color: var(--text-muted);
  }

  .app-alert-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    align-items: center;
  }

  .app-alert-btn {
    font: inherit;
    font-size: 0.78rem;
    padding: 0.35rem 0.65rem;
    border-radius: var(--radius-sm);
    border: 1px solid color-mix(in srgb, var(--danger) 35%, var(--border));
    background: var(--surface-elevated);
    color: var(--text);
    cursor: pointer;
  }

  .app-alert-btn:hover {
    background: var(--surface);
  }

  .app-alert-btn--ghost {
    border-color: var(--border);
    background: transparent;
    color: var(--text-muted);
  }
</style>
