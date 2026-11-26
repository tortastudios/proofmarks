'use client';
import { useEffect } from 'react';
import type {
  ProofmarksReview,
  ProofmarksFinding,
  ProofmarksActionOptions,
  ProofmarksActionResult,
  ProofmarksAgents,
  ProofmarksTargetResult,
} from './types';
import { createProofmarksTransport, startHint } from './transport';
import { keepCurrent } from './live';
const noAvoid: string[] = [];
export type ProofmarksProps = {
  reviewId: string;
  base?: string;
  endpoint?: string;
  rootSelector?: string;
  avoid?: string[];
  onSourceChange?: () => void;
  formatOptimisticText?: (text: string, matchedText: string) => string;
  onMeasure?: (stage: string) => void;
};
/** Optional React lifecycle and helper transport around the plain DOM overlay. */
export function Proofmarks({
  reviewId,
  base = 'http://127.0.0.1:4848',
  endpoint,
  rootSelector = '#main-content',
  avoid = noAvoid,
  onSourceChange,
  formatOptimisticText,
  onMeasure,
}: ProofmarksProps) {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'development') return;
    const transport = createProofmarksTransport(base, fetch, endpoint);
    let disposed = false,
      pending = false;
    const warned = new Set<string>();
    const warn = (review: ProofmarksReview) => {
      for (const warning of review.reconciliationWarnings ?? []) {
        const key = review.revision + warning;
        if (!warned.has(key)) {
          warned.add(key);
          console.warn(warning);
        }
      }
    };
    let currentAgents: ProofmarksAgents | undefined;
    let agentsReason: string | undefined;
    let current: ProofmarksReview = { findings: [], rules: [] };
    let handle: ReturnType<typeof import('./index').mountProofmarks> | undefined;
    const refresh = async () => {
      if (disposed) return;
      if (handle) syncRoot();
      if (pending) return;
      try {
        const review = await transport.review(reviewId);
        if (disposed || pending) return;
        if (review.revision !== current.revision) {
          warn(review);
          current = review;
          handle?.setReview(review);
        }
      } catch {}
    };
    const action =
      (kind: 'accept' | 'dismiss' | 'revert' | 'request-rewrite' | 'cancel-rewrite') =>
      async (
        finding: ProofmarksFinding | undefined,
        options?: ProofmarksActionOptions,
      ): Promise<ProofmarksActionResult> => {
        if (new URLSearchParams(window.location.search).get('mock') === 'settings')
          return { ok: false, reason: 'Preview only' };
        if (pending) return { ok: false, reason: 'Another action is being saved.' };
        pending = true;
        try {
          const result = await transport.decision(kind, reviewId, current, finding, options);
          if (result.review) {
            warn(result.review);
            current = result.review;
            if (!['request-rewrite', 'cancel-rewrite'].includes(kind)) onSourceChange?.();
          }
          return result;
        } catch {
          return { ok: false, reason: "Couldn't reach the review server. Please try again." };
        } finally {
          pending = false;
        }
      };
    const review = async (): Promise<ProofmarksActionResult> => {
      if (pending) return { ok: false, reason: 'Another action is being saved.' };
      pending = true;
      try {
        const result = await transport.recheck(reviewId);
        if (result.ok) {
          current = await transport.review(reviewId);
          return { ok: true, review: current };
        }
        return { ok: false, reason: result.reason ?? 'Review failed' };
      } catch {
        return { ok: false, reason: startHint };
      } finally {
        pending = false;
      }
    };
    void (async () => {
      await Promise.all([refresh(), loadAgents()]);
      const { mountProofmarks } = await import('./index');
      const root = document.querySelector<HTMLElement>(rootSelector);
      if (!disposed && root)
        handle = mountProofmarks({
          root,
          ...current,
          reviewId,
          optimisticText: true,
          formatOptimisticText,
          onMeasure,
          avoid,
          onAccept: action('accept'),
          onDismiss: action('dismiss'),
          onRevert: action('revert'),
          onRequestRewrite: action('request-rewrite'),
          onCancelRewrite: action('cancel-rewrite'),
          agents: currentAgents,
          onSelectTarget: selectTarget,
          onReview: review,
          onResetStrictness: rule => transport.resetStrictness(rule),
        });
      handle?.setAgents(currentAgents, agentsReason);
      void status();
    })();
    async function loadAgents() {
      try {
        const data = await transport.agents();
        if (!Array.isArray(data.agents) || !Array.isArray(data.headless)) throw Error();
        if (disposed) return;
        currentAgents = data;
        agentsReason = undefined;
        handle?.setAgents(data);
      } catch {
        if (!disposed) {
          currentAgents = undefined;
          agentsReason = 'Couldn’t load agents. Try again.';
          handle?.setAgents(undefined, agentsReason);
        }
      }
    }
    async function selectTarget(target: string): Promise<ProofmarksTargetResult> {
      try {
        const result = await transport.target(target);
        if (!result.ok) return { ok: false, reason: result.reason ?? 'Couldn’t change the rewrite target.' };
        await loadAgents();
        return agentsReason ? { ok: false, reason: agentsReason } : { ok: true, agents: currentAgents };
      } catch {
        return { ok: false, reason: 'Couldn’t change the rewrite target. Try again.' };
      }
    }
    async function status() {
      try {
        const value = await transport.status();
        if (!disposed) handle?.setCompanionStatus(value);
      } catch {
        if (!disposed) handle?.setCompanionStatus({ connected: false, reason: startHint });
      }
    }
    void status();
    const stopLive = keepCurrent(window, transport.changes(reviewId), {
      review: () => void refresh(),
      agents: () => void loadAgents(),
      status: () => void status(),
    });
    let refreshFrame = 0;
    const observer = new MutationObserver(() => {
      if (refreshFrame) return;
      refreshFrame = requestAnimationFrame(() => {
        refreshFrame = 0;
        void refresh();
      });
    });
    let content = document.querySelector<HTMLElement>(rootSelector);
    if (content) observer.observe(content, { subtree: true, childList: true, characterData: true });
    function syncRoot() {
      const next = document.querySelector<HTMLElement>(rootSelector);
      if (!next || next === content) return false;
      content = next;
      observer.disconnect();
      observer.observe(content, { subtree: true, childList: true, characterData: true });
      handle?.setRoot(content);
      return true;
    }
    const rootObserver = new MutationObserver(() => {
      if (syncRoot()) void refresh();
    });
    rootObserver.observe(document.body, { subtree: true, childList: true });
    return () => {
      disposed = true;
      stopLive();
      cancelAnimationFrame(refreshFrame);
      observer.disconnect();
      rootObserver.disconnect();
      handle?.unmount();
    };
  }, [reviewId, base, endpoint, rootSelector, avoid, onSourceChange, formatOptimisticText, onMeasure]);
  return null;
}
