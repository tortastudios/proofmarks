import { layoutWidth } from './viewport';
type TooltipBox = { left: number; right: number; top: number; bottom: number };
/** Only the visible portions of a page control can collide with an overlay tooltip. */
export function uncoveredBox(b: TooltipBox, cover: TooltipBox): TooltipBox[] {
  const left = Math.max(b.left, cover.left),
    right = Math.min(b.right, cover.right),
    top = Math.max(b.top, cover.top),
    bottom = Math.min(b.bottom, cover.bottom);
  if (left >= right || top >= bottom) return [b];
  return [
    { ...b, bottom: top },
    { ...b, top: bottom },
    { left: b.left, right: left, top, bottom },
    { left: right, right: b.right, top, bottom },
  ].filter(r => r.left < r.right && r.top < r.bottom);
}
export function tooltipPosition(
  r: TooltipBox,
  width: number,
  height: number,
  viewport: number,
  options: {
    height?: number;
    header?: TooltipBox;
    surface?: TooltipBox;
    side?: 'left' | 'right';
    obstacles?: TooltipBox[];
  } = {},
) {
  if (options.surface) {
    const c = options.surface,
      top = Math.max(8, Math.min((r.top + r.bottom - height) / 2, (options.height ?? Infinity) - height - 8));
    const leftSide = { left: c.left - width - 8, top },
      rightSide = { left: c.right + 8, top };
    const candidates = options.side === 'left' ? [rightSide, leftSide] : [leftSide, rightSide];
    const across = Math.max(8, Math.min((r.left + r.right - width) / 2, viewport - width - 8)),
      below = { left: across, top: c.bottom + 8 },
      above = { left: across, top: c.top - height - 8 };
    // Past the surface's ends, the nearer end first: a control in its top half shows its tip above it.
    candidates.push(...(r.top + r.bottom < c.top + c.bottom ? [above, below] : [below, above]));
    return candidates.find(
      p =>
        p.left >= 8 &&
        p.left + width <= viewport - 8 &&
        p.top >= 8 &&
        p.top + height <= (options.height ?? Infinity) - 8 &&
        !options.obstacles?.some(
          b =>
            p.left < b.right + 4 && p.left + width > b.left - 4 && p.top < b.bottom + 4 && p.top + height > b.top - 4,
        ),
    );
  }
  const bounds = options.header ?? r,
    left = Math.max(8, Math.min((r.left + r.right - width) / 2, viewport - width - 8));
  const obstacles = [r, ...(options.obstacles ?? []), ...(options.header ? [options.header] : [])];
  const candidates = [
    { left, top: bounds.top - height - 8 },
    { left, top: bounds.bottom + 8 },
    { left: bounds.right + 4, top: (r.top + r.bottom - height) / 2 },
    { left: bounds.left - width - 4, top: (r.top + r.bottom - height) / 2 },
  ];
  // If both preferred sides are occupied, try beyond the obstructing controls.
  for (const box of obstacles) candidates.push({ left, top: box.top - height - 8 }, { left, top: box.bottom + 8 });
  return candidates.find(
    p =>
      p.left >= 8 &&
      p.left + width <= viewport - 8 &&
      p.top >= 8 &&
      p.top + height <= (options.height ?? Infinity) - 8 &&
      !obstacles.some(
        b => p.left < b.right + 4 && p.left + width > b.left - 4 && p.top < b.bottom + 4 && p.top + height > b.top - 4,
      ),
  );
}
export const tooltipDelay = (now: number, warmUntil: number, reduced: boolean) =>
  reduced || now < warmUntil ? 0 : 400;
export function proofTooltips(doc: Document, win: Window, shadow: ShadowRoot, reduced: MediaQueryList) {
  const box = (el: Element): TooltipBox => {
    const r = el.getBoundingClientRect();
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
  };
  const fine = win.matchMedia('(hover: hover) and (pointer: fine)');
  const tip = doc.createElement('div');
  tip.className = 'proof-tooltip';
  tip.id = 'proof-tooltip';
  tip.setAttribute('role', 'tooltip');
  tip.hidden = true;
  shadow.append(tip);
  let animation: Animation | undefined;
  let timer = 0,
    warmUntil = 0,
    active: HTMLElement | undefined;
  const cleanups: (() => void)[] = [];
  function hide() {
    animation?.cancel();
    win.clearTimeout(timer);
    if (!tip.hidden) warmUntil = win.performance.now() + 600;
    tip.hidden = true;
    active?.removeAttribute('aria-describedby');
    active = undefined;
  }
  function bind(control: HTMLElement, label: () => string) {
    const show = () => {
      if (!fine.matches) return;
      hide();
      active = control;
      const reveal = () => {
        if (active !== control || !control.isConnected || !control.getBoundingClientRect().width) return;
        const text = label(),
          parts = text.match(/^(.*) (⇧?[PADIUO]|Esc|←|→|,|\[|\])$/);
        tip.replaceChildren(doc.createTextNode(parts ? parts[1]! : text));
        if (parts) {
          const key = doc.createElement('span');
          key.className = 'proof-tooltip-key';
          key.textContent = parts[2]!;
          tip.append(key);
        }
        tip.hidden = false;
        control.setAttribute('aria-describedby', tip.id);
        const row = control.closest('.card header'),
          card = row?.closest('.card'),
          surface = control.closest('.card');
        const header = row && card ? { ...box(card), bottom: row.getBoundingClientRect().bottom } : undefined;
        const obstacles = [
          ...shadow.querySelectorAll<HTMLElement>('button,a,input,select,textarea,[role="button"]'),
          ...[...doc.querySelectorAll<HTMLElement>('button,a,input,select,textarea,[role="button"]')].filter(e => {
            const r = e.getBoundingClientRect(),
              hit = doc.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2);
            return !!hit && (hit === e || e.contains(hit));
          }),
        ]
          .filter(
            e =>
              !e.closest('[inert]') &&
              e.getBoundingClientRect().width &&
              e.getBoundingClientRect().height &&
              win.getComputedStyle(e).visibility !== 'hidden' &&
              win.getComputedStyle(e).opacity !== '0',
          )
          .flatMap(e => {
            const bounds = box(e);
            return surface && !surface.contains(e) && !e.closest('.header,.sheet-logo')
              ? uncoveredBox(bounds, box(surface))
              : [bounds];
          });
        // A line's tabs are hidden while their copies tuck in after a +N morph, but they land beside the card's title.
        for (const tab of shadow.querySelectorAll<HTMLElement>('.line-tabs:not([hidden]) .line-tab'))
          obstacles.push(box(tab));
        const p = tooltipPosition(
          control.getBoundingClientRect(),
          tip.getBoundingClientRect().width,
          tip.getBoundingClientRect().height,
          layoutWidth(doc),
          {
            height: win.innerHeight,
            header,
            surface: surface ? box(surface) : undefined,
            side: shadow.querySelector<HTMLElement>('.panel')?.dataset.slot?.endsWith('left') ? 'left' : 'right',
            obstacles,
          },
        );
        if (!p) {
          tip.hidden = true;
          control.removeAttribute('aria-describedby');
          return;
        }
        tip.style.left = `${p.left}px`;
        tip.style.top = `${p.top}px`;
        if (delay > 0 && !reduced.matches)
          animation = tip.animate(
            [
              { opacity: 0, transform: 'translateY(2px) scale(.96)' },
              { opacity: 1, transform: 'none' },
            ],
            { duration: 150, easing: 'ease-out' },
          );
        warmUntil = Infinity;
      };
      const delay = tooltipDelay(win.performance.now(), warmUntil, reduced.matches);
      if (delay) timer = win.setTimeout(reveal, delay);
      else reveal();
    };
    const enter = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') show();
    };
    const focus = () => {
      if (control.matches(':focus-visible')) show();
    };
    control.removeAttribute('title');
    control.addEventListener('pointerenter', enter);
    control.addEventListener('pointerleave', hide);
    control.addEventListener('focus', focus);
    control.addEventListener('blur', hide);
    control.addEventListener('pointerdown', hide);
    control.addEventListener('click', hide);
    cleanups.push(() => {
      control.removeEventListener('pointerenter', enter);
      control.removeEventListener('pointerleave', hide);
      control.removeEventListener('focus', focus);
      control.removeEventListener('blur', hide);
      control.removeEventListener('pointerdown', hide);
      control.removeEventListener('click', hide);
    });
  }
  const keydown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') hide();
  };
  win.addEventListener('keydown', keydown, true);
  win.addEventListener('scroll', hide, true);
  win.addEventListener('resize', hide);
  fine.addEventListener('change', hide);
  return {
    bind,
    destroy() {
      hide();
      cleanups.forEach(fn => fn());
      tip.remove();
      win.removeEventListener('keydown', keydown, true);
      win.removeEventListener('scroll', hide, true);
      win.removeEventListener('resize', hide);
      fine.removeEventListener('change', hide);
    },
  };
}
