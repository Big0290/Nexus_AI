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
  import IntakeSuggestionPicker from './IntakeSuggestionPicker.svelte';

  let {
    items = [] as InterventionRequest[],
    openDetail,
    afterHitlAction = async () => {}
  } = $props<{
    items: InterventionRequest[];
    openDetail: (title: string, body: string, meta?: string | null) => void;
    afterHitlAction?: () => void | Promise<void>;
  }>();

  /** Optional note sent with approve (not the same as inject). */
  let approveNotes = $state<Record<string, string>>({});
  let injectContexts = $state<Record<string, string>>({});
  let overrideReason = $state<Record<string, string>>({});
  let clarifyText = $state<Record<string, string>>({});
  let contextOpen = $state<Record<string, boolean>>({});
  let err = $state<string | null>(null);
  let actingId = $state<string | null>(null);
  let flashMessage = $state<string | null>(null);
  let flashTimer: ReturnType<typeof setTimeout> | null = null;
  /** Per clarification request: which assumption/constraint chips are on (for learning signal). */
  let pickerBits = $state<
    Record<string, { assumptionChecks: boolean[]; constraintChecks: boolean[] }>
  >({});

  function onPickerChange(
    id: string,
    payload: { assumptionChecks: boolean[]; constraintChecks: boolean[] }
  ) {
    pickerBits = { ...pickerBits, [id]: payload };
  }

  function kindOf(it: InterventionRequest): 'clarification' | 'quality_gate' {
    return it.kind ?? 'quality_gate';
  }

  function setApprove(id: string, v: string) {
    approveNotes = { ...approveNotes, [id]: v };
  }

  function setInject(id: string, v: string) {
    injectContexts = { ...injectContexts, [id]: v };
  }

  function setReason(id: string, v: string) {
    overrideReason = { ...overrideReason, [id]: v };
  }

  function setClarify(id: string, v: string) {
    clarifyText = { ...clarifyText, [id]: v };
  }

  function toggleContext(id: string) {
    contextOpen = { ...contextOpen, [id]: !contextOpen[id] };
  }

  function formatErr(e: unknown): string {
    const raw = e instanceof Error ? e.message : String(e);
    const s = summarizeBrainError(raw);
    return `${s.title}: ${s.hint}`;
  }

  function showFlash(msg: string) {
    flashMessage = msg;
    if (flashTimer) clearTimeout(flashTimer);
    flashTimer = setTimeout(() => {
      flashMessage = null;
    }, 4500);
  }

  async function withActing(id: string, fn: () => Promise<void>) {
    err = null;
    actingId = id;
    try {
      await fn();
      showFlash('Submitted — the Brain will continue.');
      await afterHitlAction();
    } catch (e) {
      err = formatErr(e);
    } finally {
      actingId = null;
    }
  }

  async function approve(id: string) {
    await withActing(id, () =>
      approveIntervention(id, approveNotes[id]?.trim() || undefined)
    );
  }

  async function inject(id: string) {
    const text = injectContexts[id]?.trim();
    if (!text) {
      err = 'Add instructions for the specialist before submitting a retry.';
      return;
    }
    await withActing(id, () => injectIntervention(id, text));
  }

  async function overrideFail(id: string) {
    await withActing(id, () =>
      overrideIntervention(id, 'failure', overrideReason[id]?.trim())
    );
  }

  async function overrideOk(id: string) {
    await withActing(id, () => overrideIntervention(id, 'success'));
  }

  async function clarify(id: string) {
    const it = items.find((i) => i.requestId === id);
    if (!it) return;
    const text = clarifyText[id]?.trim() ?? '';
    const aOpts = it.assumptionOptions ?? [];
    const cOpts = it.constraintOptions ?? [];
    const pb = pickerBits[id];
    const rowA = pb?.assumptionChecks ?? aOpts.map(() => true);
    const rowC = pb?.constraintChecks ?? cOpts.map(() => true);
    const confirmedA = aOpts.filter((_, i) => rowA[i]);
    const confirmedC = cOpts.filter((_, i) => rowC[i]);
    const hasPickers = aOpts.length > 0 || cOpts.length > 0;
    const hasSignal =
      text.length > 0 || confirmedA.length > 0 || confirmedC.length > 0;
    if (!hasSignal) {
      err = hasPickers
        ? 'Keep at least one assumption or constraint checked, or add written answers.'
        : 'Answer the questions before submitting.';
      return;
    }
    await withActing(id, () =>
      submitClarification(id, {
        answers: text,
        ...(confirmedA.length ? { confirmedAssumptions: confirmedA } : {}),
        ...(confirmedC.length ? { confirmedConstraints: confirmedC } : {})
      })
    );
  }

  function fullContextModal(it: InterventionRequest) {
    openDetail(
      `Intervention · ${it.requestId}`,
      [
        `## Why the Brain paused`,
        it.brainContext,
        ``,
        `## Suggested next step`,
        it.proposedNextStep,
        it.humanInstruction ? `\n## Prior note\n${it.humanInstruction}` : ''
      ].join('\n'),
      JSON.stringify({ kind: it.kind, requestId: it.requestId }, null, 2)
    );
  }
</script>

<section class="hitl" aria-labelledby="hitl-heading">
  <header class="hero">
    <h2 id="hitl-heading">Human in the loop</h2>
    <p class="lede">
      When confidence is low or clarification is needed, the Brain <strong>stops and waits</strong>. For pre-flight
      clarifications, confirm which <strong>AI assumptions and constraints</strong> are correct (learning signal for the
      next intake), answer the questions, then submit.
    </p>
    <p class="meta-line">
      <span class="count-pill">{items.length} open</span>
      {#if items.length === 0}
        <span class="all-clear">No action required right now.</span>
      {/if}
    </p>
  </header>

  {#if flashMessage}
    <p class="flash" role="status">{flashMessage}</p>
  {/if}
  {#if err}
    <p class="err" role="alert">{err}</p>
  {/if}

  <ul class="list">
    {#each items as it (it.requestId)}
      {@const k = kindOf(it)}
      {@const busy = actingId === it.requestId}
      <li class="card">
        <div class="card-head">
          <div class="titles">
            {#if k === 'clarification'}
              <h3 class="card-title">Clarification before running</h3>
              <p class="card-sub">Answer the questions so intake can continue safely.</p>
            {:else}
              <h3 class="card-title">Review before continuing</h3>
              <p class="card-sub">
                Reflection or confidence flagged this run. Approve, add context for a retry, or override how it is
                logged for training.
              </p>
            {/if}
          </div>
          <div class="card-badges">
            <span class="kind-pill" class:clar={k === 'clarification'} class:gate={k === 'quality_gate'}>
              {k === 'clarification' ? 'Pre-flight' : 'Quality gate'}
            </span>
            <code class="req-id" title={it.requestId}>{it.requestId}</code>
          </div>
        </div>

        <div class="summary-block">
          <p class="summary-text">{previewText(it.brainContext, 280)}</p>
          <p class="next-step">
            <span class="next-label">Suggested next step</span>
            {previewText(it.proposedNextStep, 200)}
          </p>
        </div>

        <div class="context-tools">
          <button
            type="button"
            class="ctx-toggle"
            aria-expanded={contextOpen[it.requestId] ?? false}
            onclick={() => toggleContext(it.requestId)}
          >
            {contextOpen[it.requestId] ? 'Hide' : 'Show'} full context
          </button>
          <button type="button" class="ctx-modal" onclick={() => fullContextModal(it)}>Open in modal</button>
        </div>

        {#if contextOpen[it.requestId]}
          <div class="context-expanded">
            <pre class="context-pre">{it.brainContext}</pre>
          </div>
        {/if}

        {#if k === 'clarification'}
          {#if (it.assumptionOptions?.length ?? 0) > 0 || (it.constraintOptions?.length ?? 0) > 0}
            <div class="learn-wrap">
              <IntakeSuggestionPicker
                requestId={it.requestId}
                assumptions={it.assumptionOptions ?? []}
                constraints={it.constraintOptions ?? []}
                onChange={onPickerChange}
              />
            </div>
          {/if}
          {#if it.rationale}
            <p class="rationale"><span class="rat-label">Why</span>{it.rationale}</p>
          {/if}
          {#if it.questions?.length}
            <div class="questions-wrap">
              <span class="q-heading">Questions from the Brain</span>
              <ol class="questions">
                {#each it.questions as q, i (i)}
                  <li>{q}</li>
                {/each}
              </ol>
            </div>
          {/if}
          <label class="field">
            <span class="field-label">
              Your answers
              {#if (it.assumptionOptions?.length ?? 0) > 0 || (it.constraintOptions?.length ?? 0) > 0}
                <span class="optional-tag">optional if selections above are enough</span>
              {/if}
            </span>
            <textarea
              rows="5"
              placeholder="Answer each question (numbered replies are fine). You can also rely on the assumption toggles alone."
              value={clarifyText[it.requestId] ?? ''}
              disabled={busy}
              oninput={(e) => setClarify(it.requestId, e.currentTarget.value)}
            ></textarea>
          </label>
          <div class="footer-actions">
            <button type="button" class="btn primary" disabled={busy} onclick={() => clarify(it.requestId)}>
              {busy ? 'Sending…' : 'Submit for next intake'}
            </button>
          </div>
        {:else}
          <div class="actions-grid" role="group" aria-label="Intervention actions">
            <article class="action-card">
              <h4 class="action-title">Approve & continue</h4>
              <p class="action-desc">
                Proceed with the current plan. Optionally leave a short note for the audit trail or specialist.
              </p>
              <label class="field tight">
                <span class="field-label optional">Optional note</span>
                <textarea
                  rows="2"
                  placeholder="e.g. Looks good — proceed"
                  value={approveNotes[it.requestId] ?? ''}
                  disabled={busy}
                  oninput={(e) => setApprove(it.requestId, e.currentTarget.value)}
                ></textarea>
              </label>
              <button type="button" class="btn primary full" disabled={busy} onclick={() => approve(it.requestId)}>
                {busy ? 'Working…' : 'Approve & continue'}
              </button>
            </article>

            <article class="action-card accent">
              <h4 class="action-title">Add instructions & retry</h4>
              <p class="action-desc">
                The specialist will run again with your text as extra context (Law 25–safe content only).
              </p>
              <label class="field tight">
                <span class="field-label">Instructions <span class="req">required</span></span>
                <textarea
                  rows="4"
                  placeholder="What should the model do differently?"
                  value={injectContexts[it.requestId] ?? ''}
                  disabled={busy}
                  oninput={(e) => setInject(it.requestId, e.currentTarget.value)}
                ></textarea>
              </label>
              <button type="button" class="btn secondary full" disabled={busy} onclick={() => inject(it.requestId)}>
                {busy ? 'Working…' : 'Submit & retry specialist'}
              </button>
            </article>

            <article class="action-card training">
              <h4 class="action-title">Override outcome (memory)</h4>
              <p class="action-desc">
                Record this run as success or failure for future recall — does not re-run the specialist by itself.
              </p>
              <label class="field tight">
                <span class="field-label optional">Failure reason (if marking failure)</span>
                <input
                  type="text"
                  value={overrideReason[it.requestId] ?? ''}
                  disabled={busy}
                  oninput={(e) => setReason(it.requestId, e.currentTarget.value)}
                />
              </label>
              <div class="train-row">
                <button
                  type="button"
                  class="btn success"
                  disabled={busy}
                  onclick={() => overrideOk(it.requestId)}
                >
                  Mark success
                </button>
                <button
                  type="button"
                  class="btn danger"
                  disabled={busy}
                  onclick={() => overrideFail(it.requestId)}
                >
                  Mark failure
                </button>
              </div>
            </article>
          </div>
        {/if}
      </li>
    {:else}
      <li class="empty-card">You're all caught up — no pending human decisions.</li>
    {/each}
  </ul>
</section>

<style>
  .hitl {
    border-radius: var(--radius);
    border: 1px solid var(--border);
    background: var(--surface);
    overflow: hidden;
  }

  .hero {
    padding: 0.75rem 0.9rem 0.65rem;
    border-bottom: 1px solid var(--border);
    background: linear-gradient(
      135deg,
      color-mix(in srgb, var(--phase-hitl) 10%, var(--surface-elevated)) 0%,
      var(--surface) 100%
    );
  }

  .hero h2 {
    margin: 0 0 0.35rem;
    font-size: 1rem;
    font-weight: 650;
    color: var(--text);
    letter-spacing: -0.02em;
  }

  .lede {
    margin: 0 0 0.5rem;
    font-size: 0.8rem;
    line-height: 1.5;
    color: var(--text-muted);
    max-width: 48rem;
  }

  .lede strong {
    color: var(--text);
    font-weight: 600;
  }

  .meta-line {
    margin: 0;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.74rem;
  }

  .count-pill {
    font-weight: 650;
    font-size: 0.68rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    padding: 0.15rem 0.5rem;
    border-radius: 999px;
    border: 1px solid color-mix(in srgb, var(--phase-hitl) 40%, var(--border));
    color: color-mix(in srgb, var(--phase-hitl) 90%, white);
    background: color-mix(in srgb, var(--phase-hitl) 12%, var(--surface));
  }

  .all-clear {
    color: var(--success);
    font-weight: 500;
  }

  .flash {
    margin: 0;
    padding: 0.45rem 0.9rem;
    font-size: 0.8rem;
    color: var(--success);
    background: color-mix(in srgb, var(--success) 10%, var(--surface));
    border-bottom: 1px solid color-mix(in srgb, var(--success) 25%, var(--border));
  }

  .err {
    margin: 0;
    padding: 0.45rem 0.9rem;
    font-size: 0.8rem;
    color: color-mix(in srgb, var(--danger) 90%, white);
    background: var(--danger-soft);
    border-bottom: 1px solid color-mix(in srgb, var(--danger) 35%, var(--border));
  }

  .list {
    list-style: none;
    margin: 0;
    padding: 0;
    max-height: min(72vh, 44rem);
    overflow: auto;
  }

  .card {
    padding: 0.85rem 0.9rem;
    border-bottom: 1px solid color-mix(in srgb, var(--border) 85%, transparent);
    display: grid;
    gap: 0.55rem;
  }

  .card:last-child {
    border-bottom: none;
  }

  .card-head {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: 0.65rem;
    align-items: flex-start;
  }

  .titles {
    flex: 1 1 12rem;
    min-width: 0;
  }

  .card-title {
    margin: 0 0 0.2rem;
    font-size: 0.9rem;
    font-weight: 650;
    color: var(--text);
  }

  .card-sub {
    margin: 0;
    font-size: 0.74rem;
    line-height: 1.45;
    color: var(--text-dim);
  }

  .card-badges {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 0.35rem;
    flex-shrink: 0;
  }

  .kind-pill {
    font-size: 0.62rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    padding: 0.12rem 0.45rem;
    border-radius: 999px;
    border: 1px solid var(--border);
    color: var(--text-muted);
  }

  .kind-pill.clar {
    border-color: color-mix(in srgb, var(--amber) 45%, var(--border));
    color: var(--amber);
    background: color-mix(in srgb, var(--amber) 10%, var(--surface));
  }

  .kind-pill.gate {
    border-color: color-mix(in srgb, var(--accent) 40%, var(--border));
    color: var(--accent);
    background: var(--accent-soft);
  }

  .req-id {
    font-size: 0.65rem;
    color: var(--text-dim);
    max-width: 14rem;
    text-align: right;
    word-break: break-all;
  }

  .summary-block {
    padding: 0.5rem 0.55rem;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border);
    background: var(--bg-subtle);
    display: grid;
    gap: 0.35rem;
  }

  .summary-text {
    margin: 0;
    font-size: 0.78rem;
    line-height: 1.45;
    color: var(--text-muted);
  }

  .next-step {
    margin: 0;
    font-size: 0.76rem;
    line-height: 1.4;
    color: var(--text);
  }

  .next-label {
    display: block;
    font-size: 0.62rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-dim);
    margin-bottom: 0.2rem;
  }

  .context-tools {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    align-items: center;
  }

  .ctx-toggle,
  .ctx-modal {
    font: inherit;
    font-size: 0.74rem;
    padding: 0.25rem 0.55rem;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border);
    background: var(--surface-elevated);
    color: var(--accent);
    cursor: pointer;
  }

  .ctx-modal {
    color: var(--text-muted);
  }

  .ctx-toggle:hover,
  .ctx-modal:hover {
    border-color: var(--border-strong);
    color: var(--text);
  }

  .context-expanded {
    max-height: 14rem;
    overflow: auto;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border);
    background: var(--bg);
  }

  .context-pre {
    margin: 0;
    padding: 0.5rem 0.6rem;
    font-size: 0.72rem;
    line-height: 1.4;
    white-space: pre-wrap;
    word-break: break-word;
    color: var(--text-muted);
    font-family: ui-monospace, monospace;
  }

  .learn-wrap {
    display: grid;
    gap: 0.5rem;
  }

  .optional-tag {
    font-weight: 400;
    color: var(--text-dim);
    font-size: 0.65rem;
    margin-left: 0.35rem;
  }

  .rationale {
    margin: 0;
    font-size: 0.76rem;
    line-height: 1.45;
    color: var(--text-muted);
    padding: 0.4rem 0.5rem;
    border-left: 3px solid var(--amber);
    background: color-mix(in srgb, var(--amber) 6%, var(--surface));
    border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
  }

  .rat-label {
    font-weight: 700;
    color: var(--amber);
    margin-right: 0.35rem;
  }

  .questions-wrap {
    display: grid;
    gap: 0.35rem;
  }

  .q-heading {
    font-size: 0.62rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-dim);
  }

  .questions {
    margin: 0;
    padding-left: 1.15rem;
    font-size: 0.8rem;
    line-height: 1.45;
    color: var(--text);
  }

  .field {
    display: grid;
    gap: 0.3rem;
  }

  .field.tight {
    gap: 0.22rem;
  }

  .field-label {
    font-size: 0.72rem;
    font-weight: 600;
    color: var(--text-muted);
  }

  .field-label.optional::after {
    content: ' · optional';
    font-weight: 400;
    color: var(--text-dim);
  }

  .req {
    color: var(--phase-hitl);
    font-weight: 700;
    font-size: 0.65rem;
    text-transform: uppercase;
  }

  textarea,
  input[type='text'] {
    font: inherit;
    font-size: 0.82rem;
    padding: 0.45rem 0.55rem;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border);
    background: var(--bg-subtle);
    color: var(--text);
    width: 100%;
    box-sizing: border-box;
  }

  textarea:focus-visible,
  input:focus-visible {
    outline: 2px solid color-mix(in srgb, var(--accent) 55%, transparent);
    outline-offset: 1px;
  }

  textarea:disabled,
  input:disabled {
    opacity: 0.55;
  }

  .footer-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
  }

  .actions-grid {
    display: grid;
    gap: 0.65rem;
  }

  @media (min-width: 720px) {
    .actions-grid {
      grid-template-columns: 1fr 1fr;
    }

    .action-card.training {
      grid-column: 1 / -1;
    }
  }

  .action-card {
    padding: 0.65rem 0.7rem;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border);
    background: var(--surface-elevated);
    display: grid;
    gap: 0.45rem;
    align-content: start;
  }

  .action-card.accent {
    border-color: color-mix(in srgb, var(--accent) 35%, var(--border));
    background: linear-gradient(
      160deg,
      color-mix(in srgb, var(--accent) 8%, var(--surface-elevated)) 0%,
      var(--surface-elevated) 100%
    );
  }

  .action-card.training {
    border-color: color-mix(in srgb, var(--text-dim) 50%, var(--border));
    background: var(--bg-subtle);
  }

  .action-title {
    margin: 0;
    font-size: 0.82rem;
    font-weight: 650;
    color: var(--text);
  }

  .action-desc {
    margin: 0;
    font-size: 0.72rem;
    line-height: 1.45;
    color: var(--text-dim);
  }

  .btn {
    font: inherit;
    font-size: 0.78rem;
    font-weight: 600;
    padding: 0.4rem 0.75rem;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--text);
    cursor: pointer;
  }

  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn.full {
    justify-self: stretch;
    text-align: center;
  }

  .btn.primary {
    border-color: var(--accent-border);
    background: linear-gradient(180deg, color-mix(in srgb, var(--accent) 82%, #1a3a8a) 0%, #2a4ab0 100%);
    color: #fff;
  }

  .btn.secondary {
    border-color: color-mix(in srgb, var(--accent) 40%, var(--border));
    background: var(--accent-soft);
    color: var(--text);
  }

  .btn.success {
    border-color: color-mix(in srgb, var(--success) 45%, var(--border));
    color: var(--success);
    background: color-mix(in srgb, var(--success) 10%, var(--surface));
  }

  .btn.danger {
    border-color: color-mix(in srgb, var(--danger) 45%, var(--border));
    color: color-mix(in srgb, var(--danger) 92%, white);
    background: var(--danger-soft);
  }

  .train-row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
  }

  .empty-card {
    padding: 1.25rem 0.9rem;
    color: var(--text-dim);
    font-size: 0.85rem;
    text-align: center;
  }
</style>
