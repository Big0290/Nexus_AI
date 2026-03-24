<script lang="ts">
  import type { InterpretationResult, TaskRunResult } from '../lib/types.js';
  import TaskForm from './TaskForm.svelte';
  import DocumentTeachPanel from './DocumentTeachPanel.svelte';
  import LastRunResult from './LastRunResult.svelte';
  import LastIntakeSnapshot from './LastIntakeSnapshot.svelte';

  type LastRunSnapshot = TaskRunResult & { receivedAt: string };

  let {
    lastTaskResult = null,
    onClearLastResult,
    onGoKnowledge,
    onGoReview,
    lastInterpretation = null,
    processing = false
  } = $props<{
    lastTaskResult?: LastRunSnapshot | null;
    onClearLastResult?: () => void;
    onGoKnowledge?: () => void;
    onGoReview?: () => void;
    lastInterpretation?: InterpretationResult | null;
    processing?: boolean;
  }>();
</script>

<div class="run-panel">
  <LastRunResult
    result={lastTaskResult ?? null}
    onClear={onClearLastResult}
    onGoKnowledge={onGoKnowledge}
    onGoReview={onGoReview}
  />

  {#if lastTaskResult == null}
    <p class="result-placeholder">
      When a run completes, the <strong>full specialist output</strong> appears above — with copy, JSON formatting when
      applicable, and a link to the saved outcome in Knowledge.
    </p>
  {/if}

  <LastIntakeSnapshot
    interpretation={lastInterpretation}
    {processing}
    onGoHumanReview={onGoReview}
  />

  <header class="run-hero">
    <h2 class="run-title">Run</h2>
    <p class="run-lede">
      Start work in two ways: describe a <strong>task</strong> for the Brain, or <strong>upload documents</strong> to teach
      into memory (masked, then learned). Follow progress on <strong>Observe</strong>.
    </p>
  </header>

  <div class="run-grid">
    <section class="run-section run-section--task" aria-labelledby="run-heading-task">
      <div class="run-section-head">
        <h3 id="run-heading-task" class="run-section-title">General task</h3>
        <span class="run-badge">Prompt</span>
      </div>
      <p class="run-section-desc">
        Natural-language instructions. The Brain recalls similar outcomes, plans, runs the specialist, and reflects.
      </p>
      <TaskForm />
    </section>

    <section class="run-section run-section--teach" aria-labelledby="run-heading-teach">
      <div class="run-section-head">
        <h3 id="run-heading-teach" class="run-section-title">Teach from documents</h3>
        <span class="run-badge run-badge--teal">Upload</span>
      </div>
      <p class="run-section-desc">
        PDF, spreadsheets, CSV, images, or text. Content is Law 25–masked on the server, then fed to the learner.
      </p>
      <DocumentTeachPanel />
    </section>
  </div>
</div>

<style>
  .run-panel {
    display: grid;
    gap: 1rem;
  }

  .result-placeholder {
    margin: 0;
    font-size: 0.76rem;
    line-height: 1.45;
    color: var(--text-dim);
    padding: 0.5rem 0.65rem;
    border-radius: var(--radius);
    border: 1px dashed color-mix(in srgb, var(--border) 85%, transparent);
    background: color-mix(in srgb, var(--surface) 92%, var(--bg));
  }

  .result-placeholder strong {
    color: var(--text-muted);
    font-weight: 600;
  }

  .run-hero {
    padding: 0.65rem 0.85rem;
    border-radius: var(--radius, 0.5rem);
    border: 1px solid var(--border);
    background: linear-gradient(
      135deg,
      color-mix(in srgb, var(--accent) 8%, var(--surface)) 0%,
      var(--surface) 100%
    );
  }

  .run-title {
    margin: 0 0 0.35rem;
    font-size: 1.05rem;
    font-weight: 650;
    letter-spacing: -0.02em;
    color: var(--text);
  }

  .run-lede {
    margin: 0;
    font-size: 0.8rem;
    line-height: 1.5;
    color: var(--text-muted);
    max-width: 52rem;
  }

  .run-lede strong {
    color: var(--text);
    font-weight: 600;
  }

  .run-grid {
    display: grid;
    gap: 1rem;
  }

  @media (min-width: 960px) {
    .run-grid {
      grid-template-columns: 1fr 1fr;
      align-items: start;
    }
  }

  .run-section {
    border-radius: var(--radius);
    border: 1px solid var(--border);
    background: var(--surface);
    padding: 0.75rem 0.85rem 0.85rem;
    display: grid;
    gap: 0.55rem;
    box-shadow: 0 1px 0 color-mix(in srgb, var(--border) 40%, transparent);
  }

  .run-section--task {
    border-left: 3px solid var(--accent);
  }

  .run-section--teach {
    border-left: 3px solid var(--teal);
  }

  .run-section-head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
  }

  .run-section-title {
    margin: 0;
    font-size: 0.92rem;
    font-weight: 650;
    color: var(--text);
  }

  .run-section-desc {
    margin: 0;
    font-size: 0.74rem;
    line-height: 1.45;
    color: var(--text-dim);
  }

  .run-badge {
    font-size: 0.62rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    padding: 0.12rem 0.45rem;
    border-radius: 999px;
    border: 1px solid color-mix(in srgb, var(--accent) 45%, var(--border));
    color: var(--accent);
    background: var(--accent-soft);
  }

  .run-badge--teal {
    border-color: color-mix(in srgb, var(--teal) 45%, var(--border));
    color: var(--teal);
    background: var(--teal-soft);
  }
</style>
