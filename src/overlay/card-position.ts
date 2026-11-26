export type CardPlacement = { left: boolean; above: boolean };

/** Direct placement with a 24px return threshold on each preferred axis.
 * Share state throughout one hover session, including finding changes. */
export function cursorCardPosition(
  x: number,
  y: number,
  width: number,
  height: number,
  viewportWidth: number,
  viewportHeight: number,
  state: CardPlacement = { left: false, above: false },
) {
  const gapX = 16,
    gapY = 20,
    margin = 8,
    hysteresis = 24;
  const roomX = viewportWidth - margin - (x + gapX + width);
  const roomY = viewportHeight - margin - (y + gapY + height);
  state.left = state.left ? roomX < hysteresis : roomX < 0;
  state.above = state.above ? roomY < hysteresis : roomY < 0;
  const left = state.left ? x - gapX - width : x + gapX;
  const top = state.above ? y - gapY - height : y + gapY;
  return {
    x: Math.max(margin, Math.min(left, viewportWidth - width - margin)),
    y: Math.max(margin, Math.min(top, viewportHeight - height - margin)),
  };
}

/** House cubic-bezier(.22,1,.36,1), inverted in time for a moving-target approach. */
export function glideProgress(time: number) {
  if (time <= 0) return 0;
  if (time >= 1) return 1;
  let lo = 0,
    hi = 1,
    t = 0.5;
  for (let i = 0; i < 16; i++) {
    t = (lo + hi) / 2;
    const x = 3 * (1 - t) * (1 - t) * t * 0.22 + 3 * (1 - t) * t * t * 0.36 + t * t * t;
    if (x < time) lo = t;
    else hi = t;
  }
  return 1 - Math.pow(1 - t, 3);
}

/** Clamp the final expanded pin box; prefer the less-overflowing side if neither fits. */
export function pinnedCardPosition(
  x: number,
  y: number,
  width: number,
  height: number,
  viewportWidth: number,
  viewportHeight: number,
  state: CardPlacement,
) {
  const h = Math.min(height, viewportHeight - 24),
    w = Math.min(width, viewportWidth - 24),
    position = cursorCardPosition(x, y, w, h, viewportWidth, viewportHeight, state);
  const below = viewportHeight - 12 - y - 20 - h,
    above = y - 20 - h - 12;
  if (below < 0 && above < 0) state.above = above > below;
  return {
    x: Math.max(12, Math.min(position.x, viewportWidth - w - 12)),
    y: Math.max(12, Math.min(state.above ? y - 20 - h : y + 20, viewportHeight - h - 12)),
  };
}

/** Start the edge dissolve only after the clip is within one CSS pixel of its endpoint. */
export function inkDissolveDelay(width: number, height: number, diameter = 36, duration = 150) {
  const distance = Math.max(0, width - diameter, height - diameter);
  for (let ms = 0; ms < duration; ms++) if (distance * (1 - glideProgress(ms / duration)) <= 1) return ms;
  return duration;
}
