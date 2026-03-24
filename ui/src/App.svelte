<script lang="ts">
  import type { ComplianceAuditEntry, OrchestratorState, ThoughtStreamEntry } from './lib/types.js';
  import type { TaskRunResult } from './lib/types.js';
  import type { PrimaryTabId, ReviewPanelId } from './lib/app-navigation.js';
  import { connectBrainEvents, fetchAudit, fetchOrchestratorState } from './lib/api.js';
  import { summarizeBrainError } from './lib/brain-errors.js';
  import FullContentModal from './components/FullContentModal.svelte';
  import TaskPhaseStrip from './components/TaskPhaseStrip.svelte';
  import HitlBanner from './components/HitlBanner.svelte';
  import AppHeader from './components/layout/AppHeader.svelte';
  import PrimaryNav from './components/layout/PrimaryNav.svelte';
  import ReviewSubnav from './components/layout/ReviewSubnav.svelte';
  import TaskErrorAlert from './components/layout/TaskErrorAlert.svelte';
  import WorkspaceRouter from './components/workspace/WorkspaceRouter.svelte';

  const initialState: OrchestratorState = {
    orchestratorId: 'brain-1',
    status: 'idle',
    currentTaskId: null,
    agentState: {
      status: 'idle',
      currentTask: null,
      history: []
    },
    thoughtStream: [],
    pendingInterventions: [],
    lastUpdated: new Date().toISOString(),
    processing: false,
    lastInterpretation: null,
    lastSessionId: null,
    modelMode: 'mock'
  };

  let orchestrator = $state<OrchestratorState>(initialState);
  let thoughts = $state<ThoughtStreamEntry[]>([]);
  let audit = $state<ComplianceAuditEntry[]>([]);
  let memoryRefresh = $state(0);
  type LastRunSnapshot = TaskRunResult & { receivedAt: string };

  let lastSuccess = $state<string | null>(null);
  let lastTaskResult = $state<LastRunSnapshot | null>(null);
  let taskError = $state<{ title: string; hint: string; detail: string } | null>(null);

  let tab = $state<PrimaryTabId>('run');
  let reviewPanel = $state<ReviewPanelId>('hitl');

  let detail = $state<{ title: string; body: string; meta?: string | null } | null>(null);

  function openDetail(title: string, body: string, meta?: string | null) {
    detail = { title, body, meta: meta ?? undefined };
  }

  function closeDetail() {
    detail = null;
  }

  async function refreshSideData() {
    try {
      const a = await fetchAudit(120);
      audit = a.entries as ComplianceAuditEntry[];
    } catch {
      /* offline / cold start */
    }
    memoryRefresh++;
    try {
      const st = (await fetchOrchestratorState()) as OrchestratorState;
      orchestrator = st;
      thoughts = st.thoughtStream;
    } catch {
      /* e.g. NEXUS_API_KEY on server but not in browser */
    }
  }

  $effect(() => {
    const off = connectBrainEvents((ev) => {
      if (ev.type === 'state' && 'state' in ev && ev.state) {
        orchestrator = ev.state as OrchestratorState;
        thoughts = orchestrator.thoughtStream;
      } else if (ev.type === 'task_complete' && 'result' in ev) {
        const r = ev.result as TaskRunResult;
        const snap: LastRunSnapshot = { ...r, receivedAt: new Date().toISOString() };
        lastTaskResult = snap;
        if (r.status === 'error' && r.error) {
          const s = summarizeBrainError(r.error);
          taskError = { title: s.title, hint: s.hint, detail: s.detail };
          lastSuccess = null;
        } else {
          taskError = null;
          const bit = r.finalResult?.trim() ? r.finalResult.trim().slice(0, 200) : '';
          lastSuccess =
            r.status === 'completed'
              ? bit
                ? `Completed · ${bit}${r.finalResult && r.finalResult.length > 200 ? '…' : ''}`
                : 'Completed'
              : r.status === 'awaiting_human'
                ? 'Awaiting human (Run → Chat or Review → Human review)'
                : `${r.status ?? 'done'}`;
        }
        void refreshSideData();
      }
    });
    void refreshSideData();
    return off;
  });

  const hitlCount = $derived(orchestrator.pendingInterventions.length);

  function goMemory() {
    tab = 'memory';
  }

  function goReviewHitl() {
    tab = 'review';
    reviewPanel = 'hitl';
  }
</script>

<main class="app-shell">
  <AppHeader orchestrator={orchestrator} lastSuccessLine={lastSuccess} {hitlCount} />

  {#if taskError}
    <TaskErrorAlert
      title={taskError.title}
      hint={taskError.hint}
      onDismiss={() => (taskError = null)}
      onOpenDetail={() => {
        const e = taskError;
        if (e) openDetail(e.title, e.detail, 'Full error from Brain / Gemini');
      }}
    />
  {/if}

  <TaskPhaseStrip orchestrator={orchestrator} lastThoughtPhase={thoughts[0]?.phase ?? null} />

  {#if hitlCount > 0 && tab !== 'run'}
    <HitlBanner
      count={hitlCount}
      onGoToInterventions={() => {
        tab = 'run';
      }}
    />
  {/if}

  <PrimaryNav activeTab={tab} {hitlCount} onSelect={(id) => (tab = id)} />

  {#if tab === 'review'}
    <ReviewSubnav activePanel={reviewPanel} {hitlCount} onSelect={(id) => (reviewPanel = id)} />
  {/if}

  <section class="app-workspace" aria-label="Main content">
    <WorkspaceRouter
      {tab}
      {reviewPanel}
      {orchestrator}
      {thoughts}
      {audit}
      memoryRefresh={memoryRefresh}
      lastTaskResult={lastTaskResult}
      {openDetail}
      refreshSideData={refreshSideData}
      onClearLastResult={() => (lastTaskResult = null)}
      onGoKnowledge={goMemory}
      onGoReview={goReviewHitl}
    />
  </section>
</main>

<FullContentModal
  open={detail !== null}
  title={detail?.title ?? ''}
  body={detail?.body ?? ''}
  meta={detail?.meta ?? null}
  onClose={closeDetail}
/>
