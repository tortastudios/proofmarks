export const sheetReleaseCloses = (distance: number, velocity: number, height: number) =>
  distance > 10 && distance + velocity * 499 > height * 0.35;
export function mobileSheet(o: {
  avoid?: string[];
  doc: Document;
  win: Window;
  host: HTMLElement;
  shadow: ShadowRoot;
  card: HTMLElement;
  panel: HTMLElement;
  overview: () => void;
  mobile: MediaQueryList;
  reduced: MediaQueryList;
  close: () => void;
  rect: (id: string) => DOMRect | undefined;
  isKeyboard: () => boolean;
}) {
  const { doc, win, card, panel } = o;
  const sheet = doc.createElement('section');
  sheet.className = 'mobile-sheet';
  sheet.hidden = true;
  sheet.setAttribute('role', 'region');
  sheet.setAttribute('aria-label', 'Proofmarks review');
  o.shadow.append(sheet);
  const make = (text: string, fn: () => void) => {
    const b = doc.createElement('button');
    b.type = 'button';
    b.textContent = text;
    b.onclick = fn;
    return b;
  };
  const handle = make('―', () => {});
  handle.className = 'sheet-handle';
  handle.setAttribute('aria-label', 'Page overview; drag down to close review');
  handle.onclick = () => {
    if (suppressClick) {
      suppressClick = false;
      return;
    }
    o.overview();
  };
  let animation: Animation | undefined,
    finishClose: (() => void) | undefined,
    suppressClick = false;
  sheet.append(handle);
  const hideChrome = doc.createElement('style');
  o.host.append(hideChrome);
  function open() {
    const from = finishClose ? win.getComputedStyle(sheet).transform : 'translateY(100%)';
    if (finishClose) {
      animation?.cancel();
      finishClose();
    }
    if (!sheet.hidden) return;
    sheet.dataset.slot = panel.dataset.slot;
    sheet.hidden = false;
    panel.hidden = true;
    o.host.dataset.sheetOpen = '';
    hideChrome.textContent = o.avoid?.length ? o.avoid.join(',') + '{visibility:hidden!important}' : '';
    if (!o.reduced.matches)
      animation = sheet.animate([{ transform: from }, { transform: 'translateY(0)' }], {
        duration: 220,
        easing: 'cubic-bezier(.22,1,.36,1)',
      });
  }
  function reveal(id: string) {
    requestAnimationFrame(() => {
      if (sheet.hidden) return;
      const rect = o.rect(id);
      if (!rect) return;
      const top = win.innerHeight - sheet.offsetHeight;
      const available = Math.max(80, top - 90);
      const target = win.scrollY + rect.top - 90 - Math.max(0, (available - rect.height) / 2);
      win.scrollTo({ top: Math.max(0, target), behavior: o.reduced.matches ? 'instant' : 'smooth' });
    });
  }
  let drag: { id: number; start: number; y: number; time: number; velocity: number; height: number } | undefined;
  handle.onpointerdown = e => {
    animation?.cancel();
    drag = {
      id: e.pointerId,
      start: e.clientY,
      y: e.clientY,
      time: e.timeStamp,
      velocity: 0,
      height: sheet.offsetHeight,
    };
    handle.setPointerCapture(e.pointerId);
  };
  handle.onpointermove = e => {
    if (!drag) return;
    const dt = e.timeStamp - drag.time;
    if (dt > 0) drag.velocity = (e.clientY - drag.y) / dt;
    drag.y = e.clientY;
    drag.time = e.timeStamp;
    const d = e.clientY - drag.start;
    sheet.style.transform = `translate3d(0,${d < 0 ? -Math.sqrt(-d) * 2 : d}px,0)`;
  };
  function release(cancel = false) {
    if (!drag) return;
    const d = drag.y - drag.start,
      from = sheet.style.transform;
    const dismiss = !cancel && sheetReleaseCloses(d, drag.velocity, drag.height);
    suppressClick = Math.abs(d) > 4;
    drag = undefined;
    sheet.style.transform = '';
    if (!cancel && d < -60) o.overview();
    else if (dismiss) o.close();
    else if (!o.reduced.matches)
      animation = sheet.animate([{ transform: from }, { transform: 'translateY(0)' }], {
        duration: 220,
        easing: 'cubic-bezier(.22,1,.36,1)',
      });
  }
  handle.onpointerup = () => release();
  handle.onpointercancel = () => release(true);
  handle.onlostpointercapture = () => release(true);
  const blur = () => release(true);
  win.addEventListener('blur', blur);
  const mode = () => {
    if (!o.mobile.matches && !sheet.hidden) o.close();
  };
  o.mobile.addEventListener('change', mode);
  const api = {
    element: sheet,
    isOpen: () => !sheet.hidden,
    review() {
      open();
      card.classList.add('sheet-card');
      sheet.append(card);
      card.style.transform = '';
      card.style.left = '';
      card.style.top = '';
    },
    reveal,
    close() {
      if (sheet.hidden) return;
      animation?.cancel();
      const copy = card.cloneNode(true) as HTMLElement;
      copy.inert = true;
      copy.classList.remove('card');
      copy.classList.add('card-exiting');
      copy.setAttribute('aria-hidden', 'true');
      sheet.append(copy);
      card.classList.remove('sheet-card');
      o.shadow.append(card);
      const finish = () => {
        finishClose = undefined;
        copy.remove();
        sheet.hidden = true;
        sheet.style.transform = '';
        hideChrome.textContent = '';
        delete o.host.dataset.sheetOpen;
        panel.hidden = false;
      };
      finishClose = finish;
      if (o.reduced.matches) {
        finish();
        return;
      }
      animation = sheet.animate(
        [{ transform: win.getComputedStyle(sheet).transform }, { transform: 'translateY(100%)' }],
        { duration: 150, easing: 'cubic-bezier(.22,1,.36,1)' },
      );
      animation.onfinish = finish;
    },
    destroy() {
      animation?.cancel();
      finishClose?.();
      win.removeEventListener('blur', blur);
      o.mobile.removeEventListener('change', mode);
      sheet.remove();
      hideChrome.remove();
    },
  };
  return api;
}
