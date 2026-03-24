<script lang="ts">
  import type { OutcomeMemory } from '../lib/types.js';
  import { fetchMemory, fetchMemoryMeta, patchMemory, teachOutcome } from '../lib/api.js';
  import { summarizeBrainError } from '../lib/brain-errors.js';
  import { previewText } from '../lib/format.js';

  let {
    openDetail,
    refreshKey = 0,
    /** Not named `onRefresh` — Svelte 5 treats `onX` + uppercase like event props and can drop the callback. */
    afterTeach = async () => {}
  } = $props<{
    openDetail: (title: string, body: string, meta?: string | null) => void;
    refreshKey?: number;
    afterTeach?: () => void | Promise<void>;
  }>();

  let err = $state<string | null>(null);
  let loadErr = $state<string | null>(null);
  /** e.g. `om_abc:success` while that request is in flight */
  let teaching = $state<string | null>(null);
  let editSaving = $state(false);
  /** When set, dialog is open for this outcome id */
  let editDraft = $state<{
    id: string;
    result: string;
    interpretedGoal: string;
    categoriesStr: string;
    canonicalQuery: string;
    tagsStr: string;
  } | null>(null);
  let savedHint = $state<string | null>(null);

  let outcomes = $state<OutcomeMemory[]>([]);
  let categories = $state<string[]>([]);
  let tags = $state<string[]>([]);
  let category = $state('');
  let tag = $state('');
  let qDraft = $state('');
  let qActive = $state('');

  async function loadMeta() {
    try {
      const m = await fetchMemoryMeta();
      categories = m.categories;
      tags = m.tags;
    } catch {
      /* ignore */
    }
  }

  async function loadOutcomes() {
    loadErr = null;
    try {
      const m = await fetchMemory(80, {
        category: category.trim() || undefined,
        tag: tag.trim() || undefined,
        q: qActive.trim() || undefined
      });
      outcomes = m.outcomes as OutcomeMemory[];
    } catch (e) {
      loadErr = e instanceof Error ? e.message : String(e);
    }
  }

  function applyFilters() {
    qActive = qDraft.trim();
    void loadOutcomes();
  }

  $effect(() => {
    refreshKey;
    void loadMeta();
    void loadOutcomes();
  });

  async function teach(id: string, o: 'success' | 'failure') {
    err = null;
    savedHint = null;
    const key = `${id}:${o}`;
    teaching = key;
    try {
      await teachOutcome(id, o);
      await afterTeach();
      savedHint = o === 'success' ? 'Marked OK (success).' : 'Marked as failure.';
      setTimeout(() => {
        savedHint = null;
      }, 3500);
      await loadOutcomes();
      await loadMeta();
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e);
      const s = summarizeBrainError(raw);
      err = `${s.title}: ${s.hint}`;
    } finally {
      teaching = null;
    }
  }

  function busy(id: string, o: 'success' | 'failure'): boolean {
    return teaching === `${id}:${o}`;
  }

  function outcomeCategories(o: OutcomeMemory): string[] {
    if (o.categories?.length) return o.categories;
    if (o.primaryCategory?.trim()) return [o.primaryCategory.trim()];
    return [];
  }

  function expand(o: OutcomeMemory) {
    const meta = JSON.stringify(
      {
        id: o.id,
        taskType: o.taskType,
        primaryCategory: o.primaryCategory,
        categories: outcomeCategories(o),
        tags: o.tags,
        canonicalQuery: o.canonicalQuery,
        timestamp: o.timestamp,
        successScore: o.successScore,
        failureReason: o.failureReason,
        sessionId: o.sessionId ?? null,
        taskId: o.taskId ?? null
      },
      null,
      2
    );
    const body = [`## Plan`, o.initialPlan, ``, `## Result`, o.result].join('\n');
    openDetail(`Outcome · ${o.taskType} · ${o.id}`, body, meta);
  }

  function startEdit(o: OutcomeMemory) {
    err = null;
    editDraft = {
      id: o.id,
      result: o.result ?? '',
      interpretedGoal: o.interpretedGoal ?? '',
      categoriesStr: outcomeCategories(o).join(', '),
      canonicalQuery: o.canonicalQuery ?? '',
      tagsStr: (o.tags ?? []).join(', ')
    };
  }

  function closeEdit() {
    editDraft = null;
  }

  async function saveEdit() {
    if (!editDraft) return;
    err = null;
    editSaving = true;
    try {
      const tags = editDraft.tagsStr
        .split(/[,;]+/)
        .map((t) => t.trim())
        .filter(Boolean);
      const categories = editDraft.categoriesStr
        .split(/[,;]+/)
        .map((t) => t.trim())
        .filter(Boolean);
      await patchMemory(editDraft.id, {
        result: editDraft.result,
        interpretedGoal: editDraft.interpretedGoal || undefined,
        ...(categories.length ? { categories } : {}),
        canonicalQuery: editDraft.canonicalQuery || undefined,
        tags
      });
      await afterTeach();
      savedHint = 'Outcome updated.';
      setTimeout(() => {
        savedHint = null;
      }, 3500);
      closeEdit();
      await loadOutcomes();
      await loadMeta();
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e);
      const s = summarizeBrainError(raw);
      err = `${s.title}: ${s.hint}`;
    } finally {
      editSaving = false;
    }
  }
</script>

<section class="card">
  <header class="head">
    <h2>Outcome memory</h2>
    <span class="meta">{outcomes.length} · filters</span>
  </header>

  <div class="filters">
    <label class="f">
      Category
      <select bind:value={category} onchange={() => void loadOutcomes()}>
        <option value="">Any</option>
        {#each categories as c (c)}
          <option value={c}>{c}</option>
        {/each}
      </select>
    </label>
    <label class="f">
      Tag
      <select bind:value={tag} onchange={() => void loadOutcomes()}>
        <option value="">Any</option>
        {#each tags as t (t)}
          <option value={t}>{t}</option>
        {/each}
      </select>
    </label>
    <label class="f grow">
      Text
      <div class="rowq">
        <input type="search" bind:value={qDraft} placeholder="Search result, goal, plan…" />
        <button type="button" class="apply" onclick={() => applyFilters()}>Apply</button>
      </div>
    </label>
  </div>

  {#if loadErr}
    <p class="err">{loadErr}</p>
  {/if}
  {#if err}
    <p class="err">{err}</p>
  {/if}
  {#if savedHint}
    <p class="okhint" role="status">{savedHint}</p>
  {/if}
  <ul class="list">
    {#each outcomes as o (o.id)}
      {@const oid = o.id}
      <li class="row">
        <div class="top">
          <span class="type">{o.taskType}</span>
          <time datetime={o.timestamp}>{new Date(o.timestamp).toLocaleString()}</time>
        </div>
        {#if o.sessionId?.trim() || o.taskId?.trim()}
          <p class="xref" title="Cross-references stored when this outcome was logged">
            {#if o.sessionId?.trim()}
              <span class="xref-bit"
                >Session <code>{o.sessionId.slice(0, 8)}…</code></span
              >
            {/if}
            {#if o.sessionId?.trim() && o.taskId?.trim()}
              <span class="xref-sep">·</span>
            {/if}
            {#if o.taskId?.trim()}
              <span class="xref-bit">Task <code>{o.taskId.slice(0, 8)}…</code></span>
            {/if}
          </p>
        {/if}
        {#if outcomeCategories(o).length || (o.tags && o.tags.length)}
          <div class="meta2">
            {#if outcomeCategories(o).length}
              <span class="cats">
                {#each outcomeCategories(o) as cat, i (`${oid}-cat-${i}`)}
                  <span class="cat">{cat}</span>
                {/each}
              </span>
            {/if}
            {#if o.tags?.length}
              <span class="tags">{o.tags.join(' · ')}</span>
            {/if}
          </div>
        {/if}
        <div class="scores">
          <span class="sc">score {o.successScore ?? '—'}</span>
          {#if o.failureReason}
            <span class="fail">{previewText(o.failureReason, 80)}</span>
          {/if}
        </div>
        <p class="one">{previewText(o.result, 140)}</p>
        <div class="row2">
          <div class="leftacts">
            <button type="button" class="view" onclick={() => expand(o)}>View full</button>
            <button type="button" class="edit" onclick={() => startEdit(o)}>Edit</button>
          </div>
          <div class="acts">
            <button
              type="button"
              class="good"
              disabled={teaching !== null}
              onclick={() => void teach(oid, 'success')}
            >
              {busy(oid, 'success') ? '…' : '+OK'}
            </button>
            <button
              type="button"
              class="bad"
              disabled={teaching !== null}
              onclick={() => void teach(oid, 'failure')}
            >
              {busy(oid, 'failure') ? '…' : '+Fail'}
            </button>
          </div>
        </div>
      </li>
    {:else}
      <li class="empty">No stored outcomes yet.</li>
    {/each}
  </ul>
</section>

{#if editDraft}
  <dialog class="editdlg" open>
    <form
      class="editform"
      onsubmit={(e) => {
        e.preventDefault();
        void saveEdit();
      }}
    >
      <h3 class="edith3">Edit outcome</h3>
      <p class="editid"><code>{editDraft.id}</code></p>
      <label class="elab">
        Result
        <textarea name="result" rows="6" bind:value={editDraft.result}></textarea>
      </label>
      <label class="elab">
        Interpreted goal
        <textarea name="interpretedGoal" rows="3" bind:value={editDraft.interpretedGoal}></textarea>
      </label>
      <label class="elab">
        Categories (comma-separated)
        <input type="text" bind:value={editDraft.categoriesStr} placeholder="knowledge, pdf, legal" />
      </label>
      <label class="elab">
        Canonical query
        <input type="text" bind:value={editDraft.canonicalQuery} />
      </label>
      <label class="elab">
        Tags (comma-separated)
        <input type="text" bind:value={editDraft.tagsStr} placeholder="tag1, tag2" />
      </label>
      <div class="editactions">
        <button type="button" class="cancel" onclick={closeEdit} disabled={editSaving}>Cancel</button>
        <button type="submit" class="save" disabled={editSaving}>{editSaving ? 'Saving…' : 'Save'}</button>
      </div>
    </form>
  </dialog>
{/if}

<style>
  .card {
    border-radius: 0.5rem;
    background: #141821;
    border: 1px solid #2a2f3a;
  }

  .head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    padding: 0.55rem 0.75rem;
    border-bottom: 1px solid #2a2f3a;
  }

  h2 {
    margin: 0;
    font-size: 0.95rem;
    font-weight: 600;
  }

  .meta {
    font-size: 0.72rem;
    color: #8c8c9a;
  }

  .filters {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem 0.75rem;
    padding: 0.5rem 0.75rem;
    border-bottom: 1px solid #1f2430;
    align-items: flex-end;
  }

  .f {
    display: grid;
    gap: 0.2rem;
    font-size: 0.72rem;
    color: #9a9db0;
    min-width: 7rem;
  }

  .f.grow {
    flex: 1 1 12rem;
    min-width: 10rem;
  }

  select,
  input {
    font: inherit;
    font-size: 0.78rem;
    padding: 0.3rem 0.4rem;
    border-radius: 0.3rem;
    border: 1px solid #2f3542;
    background: #0f1115;
    color: #e8e8ec;
  }

  .rowq {
    display: flex;
    gap: 0.35rem;
    align-items: center;
  }

  .rowq input {
    flex: 1;
    min-width: 0;
  }

  .apply {
    font: inherit;
    font-size: 0.75rem;
    padding: 0.3rem 0.5rem;
    border-radius: 0.3rem;
    border: 1px solid #3d6df4;
    background: #2a3f80;
    color: #e8ecff;
    cursor: pointer;
    flex-shrink: 0;
  }

  .list {
    list-style: none;
    margin: 0;
    padding: 0;
    max-height: min(70vh, 40rem);
    overflow: auto;
  }

  .row {
    padding: 0.5rem 0.75rem;
    border-bottom: 1px solid #1f2430;
    display: grid;
    gap: 0.3rem;
  }

  .top {
    display: flex;
    justify-content: space-between;
    gap: 0.5rem;
    font-size: 0.8rem;
  }

  .xref {
    margin: 0;
    font-size: 0.68rem;
    color: var(--text-dim);
    line-height: 1.35;
  }

  .xref-bit code {
    font-size: 0.64rem;
    word-break: break-all;
  }

  .xref-sep {
    margin: 0 0.25rem;
    opacity: 0.7;
  }

  .type {
    font-weight: 600;
    color: #dfe0ea;
  }

  time {
    color: #8c8c9a;
    font-size: 0.72rem;
    flex-shrink: 0;
  }

  .meta2 {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
    font-size: 0.72rem;
    line-height: 1.3;
  }

  .cats {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
    align-items: center;
  }

  .cat {
    color: #a8c4ff;
    font-weight: 500;
    padding: 0.08rem 0.35rem;
    border-radius: 0.25rem;
    background: rgba(100, 140, 255, 0.12);
    border: 1px solid rgba(100, 140, 255, 0.28);
    font-size: 0.68rem;
  }

  .tags {
    color: #8b93a8;
  }

  .scores {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    font-size: 0.74rem;
    color: #b8bac8;
  }

  .sc {
    color: #9ea6c0;
  }

  .fail {
    color: #ff9b6a;
  }

  .one {
    margin: 0;
    font-size: 0.78rem;
    color: #aeb2c6;
    line-height: 1.35;
  }

  .row2 {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
    position: relative;
    z-index: 1;
  }

  .leftacts {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
    align-items: center;
  }

  .view {
    font: inherit;
    font-size: 0.75rem;
    padding: 0.2rem 0.45rem;
    border-radius: 0.3rem;
    border: 1px solid #3a4a6a;
    background: #1a2233;
    color: #a8c4ff;
    cursor: pointer;
  }

  .edit {
    font: inherit;
    font-size: 0.75rem;
    padding: 0.2rem 0.45rem;
    border-radius: 0.3rem;
    border: 1px solid #4a5a8a;
    background: #1e2438;
    color: #c8d4ff;
    cursor: pointer;
  }

  .acts {
    display: flex;
    gap: 0.3rem;
    position: relative;
    z-index: 2;
  }

  .okhint {
    margin: 0 0.75rem 0.35rem;
    padding: 0.35rem 0.5rem;
    border-radius: 0.3rem;
    font-size: 0.78rem;
    color: #a8f5d4;
    background: #152a22;
    border: 1px solid #2a6b5e;
  }

  .acts button {
    font: inherit;
    font-size: 0.72rem;
    padding: 0.22rem 0.45rem;
    border-radius: 0.3rem;
    border: 1px solid #333;
    background: #1b2030;
    color: #e8e8ec;
    cursor: pointer;
  }

  .acts button:disabled {
    opacity: 0.55;
    cursor: wait;
  }

  .good {
    border-color: #4dd0a3;
    color: #c6ffe8;
  }

  .bad {
    border-color: #ff6b8a;
    color: #ffc2cf;
  }

  .empty {
    padding: 0.85rem;
    color: #8c8c9a;
    font-size: 0.85rem;
  }

  .err {
    margin: 0.4rem 0.75rem 0;
    color: #ff8b7a;
    font-size: 0.82rem;
  }

  .editdlg {
    position: fixed;
    inset: 0;
    z-index: 80;
    max-width: min(36rem, 96vw);
    max-height: 90vh;
    margin: auto;
    padding: 0;
    border: 1px solid var(--border, #2a2f3a);
    border-radius: 0.5rem;
    background: var(--surface-elevated, #161a24);
    color: inherit;
    box-shadow: 0 1rem 2.5rem rgba(0, 0, 0, 0.45);
  }

  .editdlg::backdrop {
    background: rgba(6, 8, 12, 0.72);
  }

  .editform {
    display: grid;
    gap: 0.65rem;
    padding: 1rem 1.1rem 1.1rem;
    max-height: 90vh;
    overflow: auto;
  }

  .edith3 {
    margin: 0;
    font-size: 1rem;
    font-weight: 600;
  }

  .editid {
    margin: 0;
    font-size: 0.72rem;
    color: #8c8c9a;
    word-break: break-all;
  }

  .elab {
    display: grid;
    gap: 0.25rem;
    font-size: 0.75rem;
    color: #9a9db0;
  }

  .elab textarea,
  .elab input {
    width: 100%;
    box-sizing: border-box;
    resize: vertical;
    min-height: 0;
  }

  .editactions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
    margin-top: 0.35rem;
  }

  .editactions .cancel {
    font: inherit;
    font-size: 0.82rem;
    padding: 0.4rem 0.75rem;
    border-radius: 0.35rem;
    border: 1px solid #3a4150;
    background: transparent;
    color: #c8c9d8;
    cursor: pointer;
  }

  .editactions .save {
    font: inherit;
    font-size: 0.82rem;
    padding: 0.4rem 0.85rem;
    border-radius: 0.35rem;
    border: 1px solid #3d6df4;
    background: #2a3f80;
    color: #e8ecff;
    cursor: pointer;
  }

  .editactions button:disabled {
    opacity: 0.55;
    cursor: wait;
  }
</style>
