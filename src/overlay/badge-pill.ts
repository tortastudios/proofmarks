/** Fixed hand-drawn pilcrow (¶, U+00B6): open left bowl, paired right stems. */
export function proofmarkIcon(doc: Document) {
  const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  // Baked curves retain the brush-like lean without per-render roughness or jitter.
  const strokes = [
    ['M18.9 4.6C15.5 3.2 9 3.7 6.1 6.5C3.8 8.6 3.6 11.6 5.7 13.1C8 14.7 12.4 14.2 16.6 12.5', '2.05'],
    ['M15.6 4.2C15.2 8.9 14.5 15.2 14 20.2', '2.1'],
    ['M18.9 4.6C18.5 9.1 18 14.8 17.5 19.6', '1.95'],
  ] as const;
  for (const [d, width] of strokes) {
    const stroke = doc.createElementNS(svg.namespaceURI, 'path');
    stroke.setAttribute('d', d);
    stroke.setAttribute('fill', 'none');
    stroke.setAttribute('stroke', 'currentColor');
    stroke.setAttribute('stroke-width', width);
    stroke.setAttribute('stroke-linecap', 'round');
    stroke.setAttribute('stroke-linejoin', 'round');
    svg.append(stroke);
  }
  return svg;
}
export function reviewPill(o: {
  doc: Document;
  win: Window;
  reduced: MediaQueryList;
  keyboard: () => boolean;
  open: () => void;
  touch: () => boolean;
  geometry: () => void;
}) {
  const { doc, win } = o,
    ease = 'cubic-bezier(.22,1,.36,1)';
  let promptText: string | undefined,
    promptLabel = '';
  let circle = true,
    enabled = true,
    completed = false;
  let completionAnimations: Animation[] = [];
  let expanded = false,
    disposed = false,
    previous: number | undefined,
    lastChange = -Infinity,
    width = 0;
  let revealAnimations: Animation[] = [],
    widthAnimation: Animation | undefined,
    dotAnimation: Animation | undefined,
    countAnimations: Animation[] = [];
  const element = doc.createElement('div');
  element.className = 'pill';
  element.setAttribute('role', 'group');
  element.setAttribute('aria-label', 'Proofmarks');
  element.setAttribute('aria-expanded', 'false');
  const surface = doc.createElement('span');
  surface.className = 'pill-surface';
  surface.setAttribute('aria-hidden', 'true');
  const inner = doc.createElement('div');
  inner.className = 'pill-content';
  const make = (label: string, action: () => void) => {
    const b = doc.createElement('button');
    b.type = 'button';
    b.setAttribute('aria-label', label);
    b.addEventListener('click', action);
    return b;
  };
  const mark = make('Expand Proofmarks badge', o.open);
  mark.className = 'pill-mark';
  mark.append(proofmarkIcon(doc));
  const countButton = make('Open writing review', o.open);
  countButton.className = 'pill-count';
  const badge = doc.createElement('span');
  badge.className = 'badge';
  badge.setAttribute('aria-hidden', 'true');
  countButton.append(badge);
  const dot = doc.createElement('span');
  dot.className = 'notification-dot';
  dot.setAttribute('aria-hidden', 'true');
  dot.hidden = true;
  const completionCheck = doc.createElement('span');
  completionCheck.className = 'completion-badge-check';
  completionCheck.hidden = true;
  completionCheck.setAttribute('aria-hidden', 'true');
  completionCheck.innerHTML =
    '<svg viewBox="0 0 16 16"><path d="M4.5 8 7 10.5 11.5 5.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const clip = doc.createElement('div');
  clip.className = 'pill-clip';
  inner.append(mark, countButton);
  clip.append(surface, inner);
  element.append(clip, dot, completionCheck);
  function instant() {
    return o.reduced.matches;
  }
  function showDot(animate: boolean) {
    dotAnimation?.cancel();
    dotAnimation = undefined;
    completionCheck.hidden = !(enabled && completed);
    const show = !completed && enabled && circle && !expanded && (previous ?? 0) > 0;
    dot.hidden = !show;
    if (show && animate && !instant())
      dotAnimation = dot.animate([{ transform: 'scale(0)' }, { transform: 'scale(1)' }], {
        duration: 140,
        delay: 0,
        easing: ease,
        fill: 'backwards',
      });
  }
  function resize(animate: boolean) {
    if (disposed) return;
    const next = circle || expanded ? 44 : Math.ceil(inner.getBoundingClientRect().width);
    if (!next || next === width) return;
    const measured = width > 0,
      from = element.getBoundingClientRect().width || next;
    widthAnimation?.cancel();
    widthAnimation = undefined;
    width = next;
    element.style.width = `${next}px`;
    if (measured && animate && !instant() && from !== next)
      widthAnimation = element.animate([{ width: `${from}px` }, { width: `${next}px` }], {
        duration: circle ? 150 : 220,
        easing: ease,
      });
    o.geometry();
  }
  function state() {
    const compact = circle || expanded;
    element.dataset.circle = String(compact);
    element.dataset.panel = String(expanded);
    element.dataset.muted = String(!enabled);
    countButton.inert = compact;
    mark.inert = false;
    mark.setAttribute(
      'aria-label',
      expanded
        ? 'Proofmarks, close writing review'
        : o.touch()
          ? 'Proofmarks, open writing review'
          : compact
            ? promptText
              ? `Proofmarks, ${promptLabel.charAt(0).toLowerCase()}${promptLabel.slice(1)}`
              : `Proofmarks, open review, ${previous ? `${previous} ${previous === 1 ? 'proof' : 'proofs'}` : 'all reviewed'}`
            : 'Open writing review',
    );
    element.setAttribute('aria-expanded', String(expanded));
  }
  function setCircle(next: boolean) {
    if (expanded || circle === next) return;
    const from = win.getComputedStyle(countButton).opacity;
    revealAnimations.forEach(a => a.cancel());
    revealAnimations = [];
    circle = next;
    state();
    resize(true);
    showDot(true);
    if (!instant())
      revealAnimations = [
        countButton.animate([{ opacity: from }, { opacity: next ? 0 : 1 }], {
          duration: next ? 150 : 220,
          easing: ease,
        }),
      ];
  }
  function settle() {
    completionAnimations.forEach(a => a.cancel());
    completionAnimations = [];
    revealAnimations.forEach(a => a.cancel());
    widthAnimation?.cancel();
    dotAnimation?.cancel();
    countAnimations.forEach(a => a.cancel());
    countAnimations = [];
    badge.querySelector('.outgoing')?.remove();
    resize(false);
    showDot(false);
    o.geometry();
  }
  const observer = new ResizeObserver(() => resize(true));
  observer.observe(inner);
  state();
  element.style.width = circle ? '44px' : '150px';
  return {
    element,
    mark,
    countButton,
    setCircle,
    prompt(text?: string, label?: string) {
      if (promptText === text) return;
      promptText = text;
      promptLabel = label ?? text ?? '';
      state();
      element.dataset.prompt = String(!!text);
      countButton.style.minWidth = '';
      previous = undefined;
      if (text) {
        badge.textContent = text;
        countButton.setAttribute('aria-label', label ?? text);
        if (o.touch()) setCircle(false);
        dot.hidden = true;
        resize(false);
      }
    },
    isMorphing: () => widthAnimation?.playState === 'running',
    setCompleted(value: boolean, animate = false) {
      if (completed === value && !animate) return;
      completionAnimations.forEach(a => a.cancel());
      completionAnimations = [];
      completed = value;
      showDot(false);
      if (value && animate && !o.reduced.matches) {
        dot.hidden = false;
        completionAnimations = [
          dot.animate(
            [
              { opacity: 1, transform: 'scale(1)' },
              { opacity: 0, transform: 'scale(.65)' },
            ],
            { duration: 180 },
          ),
          completionCheck.animate(
            [
              { opacity: 0, transform: 'scale(.65)' },
              { opacity: 1, transform: 'scale(1)' },
            ],
            { duration: 180, easing: ease },
          ),
        ];
        completionAnimations[0]!.onfinish = () => {
          dot.hidden = true;
        };
      }
    },
    setEnabled(value: boolean) {
      enabled = value;
      state();
      showDot(false);
    },
    update(count: number, description: string) {
      if (promptText) return;
      const now = win.performance.now();
      countButton.setAttribute('aria-label', `Open writing review: ${description}`);
      if (previous === count) return;
      countAnimations.forEach(a => a.cancel());
      countAnimations = [];
      badge.replaceChildren();
      const number = doc.createElement('span');
      number.className = 'count';
      number.textContent = count ? String(count) : '';
      const label = doc.createElement('span');
      label.textContent = count ? (count === 1 ? 'proof' : 'proofs') : 'All reviewed';
      badge.append(number, label);
      number.hidden = count === 0;
      if (previous !== undefined && !instant() && now - lastChange > 220) {
        const old = doc.createElement('span');
        old.className = 'outgoing';
        old.textContent = previous ? String(previous) : '';
        badge.append(old);
        countAnimations.push(
          number.animate(
            [
              { transform: 'translateY(8px)', filter: 'blur(2px)', opacity: 0 },
              { transform: 'translateY(0)', filter: 'blur(0px)', opacity: 1 },
            ],
            { duration: 220, easing: ease },
          ),
        );
        if (count === 0)
          countAnimations.push(label.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 150, easing: ease }));
        const exit = old.animate(
          [
            { transform: 'translateY(0)', filter: 'blur(0px)', opacity: 1 },
            { transform: 'translateY(-12px)', filter: 'blur(2px)', opacity: 0 },
          ],
          { duration: 150, easing: ease },
        );
        exit.onfinish = () => old.remove();
        countAnimations.push(exit);
      }
      const wasEmpty = previous !== undefined && !previous;
      previous = count;
      lastChange = now;
      state();
      showDot(wasEmpty && count > 0);
      resize(true);
    },
    setExpanded(value: boolean) {
      expanded = value;
      circle = true;
      revealAnimations.forEach(a => a.cancel());
      revealAnimations = [];
      widthAnimation?.cancel();
      widthAnimation = undefined;
      state();
      resize(false);
      showDot(false);
    },
    focus() {
      mark.focus({ preventScroll: true });
    },
    settle,
    destroy() {
      completionAnimations.forEach(a => a.cancel());
      disposed = true;
      observer.disconnect();
      revealAnimations.forEach(a => a.cancel());
      widthAnimation?.cancel();
      dotAnimation?.cancel();
      countAnimations.forEach(a => a.cancel());
    },
  };
}
