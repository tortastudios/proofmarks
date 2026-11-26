import { layoutWidth } from './viewport';
/** Geometry and input for the disposable badge; never writes to the page. */
export type Slot = 'top-left' | 'top-center' | 'top-right' | 'bottom-left' | 'bottom-center' | 'bottom-right';
type Point = { x: number; y: number };
type Box = { left: number; top: number; right: number; bottom: number };
export const overlaps = (a: Box, b: Box) =>
  a.left < b.right + 8 && a.right > b.left - 8 && a.top < b.bottom + 8 && a.bottom > b.top - 8;
export const resist = (n: number, min: number, max: number) => {
  const edge = Math.max(min, Math.min(max, n));
  return edge + Math.sign(n - edge) * Math.sqrt(Math.abs(n - edge)) * 2;
};
export const projected = (position: number, velocity: number) => position + velocity * 499;
export function dockSlots(
  width: number,
  height: number,
  top: number,
  bottom: number,
  mobile: boolean,
  obstacles: Box[],
  badgeWidth = 146,
  sideInset = 12,
) {
  const slots: { slot: Slot; x: number; y: number }[] = [];
  for (const edge of mobile ? ['bottom'] : ['top', 'bottom'])
    for (const side of mobile ? ['left', 'center', 'right'] : ['left', 'right']) {
      const x =
          side === 'left' ? sideInset : side === 'right' ? width - badgeWidth - sideInset : (width - badgeWidth) / 2,
        y = edge === 'top' ? top : height - bottom - 46;
      if (y >= top && !obstacles.some(o => overlaps({ left: x, top: y, right: x + badgeWidth, bottom: y + 46 }, o)))
        slots.push({ slot: `${edge}-${side}` as Slot, x, y });
    }
  return slots;
}
export function avoidDockObstacles<T extends { slot: Slot; x: number; y: number }>(
  point: T,
  obstacles: Box[],
  width: number,
): T {
  const result = { ...point };
  for (let pass = 0; pass < obstacles.length; pass++)
    for (const box of obstacles) {
      if (overlaps({ left: result.x, right: result.x + width, top: result.y, bottom: result.y + 46 }, box))
        result.y = result.slot.startsWith('bottom') ? box.top - 54 : box.bottom + 8;
    }
  return result;
}
/** Exact resting ink capsule inside the 44px button (4px inset on each side). */
export function badgeInkClip(
  panelWidth: number,
  panelHeight: number,
  x: number,
  y: number,
  badgeWidth: number,
  badgeHeight: number,
) {
  return `inset(${y + 4}px ${Math.max(0, panelWidth - x - badgeWidth + 4)}px ${Math.max(0, panelHeight - y - badgeHeight + 4)}px ${x + 4}px round ${(badgeHeight - 8) / 2}px)`;
}
export function badgeDock(o: {
  avoid?: string[];
  storageKey?: string;
  persistent?: boolean;
  /** Where the badge starts when the reader hasn't moved it. */
  slot?: Slot;
  doc: Document;
  win: Window;
  panel: HTMLElement;
  pill: HTMLElement;
  mobile: MediaQueryList;
  reduced: MediaQueryList;
  expanded: () => boolean;
  keyboard: () => boolean;
  changed: () => void;
}) {
  const { doc, win, panel, pill } = o,
    key = o.storageKey ?? 'proofmarks:badge-slot';
  const badgeWidth = () => pill.getBoundingClientRect().width + 2;
  let slot: Slot = o.slot ?? 'top-right';
  try {
    if (o.persistent !== false) slot = (win.localStorage.getItem(key) as Slot) || slot;
  } catch {}
  let point: Point = { x: 0, y: 0 },
    offset: Point = { x: 0, y: 0 },
    frame = 0,
    animation: Animation | undefined,
    suppressClick = false;
  let drag:
    | { id: number; start: Point; origin: Point; last: Point; time: number; vx: number; vy: number; active: boolean }
    | undefined;
  const safe = doc.createElement('div');
  safe.style.cssText =
    'position:fixed;pointer-events:none;visibility:hidden;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)';
  panel.append(safe);
  function obstacles() {
    const found = [...doc.querySelectorAll<HTMLElement>(o.avoid?.join(',') || ':not(*)')];
    return found.flatMap(el => {
      const rect = el.getBoundingClientRect();
      return rect.width &&
        rect.height &&
        win.getComputedStyle(el).visibility !== 'hidden' &&
        win.getComputedStyle(el).pointerEvents !== 'none'
        ? [rect]
        : [];
    });
  }
  function bounds() {
    const css = win.getComputedStyle(safe);
    const headers = [...doc.querySelectorAll('body header,body nav')]
      .filter(el => !el.closest('article'))
      .map(el => el.getBoundingClientRect())
      .filter(r => r.top < 90 && r.bottom > 0 && r.height < 180);
    return {
      top: Math.max(12 + (parseFloat(css.paddingTop) || 0), ...headers.map(r => r.bottom + 12)),
      bottom: 12 + (parseFloat(css.paddingBottom) || 0),
      side: 12 + Math.max(parseFloat(css.paddingLeft) || 0, parseFloat(css.paddingRight) || 0),
    };
  }
  function available() {
    const b = bounds(),
      blocked = obstacles();
    // Preserve corner identity even when an avoided element occupies it. Clear the obstacle
    // along that edge instead of silently selecting a different docking slot.
    return dockSlots(
      layoutWidth(doc),
      win.innerHeight,
      b.top,
      b.bottom,
      o.mobile.matches,
      [],
      badgeWidth(),
      b.side,
    ).map(s => avoidDockObstacles(s, blocked, badgeWidth()));
  }
  function write() {
    panel.style.transform = `translate3d(${point.x - offset.x}px,${point.y - offset.y}px,0)`;
    o.changed();
  }
  function geometry() {
    const availableHeight = slot.startsWith('bottom')
      ? point.y + 46 - bounds().top
      : win.innerHeight - bounds().bottom - point.y;
    panel.style.setProperty('--panel-max-height', `${Math.max(120, availableHeight)}px`);
    const w = panel.offsetWidth,
      h = panel.offsetHeight;
    offset = {
      x: slot.endsWith('left') ? 0 : slot.endsWith('right') ? w - badgeWidth() : (w - badgeWidth()) / 2,
      y: slot.startsWith('bottom') ? h - 46 : 0,
    };
    panel.style.setProperty('--badge-x', `${offset.x}px`);
    panel.style.setProperty('--badge-y', `${offset.y}px`);
    panel.dataset.slot = slot;
    panel.style.clipPath = o.expanded() ? 'inset(0 0 0 0 round var(--surface-radius))' : 'none';
  }
  function openingClip() {
    return `inset(${offset.y}px ${Math.max(0, panel.offsetWidth - offset.x - badgeWidth())}px ${Math.max(0, panel.offsetHeight - offset.y - 46)}px ${offset.x}px round var(--surface-radius))`;
  }
  // The close endpoint is the painted ink, not the larger pointer target.
  function closedClip() {
    const r = pill.getBoundingClientRect();
    return badgeInkClip(panel.offsetWidth, panel.offsetHeight, offset.x, offset.y, r.width, r.height);
  }
  function cancel() {
    cancelAnimationFrame(frame);
    frame = 0;
    animation?.cancel();
    animation = undefined;
  }
  function choose(next: ReturnType<typeof available>[number], animate: boolean) {
    cancel();
    const from = { ...point };
    slot = next.slot;
    point = { x: next.x, y: next.y };
    geometry();
    try {
      if (o.persistent !== false) win.localStorage.setItem(key, slot);
    } catch {}
    if (!animate || o.reduced.matches || o.keyboard()) {
      write();
      return;
    }
    // Critically damped spring (omega 32), sampled as transforms; regrab reads current point.
    const start = win.performance.now(),
      target = { ...point };
    point = from;
    const tick = () => {
      const elapsed = (win.performance.now() - start) / 1000,
        remaining = (1 + 32 * elapsed) * Math.exp(-32 * elapsed);
      point = { x: target.x + (from.x - target.x) * remaining, y: target.y + (from.y - target.y) * remaining };
      if (elapsed >= 0.28) {
        point = target;
        frame = 0;
        write();
        return;
      }
      write();
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
  }
  function refresh() {
    if (drag?.active || frame) return;
    if (!o.mobile.matches && slot.endsWith('center')) {
      const b = bounds();
      point = {
        x: (layoutWidth(doc) - badgeWidth()) / 2,
        y: slot.startsWith('bottom') ? win.innerHeight - b.bottom - 46 : b.top,
      };
    }
    const options = available();
    const next =
      options.find(s => s.slot === slot) ??
      options.sort(
        (a, b) => Math.hypot(a.x - point.x, a.y - point.y) - Math.hypot(b.x - point.x, b.y - point.y) || b.x - a.x,
      )[0];
    if (next) choose(next, false);
  }
  function moveSlot(direction?: string) {
    const choices = available();
    const current = choices.find(s => s.slot === slot) ?? choices[0];
    if (!current) return;
    let next;
    if (direction && !o.mobile.matches) {
      const order = ['top-left', 'top-right', 'bottom-right', 'bottom-left'];
      const corners = choices.sort((a, b) => order.indexOf(a.slot) - order.indexOf(b.slot)),
        i = corners.findIndex(s => s.slot === slot),
        delta = direction === 'ArrowLeft' || direction === 'ArrowUp' ? -1 : 1;
      next = corners[(i + delta + corners.length) % corners.length];
    } else if (direction) {
      const dx = direction === 'ArrowLeft' ? -1 : direction === 'ArrowRight' ? 1 : 0,
        dy = direction === 'ArrowUp' ? -1 : direction === 'ArrowDown' ? 1 : 0;
      next = choices
        .filter(s => (s.x - current.x) * dx + (s.y - current.y) * dy > 1)
        .sort((a, b) => Math.hypot(a.x - current.x, a.y - current.y) - Math.hypot(b.x - current.x, b.y - current.y))[0];
    } else {
      const corners = choices.filter(s => !s.slot.endsWith('center'));
      next = corners[(corners.findIndex(s => s.slot === slot) + 1) % corners.length];
    }
    if (next) choose(next, false);
  }
  function down(e: PointerEvent) {
    if (o.expanded() || e.button !== 0) return;
    suppressClick = false;
    cancel();
    drag = {
      id: e.pointerId,
      start: { x: e.clientX, y: e.clientY },
      origin: { ...point },
      last: { x: e.clientX, y: e.clientY },
      time: e.timeStamp,
      vx: 0,
      vy: 0,
      active: false,
    };
  }
  function move(e: PointerEvent) {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.start.x,
      dy = e.clientY - drag.start.y;
    if (!drag.active && Math.hypot(dx, dy) <= 4) return;
    if (!drag.active) pill.setPointerCapture(e.pointerId);
    drag.active = true;
    panel.dataset.dragging = 'true';
    const dt = e.timeStamp - drag.time;
    if (dt > 0) {
      drag.vx = (e.clientX - drag.last.x) / dt;
      drag.vy = (e.clientY - drag.last.y) / dt;
    }
    drag.last = { x: e.clientX, y: e.clientY };
    drag.time = e.timeStamp;
    const b = bounds();
    point = {
      x: resist(drag.origin.x + dx, b.side, layoutWidth(doc) - badgeWidth() - b.side),
      y: resist(drag.origin.y + dy, b.top, win.innerHeight - b.bottom - 46),
    };
    write();
  }
  function end(e?: PointerEvent, cancelled = false) {
    if (!drag) return;
    const d = drag;
    drag = undefined;
    delete panel.dataset.dragging;
    if (pill.hasPointerCapture(d.id)) pill.releasePointerCapture(d.id);
    if (!d.active) return;
    suppressClick = true;
    const age = e ? e.timeStamp - d.time : Infinity,
      vx = cancelled || age > 100 ? 0 : d.vx,
      vy = cancelled || age > 100 ? 0 : d.vy;
    const x = projected(point.x, vx),
      y = projected(point.y, vy);
    const next = available().sort((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y))[0];
    if (next) choose(next, true);
  }
  const up = (e: PointerEvent) => end(e),
    abort = () => end(undefined, true);
  const click = (e: MouseEvent) => {
    if (suppressClick) {
      suppressClick = false;
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  };
  const keydown = (e: KeyboardEvent) => {
    if (
      !e.defaultPrevented &&
      !e.isComposing &&
      !e.metaKey &&
      !e.ctrlKey &&
      !e.shiftKey &&
      e.altKey &&
      e.key.startsWith('Arrow')
    ) {
      e.preventDefault();
      moveSlot(e.key);
    }
  };
  const reflow = () => refresh();
  const settle = () => {
    abort();
    cancel();
    refresh();
  };
  const preference = () => {
    if (o.reduced.matches) settle();
  };
  o.reduced.addEventListener('change', preference);
  pill.addEventListener('pointerdown', down);
  win.addEventListener('pointermove', move);
  win.addEventListener('pointerup', up);
  pill.addEventListener('pointercancel', abort);
  pill.addEventListener('lostpointercapture', event => {
    if (event.target === pill) abort();
  });
  pill.addEventListener('click', click, true);
  pill.addEventListener('keydown', keydown);
  win.addEventListener('blur', abort);
  win.addEventListener('resize', reflow);
  win.addEventListener('pointerup', reflow);
  o.mobile.addEventListener('change', reflow);
  const resize = new ResizeObserver(refresh);
  resize.observe(panel);
  resize.observe(pill);
  // Avoided elements own their transforms. Observe only its hosts, not article content.
  const obstacleObserver = new MutationObserver(refresh);
  for (const el of doc.querySelectorAll(o.avoid?.join(',') || ':not(*)'))
    obstacleObserver.observe(el, { attributes: true, subtree: true, attributeFilter: ['style', 'class'] });
  refresh();
  return {
    refresh,
    closedClip,
    openingClip,
    moveSlot,
    settle,
    destroy() {
      cancel();
      resize.disconnect();
      obstacleObserver.disconnect();
      abort();
      cancel();
      win.removeEventListener('pointermove', move);
      win.removeEventListener('pointerup', up);
      win.removeEventListener('blur', abort);
      win.removeEventListener('resize', reflow);
      win.removeEventListener('pointerup', reflow);
      o.mobile.removeEventListener('change', reflow);
      o.reduced.removeEventListener('change', preference);
    },
  };
}
