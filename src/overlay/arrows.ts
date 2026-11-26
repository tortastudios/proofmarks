import rough from 'roughjs';
import { findingSeed } from './drawing';
type Point = { x: number; y: number };
type Rect = { left: number; right: number; top: number; bottom: number };
export function arrowCurve(start: Point, rects: readonly Rect[]) {
  const nearest = rects
    .map(rect => ({
      x: Math.min(rect.right, Math.max(rect.left, start.x)),
      y: Math.min(rect.bottom, Math.max(rect.top, start.y)),
    }))
    .sort((a, b) => Math.hypot(a.x - start.x, a.y - start.y) - Math.hypot(b.x - start.x, b.y - start.y))[0];
  if (!nearest || start.x - nearest.x < 14) return null;
  const end = { x: nearest.x + 3, y: nearest.y },
    bend = Math.min(22, (start.x - end.x) * 0.12);
  return { end, first: { x: start.x - 35, y: start.y - bend }, last: { x: end.x + 30, y: end.y - bend } };
}
export function drawArrow(
  layer: HTMLElement,
  start: Point,
  rects: readonly DOMRect[],
  color: string,
  animate: boolean,
  delay: number,
  finding: string,
) {
  const curve = arrowCurve(start, rects);
  if (!curve) return;
  const { end, first, last } = curve,
    angle = Math.atan2(end.y - last.y, end.x - last.x),
    head = 7;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.classList.add('arrow');
  svg.dataset.finding = finding;
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('width', '100%');
  svg.setAttribute('height', String(Math.max(start.y, ...rects.map(r => r.bottom)) + 16));
  layer.append(svg);
  const path = `M ${start.x} ${start.y} C ${first.x} ${first.y}, ${last.x} ${last.y}, ${end.x} ${end.y} M ${end.x - head * Math.cos(angle - 0.5)} ${end.y - head * Math.sin(angle - 0.5)} L ${end.x} ${end.y} L ${end.x - head * Math.cos(angle + 0.5)} ${end.y - head * Math.sin(angle + 0.5)}`;
  svg.append(
    rough.svg(svg).path(path, {
      stroke: color,
      strokeWidth: 1.2,
      roughness: 0.55,
      bowing: 0.7,
      disableMultiStroke: true,
      seed: findingSeed(`${finding}:arrow`),
    }),
  );
  if (animate)
    for (const p of svg.querySelectorAll('path')) {
      const length = p.getTotalLength();
      p.style.strokeDasharray = `${length}`;
      p.style.strokeDashoffset = '0';
      p.animate([{ strokeDashoffset: String(length) }, { strokeDashoffset: '0' }], {
        duration: 420,
        delay,
        easing: 'cubic-bezier(.22,1,.36,1)',
        fill: 'backwards',
      });
    }
}
