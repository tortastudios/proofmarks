export type MarginLabel = {
  id: string;
  anchor: number;
  anchorLeft?: number;
  anchorBottom?: number;
  left: number;
  width: number;
  height: number;
  rank?: number;
};
/** A static column in reading order; every label reserves space, even off screen. */
export function layoutMarginLabels(labels: readonly MarginLabel[], gap = 6) {
  const rows: MarginLabel[][] = [];
  for (const label of [...labels].sort((a, b) => a.anchor - b.anchor)) {
    const row = rows.at(-1);
    if (row && Math.abs(label.anchor - row[0]!.anchor) < 1) row.push(label);
    else rows.push([label]);
  }
  let bottom = -Infinity;
  const ordered = rows.flatMap(row => row.sort((a, b) => (a.anchorLeft ?? a.left) - (b.anchorLeft ?? b.left)));
  const left = ordered[0]?.left ?? 0;
  return ordered.map(label => {
    const top = Math.max(label.anchor, bottom + gap);
    bottom = top + label.height;
    return { ...label, left, top };
  });
}

/** Marks whose first line starts at the same height share a row: lower rank first (open proofs before decided ones), then left to right. */
export function lineRows<T extends { anchor: number; anchorLeft?: number; left?: number; rank?: number }>(
  labels: readonly T[],
) {
  const rows: T[][] = [];
  for (const label of [...labels].sort((a, b) => a.anchor - b.anchor)) {
    const row = rows.at(-1);
    if (row && Math.abs(label.anchor - row[0]!.anchor) < 1) row.push(label);
    else rows.push([label]);
  }
  return rows.map(row =>
    row.sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0) || (a.anchorLeft ?? a.left ?? 0) - (b.anchorLeft ?? b.left ?? 0)),
  );
}
export type LineLabel = MarginLabel & { top: number; count?: number; head?: string; hidden?: boolean };
/**
 * One label per line: marks on the same line share the first one's label, which counts the rest
 * ("Puffery +3"); the others are hidden and lead from it. Lines stack in the static column and never move.
 */
export function layoutLineLabels(labels: readonly MarginLabel[], gap = 6): LineLabel[] {
  const rows = lineRows(labels),
    heads = new Map(
      layoutMarginLabels(
        rows.map(row => row[0]!),
        gap,
      ).map(head => [head.id, head]),
    );
  return rows.flatMap(row => {
    const head = heads.get(row[0]!.id)!;
    return row.map((label, i): LineLabel =>
      i ? { ...label, left: head.left, top: head.top, hidden: true, head: head.id } : { ...head, count: row.length },
    );
  });
}
/** A shared label carries its +N, so it may use more of the rail than one label to stay on one line. */
export const lineLabelWidth = (rail: number) => Math.max(0, Math.min(200, rail));

/** Existing marginalia reserves the outer rail; otherwise use the prose gutter. */
export const marginLabelLeft = (contentRight: number, hasMarginalia: boolean, viewportWidth: number) =>
  Math.max(contentRight + 8, hasMarginalia ? viewportWidth - 164 : contentRight + 8);
