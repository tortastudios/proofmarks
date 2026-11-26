import { css } from './css';
export type WorkingPhase = 'sent' | 'writing';
/** Update only on a state change: polling must not restart motion or repeat announcements. */
export function workingLine(element: HTMLElement) {
  let previous = '';
  let exit: Animation | undefined;
  element.setAttribute('aria-atomic', 'true');
  return (message: string, phase: WorkingPhase | undefined) => {
    const doc = element.ownerDocument,
      win = doc.defaultView!;
    const handwriting =
      !!phase && [...doc.fonts].some(face => face.family === 'ProofmarksHand' && face.status === 'loaded');
    const reduced = win.matchMedia('(prefers-reduced-motion:reduce)').matches;
    const key = JSON.stringify([message, phase, handwriting, handwriting && reduced]);
    if (key === previous) return;
    previous = key;
    const old =
      element.hasAttribute('data-working') && phase && message && !reduced
        ? element.querySelector<HTMLElement>('.working-line')
        : null;
    exit?.cancel();
    if (element.hasAttribute('data-working'))
      element.getAnimations({ subtree: true }).forEach(animation => {
        const target = (animation.effect as KeyframeEffect).target;
        if (old && target instanceof Node && old.contains(target)) animation.pause();
        else animation.cancel();
      });
    element.hidden = !message;
    const announcement = element.querySelector<HTMLElement>('.d-sr') ?? doc.createElement('span');
    for (const child of [...element.children]) if (child !== announcement) child.remove();
    delete element.dataset.working;
    delete element.dataset.workingPhase;
    if (!phase || !message) {
      element.textContent = message;
      return;
    }
    if (handwriting) element.dataset.working = '';
    element.dataset.workingPhase = phase;
    announcement.className = 'd-sr';
    if (announcement.textContent !== message) announcement.textContent = message;
    const line = doc.createElement('span');
    line.className = 'working-line';
    line.setAttribute('aria-hidden', 'true');
    line.textContent = message;
    if (!announcement.isConnected) element.replaceChildren(announcement);
    element.append(line);
    if (!handwriting) return;
    if (old) {
      old.className = 'working-line working-outgoing';
      element.append(old);
      exit = old.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 150, fill: 'forwards' });
      exit.onfinish = () => {
        old.getAnimations({ subtree: true }).forEach(animation => animation.cancel());
        old.remove();
      };
    }
    handwrite(line, message, phase, reduced, old ? 150 : 0);
  };
}

/** Stable uneven pacing, capped including the last glyph's 80ms reveal. */
export function handwritingTimes(length: number, delay = 0) {
  let time = 0;
  const times = Array.from({ length }, (_, i) => {
    const start = time;
    time += 30 + [0, 11, 5, 15][i % 4]!;
    return start;
  });
  return times.map(time => time * Math.min(1, (1120 - delay) / Math.max(1, times.at(-1) ?? 0)));
}
function handwrite(line: HTMLElement, message: string, phase: WorkingPhase, reduced: boolean, delay: number) {
  const doc = line.ownerDocument;
  line.textContent = '';
  // Resolve CSS colours through the browser; canvas returns sRGB for the contrast check.
  const canvas = doc.createElement('canvas').getContext('2d')!;
  const luminance = (colour: string) => {
    canvas.fillStyle = colour;
    canvas.fillRect(0, 0, 1, 1);
    return [...canvas.getImageData(0, 0, 1, 1).data].slice(0, 3).reduce((sum, value, i) => {
      const c = value / 255;
      return sum + (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4) * [0.2126, 0.7152, 0.0722][i]!;
    }, 0);
  };
  // The agent's color when it has one, otherwise the rule's ink.
  const style = doc.defaultView!.getComputedStyle(line),
    ink = style.getPropertyValue('--agent').trim() || style.getPropertyValue('--mark');
  const a = luminance(ink),
    b = luminance(style.getPropertyValue('--ink'));
  line.style.color = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) >= 4.5 ? ink : 'var(--paper)';
  const times = handwritingTimes(message.length, delay),
    duration = (times.at(-1) ?? 0) + 80;
  const glyphs = [...message].map((text, i) => {
    const glyph = doc.createElement('span');
    glyph.className = 'hand-glyph';
    glyph.textContent = text;
    line.append(glyph);
    if (!reduced)
      glyph.animate(
        [
          { opacity: 0, transform: 'translateY(1px)' },
          { opacity: 1, transform: 'none' },
        ],
        { duration: 80, delay: delay + times[i]!, fill: 'backwards', easing: 'cubic-bezier(.22,1,.36,1)' },
      );
    return glyph;
  });
  if (reduced) return;
  const strength = phase === 'sent' ? 0.5 : 1;
  const nib = doc.createElement('span');
  nib.className = 'hand-nib';
  line.append(nib);
  nib.animate(
    [
      { offset: 0, transform: 'translateX(0px)', opacity: strength },
      ...glyphs.map((glyph, i) => ({
        offset: (times[i]! + 80) / duration,
        transform: `translateX(${glyph.offsetLeft + glyph.offsetWidth}px)`,
        opacity: i === glyphs.length - 1 ? 0 : strength,
      })),
    ],
    { duration, delay, fill: 'backwards' },
  );
  const dots = doc.createElement('span');
  dots.className = 'hand-dots';
  line.append(dots);
  canvas.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  // Inline glyph advances can end before Caveat's ink, especially the tail of g.
  const inkRight = Math.max(
    ...glyphs.map(glyph => glyph.offsetLeft + canvas.measureText(glyph.textContent!).actualBoundingBoxRight),
  );
  dots.style.left = `${inkRight + 2.5 + canvas.measureText('.').actualBoundingBoxLeft}px`;
  for (let i = 0; i < 3; i++) {
    const dot = doc.createElement('span');
    dot.textContent = '.';
    dots.append(dot);
    dot.animate(
      [
        { offset: 0, opacity: 0 },
        { offset: 0.15 + i * 0.15, opacity: 0 },
        { offset: 0.2 + i * 0.15, opacity: strength },
        { offset: 0.8, opacity: strength },
        { offset: 1, opacity: 0 },
      ],
      { duration: 1600, delay: delay + duration, iterations: Infinity, fill: 'backwards' },
    );
  }
}

export const workingStyles = css`
  .working-line {
    display: inline-block;
    position: relative;
    max-width: 100%;
  }
  [data-working] {
    height: 18px;
    position: relative;
  }
  [data-working] .working-line {
    position: absolute;
    left: 0;
    top: 0;
    white-space: pre;
    font:
      500 18px/18px ProofmarksHand,
      cursive;
  }
  .hand-glyph {
    display: inline-block;
    white-space: pre;
  }
  .hand-nib {
    width: 3px;
    height: 3px;
    border-radius: 50%;
    background: var(--agent, var(--mark));
    position: absolute;
    left: 0;
    top: 12px;
    opacity: 0;
  }
  .hand-dots {
    position: absolute;
    top: 0;
    display: flex;
    color: var(--agent, var(--mark));
  }
  .hand-dots span {
    opacity: 0;
  }
  .working-outgoing {
    pointer-events: none;
  }
  .working-outgoing .hand-nib,
  .working-outgoing .hand-dots {
    display: none;
  }
`;
