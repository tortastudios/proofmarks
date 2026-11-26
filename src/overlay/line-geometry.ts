export type TextRect = { left: number; right: number; top: number; bottom: number };
/** Inline font metrics vary; substantial vertical overlap identifies the same line. */
export function mergeLineRects(rects: readonly TextRect[]) {
  const lines: TextRect[] = [];
  for (const rect of [...rects].sort((a, b) => a.top - b.top || a.left - b.left)) {
    const line = lines.find(
      l =>
        Math.min(l.bottom, rect.bottom) - Math.max(l.top, rect.top) >=
        Math.min(l.bottom - l.top, rect.bottom - rect.top) * 0.6,
    );
    if (line) {
      line.left = Math.min(line.left, rect.left);
      line.right = Math.max(line.right, rect.right);
      line.top = Math.min(line.top, rect.top);
      line.bottom = Math.max(line.bottom, rect.bottom);
    } else lines.push({ left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom });
  }
  return lines.sort((a, b) => a.top - b.top || a.left - b.left);
}
