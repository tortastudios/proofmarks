// proofmarks.dev: the opening example (hero.ts), then the real overlay on the rule examples, with Accept, Dismiss and
// Undo kept in the visitor's browser. The review is a real one, and the rewrites are ones an agent wrote and the judge
// cleared. The site calls the judge "the decision model" rather than by name.
import { proofmarkIcon } from '../src/overlay/badge-pill';
import { replacementStart, tidyDeletion } from '../src/overlay/deletion';
import { mountProofmarks } from '../src/overlay/index';
import type { ProofmarksFinding, ProofmarksReview } from '../src/overlay/types';
import { startHero } from './hero';
import { track } from './analytics';
import saved from './rules-review.json';

const doc = document;
track('$pageview');
const hero = doc.querySelector<HTMLElement>('[data-hero]');
if (hero) startHero(hero);

function mountRules() {
  const root = doc.querySelector<HTMLElement>('[data-rules]');
  if (!root) return;
  const review = structuredClone(saved) as unknown as ProofmarksReview;
  const find = (id: string) => review.findings.find(f => f.id === id)!;
  const done = () => ({ ok: true, review: structuredClone(review) });
  // An accepted proof is recorded as the companion writes it: a deletion tidied, and every edit with the text
  // around it, which places its mark.
  const accepted = new Map<string, Pick<ProofmarksFinding, 'after' | 'edits'>>();
  for (const finding of review.findings) {
    if (finding.proposed === undefined) continue;
    // The examples are Markdown, and only bold differs on the page.
    const match = finding.match.replaceAll('**', ''),
      text = [...root.querySelectorAll('.rule-example')].find(p => p.textContent?.includes(match))?.textContent ?? '',
      start = text.indexOf(match);
    if (start < 0) continue;
    const edit =
      finding.proposed === ''
        ? tidyDeletion(text, start, start + match.length)
        : {
            start: replacementStart(text, start, finding.proposed),
            end: start + match.length,
            after: finding.proposed.replaceAll('**', ''),
          };
    const updated = text.slice(0, edit.start) + edit.after + text.slice(edit.end),
      end = edit.start + edit.after.length;
    accepted.set(finding.id, {
      after: edit.after,
      edits: [
        {
          before: text.slice(edit.start, edit.end),
          after: edit.after,
          start: edit.start,
          end: edit.end,
          context: {
            left: updated.slice(Math.max(0, edit.start - 64), edit.start),
            right: updated.slice(end, end + 64),
          },
        },
      ],
    });
  }
  // Bold is markup, which the overlay's page edit can't drop: a real page loses it when its source changes and reloads.
  // Here Accept unwraps the bold, and Undo wraps the same text back.
  const unbolded = new Map<string, ChildNode[]>();
  const unbold = (finding: ProofmarksFinding) => {
    if (!/^\*\*[^*]+\*\*$/.test(finding.match) || finding.proposed?.includes('**')) return;
    const strong = [...root.querySelectorAll('.rule-example strong')].find(
      element => element.textContent === finding.proposed,
    );
    if (!strong) return;
    const nodes = [...strong.childNodes];
    strong.replaceWith(...nodes);
    unbolded.set(finding.id, nodes);
  };
  const rebold = (finding: ProofmarksFinding) => {
    const nodes = unbolded.get(finding.id);
    if (!nodes?.[0]?.isConnected) return;
    const strong = doc.createElement('strong');
    nodes[0].before(strong);
    strong.append(...nodes);
    unbolded.delete(finding.id);
  };
  const overlay = mountProofmarks({
    root,
    ...review,
    reviewId: 'rules',
    enabled: true,
    badgeSlot: 'bottom-right',
    optimisticText: true,
    onAccept: (finding: ProofmarksFinding) => {
      const current = find(finding.id);
      Object.assign(
        current,
        { status: 'accepted', before: current.match, after: current.proposed },
        accepted.get(current.id),
      );
      unbold(current);
      return done();
    },
    onDismiss: (finding: ProofmarksFinding) => {
      find(finding.id).status = 'dismissed';
      return done();
    },
    onRevert: (finding: ProofmarksFinding) => {
      const current = find(finding.id);
      rebold(current);
      current.status = 'open';
      delete current.before;
      delete current.after;
      delete current.edits;
      return done();
    },
  });
  overlay.setCompanionStatus({ connected: false, reason: 'A saved review by the decision model' });
}

// Try it: the button becomes the badge in the corner, then the marks appear on the rule examples.
const tryIt = doc.querySelector<HTMLButtonElement>('[data-try]');
if (tryIt) {
  tryIt.addEventListener('click', async () => {
    track('try_it');
    const from = tryIt.getBoundingClientRect(),
      size = 44,
      inset = 14;
    const ghost = tryIt.cloneNode(true) as HTMLElement;
    ghost.removeAttribute('data-try');
    ghost.classList.add('try-ghost');
    Object.assign(ghost.style, {
      left: `${from.left}px`,
      top: `${from.top}px`,
      width: `${from.width}px`,
      height: `${from.height}px`,
    });
    const icon = proofmarkIcon(doc);
    ghost.append(icon);
    doc.body.append(ghost);
    tryIt.style.visibility = 'hidden';
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    await Promise.all([
      ghost.animate(
        [
          {
            left: `${from.left}px`,
            top: `${from.top}px`,
            width: `${from.width}px`,
            height: `${from.height}px`,
            borderRadius: '10px',
          },
          {
            left: `${innerWidth - inset - size}px`,
            top: `${innerHeight - inset - size}px`,
            width: `${size}px`,
            height: `${size}px`,
            borderRadius: `${size / 2}px`,
          },
        ],
        { duration: reduce ? 0 : 560, easing: 'cubic-bezier(.32,.72,0,1)', fill: 'forwards' },
      ).finished,
      ghost.firstElementChild?.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 140, fill: 'forwards' }).finished,
      icon.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, delay: reduce ? 0 : 320, fill: 'both' }).finished,
    ]);
    mountRules();
    doc.documentElement.dataset.marks = 'on';
    ghost
      .animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200, delay: 120, fill: 'forwards' })
      .finished.then(() => ghost.remove());
  });
} else mountRules();

// The setup prompt's install route: a menu of routes; picking one shows its prompt, and Copy prompt copies it.
for (const box of doc.querySelectorAll<HTMLElement>('[data-prompt-routes]')) {
  const trigger = box.querySelector<HTMLButtonElement>('.picker-trigger')!,
    label = box.querySelector<HTMLElement>('[data-picker-label]')!,
    menu = box.querySelector<HTMLElement>('.picker-menu')!,
    options = [...menu.querySelectorAll<HTMLElement>('[role="option"]')],
    copy = box.querySelector<HTMLButtonElement>('[data-copy]')!;
  let active = 0;
  const reduce = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const highlight = (index: number) => {
    active = (index + options.length) % options.length;
    options.forEach((option, i) => option.toggleAttribute('data-active', i === active));
    menu.setAttribute('aria-activedescendant', options[active]!.id);
  };
  const open = () => {
    if (!menu.hidden) return;
    menu.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    highlight(options.findIndex(option => option.getAttribute('aria-selected') === 'true'));
    menu.focus({ preventScroll: true });
    if (!reduce())
      menu.animate(
        [
          { opacity: 0, transform: 'translateY(-4px) scale(.97)' },
          { opacity: 1, transform: 'none' },
        ],
        { duration: 140, easing: 'cubic-bezier(.32,.72,0,1)' },
      );
  };
  const close = (focus = true) => {
    if (menu.hidden) return;
    menu.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    if (focus) trigger.focus({ preventScroll: true });
  };
  const choose = (option: HTMLElement) => {
    if (option.getAttribute('aria-selected') !== 'true')
      track('install_route_picked', { route: option.dataset.value! });
    for (const other of options) other.setAttribute('aria-selected', String(other === option));
    label.textContent = option.textContent;
    for (const body of box.querySelectorAll<HTMLElement>('[data-route]')) {
      body.hidden = body.dataset.route !== option.dataset.value;
      if (!body.hidden) copy.dataset.copy = body.dataset.text;
    }
    close();
  };
  trigger.addEventListener('click', () => (menu.hidden ? open() : close()));
  trigger.addEventListener('keydown', event => {
    if (['ArrowDown', 'ArrowUp'].includes(event.key)) {
      event.preventDefault();
      open();
    }
  });
  menu.addEventListener('keydown', event => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      highlight(active + (event.key === 'ArrowDown' ? 1 : -1));
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      highlight(event.key === 'Home' ? 0 : options.length - 1);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      choose(options[active]!);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      close();
    } else if (event.key === 'Tab') close(false);
  });
  for (const [i, option] of options.entries()) {
    option.addEventListener('pointermove', () => highlight(i));
    option.addEventListener('click', () => choose(option));
  }
  doc.addEventListener('pointerdown', event => {
    if (!box.querySelector('[data-picker]')!.contains(event.target as Node)) close(false);
  });
}

// Copy: the command blurs into "Copied to clipboard", then back.
const status = doc.querySelector<HTMLElement>('[data-copy-status]');
for (const button of doc.querySelectorAll<HTMLButtonElement>('[data-copy]')) {
  let timer = 0;
  button.addEventListener('click', async () => {
    await navigator.clipboard.writeText(button.dataset.copy!);
    const route = button
      .closest('[data-prompt-routes]')
      ?.querySelector('[aria-selected="true"]')
      ?.getAttribute('data-value');
    if (button.classList.contains('prompt-copy')) track('prompt_copied', { route: route ?? 'setup' });
    else track('command_copied', { command: button.dataset.copy! });
    button.dataset.copied = 'true';
    if (status) status.textContent = 'Copied to clipboard';
    clearTimeout(timer);
    timer = window.setTimeout(() => (button.dataset.copied = 'false'), 1800);
  });
}

// Clicks out to GitHub, the step after the page for anyone who reads the code before installing.
doc.addEventListener('click', event => {
  const link = (event.target as Element).closest<HTMLAnchorElement>('a[href^="https://github.com/"]');
  if (link) track('outbound_click', { href: link.href });
});
