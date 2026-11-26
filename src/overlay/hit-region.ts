export type HitRect = { left: number; right: number; top: number; bottom: number };

/** One union per finding. Inline fragments share a row; neighboring rows meet
 * halfway through the line gap without making the ragged edge a large box. */
export function findingHitRegion(rects: readonly HitRect[]): HitRect[] {
  const rows: HitRect[] = [];
  for (const rect of [...rects].sort((a, b) => a.top - b.top || a.left - b.left)) {
    const row = rows.find(row => Math.min(row.bottom, rect.bottom) > Math.max(row.top, rect.top));
    if (row) {
      row.left = Math.min(row.left, rect.left);
      row.right = Math.max(row.right, rect.right);
      row.top = Math.min(row.top, rect.top);
      row.bottom = Math.max(row.bottom, rect.bottom);
    } else rows.push({ ...rect, left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom });
  }
  return rows.map((row, i) => {
    const previous = rows[i - 1],
      next = rows[i + 1];
    const before = previous ? Math.max(0, row.top - previous.bottom) / 2 : 0;
    const after = next ? Math.max(0, next.top - row.bottom) / 2 : 0;
    return { ...row, top: row.top - before, bottom: row.bottom + after };
  });
}

export const containsPoint = (rect: HitRect, x: number, y: number) =>
  x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
