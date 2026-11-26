// proofmarks.dev's opening example: a scripted run of Proofmarks on a sample post. It isn't the overlay; nothing here
// reads the page or calls anything, though it borrows the overlay's icon, handwriting and working line so it looks the
// same. It plays two passes, top to bottom each time: first from the marks' labels, then from the Proofmarks badge.
// In each, an agent rewrites the top line and Accept puts it in the post, then Accept deletes the bottom line's opener.
// It pauses off screen, and with reduced motion it shows one still frame.
import { fontBytes } from '../src/overlay/font-bytes';
import { handwritingFont } from '../src/overlay/font-data';
import { proofmarkIcon } from '../src/overlay/badge-pill';
import { workingLine, workingStyles } from '../src/overlay/working';
import { agentColors } from '../src/overlay/agents';

const SVG = 'http://www.w3.org/2000/svg';
const EASE = 'cubic-bezier(.32,.72,0,1)';
const MOVE = 'cubic-bezier(.65,0,.35,1)';
const REWRITE = 'I realized each rejection was data.';
// The registry's colors for these two rules, and the overlay's color for an accepted mark.
const SIGNPOST = '#75642f';
const CONTRAST = '#994b52';
const ACCEPTED = '#38766b';
const light = (color: string) => `oklch(from ${color} .8 calc(c * .7) h)`;
const curl = (text: string) => text.replace(/'/g, '’');

type Point = { x: number; y: number };
type Kind = 'strike' | 'underline';
type Mark = {
  name: string;
  span: HTMLElement;
  label: HTMLElement;
  ink: SVGPathElement[];
  original: string;
  color: string;
  kind: Kind;
  rule: string;
  why: string;
};

export function startHero(frame: HTMLElement, options: { clip?: boolean } = {}) {
  const stage = frame.querySelector<HTMLElement>('.hero-stage')!;
  const post = stage.querySelector<HTMLElement>('.hero-post')!;
  const doc = frame.ownerDocument;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  doc.fonts.add(new FontFace('ProofmarksHand', fontBytes(handwritingFont), { weight: '400 700' }));
  const styles = doc.createElement('style');
  styles.textContent = workingStyles;
  doc.head.append(styles);

  // The stage keeps one size, so the post wraps the same everywhere; a narrower frame shrinks it as a whole.
  const fit = () => {
    const s = Math.min(1, frame.clientWidth / stage.offsetWidth);
    stage.style.transform = s < 1 ? `scale(${s})` : '';
    stage.style.marginRight = `${-stage.offsetWidth * (1 - s)}px`;
    stage.style.marginBottom = `${-stage.offsetHeight * (1 - s)}px`;
  };
  new ResizeObserver(fit).observe(frame);
  fit();

  const layer = (tag: string, className: string) => {
    const el = doc.createElement(tag);
    el.className = className;
    el.setAttribute('aria-hidden', 'true');
    stage.append(el);
    return el;
  };
  const ink = doc.createElementNS(SVG, 'svg');
  ink.classList.add('hero-ink');
  ink.setAttribute('aria-hidden', 'true');
  stage.append(ink);
  const card = layer('div', 'hero-card');
  const badge = layer('div', 'hero-badge');
  const count = Object.assign(doc.createElement('span'), { className: 'hero-count', textContent: '2 proofs' });
  badge.append(proofmarkIcon(doc), count, Object.assign(doc.createElement('span'), { className: 'hero-dot' }));
  const cursor = layer('div', 'hero-cursor');
  cursor.innerHTML =
    '<svg viewBox="0 0 20 22"><path d="M3 2.5v15.2l3.9-3.7 2.6 6 2.6-1.1-2.6-5.9h5.4z" fill="#1c1a17" stroke="#fff" stroke-width="1.4" stroke-linejoin="round"/></svg>';

  // Positions inside the stage, in its own pixels.
  const scale = () => stage.getBoundingClientRect().width / stage.offsetWidth || 1;
  const local = (rect: DOMRect) => {
    const origin = stage.getBoundingClientRect(),
      s = scale();
    return {
      left: (rect.left - origin.left) / s,
      top: (rect.top - origin.top) / s,
      right: (rect.right - origin.left) / s,
      bottom: (rect.bottom - origin.top) / s,
    };
  };
  const center = (el: Element): Point => {
    const r = local(el.getBoundingClientRect());
    return { x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 };
  };

  const mark = (name: string, color: string, kind: Kind, rule: string, why: string): Mark => {
    const span = post.querySelector<HTMLElement>(`[data-mark="${name}"]`)!;
    return {
      name,
      span,
      label: layer('div', 'hero-label'),
      ink: [],
      original: span.textContent ?? '',
      color,
      kind,
      rule,
      why,
    };
  };
  const contrast = mark('contrast', CONTRAST, 'underline', 'Not X, but Y', 'Sets up a claim just to knock it down.');
  const signpost = mark('signpost', SIGNPOST, 'strike', 'Signposting', 'Announces a point instead of making it.');
  const marks = [contrast, signpost];

  // Strokes start undrawn, so a mark appears only when it's drawn.
  const path = (d: string, color: string) => {
    const p = doc.createElementNS(SVG, 'path');
    p.setAttribute('d', d);
    p.style.stroke = color;
    ink.append(p);
    const length = p.getTotalLength();
    p.style.strokeDasharray = `${length}`;
    p.style.strokeDashoffset = `${length}`;
    return p;
  };
  // A hand-drawn mark: a strike or underline on each line of the text, then a leader arcing out to the margin label.
  function layout(m: Mark, text = m.rule, color = m.color) {
    for (const p of m.ink) p.remove();
    const lines = [...m.span.getClientRects()].map(local);
    const last = lines.at(-1)!;
    m.label.textContent = text;
    m.label.style.color = color;
    m.label.style.clipPath = 'inset(0 100% 0 0)';
    const labelTop = lines[0]!.top - 4;
    m.label.style.transform = `translate(${stage.offsetWidth - 150}px, ${labelTop}px)`;
    m.ink = lines.map(line => {
      const y = m.kind === 'strike' ? line.top + (line.bottom - line.top) * 0.56 : line.bottom + 1;
      const w = line.right - line.left;
      return path(
        `M${line.left - 1} ${y + 0.6} C${line.left + w * 0.3} ${y - 0.7}, ${line.left + w * 0.7} ${y + 0.9}, ${line.right + 1} ${y - 0.2}`,
        color,
      );
    });
    const from = { x: stage.offsetWidth - 156, y: labelTop + 14 },
      to = m.kind === 'strike' ? { x: last.right + 3, y: last.top + 6 } : { x: last.right + 4, y: last.bottom - 6 };
    const lift = Math.min(from.y, to.y) - 16;
    m.ink.push(path(`M${from.x} ${from.y} C${from.x - 30} ${lift}, ${to.x + 60} ${lift}, ${to.x} ${to.y}`, color));
    if (m.kind === 'underline')
      m.ink.push(path(`M${to.x + 7} ${to.y - 4} L${to.x} ${to.y} L${to.x + 7} ${to.y + 3}`, color));
  }
  const draw = (p: SVGPathElement, ms: number, delay = 0) =>
    p.animate([{ strokeDashoffset: p.getTotalLength() }, { strokeDashoffset: 0 }], {
      duration: ms,
      delay,
      easing: 'cubic-bezier(.4,0,.2,1)',
      fill: 'both',
    }).finished;
  async function showMark(m: Mark) {
    const strokes = m.ink.map((p, i) => draw(p, i < m.ink.length - 2 ? 320 : 420, i * 120));
    const label = m.label.animate([{ clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0 0 0)' }], {
      duration: 520,
      delay: 260,
      easing: 'linear',
      fill: 'both',
    });
    await Promise.all([...strokes, label.finished]);
  }
  // Shown at once, without drawing: the reduced-motion frame, and a mark redrawn as accepted.
  const settle = (m: Mark) => {
    for (const p of m.ink) p.style.strokeDashoffset = '0';
    m.label.style.clipPath = 'none';
  };
  const fade = (els: Element[], ms = 220) =>
    Promise.all(
      els.map(el => el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: ms, fill: 'forwards' }).finished),
    );
  const activate = (m?: Mark) => {
    for (const other of marks) other.label.classList.toggle('hero-label-active', other === m);
  };

  // The card, built like the overlay's: rule, why, the struck original, then the request for a rewrite, the rewrite
  // and its decision, or the decision alone for a deletion. Docked at the badge, it also steps between proofs.
  let docked = false;
  function fillCard(m: Mark, place: number) {
    card.innerHTML = '';
    card.style.setProperty('--mark', light(m.color));
    const el = (tag: string, className: string, text = '') => {
      const node = doc.createElement(tag);
      node.className = className;
      node.textContent = text;
      card.append(node);
      return node;
    };
    el('div', 'hero-card-rule', m.rule);
    el('p', 'hero-card-why', m.why);
    el('p', 'hero-card-original', curl(m.original));
    const slot = el('div', 'hero-card-slot');
    if (m.kind === 'underline') {
      const ask = doc.createElement('span');
      ask.className = 'hero-button hero-button-filled';
      ask.textContent = 'Ask your agent for a rewrite';
      slot.append(ask);
    } else decision(slot);
    if (docked) {
      const nav = el('div', 'hero-card-nav');
      nav.innerHTML = `<span>‹</span><span>${place} of 2</span><span class="hero-next">›</span>`;
    }
    return slot;
  }
  function decision(slot: HTMLElement) {
    const row = doc.createElement('div');
    row.className = 'hero-card-actions';
    row.innerHTML =
      '<span class="hero-button hero-button-filled">Accept</span><span class="hero-button">Dismiss</span>';
    slot.append(row);
  }
  // Accepted, the card keeps the proof and offers Undo as a button, as the overlay's does.
  function accepted(slot: HTMLElement) {
    slot.querySelector('.hero-card-actions')!.innerHTML =
      '<span class="hero-accepted">Accepted</span><span class="hero-button hero-button-tonal">Undo</span>';
  }
  // Below the label, or above it when there's no room, held by its bottom edge so it grows away from the label.
  function placeCard(m: Mark) {
    card.classList.remove('hero-card-docked');
    const label = local(m.label.getBoundingClientRect());
    const below = label.bottom + 8;
    card.style.left = `${stage.offsetWidth - card.offsetWidth - 14}px`;
    card.style.right = 'auto';
    if (below + card.offsetHeight + 40 <= stage.offsetHeight - 12) {
      card.style.top = `${below}px`;
      card.style.bottom = 'auto';
    } else {
      card.style.top = 'auto';
      card.style.bottom = `${stage.offsetHeight - label.top + 8}px`;
    }
  }
  function dockCard() {
    card.classList.add('hero-card-docked');
    for (const side of ['left', 'top', 'right', 'bottom'] as const) card.style[side] = '';
  }
  // A change of content resizes the card smoothly instead of jumping.
  function reshape(change: () => void) {
    const from = card.offsetHeight;
    change();
    const to = card.offsetHeight;
    if (from !== to) card.animate([{ height: `${from}px` }, { height: `${to}px` }], { duration: 240, easing: EASE });
  }
  const showCard = () =>
    card.animate(
      [
        { opacity: 0, scale: '0.97', translate: '0 4px' },
        { opacity: 1, scale: '1', translate: '0 0' },
      ],
      { duration: 160, easing: EASE, fill: 'forwards' },
    ).finished;
  const hideCard = () =>
    card.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 120, easing: 'ease-out', fill: 'forwards' }).finished;

  let at: Point = { x: 0, y: 0 };
  async function moveTo(to: Point, ms: number) {
    await cursor.animate(
      [{ transform: `translate(${at.x}px, ${at.y}px)` }, { transform: `translate(${to.x}px, ${to.y}px)` }],
      { duration: ms, easing: MOVE, fill: 'forwards' },
    ).finished;
    at = to;
  }
  const click = () =>
    cursor.firstElementChild!.animate([{ scale: '1' }, { scale: '0.82' }, { scale: '1' }], {
      duration: 180,
      easing: 'ease-out',
    }).finished;
  const offstage = () => moveTo({ x: stage.offsetWidth + 20, y: at.y + 40 }, 450);

  let paused = false;
  const sleep = (ms: number) =>
    new Promise<void>(resolve => {
      let left = ms,
        last = performance.now();
      const tick = (now: number) => {
        if (!paused) left -= now - last;
        last = now;
        if (left <= 0) resolve();
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });

  const pristine = post.innerHTML;
  function reset() {
    for (const animation of stage.getAnimations({ subtree: true })) animation.cancel();
    ink.replaceChildren();
    post.innerHTML = pristine;
    signpost.kind = 'strike';
    for (const m of marks) {
      m.ink = [];
      m.span = post.querySelector<HTMLElement>(`[data-mark="${m.name}"]`)!;
      m.label.textContent = '';
      m.label.style.opacity = '';
    }
    activate();
    ink.setAttribute('viewBox', `0 0 ${stage.offsetWidth} ${stage.offsetHeight}`);
    card.style.opacity = '0';
    docked = false;
    badge.dataset.state = 'on';
    at = { x: stage.offsetWidth + 20, y: stage.offsetHeight - 70 };
    cursor.style.transform = `translate(${at.x}px, ${at.y}px)`;
  }
  async function begin() {
    reset();
    post.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300 });
    await sleep(500);
    for (const m of marks) layout(m);
    await showMark(contrast);
    await showMark(signpost);
    await sleep(500);
  }
  function still() {
    reset();
    for (const m of marks) {
      layout(m);
      settle(m);
    }
    activate(contrast);
    const slot = fillCard(contrast, 1);
    slot.replaceChildren(
      Object.assign(doc.createElement('p'), { className: 'hero-card-rewrite', textContent: REWRITE }),
    );
    decision(slot);
    placeCard(contrast);
    card.style.opacity = '1';
    cursor.style.opacity = '0';
  }

  // The top line: ask the agent, watch it write, accept the rewrite. The rewrite only shows once the decision model has
  // cleared it.
  async function rewriteTop(slot: HTMLElement) {
    await sleep(200);
    await moveTo(center(slot.firstElementChild!), 320);
    await click();
    const status = doc.createElement('p');
    status.className = 'hero-card-status';
    // In the agent's color, as the overlay writes it.
    status.style.setProperty('--agent', agentColors['claude-code']!);
    const write = workingLine(status);
    reshape(() => {
      slot.replaceChildren(status);
      write('Sent to Claude Code', 'sent');
    });
    await sleep(1500);
    write('Claude Code is writing', 'writing');
    await sleep(2200);
    reshape(() => {
      write('', undefined);
      slot.replaceChildren(
        Object.assign(doc.createElement('p'), { className: 'hero-card-rewrite', textContent: REWRITE }),
      );
      decision(slot);
    });
    slot.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: 'ease-out' });
    // A beat to read the rewrite before Accept.
    await sleep(520);
    await moveTo(center(slot.querySelector('.hero-button-filled')!), 320);
    await click();
    accepted(slot);
    await acceptRewrite();
  }
  // Accepted, a mark stays on its new text, marked Accepted, as the overlay draws it.
  async function remark(m: Mark) {
    for (const animation of m.label.getAnimations()) animation.cancel();
    layout(m, 'Accepted', ACCEPTED);
    settle(m);
    for (const p of m.ink) p.style.opacity = '0.45';
    // From transparent to where each one rests: a lone keyframe would be the end, fading the mark out and back.
    await Promise.all(
      [m.label, ...m.ink].map(
        el => el.animate([{ opacity: 0, offset: 0 }], { duration: 260, easing: 'ease-out' }).finished,
      ),
    );
  }
  async function acceptRewrite() {
    await Promise.all([fade([contrast.label, ...contrast.ink], 160), swap(contrast.span, REWRITE)]);
    await remark(contrast);
  }
  // The bottom line loses its opener, and the next word, now capitalized, carries the Accepted mark.
  async function acceptDeletion() {
    await Promise.all([fade([signpost.label, ...signpost.ink]), collapse(signpost)]);
    const next = signpost.span.nextSibling!,
      word = doc.createElement('span');
    word.textContent = /^\S+/.exec(next.textContent!)![0];
    next.textContent = next.textContent!.slice(word.textContent.length);
    next.before(word);
    signpost.span = word;
    signpost.kind = 'underline';
    await remark(signpost);
  }
  // The bottom line: a signpost's fix is deleting it, so Accept is the whole decision.
  async function acceptBottom(slot: HTMLElement) {
    await sleep(240);
    await moveTo(center(slot.querySelector('.hero-button-filled')!), 290);
    await click();
    accepted(slot);
    await acceptDeletion();
  }

  // Pass one: from the marks' labels.
  async function fromLabels() {
    await begin();
    await moveTo(center(contrast.label), 420);
    activate(contrast);
    let slot = fillCard(contrast, 1);
    placeCard(contrast);
    await showCard();
    await rewriteTop(slot);
    await sleep(280);
    activate();
    await Promise.all([hideCard(), moveTo(center(signpost.label), 420)]);
    activate(signpost);
    slot = fillCard(signpost, 2);
    placeCard(signpost);
    await showCard();
    await acceptBottom(slot);
    await sleep(280);
    activate();
    await Promise.all([hideCard(), offstage()]);
    badge.dataset.state = 'done';
    await sleep(1600);
  }
  // Pass two: from the badge. Hovering shows the count; a click opens the proofs there, and › steps to the next.
  async function fromBadge() {
    await begin();
    await moveTo(center(badge), 450);
    badge.dataset.state = 'hover';
    await sleep(240);
    await click();
    badge.dataset.state = 'open';
    docked = true;
    activate(contrast);
    let slot = fillCard(contrast, 1);
    dockCard();
    await showCard();
    await rewriteTop(slot);
    await sleep(240);
    await moveTo(center(card.querySelector('.hero-next')!), 320);
    await click();
    activate(signpost);
    reshape(() => (slot = fillCard(signpost, 2)));
    await acceptBottom(slot);
    await sleep(280);
    await moveTo(center(badge), 320);
    await click();
    activate();
    await hideCard();
    badge.dataset.state = 'done';
    await offstage();
    await sleep(1400);
  }
  // A few seconds for a video or GIF: the marks draw, then both are accepted and the post updates, and it starts over.
  async function clip() {
    cursor.style.opacity = '0';
    for (;;) {
      reset();
      post.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 250 });
      await sleep(350);
      for (const m of marks) layout(m);
      await Promise.all([showMark(contrast), sleep(200).then(() => showMark(signpost))]);
      await sleep(450);
      badge.dataset.state = 'done';
      await Promise.all([acceptRewrite(), sleep(120).then(acceptDeletion)]);
      await sleep(1300);
      await post.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 250, fill: 'forwards' }).finished;
    }
  }
  async function play() {
    for (;;) {
      await fromLabels();
      await post.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 300, fill: 'forwards' }).finished;
      await fromBadge();
      await post.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 300, fill: 'forwards' }).finished;
    }
  }
  // Accepting swaps the sentence in place, as the page would show it once the source changes.
  async function swap(span: HTMLElement, text: string) {
    await span.animate(
      [
        { opacity: 1, filter: 'blur(0)' },
        { opacity: 0, filter: 'blur(3px)' },
      ],
      {
        duration: 160,
        fill: 'forwards',
      },
    ).finished;
    span.textContent = text;
    await span.animate(
      [
        { opacity: 0, filter: 'blur(3px)' },
        { opacity: 1, filter: 'blur(0)' },
      ],
      {
        duration: 240,
        easing: 'ease-out',
        fill: 'forwards',
      },
    ).finished;
  }
  // Deleting an opener takes the punctuation and space after it, and the next word starts the sentence, as Accept
  // tidies it on a real page.
  async function collapse({ span }: Mark) {
    const next = span.nextSibling;
    const lead = /^[,:;]?\s/.exec(next?.textContent ?? '');
    if (next && lead) {
      next.textContent = next.textContent!.slice(lead[0].length);
      span.textContent += lead[0];
    }
    const width = span.getBoundingClientRect().width / scale();
    span.style.display = 'inline-block';
    span.style.whiteSpace = 'pre';
    span.style.overflow = 'hidden';
    span.style.verticalAlign = 'bottom';
    await span.animate(
      [
        { width: `${width + 4}px`, opacity: 1 },
        { width: '0px', opacity: 0 },
      ],
      { duration: 320, easing: EASE, fill: 'forwards' },
    ).finished;
    if (next) next.textContent = next.textContent!.replace(/^\p{Ll}/u, letter => letter.toUpperCase());
  }

  const pause = (on: boolean) => {
    paused = on;
    for (const animation of stage.getAnimations({ subtree: true }))
      if (on) animation.pause();
      else animation.play();
  };
  let visible = false;
  new IntersectionObserver(([entry]) => {
    visible = !!entry?.isIntersecting;
    pause(!visible || doc.hidden);
  }).observe(frame);
  doc.addEventListener('visibilitychange', () => pause(!visible || doc.hidden));

  void doc.fonts.load('500 20px ProofmarksHand').then(() => {
    if (reduced.matches) still();
    else void (options.clip ? clip() : play());
  });
}
