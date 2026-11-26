import { visibleProofs } from './proof-set';
import rough from 'roughjs';
import { proofmarkIcon } from './badge-pill';
import type { ProofmarksFinding } from './types';
export function completionStatus(findings: readonly ProofmarksFinding[]) {
  findings = visibleProofs(findings);
  const reviewed = findings.filter(
    f => f.status === 'accepted' || f.status === 'accepted-unrecorded' || f.status === 'dismissed',
  ).length;
  return {
    reviewed,
    complete: findings.length > 0 && reviewed === findings.length,
    announcement: `All ${reviewed} ${reviewed === 1 ? 'proof' : 'proofs'} reviewed`,
  };
}
export function completionPlayback() {
  let pending = false;
  return {
    complete() {
      pending = true;
    },
    reset() {
      pending = false;
    },
    consume(reduced: boolean) {
      const play = pending && !reduced;
      pending = false;
      return play;
    },
  };
}
export function completionMoment(o: {
  doc: Document;
  win: Window;
  reduced: MediaQueryList;
  source: string;
  persistent?: boolean;
  undo: (id: string) => void;
  badge: (checked: boolean, animate: boolean) => void;
}) {
  const { doc, win } = o,
    recordKey = `proofmarks:completion:${o.source}`;
  let lastId: string | undefined,
    animations: Animation[] = [];
  try {
    if (o.persistent !== false) {
      win.localStorage.removeItem('proofmarks:done-style');
      lastId = JSON.parse(win.localStorage.getItem(recordKey) ?? 'null')?.id;
    }
  } catch {}
  const playback = completionPlayback();
  const element = doc.createElement('div');
  element.className = 'completion';
  element.hidden = true;
  const art = doc.createElement('div');
  art.className = 'completion-art';
  art.setAttribute('aria-hidden', 'true');
  element.append(art);
  const sign = doc.createElement('div');
  sign.className = 'completion-sign';
  const mark = proofmarkIcon(doc);
  mark.classList.add('completion-pilcrow');
  // Split the badge's first cubic at t=.2: identical baked contour, with its
  // short top bar available as the final stroke in the signing sequence.
  const bowl = mark.querySelector('path')!;
  bowl.setAttribute(
    'd',
    'M16.5416 3.9912C13.044 3.492 8.42 4.26 6.1 6.5C3.8 8.6 3.6 11.6 5.7 13.1C8 14.7 12.4 14.2 16.6 12.5',
  );
  const bar = bowl.cloneNode() as SVGPathElement;
  bar.setAttribute('d', 'M18.9 4.6C18.22 4.32 17.416 4.116 16.5416 3.9912');
  mark.append(bar);
  sign.append(mark);
  const check = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
  check.setAttribute('viewBox', '0 0 70 64');
  check.classList.add('completion-sign-check');
  check.append(
    rough.svg(check).path('M8 34 C15 39 19 45 24 50 C34 32 48 17 61 9', {
      seed: 8517,
      stroke: 'currentColor',
      strokeWidth: 3,
      roughness: 0.55,
      disableMultiStroke: true,
    }),
  );
  sign.append(check);
  const caption = doc.createElement('div');
  caption.className = 'completion-caption';
  caption.textContent = 'All reviewed';
  sign.append(caption);
  art.append(sign);
  const equivalent = doc.createElement('span');
  equivalent.className = 'completion-equivalent';
  element.append(equivalent);
  const undo = doc.createElement('button');
  undo.type = 'button';
  undo.className = 'completion-undo';
  undo.textContent = 'Undo last decision';
  undo.setAttribute('aria-keyshortcuts', 'U');
  undo.onclick = () => {
    settle();
    if (lastId) o.undo(lastId);
  };
  element.append(undo);
  function settle() {
    animations.forEach(a => a.cancel());
    animations = [];
  }
  function play() {
    settle();
    if (o.reduced.matches) return;
    const paths = [...mark.querySelectorAll('path')];
    for (const [i, p] of paths.entries()) {
      const length = p.getTotalLength() + 1;
      p.style.strokeDasharray = `${length} ${length + 2}`;
      animations.push(
        p.animate([{ strokeDashoffset: length }, { strokeDashoffset: 0 }], {
          duration: [200, 125, 125, 50][i],
          delay: [0, 200, 325, 450][i],
          easing: 'cubic-bezier(.22,1,.36,1)',
          fill: 'backwards',
        }),
      );
    }
    for (const p of check.querySelectorAll('path')) {
      const length = p.getTotalLength() + 1;
      p.style.strokeDasharray = `${length} ${length + 2}`;
      animations.push(
        p.animate([{ strokeDashoffset: length }, { strokeDashoffset: 0 }], {
          duration: 200,
          delay: 500,
          easing: 'cubic-bezier(.22,1,.36,1)',
          fill: 'backwards',
        }),
      );
    }
    o.badge(true, true);
  }
  return {
    element,
    undo,
    settle,
    update(findings: ProofmarksFinding[], busy: boolean) {
      const status = completionStatus(findings);
      equivalent.textContent = status.announcement;
      undo.disabled =
        busy ||
        !lastId ||
        !findings.some(f => f.id === lastId && f.status !== 'open' && f.status !== 'accepted-unrecorded');
      if (!status.complete) {
        playback.reset();
        settle();
      }
      o.badge(status.complete, false);
    },
    completed(id: string) {
      lastId = id;
      playback.complete();
      try {
        if (o.persistent !== false) win.localStorage.setItem(recordKey, JSON.stringify({ id }));
      } catch {}
    },
    show() {
      element.hidden = false;
      if (playback.consume(o.reduced.matches)) play();
    },
    hide() {
      element.hidden = true;
      settle();
    },
    destroy() {
      settle();
      element.remove();
    },
  };
}
