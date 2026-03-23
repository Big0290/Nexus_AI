<script lang="ts">
  import type { InterventionRequest } from '../lib/types.js';
  import {
    approveIntervention,
    injectIntervention,
    overrideIntervention,
    submitClarification
  } from '../lib/api.js';
  import { previewText } from '../lib/format.js';
  import { summarizeBrainError } from '../lib/brain-errors.js';

  let {
    items = [] as InterventionRequest[],
    openDetail,
    /** Not `onActionDone` — Svelte 5 can treat `on*` + PascalCase like event props. */
    afterHitlAction = async () => {}
  } = $props<{
    items: InterventionRequest[];
    openDetail: (title: string, body: string, meta?: string | null) => void;
    afterHitlAction?: () => void | Promise<void>;
  }>();

  let injectText = $state<Record<string, string>>({});
  let overrideReason = $state<Record<string, string>>({});
  let clarifyText = $state<Record<string, string>>({});
  let err = $state<string | null>(null);

  function setInject(id: string, v: string) {
    injectText = { ...injectText, [id]: v };
  }

  function setReason(id: string, v: string) {
    overrideReason = { ...overrideReason, [id]: v };
  }

  function setClarify(id: string, v: string) {
    clarifyText = { ...clarifyText, [id]: v };
  }

  function kindOf(it: InterventionRequest): 'clarification' | 'quality_gate' {
    return it.kind ?? 'quality_gate';
  }

  function formatErr(e: unknown): string {
    const raw = e instanceof Error ? e.message : String(e);
    const s = summarizeBrainError(raw);
    return `${s.title}: ${s.hint}`;
  }

  async function approve(id: string) {
    err = null;
    try {
      await approveIntervention(id, injectText[id]?.trim() || undefined);
      await afterHitlAction();
    } catch (e) {
      err = formatErr(e);
    }
  }

  async function inject(id: string) {
    err = null;
    const text = injectText[id]?.trim();
    if (!text) {
      err = 'Add context to inject.';
      return;
    }
    try {
      await injectIntervention(id, text);
      await afterHitlAction();
    } catch (e) {
      err = formatErr(e);
    }
  }

  async function overrideFail(id: string) {
    err = null;
    try {
      await overrideIntervention(id, 'failure', overrideReason[id]?.trim());
      await afterHitlAction();
    } catch (e) {
      err = formatErr(e);
    }
  }

  async function overrideOk(id: string) {
    err = null;
    try {
      await overrideIntervention(id, 'success');
      await afterHitlAction();
    } catch (e) {
      err = formatErr(e);
    }
  }

  async function clarify(id: string) {
    err = null;
    const text = clarifyText[id]?.trim();
    if (!text) {
      err = 'Answer the questions before submitting.';
      return;
    }
    try {
      await submitClarification(id, text);
      await afterHitlAction();
    } catch (e) {
      err = formatErr(e);
    }
  }

  function fullContext(it: InterventionRequest) {
    openDetail(
      `Intervention ${it.requestId}`,
      [`## Brain context`, it.brainContext, ``, `## Proposed next step`, it.proposedNextStep].join('\n'),
      null
    );
  }
</script>

<section class="card">
  <header class="head">
    <h2>Pending interventions</h2>
    <span class="meta">{items.length} open</span>
  </header>
  {#if err}
    <p class="err">{err}</p>
  {/if}
  <ul class="list">
    {#each items as it (it.requestId)}
      {@const k = kindOf(it)}
      <li class="item">
        <div class="top">
          <code class="id">{it.requestId}</code>
          <span class="badges">
            <span class="pill" class:clar={k === 'clarification'} class:gate={k === 'quality_gate'}>
              {k === 'clarification' ? 'Clarify' : 'Quality gate'}
            </span>
            <button type="button" class="linkish" onclick={() => fullContext(it)}>Full context</button>
          </span>
        </div>
        <p class="preview">{previewText(it.brainContext, 200)}</p>
        <p class="next"><span class="lbl">Next:</span> {previewText(it.proposedNextStep, 120)}</p>

        {#if k === 'clarification'}
          {#if it.rationale}
            <p class="rationale">{it.rationale}</p>
          {/if}
          {#if it.questions?.length}
            <ol class="qs">
              {#each it.questions as q, i (i)}
                <li>{q}</li>
              {/each}
            </ol>
          {/if}
          <label class="compact">
            Your answers
            <textarea
              rows="4"
              placeholder="Answer the questions above (numbered replies are fine)."
              value={clarifyText[it.requestId] ?? ''}
              oninput={(e) => setClarify(it.requestId, e.currentTarget.value)}
            ></textarea>
          </label>
          <div class="actions">
            <button type="button" class="primary" onclick={() => clarify(it.requestId)}>Submit answers</button>
          </div>
        {:else}
          <label class="compact">
            Context
            <textarea
              rows="2"
              placeholder="Notes for approve / inject"
              value={injectText[it.requestId] ?? ''}
              oninput={(e) => setInject(it.requestId, e.currentTarget.value)}
            ></textarea>
          </label>
          <div class="actions">
            <button type="button" class="primary" onclick={() => approve(it.requestId)}>Approve</button>
            <button type="button" class="secondary" onclick={() => inject(it.requestId)}>Inject</button>
            <button type="button" class="danger" onclick={() => overrideFail(it.requestId)}>Fail</button>
            <button type="button" class="success" onclick={() => overrideOk(it.requestId)}>Success</button>
          </div>
          <label class="small">
            Failure reason (override)
            <input
              type="text"
              value={overrideReason[it.requestId] ?? ''}
              oninput={(e) => setReason(it.requestId, e.currentTarget.value)}
            />
          </label>
        {/if}
      </li>
    {:else}
      <li class="empty">No human actions required.</li>
    {/each}
  </ul>
</section>

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

  .list {
    list-style: none;
    margin: 0;
    padding: 0;
    max-height: min(70vh, 40rem);
    overflow: auto;
  }

  .item {
    padding: 0.55rem 0.75rem;
    border-bottom: 1px solid #1f2430;
    display: grid;
    gap: 0.4rem;
  }

  .top {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .badges {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .pill {
    font-size: 0.68rem;
    padding: 0.12rem 0.45rem;
    border-radius: 999px;
    border: 1px solid #3a4a6a;
    color: #b8bdd4;
  }

  .pill.clar {
    border-color: #c9a24d;
    color: #ffe6a8;
    background: #1a1810;
  }

  .pill.gate {
    border-color: #5a7a9a;
    color: #c8d8f0;
  }

  .id {
    font-size: 0.72rem;
    color: #b8bdd4;
    word-break: break-all;
  }

  .linkish {
    font: inherit;
    font-size: 0.75rem;
    padding: 0.15rem 0.4rem;
    border: 1px solid #3a4a6a;
    border-radius: 0.3rem;
    background: #1a2233;
    color: #a8c4ff;
    cursor: pointer;
    flex-shrink: 0;
  }

  .preview,
  .next {
    margin: 0;
    font-size: 0.78rem;
    color: #b8bac8;
    line-height: 1.35;
  }

  .rationale {
    margin: 0;
    font-size: 0.74rem;
    color: #9ea6c0;
    font-style: italic;
  }

  .qs {
    margin: 0;
    padding-left: 1.1rem;
    font-size: 0.78rem;
    color: #d8dae0;
    line-height: 1.4;
  }

  .lbl {
    color: #7e8498;
    margin-right: 0.25rem;
  }

  .compact {
    display: grid;
    gap: 0.25rem;
    font-size: 0.72rem;
    color: #9a9db0;
  }

  textarea,
  input {
    font: inherit;
    padding: 0.35rem 0.45rem;
    border-radius: 0.3rem;
    border: 1px solid #2f3542;
    background: #0f1115;
    color: #e8e8ec;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
  }

  button {
    font: inherit;
    font-size: 0.78rem;
    padding: 0.32rem 0.55rem;
    border-radius: 0.3rem;
    border: 1px solid #333;
    background: #1b2030;
    color: #e8e8ec;
    cursor: pointer;
  }

  .primary {
    border-color: #3d6df4;
    background: #2f4fd4;
  }

  .secondary {
    border-color: #c9a24d;
    color: #ffe6a8;
  }

  .danger {
    border-color: #ff6b8a;
    color: #ffc2cf;
  }

  .success {
    border-color: #4dd0a3;
    color: #c6ffe8;
  }

  .small {
    font-size: 0.72rem;
    display: grid;
    gap: 0.2rem;
    color: #8b8fa3;
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
</style>
