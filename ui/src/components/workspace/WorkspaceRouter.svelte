<script lang="ts">
  import type { ComplianceAuditEntry, OrchestratorState, ThoughtStreamEntry } from '../../lib/types.js';
  import type { TaskRunResult } from '../../lib/types.js';
  import type { PrimaryTabId, ReviewPanelId } from '../../lib/app-navigation.js';
  import RunPanel from '../RunPanel.svelte';
  import ThoughtStream from '../ThoughtStream.svelte';
  import InterventionQueue from '../InterventionQueue.svelte';
  import CompliancePanel from '../CompliancePanel.svelte';
  import OutcomeMemoryPanel from '../OutcomeMemoryPanel.svelte';
  import BrainOverview from '../BrainOverview.svelte';

  type LastRunSnapshot = TaskRunResult & { receivedAt: string };

  let {
    tab,
    reviewPanel,
    orchestrator,
    thoughts,
    audit,
    memoryRefresh,
    lastTaskResult,
    openDetail,
    refreshSideData,
    onClearLastResult,
    onGoKnowledge,
    onGoReview
  } = $props<{
    tab: PrimaryTabId;
    reviewPanel: ReviewPanelId;
    orchestrator: OrchestratorState;
    thoughts: ThoughtStreamEntry[];
    audit: ComplianceAuditEntry[];
    memoryRefresh: number;
    lastTaskResult: LastRunSnapshot | null;
    openDetail: (title: string, body: string, meta?: string | null) => void;
    refreshSideData: () => void | Promise<void>;
    onClearLastResult: () => void;
    onGoKnowledge: () => void;
    onGoReview: () => void;
  }>();
</script>

{#if tab === 'run'}
  <RunPanel
    lastTaskResult={lastTaskResult}
    onClearLastResult={onClearLastResult}
    onGoKnowledge={onGoKnowledge}
    onGoReview={onGoReview}
    lastInterpretation={orchestrator.lastInterpretation}
    processing={orchestrator.processing}
    sessionHistoryRefresh={memoryRefresh}
    pendingInterventions={orchestrator.pendingInterventions}
    {openDetail}
    afterHitlAction={refreshSideData}
  />
{:else if tab === 'observe'}
  <ThoughtStream entries={thoughts} {openDetail} />
{:else if tab === 'review' && reviewPanel === 'hitl'}
  <InterventionQueue items={orchestrator.pendingInterventions} {openDetail} afterHitlAction={refreshSideData} />
{:else if tab === 'review' && reviewPanel === 'audit'}
  <CompliancePanel entries={audit} {openDetail} />
{:else if tab === 'memory'}
  <OutcomeMemoryPanel {openDetail} refreshKey={memoryRefresh} afterTeach={refreshSideData} />
{:else}
  <BrainOverview orchestrator={orchestrator} />
{/if}
