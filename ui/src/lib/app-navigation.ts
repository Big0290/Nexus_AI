/**
 * Single source of truth for primary / review workspace navigation.
 */

export type PrimaryTabId = 'run' | 'observe' | 'review' | 'memory' | 'brain';

export type ReviewPanelId = 'hitl' | 'audit';

export type PrimaryNavItem = {
  id: PrimaryTabId;
  label: string;
  hint: string;
};

export type ReviewNavItem = {
  id: ReviewPanelId;
  label: string;
  hint: string;
};

export const PRIMARY_NAV: PrimaryNavItem[] = [
  { id: 'run', label: 'Run', hint: 'Chat, teach, prompt & output — HITL in Chat' },
  { id: 'observe', label: 'Observe', hint: 'Thought stream and live reasoning' },
  { id: 'review', label: 'Review', hint: 'Human review (HITL) and compliance audit' },
  { id: 'memory', label: 'Knowledge', hint: 'Outcome memory — browse and edit' },
  { id: 'brain', label: 'System', hint: 'Health, API key, session' }
];

export const REVIEW_NAV: ReviewNavItem[] = [
  { id: 'hitl', label: 'Human review', hint: 'Approve, clarify, or override when the Brain pauses' },
  { id: 'audit', label: 'Compliance', hint: 'Law 25 audit log' }
];

/** Primary tabs that show the HITL count badge when interventions are pending. */
export function primaryTabShowsHitlBadge(id: PrimaryTabId): boolean {
  return id === 'run' || id === 'review';
}
