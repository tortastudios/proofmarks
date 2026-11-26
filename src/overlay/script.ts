import { mountProofmarks } from './index';
import { optimisticProse, readsAsMarkdown } from './optimistic-prose';
import { createProofmarksTransport, startHint } from './transport';
import { keepCurrent } from './live';
import type { Decision } from './transport';
import type { ProofmarksActionOptions, ProofmarksActionResult, ProofmarksFinding, ProofmarksReview } from './types';

export const setupHint = "This page isn't in proofmarks.config.json. Add its source and url to documents.";
export function documentRoot(doc: Document, selector?: string): HTMLElement {
  return (
    (selector ? doc.querySelector<HTMLElement>(selector) : null) ??
    doc.querySelector<HTMLElement>('[data-proofmarks-root]') ??
    doc.querySelector<HTMLElement>('main') ??
    doc.querySelector<HTMLElement>('article') ??
    doc.body
  );
}

/** Mount once per script; keep the same surface through host article replacement. */
export function startProofmarks(script: HTMLScriptElement | null, doc = document) {
  const win = doc.defaultView!;
  const base = script?.src ? new URL(script.src, doc.baseURI).origin : win.location.origin;
  const transport = createProofmarksTransport(base);
  let root = documentRoot(doc, script?.dataset.root),
    disposed = false,
    pending = false;
  let reviewId = script?.dataset.document;
  let current: ProofmarksReview = { findings: [], rules: [] };
  let handle: ReturnType<typeof mountProofmarks> | undefined;
  // Accept's instant swap puts reading text in the page, never Markdown syntax, which would also hide the accepted mark.
  const formatOptimisticText = (text: string, matched: string) =>
    readsAsMarkdown(current.source, script?.dataset.prose) ? optimisticProse(text, matched) : text;
  const action =
    (kind: Decision) =>
    async (finding?: ProofmarksFinding, options?: ProofmarksActionOptions): Promise<ProofmarksActionResult> => {
      if (pending) return { ok: false, reason: 'Another action is being saved.' };
      pending = true;
      try {
        const result = await transport.decision(kind, reviewId!, current, finding, options);
        if (result.review) current = result.review;
        return result;
      } catch (error) {
        return { ok: false, reason: error instanceof Error ? error.message : startHint };
      } finally {
        pending = false;
      }
    };
  const recheck = async (): Promise<ProofmarksActionResult> => {
    if (pending) return { ok: false, reason: 'Another action is being saved.' };
    pending = true;
    try {
      const result = await transport.recheck(reviewId!);
      if (result.ok) {
        current = await transport.review(reviewId!);
        return { ok: true, review: current };
      }
      return result;
    } catch {
      return { ok: false, reason: startHint };
    } finally {
      pending = false;
    }
  };
  async function agents() {
    try {
      const value = await transport.agents();
      if (!disposed) handle?.setAgents(value);
      return value;
    } catch {
      if (!disposed) handle?.setAgents(undefined, 'Couldn’t load agents. Try again.');
      return undefined;
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
  function syncRoot() {
    if (disposed || !handle) return;
    const nextRoot = documentRoot(doc, script?.dataset.root);
    if (root !== nextRoot) {
      root = nextRoot;
      handle.setRoot(root);
    }
  }
  const rootObserver = new MutationObserver(syncRoot);
  rootObserver.observe(doc.body, { subtree: true, childList: true });
  async function refresh() {
    if (disposed || pending || !reviewId) return;
    syncRoot();
    try {
      const next = await transport.review(reviewId);
      if (!disposed && !pending && next.revision !== current.revision) {
        current = next;
        handle?.setReview(next);
      }
    } catch {
      if (!disposed) handle?.setCompanionStatus({ connected: false, reason: startHint });
    }
  }
  function mount(hint?: string) {
    if (disposed) return;
    handle = mountProofmarks({
      root,
      ...current,
      reviewId,
      setupHint: hint,
      optimisticText: true,
      formatOptimisticText,
      avoid: script?.dataset.avoid?.split('|').filter(Boolean),
      onMeasure: stage => win.performance.mark('proofmarks:' + stage),
      ...(hint
        ? {}
        : {
            onAccept: action('accept'),
            onDismiss: action('dismiss'),
            onRevert: action('revert'),
            onRequestRewrite: action('request-rewrite'),
            onCancelRewrite: action('cancel-rewrite'),
            onReview: recheck,
            onResetStrictness: rule => transport.resetStrictness(rule),
            onSelectTarget: async (target: string) => {
              try {
                const result = await transport.target(target);
                return result.ok ? { ok: true, agents: await agents() } : result;
              } catch {
                return { ok: false, reason: 'Couldn’t change the rewrite target. Try again.' };
              }
            },
          }),
    });
  }
  let stopLive = () => {};
  void (async () => {
    try {
      await transport.session();
      if (!reviewId)
        reviewId = (await transport.match(win.location.pathname, root.innerText.slice(0, 4000))).reviewId ?? undefined;
      if (!reviewId) {
        mount(setupHint);
        return;
      }
      current = await transport.review(reviewId);
      mount();
      await Promise.all([agents(), status()]);
    } catch {
      mount(startHint);
    }
    // A page without a review still checks for one; a mounted page follows the helper's changes.
    if (!disposed)
      stopLive = keepCurrent(win, reviewId ? transport.changes(reviewId) : undefined, {
        review: () => void refresh(),
        agents: () => {
          if (handle && reviewId) void agents();
        },
        status: () => {
          if (handle && reviewId) void status();
        },
      });
  })();
  const stop = () => {
    disposed = true;
    rootObserver.disconnect();
    stopLive();
    handle?.unmount();
    win.removeEventListener('pagehide', stop);
    script?.removeEventListener('proofmarks:dispose', stop);
  };
  win.addEventListener('pagehide', stop);
  script?.addEventListener('proofmarks:dispose', stop, { once: true });
  return stop;
}

/** The classic bootstrap passes its script element across the asynchronous import. */
export function bootProofmarks(script: HTMLScriptElement | null) {
  if (script && !script.isConnected) return;
  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', () => startProofmarks(script), { once: true });
  else startProofmarks(script);
}
