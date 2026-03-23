<script lang="ts">
  let {
    open = false,
    title = '',
    body = '',
    meta = null as string | null,
    onClose
  } = $props<{
    open?: boolean;
    title?: string;
    body?: string;
    meta?: string | null;
    onClose: () => void;
  }>();

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      /* ignore */
    }
  }

  $effect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  });
</script>

{#if open}
  <div class="backdrop" onclick={onClose} role="presentation" aria-hidden="true"></div>
  <div class="modal" role="dialog" aria-modal="true" aria-labelledby="fcd-title">
    <header class="hdr">
      <h2 id="fcd-title">{title}</h2>
      <div class="hdr-actions">
        <button type="button" class="btn ghost" onclick={() => copy(body)}>Copy body</button>
        {#if meta}
          <button type="button" class="btn ghost" onclick={() => copy(meta ?? '')}>Copy meta</button>
        {/if}
        <button type="button" class="btn close" onclick={onClose} aria-label="Close">×</button>
      </div>
    </header>
    {#if meta}
      <section class="block">
        <h3 class="subh">Metadata</h3>
        <pre class="pre meta">{meta}</pre>
      </section>
    {/if}
    <section class="block grow">
      <h3 class="subh">Content</h3>
      <pre class="pre main">{body}</pre>
    </section>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 1000;
    background: rgba(6, 8, 12, 0.72);
    backdrop-filter: blur(4px);
  }

  .modal {
    position: fixed;
    z-index: 1001;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    width: min(92vw, 52rem);
    max-height: min(88vh, 40rem);
    display: flex;
    flex-direction: column;
    background: #12151c;
    border: 1px solid #2f3542;
    border-radius: 0.5rem;
    box-shadow: 0 18px 48px rgba(0, 0, 0, 0.45);
  }

  .hdr {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.75rem;
    padding: 0.65rem 0.85rem;
    border-bottom: 1px solid #252b36;
    flex-shrink: 0;
  }

  h2 {
    margin: 0;
    font-size: 0.95rem;
    font-weight: 600;
    line-height: 1.35;
    word-break: break-word;
  }

  .hdr-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
    align-items: center;
    flex-shrink: 0;
  }

  .btn {
    font: inherit;
    font-size: 0.78rem;
    padding: 0.3rem 0.5rem;
    border-radius: 0.3rem;
    border: 1px solid #3a4150;
    background: #1a1f2a;
    color: #e0e2ee;
    cursor: pointer;
  }

  .btn.ghost:hover {
    border-color: #5a6578;
  }

  .btn.close {
    width: 1.85rem;
    height: 1.85rem;
    padding: 0;
    line-height: 1;
    font-size: 1.2rem;
    border-radius: 0.35rem;
  }

  .block {
    padding: 0.55rem 0.85rem 0.65rem;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    min-height: 0;
  }

  .block.grow {
    flex: 1;
    overflow: hidden;
  }

  .subh {
    margin: 0;
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: #8b8d9c;
    font-weight: 600;
  }

  .pre {
    margin: 0;
    font-size: 0.8rem;
    line-height: 1.45;
    white-space: pre-wrap;
    word-break: break-word;
    background: #0b0d11;
    border: 1px solid #242a36;
    border-radius: 0.35rem;
    padding: 0.55rem 0.65rem;
    overflow: auto;
    color: #d2d4e0;
  }

  .pre.meta {
    max-height: 8rem;
    font-size: 0.75rem;
  }

  .pre.main {
    flex: 1;
    max-height: calc(min(88vh, 40rem) - 9rem);
    min-height: 6rem;
  }
</style>
