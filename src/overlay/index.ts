import { replacementStart, tidyDeletion } from './deletion';
import { loadHandwritingFont } from './font-loader';
import { fontBytes } from './font-bytes';
import { rewriteState, updateAgentSettings } from './agents';
import { workingLine, workingStyles } from './working';
import type { ProofmarksAgents, ProofmarksTargetResult } from './types';
import { layoutWidth } from './viewport';
import { companionStatusText, ruleContent, settingsContent, settingsState as reviewSettings } from './settings';
import { surfaceStyles } from './surface-styles';
import { mergeLineRects } from './line-geometry';
import { layoutLineLabels, lineLabelWidth, lineRows, marginLabelLeft } from './label-layout';
import { readerActionReason } from './action-reason';
import { whyContent } from './judge-record';
import { completionMoment, completionStatus } from './completion';
import { proofTooltips } from './tooltips';
import { proofShortcut } from './shortcuts';
import { cardProse } from './card-prose';
import { proofSet, visibleProofs, stepAllProofs, lightRuleColor, ProofOrder, pageAnchorReason } from './proof-set';
import { reviewPill, proofmarkIcon } from './badge-pill';
import { badgeDock } from './badge-dock';
import { mobileSheet } from './mobile-sheet';
import { prepareWords, snapshotWords, playWords } from './word-morph';
import { replaceTextCopies } from './text-transaction';
import { findingHitRegion, containsPoint, type HitRect } from './hit-region';
import { cursorCardPosition, pinnedCardPosition, inkDissolveDelay } from './card-position';
import { marginSelectors, marginStyles } from './margins';
import { drawArrow } from './arrows';
import { markPlan } from './marks';
import { drawMark, findingSeed } from './drawing';
import { registryReview } from './registry';
import type { ProofmarksMark } from './types';
import { findProofmarks, findingRects } from './matcher';
import { proofmarksStyles } from './styles';
import type {
  ProofmarksFinding,
  ProofmarksReview,
  ProofmarksAction,
  ProofmarksActionOptions,
  ProofmarksActionResult,
  ProofmarksCompanionStatus,
} from './types';
import {
  versionSlots,
  selectedSlot,
  rewriteQueue,
  stepQueue,
  refreshIcon,
  chevronIcon,
  acceptsAll,
  acceptAllStatus,
} from './rewrite-versions';
import { rewriteVersions } from '../versions';
export type {
  ProofmarksAgents,
  ProofmarksTargetResult,
  ProofmarksFinding,
  ProofmarksReview,
  ProofmarksRule,
} from './types';
export type ProofmarksOptions = ProofmarksReview & {
  root: HTMLElement;
  setupHint?: string;
  agents?: ProofmarksAgents;
  onSelectTarget?: (target: string) => Promise<ProofmarksTargetResult>;
  onCancelRewrite?: (finding?: ProofmarksFinding) => Promise<ProofmarksActionResult>;
  avoid?: string[];
  onRequestRewrite?: (
    finding?: ProofmarksFinding,
    options?: ProofmarksActionOptions,
  ) => Promise<ProofmarksActionResult>;
  onReview?: () => Promise<ProofmarksActionResult>;
  /** Forget this site's calls on a rule; the overlay re-checks the page afterwards. */
  onResetStrictness?: (rule: string) => Promise<{ ok: boolean; reason?: string }>;
  onMeasure?: (stage: string) => void;
  /** Show the marks from the start, as a demo does; otherwise the page's ?proof=1 decides. */
  enabled?: boolean;
  /** Where the badge starts until the reader moves it; top right by default. */
  badgeSlot?: import('./badge-dock').Slot;
  optimisticText?: boolean;
  formatOptimisticText?: (text: string, matchedText: string) => string;
  onAccept?: ProofmarksAction;
  onDismiss?: ProofmarksAction;
  onRevert?: ProofmarksAction;
};

/** Superseded proofs stay in persisted history, outside every reader-facing view. */
function visibleReview(review: ProofmarksReview) {
  const normalized = registryReview(review);
  return { ...normalized, findings: visibleProofs(normalized.findings) };
}

/** A disposable overlay. Article text is read-only unless optimisticText is explicitly enabled. */
export function mountProofmarks({
  root,
  setupHint,
  agents,
  onSelectTarget,
  onCancelRewrite,
  avoid = [],
  findings,
  rules,
  source,
  reviewId,
  onAccept,
  onDismiss,
  onRevert,
  onRequestRewrite,
  onReview,
  onResetStrictness,
  strictness = [],
  onMeasure,
  enabled: enabledAtStart,
  badgeSlot,
  optimisticText = false,
  formatOptimisticText = text => text,
}: ProofmarksOptions) {
  ({ findings, rules } = visibleReview({ findings, rules }));
  const doc = root.ownerDocument,
    win = doc.defaultView!;
  const settingsState = reviewSettings({ empty: findings.length === 0 });
  let view: 'proof' | 'overview' | 'settings' | 'why' | 'rule' = 'proof';
  /** The rule whose page is open, from Settings. */
  let ruleId: string | undefined;
  let companionStatus: ProofmarksCompanionStatus = {
    connected: false,
    reason: 'Proofmarks companion is not running. Start proofmarks serve.',
  };
  let reviewing = false;
  let learned = strictness,
    resetting = false;
  let agentStatus = agents,
    agentReason: string | undefined =
      !agents && !onSelectTarget
        ? 'Connect an MCP agent in watch mode, or install Claude Code, Codex or pi.'
        : undefined,
    targetBusy = false;
  const rewriteErrors = new Map<string, string>();
  const host = doc.createElement('div');
  host.dataset.proofmarks = '';
  host.style.setProperty('--layout-width', `${layoutWidth(doc)}px`);
  const originalFlag = doc.documentElement.getAttribute('data-proofmarks-on');
  const marginStyle = doc.createElement('style');
  host.append(marginStyle);
  const restoreFlag = () => {
    if (originalFlag === null) doc.documentElement.removeAttribute('data-proofmarks-on');
    else doc.documentElement.setAttribute('data-proofmarks-on', originalFlag);
  };
  const shadow = host.attachShadow({ mode: 'open' });
  const style = doc.createElement('style');
  style.textContent = proofmarksStyles + surfaceStyles + workingStyles;
  shadow.append(style);
  const layer = doc.createElement('div');
  layer.className = 'marks';
  shadow.append(layer);
  const surfaceShadow = doc.createElement('div');
  surfaceShadow.className = 'd-surface-shadow';
  shadow.append(surfaceShadow);
  const panel = doc.createElement('aside');
  panel.className = 'panel';
  panel.setAttribute('aria-label', 'Proofmarks writing review');
  shadow.append(panel);
  const shell = doc.createElement('div');
  shell.className = 'dock-surface';
  shell.setAttribute('aria-hidden', 'true');
  panel.append(shell);
  const card = doc.createElement('section');
  card.className = 'card';
  card.hidden = true;
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-label', 'Writing proposal');
  shadow.append(card);
  doc.body.append(host);
  let font: FontFace | undefined;
  let enabled = enabledAtStart ?? new URL(win.location.href).searchParams.get('proof') === '1';
  let disposed = false,
    raf = 0,
    keyboard = false;
  let matches: ReturnType<typeof findProofmarks> = [];
  const proofOrder = new ProofOrder();
  const orderedFindings = () => proofOrder.order(findings, matches);
  function matchFindings() {
    matches = findProofmarks(root, findings);
    const dismissed = findings.filter(f => f.status === 'dismissed').map(f => ({ ...f, status: 'open' as const }));
    proofOrder.order(findings, [...matches, ...(dismissed.length ? findProofmarks(root, dismissed) : [])]);
  }
  const groups = new Map<string, { signature: string; element: HTMLDivElement }>();
  const documentRect = (r: DOMRect) => new DOMRect(r.x + win.scrollX, r.y + win.scrollY, r.width, r.height);
  let focusId: string | undefined;
  let entryMode: 'pill' | 'text' = 'text';
  let cyclerId: string | undefined, decisionSettle: ReturnType<typeof setTimeout> | undefined;
  let cycleAnimation: Animation | undefined,
    fadeAnimations: Animation[] = [];
  let intentTimer: ReturnType<typeof setTimeout> | undefined, graceTimer: ReturnType<typeof setTimeout> | undefined;
  let regions: { finding: ProofmarksFinding; rects: DOMRect[]; hit: HitRect[]; label?: HitRect }[] = [];
  let hoverFrame = 0,
    hoverOpen: ReturnType<typeof setTimeout> | undefined,
    hoverClose: ReturnType<typeof setTimeout> | undefined;
  let hoverId: string | undefined,
    lastOpen = 0,
    suppressFocus = false;
  let pointerPosition: { x: number; y: number } | undefined;
  let pointerButtons = 0;
  let hoverSuppression: { x: number; y: number; id: string } | undefined;
  let touchStart: { x: number; y: number } | undefined;
  function cancelHover() {
    clearTimeout(hoverOpen);
    clearTimeout(hoverClose);
    hoverClose = undefined;
    hoverId = undefined;
  }
  let following = false,
    pinned = false;
  let closing = false,
    closeAnimation: Animation | undefined,
    finishCardClose: (() => void) | undefined;
  let morphing = false,
    actionsExpanded = false;
  let pinAnimation: Animation | undefined,
    pinFades: Animation[] = [];
  let finishPin: (() => void) | undefined;
  /** A pointerdown that closed a pinned card: the click that follows does nothing else. */
  let dismissClick = false;
  let busy = false;
  let finishWords: (() => void) | undefined, wordFinding: string | undefined, revealFinding: string | undefined;
  const stopWords = () => {
    const finish = finishWords;
    finishWords = undefined;
    finish?.();
  };
  let cardSize = { width: 330, height: 0 };
  let placement = { left: false, above: false };
  let pinOrigin: { x: number; y: number } | undefined;
  // A card grown from a line's list keeps that list's top-left corner (document coordinates) instead of a point by the mark.
  let pinBox: { x: number; y: number } | undefined;
  /** The line whose list opened the card: only then does the card carry that line's tabs. */
  let tabsLine: string | undefined;
  /** While a surface's height animates, nothing inside it shows a scrollbar: it ends at its full size anyway (scroll position is kept). */
  const reshapes = new WeakMap<HTMLElement, Animation>();
  function reshaping(surface: HTMLElement, animation: Animation) {
    reshapes.set(surface, animation);
    surface.dataset.reshaping = '';
    const settled = () => {
      if (reshapes.get(surface) !== animation) return;
      reshapes.delete(surface);
      delete surface.dataset.reshaping;
    };
    animation.finished.then(settled, settled);
    return animation;
  }
  let viewport = { width: layoutWidth(doc), height: win.innerHeight };
  let panelBounds: HitRect | undefined;
  const mobile = win.matchMedia('(pointer: coarse), (max-width: 700px)');
  const finePointer = win.matchMedia('(hover: hover) and (pointer: fine)');
  /** The card's size for placing it. Mid-morph, that's the height it's growing or shrinking to, not the frame on screen. */
  const cacheCardSize = () => {
    const rect = card.getBoundingClientRect(),
      morph = reshapes.get(card),
      target = morph && (morph.effect as KeyframeEffect | null)?.getKeyframes().at(-1)?.height;
    cardSize = { width: rect.width, height: typeof target === 'string' ? parseFloat(target) : rect.height };
  };
  function followCard() {
    if (!following || card.hidden || !pointerPosition) return;
    const p = cursorCardPosition(
      pointerPosition.x,
      pointerPosition.y,
      cardSize.width,
      cardSize.height,
      viewport.width,
      viewport.height,
      placement,
    );
    card.style.transform = `translate3d(${p.x}px, ${p.y}px, 0)`;
  }
  function anchorCard(finding: ProofmarksFinding) {
    if (mobile.matches || expanded || closing || morphing) return;
    if (following) {
      followCard();
      return;
    }
    if (pinBox) {
      const w = Math.min(cardSize.width, viewport.width - 24),
        h = Math.min(cardSize.height, viewport.height - 24);
      card.dataset.fixed = 'true';
      card.style.left = '0px';
      card.style.top = '0px';
      card.style.transform = `translate3d(${Math.max(12, Math.min(pinBox.x - win.scrollX, viewport.width - w - 12))}px,${Math.max(12, Math.min(pinBox.y - win.scrollY, viewport.height - h - 12))}px,0)`;
      if (!tabsFrame) followTabs();
      return;
    }
    const anchor = regions.find(r => r.finding.id === finding.id)?.rects[0];
    pinOrigin ??= anchor
      ? { x: anchor.left + Math.min(anchor.width / 2, 180), y: anchor.top + anchor.height / 2 }
      : { x: win.scrollX + viewport.width / 2, y: win.scrollY + viewport.height / 2 };
    const p = pinnedCardPosition(
      pinOrigin.x - win.scrollX,
      pinOrigin.y - win.scrollY,
      cardSize.width,
      cardSize.height,
      viewport.width,
      viewport.height,
      placement,
    );
    card.dataset.fixed = 'true';
    card.style.left = '0px';
    card.style.top = '0px';
    card.style.transform = `translate3d(${p.x}px,${p.y}px,0)`;
    if (!tabsFrame) followTabs();
  }
  const reduced = win.matchMedia('(prefers-reduced-motion: reduce)');
  const button = (text: string, action: (event: MouseEvent) => void) => {
    const element = doc.createElement('button');
    element.type = 'button';
    element.textContent = text;
    element.addEventListener('click', action);
    return element;
  };
  const ruleFor = (finding: ProofmarksFinding) =>
    finding.status === 'accepted' || finding.status === 'accepted-unrecorded'
      ? { id: finding.rule, label: 'Accepted', color: '#38766b', mark: 'underline' as const }
      : (rules.find(rule => rule.id === finding.rule) ?? { id: finding.rule, label: finding.rule, color: '#655347' });
  // These nodes live for the entire mount. Pinning never rebuilds the card.
  const cardHeader = doc.createElement('header'),
    heading = button('', () => setView('why')),
    headingText = doc.createTextNode('');
  heading.append(headingText);
  heading.className = 'd-rule';
  const close = button('Close the proof', () => closeCard());
  close.className = 'd-sr-close';
  close.setAttribute('aria-label', 'Close the proof');
  cardHeader.append(heading, close);
  card.append(cardHeader);
  const cardLogo = button('', () => closeCard());
  cardLogo.className = 'surface-logo';
  cardLogo.setAttribute('aria-label', 'Proofmarks, close review');
  cardLogo.append(proofmarkIcon(doc));
  const position = button('', () => setView('overview'));
  position.className = 'proof-position';
  const counterLive = doc.createElement('span');
  counterLive.className = 'counter-live d-sr';
  counterLive.setAttribute('aria-live', 'polite');
  card.append(counterLive);
  const prev = button('‹', () => cycle(-1)),
    next = button('›', () => cycle(1));
  prev.setAttribute('aria-label', 'Previous proof');
  next.setAttribute('aria-label', 'Next proof');
  prev.dataset.step = 'previous';
  next.dataset.step = 'next';
  const footer = doc.createElement('footer');
  footer.className = 'd-footer';
  footer.append(prev, position, next);
  const content = doc.createElement('div');
  content.className = 'proof-content';
  card.append(content);
  const metaInfo = doc.createElement('div');
  metaInfo.className = 'meta-info';
  metaInfo.hidden = true;
  content.append(metaInfo);
  const metaHeading = doc.createElement('strong'),
    metaField = doc.createElement('span'),
    metaIcon = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
  metaIcon.setAttribute('viewBox', '0 0 24 24');
  metaIcon.setAttribute('aria-hidden', 'true');
  const metaPath = doc.createElementNS('http://www.w3.org/2000/svg', 'path');
  metaPath.setAttribute(
    'd',
    'M3 3.5 20.5 21 M9 5.5C14 3.8 19 7.5 22 12c-1 1.7-2.1 3-3.5 4 M15.3 18.2C10 20 4.6 16.9 2 12c1.1-1.8 2.4-3.3 4-4.5 M10 9.8c-2.6 2.7 1.1 6.6 4 4.2',
  );
  metaIcon.append(metaPath);
  metaHeading.append(metaIcon, metaField);
  const metaTag = doc.createElement('span');
  metaTag.textContent = 'Not on the page · read by search and AI';
  metaInfo.append(metaHeading, metaTag);
  const fieldName = (target: NonNullable<ProofmarksFinding['target']>) =>
    target.field === 'takeaways'
      ? `Takeaway ${(target.index ?? 0) + 1}`
      : target.field === 'summary'
        ? 'Summary'
        : 'Description';
  // Proofs that share a line label (Puffery +3): hovering the label unfolds the line's proofs.
  const lineGroups = new Map<string, string[]>();
  const ruleCheck = doc.createElement('p');
  ruleCheck.className = 'rule-check';
  ruleCheck.hidden = true;
  content.append(ruleCheck);
  const pair = doc.createElement('div');
  pair.className = 'proof-pair';
  content.append(pair);
  const textSlot = (label: string) => {
    const title = doc.createElement('span');
    title.className = 'd-sr';
    title.textContent = label + ': ';
    const paragraph = doc.createElement('p'),
      text = doc.createTextNode(''),
      change = doc.createElement(label === 'Original' ? 'del' : 'ins');
    change.append(text);
    paragraph.append(change);
    const item = doc.createElement('div');
    item.className = 'proof-version';
    item.append(title, paragraph);
    pair.append(item);
    return { text, paragraph, change, item };
  };
  const { text: originalText, paragraph: originalParagraph, change: originalChange } = textSlot('Original'),
    { text: proposedText, item: proposedVersion } = textSlot('Rewrite');
  originalParagraph.className = 'original';
  pair.setAttribute('role', 'group');
  pair.setAttribute('aria-label', 'Proposed change: original struck through, followed by the rewrite');
  // Rewrite versions live in the header beside the rule: ‹ 2/3 › and a refresh icon for Try another.
  const chosenVersions = new Map<string, number>();
  const versionNav = doc.createElement('div');
  versionNav.className = 'version-nav';
  versionNav.setAttribute('role', 'group');
  versionNav.setAttribute('aria-label', 'Rewrite versions');
  versionNav.hidden = true;
  const prevVersion = button('', () => stepVersion(-1)),
    nextVersionControl = button('', () => stepVersion(1)),
    versionLabel = doc.createElement('span');
  prevVersion.append(chevronIcon(doc, 'previous'));
  nextVersionControl.append(chevronIcon(doc, 'next'));
  versionLabel.className = 'version-label';
  versionLabel.setAttribute('aria-hidden', 'true');
  prevVersion.setAttribute('aria-label', 'Previous version');
  nextVersionControl.setAttribute('aria-label', 'Next version');
  prevVersion.setAttribute('aria-keyshortcuts', '[');
  nextVersionControl.setAttribute('aria-keyshortcuts', ']');
  versionNav.append(prevVersion, versionLabel, nextVersionControl);
  const tryAnother = button('', () => {
    const f = findings.find(f => f.id === focusId);
    if (f) void requestRewrites(f);
  });
  tryAnother.className = 'try-another';
  tryAnother.hidden = true;
  tryAnother.setAttribute('aria-label', 'Try another rewrite');
  tryAnother.append(refreshIcon(doc));
  const versionTools = doc.createElement('div');
  versionTools.className = 'version-tools';
  versionTools.hidden = true;
  versionTools.append(versionNav, tryAnother);
  cardHeader.insertBefore(versionTools, close);
  const anchorReason = doc.createElement('p');
  anchorReason.className = 'note anchor-reason';
  anchorReason.setAttribute('role', 'status');
  anchorReason.hidden = true;
  content.append(anchorReason);
  const copyNote = doc.createElement('p');
  copyNote.className = 'note copy-note';
  copyNote.textContent = 'Also updates the copy search and AI read.';
  copyNote.hidden = true;
  content.append(copyNote);
  const rewriteWarning = doc.createElement('p');
  rewriteWarning.className = 'note rewrite-warning';
  rewriteWarning.hidden = true;
  content.append(rewriteWarning);
  const rewritePrompt = doc.createElement('p');
  rewritePrompt.className = 'note rewrite-prompt';
  rewritePrompt.setAttribute('role', 'status');
  rewritePrompt.hidden = true;
  content.append(rewritePrompt);
  const updateWorkingLine = workingLine(rewritePrompt);
  const empty = doc.createElement('div');
  empty.className = 'proof-empty';
  empty.hidden = true;
  card.append(empty);
  const actionShell = doc.createElement('div');
  actionShell.className = 'actions-shell';
  actionShell.style.height = '0px';
  actionShell.inert = true;
  const actionContent = doc.createElement('div');
  actionContent.className = 'action-content';
  const actions = doc.createElement('div');
  actions.className = 'actions';
  actionContent.append(actions);
  actionShell.append(actionContent);
  card.append(actionShell, footer);
  const statusText = doc.createElement('span');
  statusText.className = 'proof-status';
  actions.append(statusText);
  const actionControls = (['accept', 'dismiss', 'revert'] as const).map(action => {
    const control = button(action === 'accept' ? 'Accept' : action === 'dismiss' ? 'Dismiss' : 'Revert', () => {
      const finding = findings.find(f => f.id === focusId);
      if (finding) void performAction(action, finding);
    });
    control.dataset.action = action;
    if (action === 'accept') control.className = 'primary';
    actions.append(control);
    return control;
  });
  const askRewrite = button('Ask your agent for a rewrite', () => {
    const f = findings.find(f => f.id === focusId);
    if (f) void requestRewrites(f);
  });
  askRewrite.className = 'primary ask-rewrite';
  actions.prepend(askRewrite);
  const cancelRewrite = button('Cancel', () => {
    const f = findings.find(f => f.id === focusId);
    if (f) void cancelRequest(f);
  });
  cancelRewrite.dataset.cancelRewrite = '';
  cancelRewrite.hidden = true;
  actions.insertBefore(cancelRewrite, actionControls[1]!);
  const switchTarget = button('Switch target', () => {
    setView('settings');
    deep.querySelector<HTMLElement>('[data-rewrite-targets]')?.scrollIntoView({ block: 'nearest' });
  });
  switchTarget.className = 'rewrite-target';
  switchTarget.hidden = true;
  // Keep the waiting line immediately below the original.
  pair.after(rewritePrompt, switchTarget);
  prev.setAttribute('aria-keyshortcuts', 'ArrowLeft');
  next.setAttribute('aria-keyshortcuts', 'ArrowRight');
  for (const [i, control] of actionControls.entries()) {
    control.setAttribute('aria-label', control.textContent!);
    control.setAttribute('aria-keyshortcuts', ['A', 'D', 'U'][i]!);
  }
  close.setAttribute('aria-keyshortcuts', 'Escape');
  const actionReason = doc.createElement('p'),
    reasonText = doc.createTextNode('');
  actionReason.className = 'action-reason';
  actionReason.setAttribute('role', 'status');
  actionReason.append(reasonText);
  actionContent.append(actionReason);
  const queueLine = doc.createElement('p'),
    queueText = doc.createElement('span'),
    cancelAll = button('Cancel all', () => void cancelRequest());
  queueLine.className = 'queue-line';
  queueLine.hidden = true;
  cancelAll.dataset.cancelRewrites = '';
  queueLine.append(queueText, cancelAll);
  actionContent.append(queueLine);
  let queueStarted = rewriteQueue(findings).writing.length > 1;
  // Rewrite all turns the pager into the queue until nothing is ready or on the way.
  const queueMode = () => {
    if (!queueStarted) return false;
    const q = rewriteQueue(findings);
    if (!q.ready.length && !q.writing.length) queueStarted = false;
    return queueStarted;
  };
  function cardSlots(finding: ProofmarksFinding) {
    const open = (finding.status ?? 'open') === 'open',
      request = rewriteState(finding, agentStatus, Date.now(), rewriteErrors.get(finding.id)),
      slots = open ? versionSlots(finding, request.waiting || request.failed) : [],
      slot = selectedSlot(slots, chosenVersions.get(finding.id), finding.proposed);
    return { request, slots, slot, text: open && slot ? slot.rewrite?.text : finding.proposed };
  }
  function stepVersion(direction: number, version?: number) {
    const f = findings.find(f => f.id === focusId);
    if (!f || card.hidden || view !== 'proof') return;
    const { slots, slot } = cardSlots(f),
      target = version !== undefined ? slots.find(s => s.version === version) : slots[slots.indexOf(slot!) + direction];
    if (!target || target === slot) return;
    chosenVersions.set(f.id, target.version);
    const surface = mobile.matches ? sheet.element : expanded ? panel : card,
      from = surface.getBoundingClientRect().height;
    updateProofContent(f);
    renderCardActions(f);
    anchorCard(f);
    if (!reduced.matches) {
      cycleAnimation?.cancel();
      cycleAnimation = reshaping(
        surface,
        surface.animate([{ height: `${from}px` }, { height: `${surface.getBoundingClientRect().height}px` }], {
          duration: 180,
          easing: ease,
        }),
      );
      fadeAnimations.push(pair.animate([{ opacity: 0.4 }, { opacity: 1 }], { duration: 160, easing: ease }));
    }
    announcement.textContent = versionNav.dataset.label ?? '';
  }
  function renderQueue() {
    const q = rewriteQueue(findings);
    queueLine.hidden = !onRequestRewrite || !(q.writing.length > 1 || (queueMode() && q.writing.length > 0));
    queueText.textContent = `${q.writing.length} ${q.writing.length === 1 ? 'rewrite' : 'rewrites'} on the way`;
    cancelAll.disabled = busy;
  }
  function setActions(open: boolean) {
    actionsExpanded = open;
    actionShell.inert = !open;
    actionShell.style.visibility = open ? 'visible' : 'hidden';
    actionShell.style.height = open ? `${actionContent.offsetHeight}px` : '0px';
    cacheCardSize();
  }
  function cancelCardClose() {
    closeAnimation?.cancel();
    closeAnimation = undefined;
    finishCardClose = undefined;
    closing = false;
    delete card.dataset.closing;
    card.style.removeProperty('transform-origin');
    card.style.removeProperty('clip-path');
    card.style.removeProperty('height');
    content.style.removeProperty('height');
    content.style.removeProperty('flex-shrink');
    actionShell.style.removeProperty('clip-path');
  }
  function closeCard(hoverAway = false) {
    completion.settle();
    if (pinAnimation) {
      const transform = win.getComputedStyle(card).transform,
        height = win.getComputedStyle(card).height;
      finishPin?.();
      card.style.transform = transform;
      card.style.height = height;
    }
    if (expanded) {
      setPanel(false);
      return;
    }
    if (closing || card.hidden) return;
    cancelHover();
    cancelAnimationFrame(hoverFrame);
    hoverFrame = 0;
    if (pointerPosition && focusId) hoverSuppression = { ...pointerPosition, id: focusId };
    const finish = () => {
      card.hidden = true;
      schedule();
      cancelCardClose();
      pinned = false;
      following = false;
      pinOrigin = undefined;
      pinBox = undefined;
      tabsLine = undefined;
      rememberOpen();
      quietMarks();
      delete card.dataset.fixed;
      setActions(false);
      restoreUndo();
    };
    if (sheet.isOpen()) {
      sheet.close();
      finish();
      return;
    }
    // Freeze the rendered geometry before cancelling any in-flight pin reveal; keep the header/actions intact until fully hidden.
    const transform = win.getComputedStyle(card).transform,
      actionHeight = actionShell.getBoundingClientRect().height;
    morphing = false;
    card.style.transform = transform;
    actionShell.style.height = `${actionHeight}px`;
    closing = true;
    card.dataset.closing = 'true';
    following = false;
    pinned = false;
    card.inert = true;
    hideTabs(true);
    card.style.transformOrigin = '0 0';
    const base = transform === 'none' ? '' : transform;
    finishCardClose = finish;
    closeAnimation = card.animate(
      [
        { opacity: 1, transform: `${base} scale(1)` },
        { opacity: 0, transform: `${base} scale(${reduced.matches ? 1 : 0.98})` },
      ],
      { duration: reduced.matches ? 0 : hoverAway ? 80 : 140, easing: 'cubic-bezier(.22,1,.36,1)', fill: 'forwards' },
    );
    closeAnimation.onfinish = finish;
    if (reduced.matches) finish();
    if (keyboard) {
      const target = [...layer.querySelectorAll<HTMLButtonElement>('button')].find(b => b.dataset.finding === focusId);
      suppressFocus = true;
      (target && !target.inert ? target : pillUI.mark).focus({ preventScroll: true });
      suppressFocus = false;
    }
  }
  function showCard(finding: ProofmarksFinding, focus = false, follow = false, entry: 'pill' | 'text' = 'text') {
    if (closing) {
      card.hidden = true;
      cancelCardClose();
    }
    if (focus) {
      pinOrigin = undefined;
      pinBox = undefined;
      tabsLine = undefined;
    }
    if (!follow && !expanded && !mobile.matches && entry === 'pill') {
      cyclerId = finding.id;
      setPanel(true);
      return;
    }
    entryMode = entry;
    card.dataset.entry = entry;
    view = 'proof';
    deep.hidden = true;
    card.dataset.view = 'proof';
    footer.hidden = follow;
    if (!expanded && card.classList.contains('dock-card')) {
      card.classList.remove('dock-card');
      shadow.append(card);
      dock.refresh();
    }
    if (mobile.matches) {
      follow = false;
      sheet.review();
    }
    if (!follow) {
      cyclerId = finding.id;
    }
    card.style.opacity = '1';
    card.dataset.proof = finding.id;
    empty.hidden = true;
    content.hidden = false;
    cardHeader.hidden = false;
    heading.hidden = false;
    actionShell.hidden = false;
    if (card.hidden) placement = { left: false, above: false };
    pinned = !follow;
    if (follow) {
      delete card.dataset.fixed;
    } else if (!expanded && !mobile.matches) {
      card.dataset.fixed = 'true';
    }
    following = follow;
    card.dataset.following = String(follow);
    card.inert = false;
    card.setAttribute('role', follow ? 'tooltip' : 'dialog');
    if (follow) {
      card.style.left = '0px';
      card.style.top = '0px';
    }
    clearTimeout(hoverClose);
    hoverClose = undefined;
    lastOpen = Date.now();
    focusId = finding.id;
    card.hidden = false;
    const rule = rules.find(r => r.id === finding.rule) ?? ruleFor(finding);
    card.style.setProperty('--mark', lightRuleColor(rule.color));
    headingText.data = rule.label;
    heading.setAttribute('aria-label', `${rule.label}: details for this proof`);
    updateProofContent(finding);
    completion.hide();
    metaInfo.hidden = !finding.target;
    metaTag.textContent = matches.find(m => m.finding.id === finding.id)?.range
      ? 'Also read by search and AI'
      : 'Not on the page · read by search and AI';
    metaField.textContent = finding.target ? fieldName(finding.target) : '';
    renderCardActions(finding);
    setActions(!follow);
    cacheCardSize();
    anchorCard(finding);
    if (mobile.matches) sheet.reveal(finding.id);
    quietMarks();
    updateCardChrome();
    if (focus) (next.disabled ? close : next).focus({ preventScroll: true });
    restoreUndo();
    schedule();
  }
  function updateProofContent(finding: ProofmarksFinding) {
    renderLineTabs(finding);
    const rule = rules.find(r => r.id === finding.rule) ?? ruleFor(finding);
    ruleCheck.textContent = cardProse(rule.why ?? rule.rubric?.checks ?? '');
    ruleCheck.hidden = !ruleCheck.textContent;
    originalText.data = cardProse(finding.before ?? finding.match);
    const { request, slots, slot, text } = cardSlots(finding);
    // Pin the version on screen: an arrival fills an empty slot but never swaps the text being read.
    if (slot && !chosenVersions.has(finding.id)) chosenVersions.set(finding.id, slot.version);
    proposedText.data = cardProse(text ?? '');
    const missing = text === undefined,
      deletion = text === '';
    // A deletion has no rewrite to show: the struck original says it, and an empty block would only add space.
    proposedVersion.hidden = missing || deletion;
    originalChange.style.textDecoration = missing ? 'none' : '';
    pair.setAttribute(
      'aria-label',
      deletion
        ? 'Proposed change: delete the struck-through text'
        : 'Proposed change: original struck through, followed by the rewrite',
    );
    rewritePrompt.style.setProperty('--agent', request.color ?? '');
    updateWorkingLine(missing ? request.message : '', request.working);
    switchTarget.hidden = !request.stalled || !missing;
    rewriteWarning.hidden = !(slot ? slot.rewrite?.stillFlagged : finding.rewriteRequest?.stillFlagged) || missing;
    const index = slot ? slots.indexOf(slot) : -1,
      last = slots.at(-1)?.version ?? 0;
    versionNav.hidden = slots.length < 2;
    versionNav.dataset.label = slot ? `Version ${slot.version} of ${last}` : '';
    versionNav.setAttribute('aria-label', versionNav.dataset.label || 'Rewrite versions');
    versionLabel.textContent = slot ? `${slot.version}/${last}` : '';
    versionLabel.setAttribute('aria-hidden', 'true');
    prevVersion.disabled = index < 1;
    nextVersionControl.disabled = index < 0 || index >= slots.length - 1;
    rewriteWarning.textContent = rewriteWarning.hidden ? '' : `This rewrite may still read as ${rule.label}`;
  }
  async function requestRewrites(finding?: ProofmarksFinding) {
    if (busy || reviewing || targetBusy || !onRequestRewrite) return;
    const restoreRequestFocus = !!finding && shadow.activeElement === askRewrite;
    // With a rewrite already on the card, asking again means another version.
    const another = !!finding && rewriteVersions(finding).length > 0;
    for (const f of finding
      ? [finding]
      : findings.filter(f => (f.status ?? 'open') === 'open' && f.proposed === undefined))
      rewriteErrors.delete(f.id);
    busy = true;
    if (finding) renderCardActions(finding);
    try {
      if (finding && rewriteState(finding, agentStatus).waiting) {
        if (!onCancelRewrite) {
          const reason = 'Cancel the earlier request before retrying.';
          rewriteErrors.set(finding.id, reason);
          announcement.textContent = reason;
          return;
        }
        const cancelled = await onCancelRewrite(finding);
        if (disposed) return;
        if (cancelled.review) ({ findings, rules } = visibleReview(cancelled.review));
        if (!cancelled.ok) {
          const reason = cancelled.reason ?? 'Couldn’t cancel the earlier request. Try again.';
          rewriteErrors.set(finding.id, reason);
          announcement.textContent = reason;
          return;
        }
        const id = finding.id;
        finding = findings.find(f => f.id === id);
        if (!finding || (!another && finding.proposed !== undefined)) return;
      }
      const result = await onRequestRewrite(finding, another ? { another: true } : undefined);
      if (disposed) return;
      if (result.review) {
        ({ findings, rules } = visibleReview(result.review));
        refresh();
      }
      if (result.ok && finding) {
        const id = finding.id,
          version = findings.find(f => f.id === id)?.rewriteRequest?.version;
        if (another && version) chosenVersions.set(finding.id, version);
      }
      if (result.ok && !finding) {
        queueStarted = true;
        const first = orderedFindings().find(f => ['pending', 'claimed'].includes(f.rewriteRequest?.status ?? ''));
        if (first && !card.hidden) selectProof(first, true);
      }
      if (result.ok) {
        const current = findings.find(f => f.id === (finding?.id ?? focusId));
        announcement.textContent =
          finding && current ? rewriteState(current, agentStatus).message : 'Rewrite requests sent.';
      } else {
        const reason = result.reason ?? 'Couldn’t request a rewrite.';
        if (finding) rewriteErrors.set(finding.id, reason);
        announcement.textContent = reason;
      }
    } catch {
      const reason = 'Couldn’t request a rewrite. Try again.';
      if (finding) rewriteErrors.set(finding.id, reason);
      announcement.textContent = reason;
    } finally {
      busy = false;
      if (!disposed) {
        const current = findings.find(f => f.id === focusId);
        if (current && view === 'proof') {
          updateProofContent(current);
          renderCardActions(current);
          if (restoreRequestFocus)
            (askRewrite.hidden ? (cancelRewrite.hidden ? actionControls[1]! : cancelRewrite) : askRewrite).focus({
              preventScroll: true,
            });
        }
        updateRewriteAll();
        renderPanel();
      }
    }
  }
  function renderAgents() {
    const section = deep.querySelector<HTMLElement>('[data-rewrite-targets]');
    if (section)
      updateAgentSettings(section, {
        agents: agentStatus,
        reason: agentReason,
        busy: targetBusy,
        select: target => void selectRewriteTarget(target),
      });
  }
  async function selectRewriteTarget(target: string) {
    if (targetBusy) return;
    if (!onSelectTarget) return;
    const restoreTargetFocus =
      shadow.activeElement instanceof HTMLElement && !!shadow.activeElement.dataset.agentTarget;
    targetBusy = true;
    agentReason = undefined;
    renderAgents();
    try {
      const result = await onSelectTarget(target);
      if (disposed) return;
      if (result.ok && result.agents) agentStatus = result.agents;
      else agentReason = result.reason ?? 'Couldn’t change the rewrite target.';
    } catch {
      agentReason = 'Couldn’t change the rewrite target. Try again.';
    } finally {
      targetBusy = false;
      if (!disposed) {
        renderAgents();
        const current = findings.find(f => f.id === focusId);
        if (
          current &&
          view === 'proof' &&
          !card.hidden &&
          current.proposed === undefined &&
          (current.status ?? 'open') === 'open'
        )
          renderCardActions(current);
        if (restoreTargetFocus && !shadow.activeElement)
          deep.querySelectorAll<HTMLButtonElement>('[data-agent-target]').forEach(button => {
            if (button.dataset.agentTarget === target) button.focus({ preventScroll: true });
          });
      }
    }
  }
  /** Without a finding, one Cancel stops every rewrite on the way. */
  async function cancelRequest(finding?: ProofmarksFinding) {
    if (busy || !onCancelRewrite) return;
    busy = true;
    const current = findings.find(f => f.id === focusId);
    if (current) renderCardActions(current);
    try {
      const result = await onCancelRewrite(finding);
      if (disposed) return;
      if (result.review) {
        if (finding) rewriteErrors.delete(finding.id);
        ({ findings, rules } = visibleReview(result.review));
        refresh();
      }
      announcement.textContent = result.ok
        ? finding
          ? 'Rewrite cancelled.'
          : 'Rewrites cancelled.'
        : (result.reason ?? 'Couldn’t cancel the rewrite.');
    } catch {
      announcement.textContent = 'Couldn’t cancel the rewrite. Try again.';
    } finally {
      busy = false;
      if (!disposed) {
        const current = findings.find(f => f.id === focusId);
        if (current && view === 'proof') {
          updateProofContent(current);
          renderCardActions(current);
        }
        updateRewriteAll();
        renderPanel();
      }
    }
  }
  function pinCard(finding: ProofmarksFinding) {
    pinBox = undefined;
    tabsLine = undefined;
    let preview = !card.hidden && focusId === finding.id ? card.getBoundingClientRect() : undefined;
    const fromOpacities =
      preview && !following ? [actionShell, footer].map(el => win.getComputedStyle(el).opacity) : ['0', '0'];
    finishPin?.();
    card.style.removeProperty('height');
    content.style.removeProperty('height');
    content.style.removeProperty('flex-shrink');
    if (!preview && !expanded && !mobile.matches) {
      showCard(finding, false, true, 'text');
      preview = card.getBoundingClientRect();
    }
    pinOrigin = preview
      ? {
          x: win.scrollX + (placement.left ? preview.right + 16 : preview.left - 16),
          y: win.scrollY + (placement.above ? preview.bottom + 20 : preview.top - 20),
        }
      : pointerPosition
        ? { x: win.scrollX + pointerPosition.x, y: win.scrollY + pointerPosition.y }
        : undefined;
    cancelHover();
    if (expanded) setPanel(false, true);
    showCard(finding, false, false, 'text');
    card.style.removeProperty('height');
    card.style.removeProperty('clip-path');
    if (!preview || reduced.matches || mobile.matches) return;
    const target = card.getBoundingClientRect();
    morphing = true;
    content.style.height = `${content.getBoundingClientRect().height}px`;
    content.style.flexShrink = '0';
    const finish = () => {
      pinAnimation?.cancel();
      pinFades.forEach(a => a.cancel());
      pinAnimation = undefined;
      pinFades = [];
      finishPin = undefined;
      content.style.removeProperty('height');
      content.style.removeProperty('flex-shrink');
      morphing = false;
      cacheCardSize();
    };
    finishPin = finish;
    pinAnimation = card.animate(
      [
        { transform: `translate3d(${preview.x}px,${preview.y}px,0)`, height: `${preview.height}px` },
        { transform: `translate3d(${target.x}px,${target.y}px,0)`, height: `${target.height}px` },
      ],
      { duration: 220, easing: ease, fill: 'both' },
    );
    pinFades = [actionShell, footer].map((el, i) =>
      el.animate([{ opacity: fromOpacities[i] }, { opacity: 1 }], { duration: 200, easing: ease, fill: 'both' }),
    );
    pinAnimation.onfinish = finish;
  }
  const undoKey = `proofmarks:undo:${reviewId ?? source ?? win.location.pathname}`;
  // Sites that fully reload after a source edit (Astro) would close the card mid-decision; reopen the same proof.
  const reopenKey = `proofmarks:reopen:${reviewId ?? source ?? win.location.pathname}`,
    reopenWindow = 15000;
  function rememberOpen(id?: string) {
    try {
      if (id)
        win.sessionStorage.setItem(
          reopenKey,
          JSON.stringify({ id, entry: expanded ? 'pill' : 'text', at: Date.now() }),
        );
      else win.sessionStorage.removeItem(reopenKey);
    } catch {}
  }
  let pendingReopen: { id: string; entry: 'pill' | 'text' } | undefined = (() => {
    try {
      const saved = JSON.parse(win.sessionStorage.getItem(reopenKey) ?? 'null');
      win.sessionStorage.removeItem(reopenKey);
      return saved && typeof saved.id === 'string' && Date.now() - saved.at < reopenWindow ? saved : undefined;
    } catch {
      return undefined;
    }
  })();
  function reopenAfterReload() {
    const saved = pendingReopen;
    pendingReopen = undefined;
    if (!saved) return;
    const finding = findings.find(f => f.id === saved.id);
    if (!finding || !card.hidden) return;
    if (saved.entry === 'pill' && !mobile.matches) {
      cyclerId = finding.id;
      setPanel(true);
    } else showCard(finding, false, false, 'text');
  }
  type PendingUndo = { id: string; status: 'accepted' | 'dismissed'; expires: number };
  let undo: PendingUndo | undefined, undoTimer: ReturnType<typeof setTimeout> | undefined;
  const toast = doc.createElement('div');
  toast.className = 'toast';
  toast.hidden = true;
  shadow.append(toast);
  const announcement = doc.createElement('div');
  announcement.setAttribute('role', 'status');
  announcement.setAttribute('aria-live', 'polite');
  Object.assign(announcement.style, {
    position: 'absolute',
    width: '1px',
    height: '1px',
    overflow: 'hidden',
    clipPath: 'inset(50%)',
  });
  shadow.append(announcement);
  function saveUndo(value?: PendingUndo) {
    undo = value;
    try {
      if (value) win.sessionStorage.setItem(undoKey, JSON.stringify(value));
      else win.sessionStorage.removeItem(undoKey);
    } catch {}
  }
  function placeToast() {
    if (toast.hidden || !panelBounds) return;
    toast.style.top = `${panelBounds.bottom + 64 < win.innerHeight ? panelBounds.bottom + 8 : Math.max(80, panelBounds.top - 64)}px`;
    toast.style.left = `${Math.max(12, Math.min(panelBounds.left, layoutWidth(doc) - 300))}px`;
    toast.style.right = 'auto';
  }
  function restoreUndo() {
    clearTimeout(undoTimer);
    try {
      undo = JSON.parse(win.sessionStorage.getItem(undoKey) ?? 'null') ?? undefined;
    } catch {
      undo = undefined;
    }
    toast.replaceChildren();
    toast.hidden = true;
    if (!undo) return;
    if (undo.expires <= Date.now()) {
      saveUndo();
      return;
    }
    const id = undo.id,
      finding = findings.find(f => f.id === id);
    if (!finding || finding.status !== undo.status) return; // Write may still be in flight during HMR.
    toast.hidden = !card.hidden;
    const label = doc.createElement('span');
    label.textContent = `${undo.status === 'accepted' ? 'Accepted' : 'Dismissed'} ${rules.find(r => r.id === finding.rule)?.label ?? 'proof'}`;
    const reverse = button('Undo', () => void performAction('revert', finding));
    reverse.disabled = busy;
    toast.append(label, reverse);
    placeToast();
    undoTimer = setTimeout(() => {
      saveUndo();
      toast.hidden = true;
    }, undo.expires - Date.now());
  }
  let hiddenSince: number | undefined;
  const undoVisibility = () => {
    if (doc.hidden) {
      hiddenSince = Date.now();
      clearTimeout(undoTimer);
    } else if (hiddenSince !== undefined) {
      if (undo) saveUndo({ ...undo, expires: undo.expires + Date.now() - hiddenSince });
      hiddenSince = undefined;
      restoreUndo();
    }
  };
  doc.addEventListener('visibilitychange', undoVisibility);
  const controlLabels = new WeakMap<HTMLElement, string>(),
    controlCanvas = doc.createElement('canvas').getContext('2d');
  function sizeControlHighlights() {
    for (const control of card.querySelectorAll<HTMLElement>('button:not(.primary):not(.d-rule)')) {
      const text = control.textContent?.trim() ?? '',
        key = text + mobile.matches;
      if (controlLabels.get(control) === key) continue;
      controlLabels.set(control, key);
      if (controlCanvas) controlCanvas.font = win.getComputedStyle(control).font;
      const width = text && controlCanvas ? Math.ceil(controlCanvas.measureText(text).width) + 24 : 32;
      control.style.setProperty('--control-ink-width', `${Math.max(32, width)}px`);
    }
  }
  function renderCardActions(finding: ProofmarksFinding) {
    anchorReason.textContent = pageAnchorReason(finding, !!matches.find(m => m.finding.id === finding.id)?.range) ?? '';
    anchorReason.hidden = !anchorReason.textContent;
    const status = finding.status ?? 'open';
    copyNote.hidden = !!finding.target || !(finding.hiddenCopies?.length || finding.edits?.some(edit => edit.target));
    actions.dataset.decided = String(status !== 'open');
    statusText.hidden = status === 'open';
    statusText.textContent = status === 'dismissed' ? 'Dismissed' : 'Accepted';
    statusText.dataset.status = status;
    const reason =
      finding.actionReason ??
      (status === 'open'
        ? !onAccept || !onDismiss
          ? 'No action adapter is connected.'
          : undefined
        : !onRevert
          ? 'No action adapter is connected.'
          : undefined);
    const { request, text } = cardSlots(finding),
      missing = text === undefined,
      waiting = request.waiting;
    const askFocused = shadow.activeElement === askRewrite,
      cancelFocused = shadow.activeElement === cancelRewrite,
      anotherFocused = shadow.activeElement === tryAnother;
    askRewrite.hidden = status !== 'open' || !missing || (waiting && !request.retry);
    askRewrite.textContent = request.retry ? 'Retry' : 'Ask your agent for a rewrite';
    cancelRewrite.hidden = !waiting || !missing;
    cancelRewrite.disabled = busy || reviewing || !onCancelRewrite;
    askRewrite.disabled = busy || reviewing || targetBusy || !onRequestRewrite;
    // Once a proof has a rewrite the icon stays put (disabled while another is written), so the header never shifts.
    tryAnother.hidden = status !== 'open' || !rewriteVersions(finding).length || !onRequestRewrite;
    tryAnother.disabled = busy || reviewing || targetBusy || waiting;
    versionTools.hidden = versionNav.hidden && tryAnother.hidden;
    if (askFocused && askRewrite.hidden)
      (cancelRewrite.hidden ? actionControls[1]! : cancelRewrite).focus({ preventScroll: true });
    for (const control of actionControls) {
      control.hidden =
        status === 'open'
          ? control.dataset.action === 'revert' || (control.dataset.action === 'accept' && missing)
          : control.dataset.action !== 'revert';
      control.disabled = busy || reviewing || !!reason || (control.dataset.action === 'accept' && missing);
    }
    if (cancelFocused && cancelRewrite.hidden)
      (status !== 'open' ? actionControls[2]! : !missing ? actionControls[0]! : askRewrite).focus({
        preventScroll: true,
      });
    if (anotherFocused && (tryAnother.hidden || tryAnother.disabled))
      (cancelRewrite.hidden ? actionControls[1]! : cancelRewrite).focus({ preventScroll: true });
    renderQueue();
    const reverse = actionControls[2]!;
    reverse.firstChild!.nodeValue = 'Undo';
    reverse.setAttribute('aria-label', 'Undo');
    reasonText.data = reason ? readerActionReason(reason) : '';
    actionReason.hidden = !reasonText.data;
    for (const control of actionControls) control.dataset.reason = reasonText.data;
    if (actionsExpanded && !morphing) actionShell.style.height = `${actionContent.offsetHeight}px`;
    sizeControlHighlights();
  }
  /** One decision. `batch` is Accept all: no word morph, no Undo toast, and the card stays where it is. Resolves to whether it took. */
  async function performAction(action: 'accept' | 'dismiss' | 'revert', finding: ProofmarksFinding, batch = false) {
    stopWords();
    cycleAnimation?.cancel();
    fadeAnimations.forEach(animation => animation.cancel());
    fadeAnimations = [];
    card.querySelector('.proof-outgoing')?.remove();
    // Accept applies the version on screen.
    const chosen = action === 'accept' ? cardSlots(finding) : undefined;
    if (busy || reviewing || (chosen && chosen.text === undefined)) return false;
    const callback = action === 'accept' ? onAccept : action === 'dismiss' ? onDismiss : onRevert;
    if (!callback) return false;
    if (!card.hidden && !batch) rememberOpen(finding.id);
    if (action !== 'revert' && !batch) {
      cancelHover();
      following = false;
      clearTimeout(graceTimer);
      if (pointerPosition) hoverSuppression = { ...pointerPosition, id: finding.id };
      announcement.textContent = `${action === 'accept' ? 'Accepted' : 'Dismissed'} ${rules.find(r => r.id === finding.rule)?.label ?? 'proof'}, ${action === 'accept' ? 'Revert' : 'Restore'} available`;
    }
    const expectedCopies = finding.hiddenCopies ?? [];
    const previousStatus = finding.status;
    let match = matches.find(m => m.finding.id === finding.id);
    let replacement = chosen
      ? chosen.text
      : action === 'revert' && finding.status === 'accepted'
        ? (finding.before ?? finding.match)
        : undefined;
    // Undo puts the edit's original text back where the edit left the page: over its rewrite, or into a deletion's gap,
    // which the caret marks from the letter beside it.
    const made = action === 'revert' && finding.status === 'accepted' ? finding.edits?.find(e => !e.target) : undefined;
    if (made && match?.range && match.segments?.length === 1 && !expectedCopies.length) {
      replacement = made.before;
      if (!made.after) {
        const gap = doc.createRange();
        if (match.gapAfter) gap.setStart(match.range.endContainer, match.range.endOffset);
        else gap.setStart(match.range.startContainer, match.range.startOffset);
        gap.collapse(true);
        match = { ...match, range: gap, segments: [gap] };
      }
    }
    // A deletion tidies its sentence on the page as the source will, when its text is one text node.
    const marked = match?.segments?.length === 1 ? match.segments[0]! : undefined;
    if (
      match &&
      marked &&
      replacement === '' &&
      !expectedCopies.length &&
      marked.startContainer === marked.endContainer
    ) {
      const tidy = tidyDeletion(marked.startContainer.nodeValue ?? '', marked.startOffset, marked.endOffset),
        range = doc.createRange();
      range.setStart(marked.startContainer, tidy.start);
      range.setEnd(marked.startContainer, tidy.end);
      match = { ...match, range, segments: [range] };
      replacement = tidy.after;
    }
    if (match && marked && replacement && !expectedCopies.length && marked.startContainer === marked.endContainer) {
      const from = replacementStart(marked.startContainer.nodeValue ?? '', marked.startOffset, replacement);
      if (from < marked.startOffset) {
        const range = doc.createRange();
        range.setStart(marked.startContainer, from);
        range.setEnd(marked.startContainer, marked.endOffset);
        match = { ...match, range, segments: [range] };
      }
    }
    const prose =
      replacement === undefined
        ? undefined
        : formatOptimisticText(replacement, match?.segments?.map(segment => segment.toString()).join('') ?? '');
    const prepared =
      !batch && optimisticText && prose !== undefined && match?.range && !reduced.matches
        ? finding.match.includes('](')
          ? { reason: 'citation source' }
          : prepareWords(match.range, prose)
        : undefined;
    if (prepared?.reason) onMeasure?.('morph-fallback:' + finding.id + ':' + prepared.reason);
    const copyTargets = !finding.target
      ? action === 'accept'
        ? expectedCopies
        : action === 'revert'
          ? (finding.edits?.flatMap(edit => (edit.target ? [edit.target] : [])) ?? [])
          : []
      : [];
    const copies = findProofmarks(
      root,
      copyTargets.map(target => ({ ...finding, target })),
    );
    const replacements =
      optimisticText && prose !== undefined
        ? [
            ...(match?.segments?.length ? [{ segments: match.segments, replacement: prose }] : []),
            ...copies.flatMap(copy =>
              copy.segments?.length
                ? [
                    {
                      segments: copy.segments,
                      replacement: formatOptimisticText(replacement!, copy.segments.map(s => s.toString()).join('')),
                    },
                  ]
                : [],
            ),
          ]
        : [];
    const transactions = replacements.length ? replaceTextCopies(replacements) : undefined;
    const transaction = match?.segments?.length ? transactions?.primary : undefined;
    if (transaction && prepared && 'snapshot' in prepared && prepared.snapshot) {
      const after = snapshotWords(transaction.range());
      if (after) {
        wordFinding = finding.id;
        onMeasure?.('morph-start:' + finding.id);
        finishWords = playWords(
          shadow,
          host,
          prepared.snapshot,
          after,
          () => {
            finishWords = undefined;
            wordFinding = undefined;
            onMeasure?.('morph-end:' + finding.id);
            refresh();
          },
          error => onMeasure?.('morph-alignment:' + finding.id + ':' + error),
        );
      }
    }
    observer.takeRecords(); // The optimistic write is ours; later mutations interrupt the morph.

    busy = true;
    const previousProposed = finding.proposed;
    if (chosen) finding.proposed = chosen.text;
    finding.status = action === 'accept' ? 'accepted' : action === 'dismiss' ? 'dismissed' : 'open';
    if (transaction) onMeasure?.('optimistic-text');
    if (action !== 'revert') {
      if (!batch)
        saveUndo({
          id: finding.id,
          status: action === 'accept' ? 'accepted' : 'dismissed',
          expires: Date.now() + 8000,
        });
    } else if (transaction) saveUndo();
    renderCardActions(finding);
    renderPanel();
    restoreUndo();
    if (transaction) {
      const group = groups.get(finding.id)?.element;
      if (group) {
        group.dataset.status = finding.status;
        group.style.setProperty('--mark', ruleFor(finding).color);
        for (const path of group.querySelectorAll('path')) path.setAttribute('stroke', ruleFor(finding).color);
      }
      // One draw at the final text layout; freeze it while decorative words move.
      matchFindings();
      const moving = wordFinding;
      wordFinding = undefined;
      draw();
      wordFinding = moving;
      refresh();
    }
    let result: ProofmarksActionResult;
    try {
      result = await callback(
        { ...finding, status: previousStatus },
        { expectedCopies, ...(chosen?.slot?.rewrite ? { version: chosen.slot.rewrite.version } : {}) },
      );
    } catch (error) {
      result = { ok: false, reason: error instanceof Error ? error.message : 'The action failed.' };
    }
    busy = false;
    if (!result.ok) {
      stopWords();
      transactions?.rollback();
      finding.status = previousStatus;
      finding.proposed = previousProposed;
      if (action !== 'revert') saveUndo();
      if (disposed) return;
      finding.actionReason = result.reason ?? 'The action failed.';
      renderCardActions(finding);
      renderPanel();
      restoreUndo();
      announcement.textContent = readerActionReason(finding.actionReason);
      toast.hidden = false;
      toast.textContent = readerActionReason(finding.actionReason);
      refresh();
      return false;
    }
    if (action === 'revert') {
      saveUndo();
      announcement.textContent = `Restored ${rules.find(r => r.id === finding.rule)?.label ?? 'proof'} to Open`;
    }
    if (disposed) return true;
    if (result.review) {
      ({ findings, rules } = visibleReview(result.review));
    } else {
      finding.status = action === 'accept' ? 'accepted' : action === 'dismiss' ? 'dismissed' : 'open';
      delete finding.actionReason;
    }
    const completed = !batch && action !== 'revert' && completionStatus(findings).complete;
    if (completed) {
      completion.completed(finding.id);
      announcement.textContent = completionStatus(findings).announcement;
    }
    const current = findings.find(f => f.id === focusId);
    if (current && !card.hidden) {
      renderCardActions(current);
      card.style.setProperty('--mark', lightRuleColor(ruleFor(current).color));
    }
    refresh();
    renderPanel();
    restoreUndo();
    if (batch) return true;
    if (!card.hidden) {
      clearTimeout(decisionSettle);
      const settleDecision = () => {
        if (disposed || card.hidden) return;
        if (wordFinding) {
          decisionSettle = setTimeout(settleDecision, 20);
          return;
        }
        if (action === 'revert') {
          selectProof(
            findings.find(f => f.id === finding.id),
            false,
          );
        } else {
          selectProof(completed ? undefined : findings.find(f => f.id === finding.id), false);
        }
        if (keyboard && !card.hidden)
          (completed ? completion.undo : action === 'revert' ? actionControls[0]! : actionControls[2]!).focus({
            preventScroll: true,
          });
      };
      settleDecision();
    }
    return true;
  }
  const overviewTitle = () =>
    findings.length ? `${proofSet(findings, 'reviewed').length} of ${findings.length} reviewed` : 'No proofs yet';
  function acceptable(f: ProofmarksFinding) {
    const { slot, text } = cardSlots(f);
    return acceptsAll(f, text, slot);
  }
  let accepting: { done: number; total: number } | undefined;
  /** Accept all: each ready rewrite in reading order, one at a time, through the same path as Accept. Undo stays per proof. */
  async function acceptAll() {
    if (accepting || busy || reviewing || !onAccept) return;
    const targets = orderedFindings().filter(acceptable);
    if (!targets.length) return;
    accepting = { done: 0, total: targets.length };
    updateRewriteAll();
    let accepted = 0;
    for (const target of targets) {
      const current = findings.find(f => f.id === target.id);
      if (current && acceptable(current) && (await performAction('accept', current, true))) accepted++;
      if (disposed) return;
      accepting.done++;
      updateRewriteAll();
      const title = view === 'overview' && deep.querySelector('header h2');
      if (title) title.textContent = overviewTitle();
    }
    const total = accepting.total;
    accepting = undefined;
    announcement.textContent =
      accepted === total
        ? `Accepted ${total} ${total === 1 ? 'rewrite' : 'rewrites'}.`
        : `Accepted ${accepted} of ${total} rewrites.`;
    if (completionStatus(findings).complete) {
      completion.completed(targets.at(-1)!.id);
      announcement.textContent = completionStatus(findings).announcement;
    }
    updateRewriteAll();
    renderPanel();
  }
  let surfacePinned = false;
  let panelAnimation: Animation | undefined,
    shellAnimation: Animation | undefined,
    headerAnimation: Animation | undefined,
    contentAnimation: Animation | undefined;
  const ease = 'cubic-bezier(.22,1,.36,1)';
  let expanded = false,
    hoverSuppressed = false,
    restoringBadgeFocus = false;
  const pillUI = reviewPill({
    doc,
    win,
    reduced,
    keyboard: () => keyboard,
    open: () => setPanel(!expanded),
    touch: () => mobile.matches,
    geometry: () =>
      queueMicrotask(() => {
        if (!disposed) dock.refresh();
      }),
  });
  const pill = pillUI.element;
  const tooltips = proofTooltips(doc, win, shadow, reduced);
  tooltips.bind(cardLogo, () => 'Close Esc');
  cardLogo.setAttribute('aria-keyshortcuts', 'Escape');
  tooltips.bind(heading, () => 'Details I');
  heading.setAttribute('aria-keyshortcuts', 'I');
  tooltips.bind(position, () => 'Overview O');
  position.setAttribute('aria-keyshortcuts', 'O');
  tooltips.bind(prev, () => (queueMode() ? 'Previous rewrite ←' : 'Previous ←'));
  tooltips.bind(next, () => (queueMode() ? 'Next rewrite →' : 'Next →'));
  tooltips.bind(close, () => 'Close Esc');
  tooltips.bind(prevVersion, () => 'Previous version [');
  tooltips.bind(nextVersionControl, () => 'Next version ]');
  tooltips.bind(tryAnother, () =>
    tryAnother.disabled && !busy ? 'Another rewrite is on the way' : 'Try another rewrite',
  );
  for (const [i, control] of actionControls.entries())
    tooltips.bind(control, () =>
      control.disabled && control.dataset.reason
        ? control.dataset.reason
        : `${control.getAttribute('aria-label')} ${['A', 'D', 'U'][i]}`,
    );
  tooltips.bind(pillUI.countButton, () => (!settingsState.ready ? 'Review this page P' : 'Open review P'));
  pillUI.countButton.setAttribute('aria-keyshortcuts', 'P');

  const completion = completionMoment({
    doc,
    win,
    reduced,
    source: reviewId ?? source ?? win.location.pathname,
    persistent: true,
    undo: id => {
      const f = findings.find(f => f.id === id);
      if (f) void performAction('revert', f);
    },
    badge: (on, animate) => pillUI.setCompleted(on, animate),
  });
  empty.append(completion.element);
  tooltips.bind(completion.undo, () => 'Undo last decision · return to proof U');
  const header = doc.createElement('div');
  header.className = 'header';
  header.append(pill);
  panel.append(header);
  header.style.opacity = '1';
  panel.dataset.expanded = 'false';
  const openClip = 'inset(0 0 0 0 round var(--surface-radius))';
  let closedClip = 'inset(0 0 0 0 round var(--surface-radius))';
  pillUI.mark.setAttribute('aria-keyshortcuts', 'P');
  const help = doc.createElement('section');
  help.className = 'shortcuts-help';
  help.hidden = true;
  help.setAttribute('role', 'dialog');
  help.setAttribute('aria-label', 'Proofmarks shortcuts');
  const helpTitle = doc.createElement('h2');
  helpTitle.textContent = 'Proofmarks shortcuts';
  const helpClose = button('×', () => toggleHelp(false));
  helpClose.setAttribute('aria-label', 'Close shortcuts');
  help.append(helpTitle, helpClose);
  for (const [keys, label] of [
    ['P', 'Open / close review'],
    ['⇧P', 'Show / hide marks'],
    ['N / ⇧N', 'Next / previous proof'],
    ['← / →', 'Previous / next proof'],
    ['A / D', 'Accept / Dismiss'],
    ['U', 'Undo'],
    ['[ / ]', 'Previous / next version'],
    ['O', 'Page overview'],
    ['I', 'Details'],
    [',', 'Settings'],
    ['Esc', 'Back / close'],
    ['?', 'Show / hide shortcuts'],
    ['⌥ + arrows', 'Move badge'],
  ]) {
    const row = doc.createElement('p'),
      key = doc.createElement('kbd');
    key.textContent = keys!;
    row.append(key, doc.createTextNode(label!));
    help.append(row);
  }
  shadow.append(help);
  function placeHelp() {
    if (help.hidden) return;
    const r = pill.getBoundingClientRect(),
      width = help.offsetWidth,
      height = help.offsetHeight;
    help.style.left = `${Math.max(12, Math.min(r.left > layoutWidth(doc) / 2 ? r.left - width - 12 : r.right + 12, layoutWidth(doc) - width - 12))}px`;
    help.style.top = `${Math.max(12, Math.min(r.top, win.innerHeight - height - 12))}px`;
  }
  function toggleHelp(show = help.hidden) {
    help.hidden = !show;
    if (show) {
      placeHelp();
      helpClose.focus({ preventScroll: true });
    } else {
      hoverSuppressed = true;
      pillUI.focus();
    }
  }
  function updateCardChrome() {
    const selected = orderedFindings(),
      i = selected.findIndex(f => f.id === focusId);
    const done = !empty.hidden;
    prev.hidden = next.hidden = done;
    position.textContent = selected.length && !done ? `${Math.max(0, i) + 1} of ${selected.length}` : 'Page overview';
    position.setAttribute(
      'aria-label',
      selected.length && !done
        ? `Proof ${Math.max(0, i) + 1} of ${selected.length}. Open the page overview`
        : 'Page overview',
    );
    if (queueMode() && !done) {
      const ready = rewriteQueue(findings).ready;
      position.textContent = ready.length ? `${ready.length} ready` : 'None ready yet';
      position.setAttribute('aria-label', `${position.textContent}. Open the page overview`);
      counterLive.textContent = position.getAttribute('aria-label');
      sizeControlHighlights();
      prev.disabled = next.disabled = busy || !ready.some(f => f.id !== focusId);
      footer.hidden = following || view !== 'proof';
      placeLogo();
      return;
    }
    counterLive.textContent = position.getAttribute('aria-label');
    sizeControlHighlights();
    prev.disabled = next.disabled = selected.length < 2 || busy;
    footer.hidden = following || view !== 'proof';
    placeLogo();
  }
  const deep = doc.createElement('div');
  deep.className = 'd-deep';
  deep.hidden = true;
  card.append(deep);
  function placeLogo() {
    const bottom = card.classList.contains('dock-card') && !mobile.matches && panel.dataset.slot?.startsWith('bottom');
    const row = bottom ? footer : view === 'proof' ? cardHeader : deep.querySelector('header');
    if (!row) return;
    cardLogo.classList.toggle('sheet-logo', mobile.matches);
    cardLogo.style.marginLeft = panel.dataset.slot?.endsWith('left') ? '0' : 'auto';
    if (panel.dataset.slot?.endsWith('left')) {
      if (row.firstElementChild !== cardLogo) row.prepend(cardLogo);
    } else if (row.lastElementChild !== cardLogo) row.append(cardLogo);
    footer.hidden = following || (!bottom && view !== 'proof');
  }
  function backView() {
    if (view === 'overview' && !findings.length) {
      closeCard();
      return;
    }
    setView(view === 'rule' ? 'settings' : view === 'settings' ? 'overview' : 'proof');
  }
  function setView(nextView: typeof view) {
    if (card.hidden) return;
    const surface = mobile.matches ? sheet.element : expanded ? panel : card,
      from = surface.getBoundingClientRect().height,
      fromPlace = surface === card ? card.style.transform : '';
    cycleAnimation?.cancel();
    fadeAnimations.forEach(a => a.cancel());
    const previous = view;
    view = nextView;
    card.dataset.view = view;
    deep.replaceChildren();
    deep.hidden = view === 'proof';
    // Back to the proof the way the card was opened: a card opened on the page stays where it is, the pill's stays in the pill.
    if (view === 'proof') {
      const f = findings.find(f => f.id === focusId);
      if (f) showCard(f, false, false, entryMode);
      else selectProof(undefined, false);
    } else {
      cardHeader.hidden = content.hidden = actionShell.hidden = empty.hidden = footer.hidden = true;
      const h = doc.createElement('header'),
        back = button('‹', backView),
        title = doc.createElement('h2');
      back.setAttribute(
        'aria-label',
        view === 'rule' ? 'Back to settings' : view === 'settings' ? 'Back to overview' : 'Back to proof',
      );
      tooltips.bind(back, () => 'Back Esc');
      title.textContent =
        view === 'overview'
          ? overviewTitle()
          : view === 'why'
            ? 'Details'
            : view === 'rule'
              ? (rules.find(r => r.id === ruleId)?.label ?? 'Rule')
              : 'Settings';
      h.append(back, title);
      deep.append(h);
      if (view === 'overview') {
        const hide = button('Hide marks', () => {
          setEnabled(!enabled);
          hide.setAttribute('aria-checked', String(!enabled));
        });
        hide.className = 'd-switch-row';
        hide.setAttribute('role', 'switch');
        hide.setAttribute('aria-checked', String(!enabled));
        const track = doc.createElement('span');
        track.className = 'd-switch';
        track.setAttribute('aria-hidden', 'true');
        hide.append(track);
        const recheck = button('Re-check page', runReview),
          checked = doc.createElement('p'),
          settingsButton = button('Settings', () => setView('settings'));
        checked.className = 'd-muted';
        settingsButton.className = 'd-nav';
        settingsButton.setAttribute('aria-keyshortcuts', ',');
        tooltips.bind(settingsButton, () => 'Settings ,');
        const chevron = doc.createElement('span');
        chevron.textContent = '›';
        chevron.setAttribute('aria-hidden', 'true');
        settingsButton.append(chevron);
        deep.append(hide);
        if (onRequestRewrite) {
          const all = doc.createElement('div');
          all.dataset.rewriteAll = '';
          deep.append(all);
          updateRewriteAll(all);
        }
        if (onReview) {
          recheck.disabled = reviewing;
          checked.textContent = companionStatus.lastReviewTime
            ? 'Last checked ' +
              new Date(companionStatus.lastReviewTime).toLocaleDateString('en-US', {
                month: 'long',
                day: 'numeric',
                year: 'numeric',
              })
            : (companionStatus.reason ?? 'Not checked yet');
          deep.append(recheck, checked);
        } else if (!findings.length) {
          const note = doc.createElement('p');
          note.textContent = setupHint ?? 'Reviews run through the Proofmarks companion.';
          deep.append(note);
        }
        deep.append(settingsButton);
      } else if (view === 'why') {
        const f = findings.find(f => f.id === focusId);
        if (f)
          deep.append(
            whyContent(
              doc,
              f,
              rules.find(r => r.id === f.rule),
            ),
          );
      } else if (view === 'rule') {
        const rule = rules.find(r => r.id === ruleId);
        if (rule)
          deep.append(
            ruleContent({
              doc,
              rule,
              state: settingsState,
              changed: () => draw(),
              strictness: learned.find(entry => entry.rule === rule.id),
              resetting: resetting || reviewing,
              resetStrictness: onResetStrictness ? id => void resetStrictness(id) : undefined,
            }),
          );
      } else
        deep.append(
          settingsContent({
            doc,
            rules,
            status: companionStatus,
            agents: agentStatus,
            agentReason,
            targetBusy,
            selectTarget: target => void selectRewriteTarget(target),
            openRule: id => {
              ruleId = id;
              setView('rule');
            },
          }),
        );
      const body = doc.createElement('div');
      body.className = 'd-view-body';
      for (const child of [...deep.children]) if (child !== h) body.append(child);
      deep.append(body);
      // Back from a rule's page lands on that rule's row.
      const row =
        previous === 'rule' && view === 'settings' && deep.querySelector<HTMLElement>(`[data-rule="${ruleId}"]`);
      if (row) {
        row.focus({ preventScroll: true });
        row.scrollIntoView({ block: 'nearest' });
      } else back.focus({ preventScroll: true });
    }
    if (view !== 'proof') {
      position.textContent = 'Page overview';
      hideTabs();
    }
    placeLogo();
    sizeControlHighlights();
    if (pinned && !expanded && !mobile.matches) {
      cacheCardSize();
      const f = findings.find(f => f.id === focusId);
      if (f) anchorCard(f);
    }
    const to = surface.getBoundingClientRect().height,
      toPlace = surface === card ? card.style.transform : '';
    if (!reduced.matches) {
      // One surface: when the new view needs the card somewhere else to fit, it moves there as it resizes, never before.
      const moves = !!fromPlace && !!toPlace && fromPlace !== toPlace;
      cycleAnimation = reshaping(
        surface,
        surface.animate(
          [
            { height: `${from}px`, ...(moves ? { transform: fromPlace } : {}) },
            { height: `${to}px`, ...(moves ? { transform: toPlace } : {}) },
          ],
          { duration: 220, easing: ease },
        ),
      );
      fadeAnimations = [
        (view === 'proof' ? content : (deep.querySelector('.d-view-body') ?? deep)).animate(
          [
            { opacity: 0, transform: 'translateY(4px)', filter: 'blur(1px)' },
            { opacity: 1, transform: 'none', filter: 'none' },
          ],
          { duration: 200, delay: 40, easing: ease, fill: 'backwards' },
        ),
      ];
    }
    dock.refresh();
  }
  /** Overview: Rewrite all asks for every open proof without a rewrite; while any are on the way, one Cancel stops them all. */
  function updateRewriteAll(section = deep.querySelector<HTMLElement>('[data-rewrite-all]')) {
    if (!section) return;
    const q = rewriteQueue(findings),
      focused =
        shadow.activeElement instanceof HTMLElement && section.contains(shadow.activeElement)
          ? shadow.activeElement.dataset
          : undefined;
    section.replaceChildren();
    const cleared = q.ready.filter(acceptable),
      unclear = q.ready.filter(f => !acceptable(f) && (f.status ?? 'open') === 'open').length;
    if (cleared.length || accepting) {
      const total = accepting?.total ?? cleared.length,
        line = doc.createElement('p'),
        all = button(`Accept ${total} ${total === 1 ? 'rewrite' : 'rewrites'}`, () => void acceptAll());
      line.className = 'd-muted';
      line.dataset.acceptStatus = '';
      line.textContent = acceptAllStatus(cleared.length, unclear, accepting);
      all.dataset.acceptAll = '';
      // The one decision in Overview, and it writes to the files: the filled first action, with its count.
      all.className = 'primary';
      all.disabled = !!accepting || busy || reviewing;
      section.append(line, all);
    }
    if (q.missing.length) {
      const all = button('Rewrite all', () => void requestRewrites());
      all.dataset.requestRewrites = '';
      all.disabled = busy || reviewing || targetBusy;
      section.append(all);
    }
    if (q.writing.length) {
      const line = doc.createElement('p'),
        cancel = button('Cancel all', () => void cancelRequest());
      line.className = 'd-muted';
      line.dataset.rewritesWaiting = '';
      line.textContent = `${q.writing.length} ${q.writing.length === 1 ? 'rewrite' : 'rewrites'} on the way`;
      cancel.dataset.cancelRewrites = '';
      cancel.disabled = busy;
      section.append(line, cancel);
    }
    if (focused)
      (
        section.querySelector<HTMLElement>(
          focused.cancelRewrites !== undefined
            ? '[data-cancel-rewrites]'
            : focused.acceptAll !== undefined
              ? '[data-accept-all]'
              : '[data-request-rewrites]',
        ) ?? section.querySelector('button')
      )?.focus({ preventScroll: true });
  }
  /** Reset a rule's learned line, then re-check the page so the calibrated line applies again. */
  async function resetStrictness(rule: string) {
    if (resetting || !onResetStrictness) return;
    resetting = true;
    draw();
    try {
      const result = await onResetStrictness(rule);
      if (!result.ok) announcement.textContent = result.reason ?? 'Reset failed.';
    } catch {
      announcement.textContent = 'Proofmarks companion is not running. Start proofmarks serve.';
    }
    resetting = false;
    if (!disposed) runReview();
  }
  function runReview() {
    if (setupHint) {
      announcement.textContent = setupHint;
      return;
    }
    if (reviewing) return;
    if (!onReview) {
      announcement.textContent = 'Proofmarks companion is not running. Start proofmarks serve.';
      return;
    }
    reviewing = true;
    renderBadge();
    void onReview()
      .then(result => {
        if (disposed) return;
        if (result.ok && result.review) {
          ({ findings, rules } = visibleReview(result.review));
          learned = result.review.strictness ?? [];
          settingsState.finish();
          if (!enabled) setEnabled(true);
          companionStatus = { ...companionStatus, connected: true, lastReviewTime: new Date().toISOString() };
          refresh();
          announcement.textContent = 'Page checked. Proofs ready.';
        } else {
          companionStatus = { ...companionStatus, reason: result.reason ?? 'Review failed' };
          announcement.textContent = companionStatus.reason!;
          if (card.hidden) setPanel(true);
          setView('overview');
        }
      })
      .catch(() => {
        companionStatus = { connected: false, reason: 'Proofmarks companion is not running. Start proofmarks serve.' };
        announcement.textContent = companionStatus.reason!;
        if (card.hidden) setPanel(true);
        setView('overview');
      })
      .finally(() => {
        reviewing = false;
        if (!disposed) {
          renderBadge();
          if (!card.hidden && view !== 'proof') setView(view);
        }
      });
  }
  function revealProof(f: ProofmarksFinding) {
    const m = matches.find(m => m.finding.id === f.id) ?? findProofmarks(root, [{ ...f, status: 'open' }])[0];
    const range = m?.range;
    if (!range) return;
    const rect = range.getBoundingClientRect();
    if (!expanded && !mobile.matches && entryMode === 'text' && pinned) {
      if (rect.top < 100 || rect.bottom > win.innerHeight - 100)
        win.scrollTo({ top: Math.max(0, win.scrollY + rect.top - win.innerHeight / 2), behavior: 'instant' });
      const r = range.getBoundingClientRect();
      pinOrigin = { x: win.scrollX + r.left + Math.min(r.width / 2, 180), y: win.scrollY + r.top + r.height / 2 };
      anchorCard(f);
      return;
    }
    if (mobile.matches) {
      sheet.reveal(f.id);
      return;
    }
    const box = expanded ? panel.getBoundingClientRect() : card.getBoundingClientRect();
    let top = 90,
      bottom = win.innerHeight - 24;
    if (rect.right > box.left && rect.left < box.right) {
      if (box.top < win.innerHeight / 2) top = Math.max(top, box.bottom + 16);
      else bottom = Math.min(bottom, box.top - 16);
    }
    win.scrollTo({
      top: Math.max(
        0,
        win.scrollY + rect.top - top - Math.max(0, (bottom - top - Math.min(rect.height, bottom - top)) / 2),
      ),
      behavior: reduced.matches || keyboard ? 'instant' : 'smooth',
    });
  }
  /** keepPlace: a tab switch, so the card stays where it is and keeps its tabs. */
  function selectProof(f: ProofmarksFinding | undefined, scrollTo = true, keepPlace = false) {
    finishPin?.();
    const same = f?.id === focusId && view === 'proof';
    const surface = expanded ? panel : card,
      from = surface.getBoundingClientRect().height;
    cycleAnimation?.cancel();
    fadeAnimations.forEach(a => a.cancel());
    fadeAnimations = [];
    card.querySelector('.proof-outgoing')?.remove();
    const contentTop = content.offsetTop;
    const old = !same && !card.hidden && !reduced.matches ? (content.cloneNode(true) as HTMLElement) : undefined;
    if (f) {
      if (!same && !expanded && entryMode === 'text' && !keepPlace) {
        pinOrigin = undefined;
        pinBox = undefined;
        tabsLine = undefined;
      }
      showCard(f, false, false, entryMode);
      if (scrollTo) revealProof(f);
    } else {
      view = 'proof';
      deep.hidden = true;
      card.dataset.view = 'proof';
      card.hidden = false;
      card.inert = false;
      following = false;
      pinned = true;
      card.dataset.following = 'false';
      delete card.dataset.proof;
      content.hidden = true;
      cardHeader.hidden = false;
      heading.hidden = true;
      actionShell.hidden = true;
      empty.hidden = false;
      completion.update(findings, busy);
      completion.show();
      updateCardChrome();
    }
    for (const [id, group] of groups) group.element.dataset.active = String(id === f?.id);
    const to = surface.getBoundingClientRect().height;
    if (from > 0 && !reduced.matches) {
      cycleAnimation = reshaping(
        surface,
        surface.animate([{ height: `${from}px` }, { height: `${to}px` }], { duration: 220, easing: ease }),
      );
      if (old && f) {
        old.className = 'proof-content proof-outgoing';
        old.style.top = `${contentTop}px`;
        old.setAttribute('aria-hidden', 'true');
        old.inert = true;
        card.append(old);
        const exit = old.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 40, easing: ease });
        exit.onfinish = () => old.remove();
        fadeAnimations.push(
          exit,
          content.animate(
            [
              { opacity: 0, transform: 'translateY(4px)', filter: 'blur(1px)' },
              { opacity: 1, transform: 'none', filter: 'none' },
            ],
            { duration: 200, delay: 40, easing: ease, fill: 'backwards' },
          ),
        );
      }
    }
    restoreUndo();
  }
  function cycle(direction: number) {
    if (busy) return;
    if (queueMode()) {
      const ready = new Set(rewriteQueue(findings).ready.map(f => f.id)),
        target = stepQueue(orderedFindings(), ready, focusId, direction);
      if (target) selectProof(target);
      return;
    }
    selectProof(stepAllProofs(orderedFindings(), focusId, direction));
  }
  function syncSurface() {
    shell.style.clipPath = 'none';
    const r = panel.getBoundingClientRect();
    Object.assign(surfaceShadow.style, {
      left: `${r.left}px`,
      top: `${r.top}px`,
      width: `${r.width}px`,
      height: `${r.height}px`,
    });
    surfaceShadow.dataset.open = String(expanded);
  }
  function circleAfterGrace() {
    clearTimeout(graceTimer);
    if (expanded) return;
    graceTimer = setTimeout(() => {
      if (!expanded && !pill.matches(':hover') && !(keyboard && pill.contains(shadow.activeElement)))
        pillUI.setCircle(true);
    }, 120);
  }
  function finishCollapse() {
    pinned = false;
    following = false;
    delete panel.dataset.animating;
    card.hidden = true;
    panel.style.clipPath = 'none';
    syncSurface();
    restoreUndo();
  }

  function settleMotion() {
    completion.settle();
    finishPin?.();
    finishCardClose?.();
    stopWords();
    dock.settle();
    cycleAnimation?.cancel();
    fadeAnimations.forEach(a => a.cancel());
    card.querySelector('.proof-outgoing')?.remove();
    morphing = false;
    actionShell.style.visibility = actionsExpanded ? 'visible' : 'hidden';
    layer.getAnimations({ subtree: true }).forEach(a => a.cancel());
    panelAnimation?.cancel();
    shellAnimation?.cancel();
    headerAnimation?.cancel();
    contentAnimation?.cancel();
    panelAnimation = undefined;
    if (!expanded && card.classList.contains('dock-card')) finishCollapse();
    closedClip = dock.closedClip();
    panel.style.clipPath = expanded ? openClip : 'none';
    delete panel.dataset.animating;
    placeToast();
    pillUI.settle();
    syncSurface();
  }
  function setPanel(open: boolean, instant = false) {
    if (open && onReview && !findings.length && !reviewing) {
      runReview();
      return;
    }
    if (disposed) return;
    if (open) {
      finishPin?.();
      if (closing) cancelCardClose();
    }
    completion.settle();
    clearTimeout(intentTimer);
    clearTimeout(graceTimer);
    if (mobile.matches) {
      if (open) {
        entryMode = 'pill';
        if (!enabled) setEnabled(true);
        const f = completionStatus(findings).complete
          ? undefined
          : (orderedFindings().find(f => f.id === cyclerId) ?? orderedFindings()[0]);
        sheet.review();
        selectProof(f);
        if (!findings.length) setView('overview');
      } else closeCard();
      return;
    }
    if (open === expanded) return;
    if (open && !enabled) setEnabled(true);
    const retained = card.classList.contains('dock-card'),
      prior = (open ? pill : panel).getBoundingClientRect(),
      priorClip = open && !expanded ? dock.openingClip() : win.getComputedStyle(panel).clipPath,
      headerFrom = win.getComputedStyle(header).opacity,
      contentFrom = win.getComputedStyle(card).opacity;
    panelAnimation?.cancel();
    shellAnimation?.cancel();
    headerAnimation?.cancel();
    contentAnimation?.cancel();
    cycleAnimation?.cancel();
    cancelHover();
    following = false;
    delete card.dataset.fixed;
    if (!open) hoverSuppressed = true;
    else hoverSuppressed = false;
    expanded = open;
    surfacePinned = open;
    panel.dataset.expanded = String(open);
    pillUI.setExpanded(open);
    if (open) {
      shell.getAnimations().forEach(a => a.cancel());
      entryMode = 'pill';
      card.classList.add('dock-card');
      panel.append(card);
      card.style.cssText = '';
      const f = completionStatus(findings).complete
        ? undefined
        : (orderedFindings().find(f => f.id === cyclerId) ?? orderedFindings()[0]);
      selectProof(f, false);
      if (!findings.length) setView('overview');
    }
    card.inert = !open;
    header.inert = false;
    dock.refresh();
    closedClip = dock.closedClip();
    const now = panel.getBoundingClientRect();
    const clipFrom =
      open && !retained
        ? `inset(${prior.top - now.top}px ${Math.max(0, now.right - prior.right)}px ${Math.max(0, now.bottom - prior.bottom)}px ${Math.max(0, prior.left - now.left)}px round var(--surface-radius))`
        : priorClip;
    panel.style.clipPath = openClip;
    syncSurface();
    header.style.opacity = open ? '0' : '1';
    header.inert = open;
    card.style.opacity = open ? '1' : '0';
    if (keyboard) {
      if (open)
        (view === 'proof' ? heading : deep.querySelector<HTMLElement>('button'))?.focus({ preventScroll: true });
      else {
        restoringBadgeFocus = true;
        pillUI.focus();
        restoringBadgeFocus = false;
      }
    }
    if (instant || reduced.matches) {
      if (!open) finishCollapse();
    } else {
      panel.dataset.animating = 'true';
      const a = (open ? panel : shell).animate(
        open ? [{ clipPath: clipFrom }, { clipPath: openClip }] : [{ clipPath: openClip }, { clipPath: closedClip }],
        { duration: open ? 220 : 150, easing: ease, fill: open ? 'none' : 'forwards' },
      );
      panelAnimation = a;
      if (!open)
        fadeAnimations.push(
          card.animate([{ clipPath: openClip }, { clipPath: closedClip }], { duration: 150, easing: ease }),
        );
      a.onfinish = () => {
        if (panelAnimation !== a) return;
        panelAnimation = undefined;
        delete panel.dataset.animating;
        if (!expanded) {
          finishCollapse();
          a.cancel();
          shellAnimation?.cancel();
          shellAnimation = undefined;
        }
      };
      shell.style.clipPath = 'none';
      if (!open) {
        const delay = inkDissolveDelay(now.width, now.height);
        shellAnimation = shell.animate([{ opacity: 1 }, { opacity: 0 }], {
          duration: 150 - delay,
          delay,
          easing: 'linear',
          fill: 'forwards',
        });
      } else shellAnimation = undefined;
      headerAnimation = header.animate([{ opacity: headerFrom }, { opacity: open ? 0 : 1 }], {
        duration: 150,
        easing: ease,
      });
      contentAnimation = (
        open ? (view === 'proof' ? content : (deep.querySelector('.d-view-body') ?? deep)) : card
      ).animate(
        open
          ? [
              { opacity: 0, transform: 'translateY(4px)', filter: 'blur(1px)' },
              { opacity: 1, transform: 'none', filter: 'none' },
            ]
          : [{ opacity: contentFrom }, { opacity: 0 }],
        { duration: open ? 200 : 90, delay: open ? 40 : 0, easing: ease, fill: 'backwards' },
      );
    }
    if (open) {
      const f = findings.find(f => f.id === focusId);
      if (f) revealProof(f);
    }
    restoreUndo();
  }
  panel.addEventListener(
    'click',
    () => {
      surfacePinned = true;
      clearTimeout(graceTimer);
    },
    true,
  );
  panel.onpointerenter = () => clearTimeout(graceTimer);
  panel.onpointerleave = () => {
    if (finePointer.matches && expanded && !busy && !surfacePinned) graceTimer = setTimeout(() => setPanel(false), 600);
  };
  pill.onpointerenter = () => {
    clearTimeout(graceTimer);
    if (!finePointer.matches || mobile.matches || expanded || hoverSuppressed) return;
    clearTimeout(intentTimer);
    if (pillUI.isMorphing() && !pointerButtons && panel.dataset.dragging !== 'true') {
      pillUI.setCircle(false);
      return;
    }
    intentTimer = setTimeout(() => {
      if (!pointerButtons && panel.dataset.dragging !== 'true') pillUI.setCircle(false);
    }, 32);
  };
  pill.onpointerleave = () => {
    hoverSuppressed = false;
    clearTimeout(intentTimer);
    circleAfterGrace();
  };
  pill.addEventListener('pointerdown', () => clearTimeout(intentTimer));
  pill.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') {
      keyboard = true;
      hoverSuppressed = false;
    }
  });
  pill.addEventListener('focusin', () => {
    clearTimeout(graceTimer);
    if (!restoringBadgeFocus && !expanded && (keyboard || shadow.activeElement?.matches(':focus-visible'))) {
      keyboard = true;
      hoverSuppressed = false;
      pillUI.setCircle(false);
    }
  });
  pill.addEventListener('focusout', () => circleAfterGrace());
  function renderBadge() {
    if (setupHint) {
      pillUI.prompt(setupHint.startsWith('Start') ? 'Start Proofmarks' : 'Set up this page', setupHint);
      return;
    }
    if (reviewing) {
      pillUI.prompt('Checking…', 'Review in progress');
      return;
    }
    if ((onReview && !findings.length) || !settingsState.ready) {
      pillUI.prompt('It’s proofin’ time', 'Review this page');
      return;
    }
    pillUI.prompt();
    pillUI.setEnabled(enabled);
    const count = proofSet(orderedFindings(), 'open').length;
    pillUI.update(count, count ? `${count} ${count === 1 ? 'proof' : 'proofs'}` : 'All reviewed');
  }
  function renderPanel() {
    renderBadge();
    completion.update(findings, busy);
    if (!card.hidden) updateCardChrome();
  }
  /** Phones: while the sheet is open only its proof stays marked; the others return when it closes. */
  function quietMarks() {
    const only = mobile.matches && !card.hidden && sheet.isOpen() ? focusId : undefined;
    for (const [id, group] of groups) group.element.dataset.quiet = String(!!only && id !== only);
  }
  /** Fade every mark except these; no argument restores them. */
  function dimTo(ids?: readonly string[]) {
    for (const [id, group] of groups) group.element.dataset.dim = String(!!ids && !ids.includes(id));
  }
  // After a pick from a line's list, the line's proofs become tabs on the card's left edge (desktop only).
  const lineTabs = doc.createElement('div');
  lineTabs.className = 'line-tabs';
  lineTabs.hidden = true;
  lineTabs.setAttribute('role', 'tablist');
  lineTabs.setAttribute('aria-label', 'Proofs on this line');
  lineTabs.setAttribute('aria-orientation', 'vertical');
  shadow.append(lineTabs);
  lineTabs.addEventListener('pointerleave', () => dimTo());
  let tabsFrame = 0,
    tabsKey = '',
    tabsFade: Animation | undefined;
  /** Keep the tabs on the card's edge: once now, and every frame only while the card itself is animating. */
  function followTabs() {
    tabsFrame = 0;
    if (lineTabs.hidden) return;
    if (card.hidden || following) {
      hideTabs();
      return;
    }
    const r = card.getBoundingClientRect();
    lineTabs.style.transform = `translate3d(${r.left + 1}px,${r.top + 12}px,0)`;
    if (card.getAnimations().length) tabsFrame = requestAnimationFrame(followTabs);
  }
  function hideTabs(animate = false) {
    if (lineTabs.hidden) return;
    tabsFade?.cancel();
    const done = () => {
      lineTabs.hidden = true;
      tabsKey = '';
      cancelAnimationFrame(tabsFrame);
      tabsFrame = 0;
      tuckRun++;
      tabGhosts.replaceChildren();
      delete lineTabs.dataset.tucking;
      dimTo();
    };
    if (!animate || reduced.matches) {
      done();
      return;
    }
    tabsFade = lineTabs.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 140, easing: ease, fill: 'forwards' });
    tabsFade.onfinish = () => {
      tabsFade?.cancel();
      tabsFade = undefined;
      done();
    };
  }
  /** The card stays where it is; only its content switches to the tab's proof. */
  function switchToProof(f: ProofmarksFinding) {
    selectProof(f, false, true);
  }
  function renderLineTabs(finding: ProofmarksFinding) {
    const ids = lineGroups.get(finding.id),
      key = ids?.join(' '),
      show =
        !mobile.matches &&
        !following &&
        !card.classList.contains('dock-card') &&
        view === 'proof' &&
        !!ids &&
        ids.length > 1 &&
        key === tabsLine;
    if (!show || !key) {
      hideTabs();
      return;
    }
    if (key !== tabsKey) {
      tabsKey = key;
      lineTabs.replaceChildren(
        ...ids!.flatMap(id => {
          const f = findings.find(f => f.id === id);
          if (!f) return [];
          const rule = ruleFor(f),
            tab = button('', () => switchToProof(f));
          tab.className = 'line-tab';
          tab.dataset.finding = id;
          tab.setAttribute('role', 'tab');
          tab.setAttribute('aria-label', rule.label);
          tab.style.setProperty('--mark', rule.color);
          tab.style.setProperty('--ink-mark', lightRuleColor(rule.color));
          const chip = doc.createElement('span'),
            first = doc.createElement('span'),
            rest = doc.createElement('span');
          chip.className = 'tab-chip';
          first.className = 'tab-first';
          rest.className = 'tab-rest';
          first.textContent = rule.label.charAt(0);
          rest.textContent = rule.label.slice(1);
          chip.append(first, rest);
          tab.append(chip);
          tab.addEventListener('pointerenter', () => dimTo([id]));
          return [tab];
        }),
      );
    }
    for (const tab of lineTabs.querySelectorAll<HTMLButtonElement>('.line-tab'))
      tab.setAttribute('aria-selected', String(tab.dataset.finding === finding.id));
    if (lineTabs.hidden) {
      tabsFade?.cancel();
      lineTabs.hidden = false;
      lineTabs.style.opacity = '';
    }
    // The first letter sits centred in the folded chip; unfolded, the rest of the name follows it.
    for (const tab of lineTabs.querySelectorAll<HTMLElement>('.line-tab')) {
      const first = tab.querySelector<HTMLElement>('.tab-first')!.getBoundingClientRect().width,
        rest = tab.querySelector<HTMLElement>('.tab-rest')!.getBoundingClientRect().width,
        lead = Math.round(Math.min(11, Math.max(6, (29 - first) / 2)));
      tab.style.setProperty('--lead', `${lead}px`);
      tab.style.setProperty('--full', `${Math.ceil(1 + lead + first + rest + 12)}px`);
    }
    if (!tabsFrame) followTabs();
  }
  const morphSurface = doc.createElement('div'),
    morphCream = doc.createElement('div');
  morphSurface.className = 'morph-surface';
  morphCream.className = 'morph-cream';
  morphSurface.hidden = true;
  morphSurface.setAttribute('aria-hidden', 'true');
  morphSurface.append(morphCream);
  shadow.insertBefore(morphSurface, card);
  /** Clicking a name in a line's list: the cream list itself grows into the card (same top, same left), and its names tuck into tabs. */
  function openFromList(finding: ProofmarksFinding, from: DOMRect, names: Map<string, DOMRect>) {
    finishPin?.();
    cancelHover();
    if (expanded) setPanel(false, true);
    pinOrigin = undefined;
    pinBox = { x: from.left + win.scrollX, y: from.top + win.scrollY };
    placement = { left: false, above: false };
    tabsLine = lineGroups.get(finding.id)?.join(' ');
    // The real tabs stay invisible from their first frame; the travelling copies hand over to them.
    if (!reduced.matches) lineTabs.dataset.tucking = '';
    showCard(finding, false, false, 'text');
    card.style.removeProperty('height');
    card.style.removeProperty('clip-path');
    if (reduced.matches) {
      dimTo();
      return;
    }
    const to = card.getBoundingClientRect(),
      at = `translate3d(${to.left}px,${to.top}px,0)`;
    Object.assign(morphSurface.style, { width: `${to.width}px`, height: `${to.height}px`, transform: at });
    morphSurface.hidden = false;
    card.dataset.morphing = '';
    morphing = true;
    const finish = () => {
      pinAnimation?.cancel();
      pinFades.forEach(a => a.cancel());
      pinAnimation = undefined;
      pinFades = [];
      finishPin = undefined;
      morphing = false;
      morphSurface.hidden = true;
      delete card.dataset.morphing;
      cacheCardSize();
      dimTo();
    };
    finishPin = finish;
    // Transform and opacity only, so every frame is the compositor's. The cream lifts off the ink early, and the card's
    // content and tabs land with the box at 240ms, so no color arrives after the motion.
    pinAnimation = morphSurface.animate(
      [
        {
          transform: `translate3d(${from.left}px,${from.top}px,0) scale(${from.width / to.width},${from.height / to.height})`,
        },
        { transform: at },
      ],
      { duration: 240, easing: ease, fill: 'forwards' },
    );
    pinFades = [
      morphCream.animate([{ opacity: 1 }, { opacity: 0 }], {
        duration: 150,
        easing: 'cubic-bezier(.4,0,.2,1)',
        fill: 'both',
      }),
      ...[cardHeader, content, actionShell, footer].map(el =>
        el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 140, delay: 100, easing: ease, fill: 'backwards' }),
      ),
    ];
    const all = [pinAnimation, ...pinFades];
    void Promise.all(all.map(a => a.finished)).then(
      () => {
        if (finishPin === finish) finish();
      },
      () => {},
    );
    requestAnimationFrame(() => tuckIntoTabs(names));
  }
  // Separate caps and stretching bodies keep chip corners round. Copies end at the tabs for an invisible handover.
  const tabGhosts = doc.createElement('div');
  tabGhosts.className = 'tab-ghosts';
  tabGhosts.inert = true;
  tabGhosts.setAttribute('aria-hidden', 'true');
  shadow.append(tabGhosts);
  const capWidth = 10;
  let tuckRun = 0;
  function tuckIntoTabs(from: Map<string, DOMRect>) {
    if (lineTabs.hidden || reduced.matches) {
      delete lineTabs.dataset.tucking;
      return;
    }
    followTabs();
    const run = ++tuckRun;
    lineTabs.dataset.tucking = '';
    tabGhosts.replaceChildren();
    const glides = [...lineTabs.querySelectorAll<HTMLElement>('.line-tab')].flatMap((tab, i) => {
      const start = from.get(tab.dataset.finding ?? ''),
        chipEl = tab.querySelector<HTMLElement>('.tab-chip');
      if (!start || !chipEl) return [];
      const end = chipEl.getBoundingClientRect(),
        lead = parseFloat(tab.style.getPropertyValue('--lead')) || 10,
        full = Math.max(end.width, parseFloat(tab.style.getPropertyValue('--full')) || end.width);
      // Start with the name over the list's name, then travel to the tab.
      const dx = start.left - (end.right - full + 1 + lead),
        dy = start.top + (start.height - end.height) / 2 - end.top,
        shrink = full - end.width;
      const el = (tag: string, className: string, parent?: HTMLElement) => {
        const node = doc.createElement(tag);
        node.className = className;
        parent?.append(node);
        return node;
      };
      const ghost = el('div', 'tab-ghost'),
        mover = el('div', 'ghost-mover', ghost),
        shape = el('div', 'ghost-shape', mover),
        body = el('span', 'ghost-body', shape),
        cap = el('span', 'ghost-cap', shape),
        clip = el('span', 'ghost-clip', mover),
        name = el('span', 'ghost-name', clip),
        first = el('span', 'ghost-first', name),
        rest = el('span', 'ghost-rest', name);
      first.textContent = tab.querySelector('.tab-first')?.textContent ?? '';
      rest.textContent = tab.querySelector('.tab-rest')?.textContent ?? '';
      if (tab.getAttribute('aria-selected') === 'true') ghost.dataset.selected = '';
      ghost.style.setProperty('--mark', tab.style.getPropertyValue('--mark'));
      ghost.style.setProperty('--ink-mark', tab.style.getPropertyValue('--ink-mark'));
      Object.assign(ghost.style, {
        left: `${end.right - full}px`,
        top: `${end.top}px`,
        width: `${full}px`,
        height: `${end.height}px`,
      });
      Object.assign(cap.style, { width: `${capWidth}px` });
      Object.assign(body.style, { width: `${full - capWidth + 1}px` });
      name.style.left = `${1 + lead}px`;
      tabGhosts.append(ghost);
      const timing = { duration: 220, delay: i * 10, easing: ease, fill: 'both' as const };
      return [
        mover.animate([{ transform: `translate(${dx}px,${dy}px)` }, { transform: 'translate(0,0)' }], timing),
        cap.animate([{ transform: 'translateX(0)' }, { transform: `translateX(${shrink}px)` }], timing),
        body.animate(
          [{ transform: 'scaleX(1)' }, { transform: `scaleX(${(end.width - capWidth + 1) / (full - capWidth + 1)})` }],
          timing,
        ),
        name.animate([{ transform: 'translateX(0)' }, { transform: `translateX(${shrink}px)` }], timing),
        rest.animate(
          [{ opacity: 1 }, { offset: 0.2, opacity: 1 }, { offset: 0.7, opacity: 0 }, { opacity: 0 }],
          timing,
        ),
      ];
    });
    void Promise.all(glides.map(glide => glide.finished.catch(() => {}))).then(() => {
      if (run !== tuckRun) return;
      delete lineTabs.dataset.tucking;
      tabGhosts.replaceChildren();
    });
  }
  // A shared label unfolds into every proof on its line; nothing else moves.
  const lineMenu = doc.createElement('div');
  lineMenu.className = 'line-menu';
  lineMenu.hidden = true;
  lineMenu.setAttribute('role', 'group');
  lineMenu.setAttribute('aria-label', 'Proofs on this line');
  let lineMenuClose: ReturnType<typeof setTimeout> | undefined;
  function hideLineMenu(keepDim = false) {
    clearTimeout(lineMenuClose);
    if (!lineMenu.hidden) {
      lineMenu.hidden = true;
      if (!keepDim) dimTo();
    }
  }
  function showLineMenu(label: HTMLElement, ids: readonly string[]) {
    clearTimeout(lineMenuClose);
    layer.append(lineMenu);
    lineMenu.replaceChildren(
      ...ids.flatMap(id => {
        const f = findings.find(f => f.id === id);
        if (!f) return [];
        const pick = button(ruleFor(f).label, () => {
          const box = lineMenu.getBoundingClientRect(),
            names = new Map(
              [...lineMenu.querySelectorAll<HTMLElement>('.line-name')].map(n => [
                n.dataset.finding ?? '',
                n.getBoundingClientRect(),
              ]),
            );
          hideLineMenu(true);
          openFromList(f, box, names);
        });
        pick.dataset.finding = id;
        pick.className = 'line-name';
        pick.style.setProperty('--mark', ruleFor(f).color);
        pick.addEventListener('pointerenter', () => dimTo([id]));
        return [pick];
      }),
    );
    Object.assign(lineMenu.style, { left: label.style.left, top: label.style.top, minWidth: label.style.width });
    lineMenu.hidden = false;
    dimTo(ids);
  }
  lineMenu.addEventListener('pointerenter', () => clearTimeout(lineMenuClose));
  lineMenu.addEventListener('pointerleave', () => {
    lineMenuClose = setTimeout(hideLineMenu, 150);
  });
  function clearMarks() {
    layer.replaceChildren();
    groups.clear();
    regions = [];
  }
  let marginCache: { width: number; css: string; left: number } | undefined;
  let labelLayoutSignature = '';
  function draw(animate = false) {
    onMeasure?.('redraw-start');
    if (disposed) return;
    if (!enabled) {
      clearMarks();
      marginStyle.textContent = '';
      restoreFlag();
      return;
    }
    doc.documentElement.setAttribute('data-proofmarks-on', '');
    // The host can have a positioned body ancestor. Place the document layer at
    // the actual document origin without touching the page's positioning rules.
    const origin = documentRect(host.getBoundingClientRect());
    layer.style.left = `${-origin.x}px`;
    layer.style.top = `${-origin.y}px`;
    if (!marginCache || marginCache.width !== layoutWidth(doc)) {
      const rights = matches
        .flatMap(match => {
          const p = match.range?.startContainer.parentElement?.closest('p,li,blockquote');
          return p ? [p.getBoundingClientRect().right] : [];
        })
        .sort((a, b) => a - b);
      const contentRight = rights[Math.floor(rights.length / 2)] ?? root.getBoundingClientRect().right;
      const selectors = marginSelectors(root, contentRight);
      marginCache = {
        width: layoutWidth(doc),
        css: marginStyles(selectors),
        left: marginLabelLeft(contentRight, selectors.length > 0, layoutWidth(doc)),
      };
    }
    if (marginStyle.textContent !== marginCache.css) marginStyle.textContent = marginCache.css;
    viewport = { width: layoutWidth(doc), height: win.innerHeight };
    panelBounds = expanded ? panel.getBoundingClientRect() : pill.getBoundingClientRect();
    const compact = mobile.matches,
      retained = new Set<string>();
    // Phones show only the marks and the sheet: no margin notes taking space between paragraphs.

    const focused = (shadow.activeElement as HTMLElement | null)?.dataset.finding;
    regions = [];
    for (const [index, match] of matches.entries()) {
      if (match.finding.target || !match.range || !settingsState.visible(match.finding.rule)) continue;
      const rects = findingRects(match)
        .filter(r => r.width > 1 && r.height > 1)
        .map(documentRect);
      const unique = mergeLineRects(rects).map(r => new DOMRect(r.left, r.top, r.right - r.left, r.bottom - r.top));
      if (!unique.length) continue;
      const region: (typeof regions)[number] = {
        finding: match.finding,
        rects: unique,
        hit: findingHitRegion(unique),
        label: undefined,
      };
      regions.push(region);
      const rule = ruleFor(match.finding),
        plan = markPlan(rule, match.finding, new Set(unique.map(r => Math.round(r.top))).size);
      const leftEdge = Math.min(...unique.map(r => r.left)),
        rightEdge = Math.max(...unique.map(r => r.right));
      const topEdge = Math.min(...unique.map(r => r.top)),
        bottomEdge = Math.max(...unique.map(r => r.bottom));
      const paragraph = match.range.startContainer.parentElement?.closest('p,li,blockquote');
      const left = marginCache.left,
        width = lineLabelWidth(layoutWidth(doc) - left - 16),
        top = topEdge;
      const signature = JSON.stringify([
        unique.map(r => [r.x, r.y, r.width, r.height]),
        left,
        top,
        width,
        compact,
        rule,
        match.finding,
        plan,
      ]);
      retained.add(match.finding.id);
      if (wordFinding === match.finding.id) continue;
      const prior = groups.get(match.finding.id);
      if (prior?.signature === signature) {
        const kept = prior.element.querySelector<HTMLButtonElement>('.label');
        region.label = kept && !kept.hidden ? documentRect(kept.getBoundingClientRect()) : undefined;
        continue;
      }
      labelLayoutSignature = '';
      prior?.element.remove();
      const group = doc.createElement('div');
      group.dataset.findingGroup = match.finding.id;
      group.dataset.severity = match.finding.severity ?? 'flag';
      group.dataset.status = match.finding.status ?? 'open';
      group.dataset.active = String(match.finding.id === cyclerId);
      layer.append(group);
      groups.set(match.finding.id, { signature, element: group });
      const shapes: { rect: DOMRect; type: ProofmarksMark | 'bracket'; passage: boolean }[] = plan.bracketOnly
        ? []
        : plan.mark === 'caret'
          ? [
              {
                // At the left of its text, or the right of the letter before an accepted deletion's gap at the end.
                rect: new DOMRect(
                  (match.gapAfter ? unique.at(-1)!.right : unique[0]!.x) - 5,
                  unique[0]!.y,
                  10,
                  unique[0]!.height,
                ),
                type: 'caret',
                passage: false,
              },
            ]
          : unique.map(rect => ({ rect, type: plan.mark, passage: false }));
      if (plan.bracket) {
        const p =
          plan.bracketOnly && paragraph
            ? documentRect(paragraph.getBoundingClientRect())
            : new DOMRect(leftEdge, topEdge, rightEdge - leftEdge, bottomEdge - topEdge);
        shapes.push({ rect: p, type: 'bracket', passage: true });
      }
      for (const [part, { rect, type, passage }] of shapes.entries()) {
        const box = doc.createElement('span');
        box.className = passage ? 'passage' : 'rect';
        box.dataset.mark = type;
        box.dataset.finding = match.finding.id;
        box.setAttribute('aria-hidden', 'true');
        Object.assign(box.style, {
          left: `${rect.x}px`,
          top: `${rect.y}px`,
          width: `${rect.width}px`,
          height: `${rect.height}px`,
        });
        group.append(box);
        drawMark(
          box,
          type,
          rule.color,
          findingSeed(`${match.finding.id}:${part}:${type}`),
          (animate || revealFinding === match.finding.id) && !reduced.matches,
          revealFinding === match.finding.id ? 0 : (index % 3) * 35,
          Math.max(
            0,
            (parseFloat(win.getComputedStyle(paragraph ?? root).lineHeight) || rect.height + 6) - rect.height,
          ),
        );
      }
      if (compact) continue;
      const label = doc.createElement('button');
      label.type = 'button';
      label.textContent = rule.label;
      label.dataset.rule = rule.label;
      label.addEventListener('click', event => {
        if (dismissClick) return;
        if (expanded && !mobile.matches) {
          selectProof(match.finding);
          return;
        }
        if (mobile.matches || !event.detail || keyboard) {
          showCard(match.finding, true);
          return;
        }
        pointerPosition = { x: event.clientX, y: event.clientY };
        pinCard(match.finding);
      });
      label.className = 'label';
      label.dataset.finding = match.finding.id;
      label.style.setProperty('--mark', rule.color);
      label.setAttribute('aria-label', `${rule.label}. Open proposal`);
      Object.assign(label.style, { left: `${left}px`, top: `${top}px`, width: `${width}px` });
      if (width < 120) label.style.fontSize = '21px';
      label.addEventListener('blur', () => schedule());
      label.addEventListener('focus', () => {
        if (!suppressFocus && keyboard) showCard(match.finding);
      });
      group.append(label);
      // A shared label (Puffery +3) unfolds into its line's proofs.
      label.addEventListener('pointerenter', () => {
        const ids = lineGroups.get(match.finding.id);
        if (!ids || ids.length < 2 || label.hidden) return;
        showLineMenu(label, ids);
      });
      label.addEventListener('pointerleave', () => {
        lineMenuClose = setTimeout(hideLineMenu, 150);
      });
      region.label = documentRect(label.getBoundingClientRect());

      if (focused === match.finding.id) {
        suppressFocus = true;
        label.focus({ preventScroll: true });
        suppressFocus = false;
      }
    }
    for (const [id, group] of groups)
      if (!retained.has(id)) {
        if (focused === id && findings.find(f => f.id === id)?.status === 'dismissed') {
          for (const mark of group.element.querySelectorAll('.rect,.passage,.arrow')) mark.remove();
          const label = group.element.querySelector<HTMLButtonElement>('.label');
          label?.setAttribute(
            'aria-label',
            `Dismissed ${rules.find(r => r.id === findings.find(f => f.id === id)?.rule)?.label ?? 'proof'}. Open proposal`,
          );
          continue;
        }
        group.element.remove();
        groups.delete(id);
      }
    if (!card.hidden) {
      const current = findings.find(f => f.id === focusId);
      if (current) {
        cacheCardSize();
        anchorCard(current);
      }
    }
    const focusedFinding = findings.find(f => f.id === focusId);
    if (focusedFinding) {
      anchorReason.textContent =
        pageAnchorReason(focusedFinding, !!matches.find(m => m.finding.id === focusId)?.range) ?? '';
      anchorReason.hidden = !anchorReason.textContent;
    }
    placeLabels();
    quietMarks();
    revealFinding = undefined;
    onMeasure?.('redraw-end');
  }
  function placeLabels() {
    if (mobile.matches) return;
    const lines = regions.flatMap(region => {
      const label = groups.get(region.finding.id)?.element.querySelector<HTMLButtonElement>('.label');
      if (!label) return [];
      const anchor = Math.min(...region.rects.map(r => r.top));
      return [
        {
          region,
          label,
          anchor,
          rank: (region.finding.status ?? 'open') === 'open' ? 0 : 1,
          anchorLeft: Math.min(...region.rects.filter(r => Math.abs(r.top - anchor) < 1).map(r => r.left)),
          anchorBottom: Math.max(...region.rects.map(r => r.bottom)),
        },
      ];
    });
    // Marks on one line share one label, an open proof's when there is one, counting the rest. Write that text before measuring, so nothing re-wraps later.
    lineGroups.clear();
    for (const row of lineRows(lines)) {
      const ids = row.map(item => item.region.finding.id);
      for (const id of ids) lineGroups.set(id, ids);
    }
    for (const row of lineRows(lines))
      row.forEach(({ label }, i) => {
        const name = label.dataset.rule ?? '',
          more = i ? 0 : row.length - 1,
          text = more ? `${name} +${more}` : name;
        label.hidden = i > 0;
        if (label.textContent !== text) {
          label.textContent = text;
          label.setAttribute(
            'aria-label',
            more ? `${name} and ${more} more on this line. Open proposal` : `${name}. Open proposal`,
          );
        }
      });
    const candidates = lines.map(({ region, label, ...line }) => {
      const rect = documentRect(label.getBoundingClientRect());
      return { id: region.finding.id, ...line, left: rect.left, width: rect.width, height: rect.height };
    });
    const layoutSignature = JSON.stringify(candidates);
    if (layoutSignature === labelLayoutSignature) {
      cullLabels();
      return;
    }
    labelLayoutSignature = layoutSignature;
    const placements = layoutLineLabels(candidates),
      starts = new Map(placements.filter(p => !p.hidden).map(p => [p.id, { x: p.left - 4, y: p.top + 14 }]));
    for (const placement of placements) {
      const group = groups.get(placement.id)!.element,
        label = group.querySelector<HTMLButtonElement>('.label')!,
        region = regions.find(r => r.finding.id === placement.id)!;
      // A hidden label's mark leads from the line's shared label.
      const start = starts.get(placement.head ?? placement.id)!;
      label.style.left = `${placement.left}px`;
      label.style.top = `${placement.top}px`;
      region.label = placement.hidden
        ? undefined
        : new DOMRect(placement.left, placement.top, placement.width, placement.height);
      const signature = JSON.stringify([
        start,
        region.rects.map(r => [r.left, r.top, r.right, r.bottom]),
        ruleFor(region.finding).color,
      ]);
      if (group.dataset.leader !== signature) {
        group.querySelector('.arrow')?.remove();
        drawArrow(group, start, region.rects, ruleFor(region.finding).color, false, 0, placement.id);
        group.dataset.leader = signature;
      }
    }
    cullLabels();
  }
  function cullLabels() {
    if (mobile.matches) return;
    for (const region of regions) {
      const group = groups.get(region.finding.id)?.element,
        label = group?.querySelector<HTMLButtonElement>('.label');
      if (!label) continue;
      const hidden =
        Math.max(...region.rects.map(r => r.bottom)) <= win.scrollY ||
        Math.min(...region.rects.map(r => r.top)) >= win.scrollY + win.innerHeight;
      label.inert = hidden;
      label.setAttribute('aria-hidden', String(hidden));
      label.dataset.offscreen = String(hidden);
      region.label = hidden || label.hidden ? undefined : documentRect(label.getBoundingClientRect());
      const arrow = group!.querySelector<SVGElement>('.arrow');
      if (arrow) arrow.dataset.offscreen = String(hidden);
    }
  }
  let refreshPending = false;
  function schedule() {
    if (disposed || raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      if (wordFinding) return;
      if (refreshPending) {
        refreshPending = false;
        onMeasure?.('rematch-start');
        matchFindings();
        onMeasure?.('rematch-end');
        renderPanel();
        if (revealFinding) {
          schedule();
          return;
        }
      }
      draw();
      reconcilePointer();
      if (pendingReopen) reopenAfterReload();
    });
  }
  function refresh() {
    if (disposed) return;
    marginCache = undefined;
    refreshPending = true;
    schedule();
  }
  function setEnabled(on: boolean) {
    stopWords();
    cancelHover();
    pinned = false;
    enabled = on;
    const url = new URL(win.location.href);
    url.searchParams.set('proof', on ? '1' : '0');
    win.history.replaceState(win.history.state, '', url);
    if (!expanded && !sheet.isOpen()) card.hidden = true;
    renderPanel();
    draw(on);
  }
  const keydown = (event: KeyboardEvent) => {
    const target = event.composedPath()[0];
    const editable =
      target instanceof HTMLElement &&
      (target.isContentEditable ||
        !!target.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"])'));
    const command = proofShortcut(event, {
      editable,
      card: !card.hidden && !closing,
      pill: entryMode === 'pill',
      help: !help.hidden,
      badgeExpanded: pill.dataset.circle === 'false',
    });
    if (!command) return;
    event.preventDefault();
    keyboard = true;
    settleMotion();
    if (command === 'escape') {
      if (view !== 'proof' && !card.hidden) {
        backView();
        return;
      }
      if (!help.hidden) toggleHelp(false);
      else if (!card.hidden) closeCard();
      else pillUI.setCircle(true);
      return;
    }
    if (command === 'overview' || command === 'why' || command === 'settings') {
      if (card.hidden) setPanel(true);
      setView(command);
      return;
    }
    if (command === 'help') {
      toggleHelp();
      return;
    }
    if (command === 'dock') {
      event.stopPropagation();
      dock.moveSlot(event.key);
      placeHelp();
      return;
    }
    if (command === 'undo' && !completion.element.hidden && !empty.hidden) {
      if (!completion.undo.disabled) completion.undo.click();
      return;
    }
    if (
      view !== 'proof' &&
      ['accept', 'dismiss', 'undo', 'next', 'previous', 'previous-version', 'next-version'].includes(command)
    )
      return;
    if (command === 'previous-version' || command === 'next-version') {
      if (!card.hidden && !versionNav.hidden) stepVersion(command === 'next-version' ? 1 : -1);
      return;
    }
    if (command === 'accept' || command === 'dismiss' || command === 'undo') {
      const control = actionControls[command === 'accept' ? 0 : command === 'dismiss' ? 1 : 2]!;
      if (!card.hidden && !control.hidden && !control.disabled) control.click();
      return;
    }
    pointerPosition = undefined;
    if (command === 'toggle-card') {
      if (!card.hidden) closeCard();
      else setPanel(true);
    } else if (command === 'toggle-marks') {
      setEnabled(!enabled);
      announcement.textContent = enabled ? 'Marks shown' : 'Marks hidden';
    } else if (command === 'next-open' || command === 'previous-open') {
      if (card.hidden) setPanel(true);
      cycle(command === 'next-open' ? 1 : -1);
    } else if (command === 'next' || command === 'previous') cycle(command === 'next' ? 1 : -1);
  };
  const hit = (x: number, y: number) =>
    enabled && y >= 76
      ? regions.find(r => r.hit.some(rect => containsPoint(rect, x + win.scrollX, y + win.scrollY)))?.finding
      : undefined;
  function pointerFinding(x: number, y: number) {
    const overPanel = panelBounds && containsPoint(panelBounds, x, y);
    // Over a shared label or its unfolded list, the list is the surface, not the hover card.
    if (!lineMenu.hidden) {
      const r = lineMenu.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top - 4 && y <= r.bottom) return undefined;
    }
    if (
      regions.some(
        r =>
          r.label &&
          containsPoint(r.label, x + win.scrollX, y + win.scrollY) &&
          (lineGroups.get(r.finding.id)?.length ?? 0) > 1,
      )
    )
      return undefined;
    return overPanel
      ? undefined
      : (regions.find(r => r.label && containsPoint(r.label, x + win.scrollX, y + win.scrollY))?.finding ?? hit(x, y));
  }
  function reconcilePointer() {
    if (disposed || closing || expanded || pinned || morphing || !pointerPosition || keyboard || hoverSuppression)
      return;
    if (pointerButtons) {
      pointerPosition = undefined;
      cancelHover();
      card.hidden = true;
      schedule();
      return;
    }
    const { x, y } = pointerPosition;
    const finding = pointerFinding(x, y);
    if (card.contains(shadow.elementFromPoint(x, y))) {
      clearTimeout(hoverClose);
      return;
    }
    if (finding) {
      clearTimeout(hoverClose);
      hoverClose = undefined;
      if (hoverId === finding.id) {
        if (!card.hidden) followCard();
        return;
      }
      clearTimeout(hoverOpen);
      hoverId = finding.id;
      if (!card.hidden || Date.now() - lastOpen < 600) showCard(finding, false, true);
      else hoverOpen = setTimeout(() => showCard(finding, false, true), 150);
    } else {
      clearTimeout(hoverOpen);
      hoverId = undefined;
      if (!card.hidden && !hoverClose)
        hoverClose = setTimeout(
          () => {
            hoverClose = undefined;
            closeCard(true);
          },
          // Long enough to cross the gap between a mark's lines, short enough that moving off lets go at once.
          75,
        );
    }
  }
  function queuePointer() {
    if (!hoverFrame)
      hoverFrame = requestAnimationFrame(() => {
        hoverFrame = 0;
        reconcilePointer();
      });
  }
  const move = (event: PointerEvent) => {
    if (mobile.matches || event.pointerType === 'touch' || !finePointer.matches) return;
    if (hoverSuppressed && !expanded) {
      const r = pill.getBoundingClientRect();
      if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom)
        hoverSuppressed = false;
    }
    pointerButtons = event.buttons;
    keyboard = false;
    pointerPosition = { x: event.clientX, y: event.clientY };
    if (
      hoverSuppression &&
      (Math.hypot(event.clientX - hoverSuppression.x, event.clientY - hoverSuppression.y) >= 8 ||
        hit(event.clientX, event.clientY)?.id !== hoverSuppression.id)
    )
      hoverSuppression = undefined;
    queuePointer();
  };
  const leave = () => {
    clearTimeout(intentTimer);
    hoverSuppression = undefined;
    pointerPosition = undefined;
    cancelHover();
    cancelAnimationFrame(hoverFrame);
    hoverFrame = 0;
    if (following) {
      card.hidden = true;
      schedule();
    }
  };
  const windowLeave = (event: MouseEvent) => {
    if (!event.relatedTarget) leave();
  };
  const preference = () => {
    if (reduced.matches) settleMotion();
    const current = findings.find(f => f.id === focusId);
    if (current && !card.hidden && view === 'proof') updateProofContent(current);
    schedule();
  };
  const pointer = (event: PointerEvent) => {
    keyboard = false;
    pointerButtons = 0;
    pointerPosition = event.pointerType === 'touch' ? undefined : { x: event.clientX, y: event.clientY };
    cancelHover();
    const target = event.composedPath()[0] as Node;
    dismissClick = false;
    if (
      !mobile.matches &&
      pinned &&
      !expanded &&
      !card.contains(target) &&
      !lineTabs.contains(target) &&
      !help.contains(target) &&
      !toast.contains(target) &&
      !panel.contains(target)
    ) {
      // Clicking off a pinned card closes it where it is.
      dismissClick = true;
      closeCard();
      return;
    }
    if (
      mobile.matches &&
      sheet.isOpen() &&
      !sheet.element.contains(target) &&
      !help.contains(target) &&
      !toast.contains(target)
    )
      closeCard();
    if (
      !mobile.matches &&
      !(target instanceof HTMLElement && target.closest('.label')) &&
      !card.contains(target) &&
      !lineTabs.contains(target) &&
      !help.contains(target) &&
      !toast.contains(target) &&
      !panel.contains(target) &&
      !hit(event.clientX, event.clientY)
    ) {
      if (expanded) setPanel(false);
      else if (pinned) closeCard();
    }
    if (event.pointerType === 'touch') touchStart = { x: event.clientX, y: event.clientY };
    else if (!card.contains(target)) queuePointer();
  };
  const click = (event: MouseEvent) => {
    if (dismissClick) {
      dismissClick = false;
      return;
    }
    if (!event.detail || (event as PointerEvent).pointerType === 'touch' || busy || doc.getSelection()?.toString())
      return;
    const target = event.composedPath()[0] as HTMLElement;
    if (
      target.closest?.('a,button,input,textarea,select,summary,[role="button"],[contenteditable="true"]') ||
      panel.contains(target)
    )
      return;
    if (card.contains(target)) {
      const f = findings.find(f => f.id === focusId);
      if (f && following) pinCard(f);
      return;
    }
    const finding = hit(event.clientX, event.clientY);
    // While the pill's card is open it stays the surface: a mark moves it like the arrows do.
    if (finding) {
      if (mobile.matches) {
        showCard(finding, true);
        return;
      }
      if (expanded) {
        selectProof(finding);
        return;
      }
      pinCard(finding);
    }
  };
  const pointerUp = (event: PointerEvent) => {
    if (event.pointerType !== 'touch' || !touchStart) return;
    const start = touchStart;
    touchStart = undefined;
    const target = event.composedPath()[0] as HTMLElement;
    if (
      Math.hypot(event.clientX - start.x, event.clientY - start.y) > 8 ||
      target.closest?.('a,button,input,textarea,select') ||
      doc.getSelection()?.toString()
    )
      return;
    const finding = hit(event.clientX, event.clientY);
    if (finding) showCard(finding, true);
  };
  let lastScrollX = win.scrollX,
    lastScrollY = win.scrollY;
  const scroll = () => {
    if (lastScrollX !== win.scrollX || lastScrollY !== win.scrollY) {
      lastScrollX = win.scrollX;
      lastScrollY = win.scrollY;
      stopWords();
    }
    cullLabels();
    if (pinned && !expanded && entryMode === 'text') {
      const f = findings.find(f => f.id === focusId);
      if (f) anchorCard(f);
    }
    queuePointer();
  };
  const windowResize = () => {
    host.style.setProperty('--layout-width', `${layoutWidth(doc)}px`);
    marginCache = undefined;
    stopWords();
    schedule();
    placeHelp();
  };
  const query = () => setEnabled(new URL(win.location.href).searchParams.get('proof') === '1');
  win.addEventListener('scroll', scroll, true);
  win.addEventListener('resize', windowResize);
  win.addEventListener('keydown', keydown, true);
  win.addEventListener('pointerdown', pointer, true);
  win.addEventListener('popstate', query);
  win.addEventListener('pointermove', move, { passive: true });
  win.addEventListener('pointerup', pointerUp, true);
  win.addEventListener('click', click);
  doc.fonts.addEventListener('loadingdone', schedule);
  reduced.addEventListener('change', preference);
  doc.documentElement.addEventListener('pointerleave', leave);
  win.addEventListener('mouseout', windowLeave);
  const cardResize = new ResizeObserver(entries => {
    const size = entries[0]?.borderBoxSize[0];
    if (size && size.inlineSize && size.blockSize) {
      cardSize = { width: size.inlineSize, height: size.blockSize };
      queuePointer();
    }
  });
  cardResize.observe(card);
  const panelResize = new ResizeObserver(() => {
    panelBounds = expanded ? panel.getBoundingClientRect() : pill.getBoundingClientRect();
    placeToast();
  });
  panelResize.observe(panel);
  const resize = new ResizeObserver(schedule);
  resize.observe(root);
  const observer = new MutationObserver(() => {
    stopWords();
    refresh();
  });
  observer.observe(root, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['class', 'style', 'hidden', 'open', 'aria-hidden'],
  });
  const sheet = mobileSheet({
    avoid,
    doc,
    win,
    host,
    shadow,
    card,
    panel,
    overview: () => setView('overview'),
    mobile,
    reduced,
    close: closeCard,
    rect: id => matches.find(m => m.finding.id === id)?.range?.getBoundingClientRect(),
    isKeyboard: () => keyboard,
  });
  const dock = badgeDock({
    avoid,
    persistent: true,
    storageKey: reviewId ? `proofmarks:badge-slot:${reviewId}` : undefined,
    slot: badgeSlot,
    doc,
    win,
    panel,
    pill,
    mobile,
    reduced,
    expanded: () => expanded,
    keyboard: () => keyboard,
    changed: () => {
      placeLogo();
      syncSurface();
      panelBounds = expanded ? panel.getBoundingClientRect() : pill.getBoundingClientRect();
      placeToast();
    },
  });
  renderPanel();
  dock.refresh();
  closedClip = dock.closedClip();
  restoreUndo();
  const initTimer = win.setTimeout(async () => {
    if (disposed) return;
    let handwritingFont: string;
    try {
      handwritingFont = await loadHandwritingFont();
    } catch {
      if (!disposed) refresh();
      return;
    }
    if (disposed) return;
    font = new FontFace('ProofmarksHand', fontBytes(handwritingFont), { weight: '400 700' });
    doc.fonts.add(font);
    try {
      await doc.fonts.load('500 18px ProofmarksHand');
    } catch {}
    if (disposed) return;
    const current = findings.find(f => f.id === focusId);
    if (current && !card.hidden && view === 'proof') updateProofContent(current);
    win.setTimeout(() => {
      if (!disposed) refresh();
    }, 0);
  }, 0);
  const requestTimer = win.setInterval(() => {
    if (disposed || card.hidden || view !== 'proof') return;
    const current = findings.find(f => f.id === focusId);
    if (
      current &&
      (current.status ?? 'open') === 'open' &&
      ['pending', 'claimed'].includes(current.rewriteRequest?.status ?? '')
    ) {
      updateProofContent(current);
      renderCardActions(current);
    }
  }, 1000);
  return {
    /** Keep this review surface when a host renderer replaces its article root. */
    setRoot(nextRoot: HTMLElement) {
      if (disposed || nextRoot === root) return;
      if (nextRoot.ownerDocument !== doc) throw Error('Proofmarks root must stay in the same document.');
      stopWords();
      observer.disconnect();
      resize.unobserve(root);
      root = nextRoot;
      matches = [];
      proofOrder.reset();
      marginCache = undefined;
      resize.observe(root);
      observer.observe(root, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
        attributeFilter: ['class', 'style', 'hidden', 'open', 'aria-hidden'],
      });
      refresh();
    },
    setAgents(next: ProofmarksAgents | undefined, reason?: string) {
      if (disposed) return;
      agentStatus = next;
      agentReason = reason;
      renderAgents();
      const current = findings.find(f => f.id === focusId);
      if (
        current &&
        view === 'proof' &&
        !card.hidden &&
        cardSlots(current).text === undefined &&
        (current.status ?? 'open') === 'open'
      ) {
        updateProofContent(current);
        renderCardActions(current);
      }
    },
    setCompanionStatus(status: ProofmarksCompanionStatus) {
      if (disposed) return;
      companionStatus = status;
      const label = deep.querySelector<HTMLElement>('[data-companion-status]');
      if (label) label.textContent = companionStatusText(status);
    },
    setReview(review: ProofmarksReview) {
      if (disposed) return;
      cancelHover();
      const previous = findings.find(f => f.id === focusId),
        surface = mobile.matches ? sheet.element : expanded ? panel : card,
        from = surface.getBoundingClientRect().height,
        shown = previous && cardSlots(previous).text;
      ({ findings, rules } = visibleReview(review));
      learned = review.strictness ?? [];
      if (
        previous &&
        review.findings.find(f => f.id === previous.id)?.status === 'superseded' &&
        !card.hidden &&
        view === 'proof'
      )
        selectProof(orderedFindings()[0], false);
      if (!card.hidden) {
        const current = findings.find(f => f.id === focusId);
        if (current && view === 'proof') {
          updateProofContent(current);
          renderCardActions(current);
        }
      }
      updateRewriteAll();
      renderPanel();
      refresh();
      restoreUndo();
      const current = findings.find(f => f.id === focusId);
      // A rewrite arriving into the slot on screen fills it; it never replaces text being read.
      if (
        !card.hidden &&
        view === 'proof' &&
        previous?.id === current?.id &&
        shown === undefined &&
        current &&
        cardSlots(current).text !== undefined &&
        !reduced.matches
      ) {
        cycleAnimation?.cancel();
        fadeAnimations.forEach(a => a.cancel());
        cycleAnimation = reshaping(
          surface,
          surface.animate([{ height: `${from}px` }, { height: `${surface.getBoundingClientRect().height}px` }], {
            duration: 220,
            easing: ease,
          }),
        );
        fadeAnimations = [content.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: ease })];
      }
    },
    unmount() {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(tabsFrame);
      clearTimeout(lineMenuClose);
      win.clearInterval(requestTimer);
      cancelCardClose();
      clearTimeout(intentTimer);
      clearTimeout(graceTimer);
      clearTimeout(decisionSettle);
      completion.destroy();
      tooltips.destroy();
      pillUI.destroy();
      dock.destroy();
      sheet.destroy();
      clearTimeout(undoTimer);
      doc.removeEventListener('visibilitychange', undoVisibility);
      settleMotion();
      cancelHover();
      cancelAnimationFrame(hoverFrame);
      cancelAnimationFrame(raf);
      observer.disconnect();
      resize.disconnect();
      cardResize.disconnect();
      panelResize.disconnect();
      clearMarks();
      win.clearTimeout(initTimer);
      if (font) doc.fonts.delete(font);
      host.remove();
      restoreFlag();
      win.removeEventListener('scroll', scroll, true);
      win.removeEventListener('resize', windowResize);
      win.removeEventListener('keydown', keydown, true);
      win.removeEventListener('pointerdown', pointer, true);
      win.removeEventListener('popstate', query);
      win.removeEventListener('pointermove', move);
      win.removeEventListener('pointerup', pointerUp, true);
      win.removeEventListener('click', click);
      doc.fonts.removeEventListener('loadingdone', schedule);
      reduced.removeEventListener('change', preference);
      doc.documentElement.removeEventListener('pointerleave', leave);
      win.removeEventListener('mouseout', windowLeave);
    },
  };
}
