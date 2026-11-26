import type { RewriteVersion } from '../versions';
export type { RewriteVersion };
export type ProofmarksTarget = { kind: 'meta'; field: 'description' | 'summary' | 'takeaways'; index?: number };
export type ProofmarksEdit = {
  target?: ProofmarksTarget;
  before: string;
  after: string;
  start: number;
  end: number;
  context?: { left: string; right: string };
};
export type ProofmarksJudge = {
  model: string;
  score?: number;
  probability?: number;
  provider?: string;
  threshold: number;
  rulesVersion?: string;
  candidate?: string;
  scope?: 'phrase' | 'sentence' | 'pair';
  after?: number | { probability: number; provider: string; model: string };
  signals?: { id: string; label: string; score: number; threshold?: number }[];
};
export type ProofmarksMark = 'underline' | 'box' | 'circle' | 'strike-through' | 'crossed-off' | 'caret';
export type ProofmarksEditType = 'replace' | 'delete' | 'insert' | 'paragraph';
export type ProofmarksRule = {
  id: string;
  label: string;
  color: string;
  mark?: ProofmarksMark;
  edit?: ProofmarksEditType;
  level?: 'word' | 'sentence' | 'paragraph';
  why?: string;
  fix?: string;
  rubric?: { checks: string; looksLike: string; notLike: string; fix: string };
};
export type ProofmarksFinding = {
  id: string;
  rule: string;
  match: string;
  target?: ProofmarksTarget;
  hiddenCopies?: ProofmarksTarget[];
  edits?: ProofmarksEdit[];
  proposed?: string;
  proposals?: RewriteVersion[];
  edit?: ProofmarksEditType;
  level?: 'word' | 'sentence' | 'paragraph';
  rewriteRequest?: {
    status: 'pending' | 'claimed' | 'proposed' | 'failed';
    version?: number;
    target?: string;
    claimedBy?: string;
    claimedAt?: string;
    error?: string;
    requestedAt?: string;
    proposedAt?: string;
    by?: string;
    stillFlagged?: boolean;
  };
  note?: string;
  severity?: 'flag' | 'warning';
  judge?: ProofmarksJudge;
  score?: number;
  span?: { start: number; end: number };
  supersededBy?: string;
  supersededFindings?: ProofmarksFinding[];
  status?: 'open' | 'accepted' | 'accepted-unrecorded' | 'dismissed' | 'superseded';
  appliedAt?: string;
  before?: string;
  after?: string;
  actionReason?: string;
};
/** A rule this site has made calls on, and where its line sits now. */
export type ProofmarksStrictness = { rule: string; line: number; base: number; kept: number; dismissed: number };
export type ProofmarksReview = {
  rules: ProofmarksRule[];
  findings: ProofmarksFinding[];
  strictness?: ProofmarksStrictness[];
  source?: string;
  reviewId?: string;
  judge?: {
    model: string;
    generatedAt: string;
    rulesVersion: string;
    maybe?: { rule: string; text: string; score: number }[];
  };
  revision?: string;
  sourceRevision?: string;
  reconciliationWarnings?: string[];
};
export type ProofmarksActionResult = { ok: boolean; reason?: string; review?: ProofmarksReview };
export type ProofmarksActionOptions = { expectedCopies?: ProofmarksTarget[]; version?: number; another?: boolean };
export type ProofmarksAction = (
  finding: ProofmarksFinding,
  options?: ProofmarksActionOptions,
) => ProofmarksActionResult | Promise<ProofmarksActionResult>;

export type ProofmarksCompanionStatus = {
  connected: boolean;
  provider?: string;
  model?: string;
  rulesVersion?: string;
  lastReviewTime?: string | null;
  reason?: string;
};

export type ProofmarksAgents = {
  agents: {
    id: string;
    host: 'claude-code' | 'codex' | 'pi' | 'other';
    label: string;
    project: string;
    startedAt: string;
    delivery: 'push' | 'watch' | 'manual';
  }[];
  headless: { id: string; label: string; available: boolean }[];
  target: string | null;
  resolvedTarget: string | null;
};
export type ProofmarksTargetResult = { ok: boolean; reason?: string; agents?: ProofmarksAgents };
