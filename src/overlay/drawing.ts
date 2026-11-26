import rough from 'roughjs';
import type { ProofmarksMark } from './types';
/** Stable positive Rough.js seed, independent of viewport and draw order. */
export function findingSeed(key: string) {
  let hash = 2166136261;
  for (const char of key) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return ((hash >>> 0) % 2147483646) + 1;
}
/** Flat oval shoulders enclose the end glyphs without inflating a long line's radii. */
export function markPadding(width: number, height: number, type: string, lineGap = 6) {
  return type === 'circle'
    ? { x: 6 + Math.min(4, width / 150), y: Math.max(0, Math.min(2, lineGap / 2 - 1)) }
    : { x: 6, y: 6 };
}
export function ellipsePath(w: number, h: number, gap = 6) {
  const { x, y } = markPadding(w, h, 'circle', gap),
    shoulder = (x * 4) / 3;
  return `M 0 ${-y} C ${w * 0.28} ${-y} ${w * 0.72} ${-y} ${w} ${-y} C ${w + shoulder} ${-y} ${w + shoulder} ${h + y} ${w} ${h + y} C ${w * 0.72} ${h + y} ${w * 0.28} ${h + y} 0 ${h + y} C ${-shoulder} ${h + y} ${-shoulder} ${-y} 0 ${-y} Z`;
}
export function drawMark(
  box: HTMLElement,
  type: ProofmarksMark | 'bracket',
  color: string,
  seed: number,
  animate: boolean,
  delay: number,
  lineGap = 6,
) {
  const svg = box.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.classList.add('rough-annotation');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('width', box.style.width);
  svg.setAttribute('height', box.style.height);
  const w = parseFloat(box.style.width),
    h = parseFloat(box.style.height);
  const padding = markPadding(w, h, type);
  const renderer = rough.svg(svg),
    options = { seed, stroke: color, strokeWidth: 1.3, roughness: 0.6, disableMultiStroke: true };
  const path =
    type === 'bracket'
      ? `M 0 0 L -5 0 L -5 ${h} L 0 ${h}`
      : type === 'caret'
        ? `M 0 ${h + 7} L 5 ${h} L 10 ${h + 7}`
        : type === 'strike-through'
          ? `M 0 ${h / 2} L ${w} ${h / 2}`
          : type === 'crossed-off'
            ? `M 0 0 L ${w} ${h} M 0 ${h} L ${w} 0`
            : `M 0 ${h + 1} L ${w} ${h + 1}`;
  svg.append(
    type === 'box'
      ? renderer.rectangle(-padding.x, -padding.y, w + 2 * padding.x, h + 2 * padding.y, options)
      : type === 'circle'
        ? renderer.path(ellipsePath(w, h, lineGap), {
            ...options,
            roughness: 0.25,
            bowing: 0,
            maxRandomnessOffset: 0.25,
          })
        : renderer.path(path, options),
  );
  box.append(svg);
  if (animate)
    for (const p of svg.querySelectorAll('path')) {
      const length = p.getTotalLength();
      p.style.strokeDasharray = String(length);
      p.style.strokeDashoffset = '0';
      p.animate([{ strokeDashoffset: String(length) }, { strokeDashoffset: '0' }], {
        duration: 420,
        delay,
        easing: 'cubic-bezier(.22,1,.36,1)',
        fill: 'backwards',
      });
    }
}
