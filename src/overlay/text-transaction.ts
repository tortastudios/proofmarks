import { distributeReplacement } from './text-distribution';
/** Snapshot every endpoint before writing: live Range offsets collapse on nodeValue changes. */
export function replaceRangeText(segments: readonly Range[], replacement: string) {
  const distributed = distributeReplacement(
    segments.map(range => (range.startContainer.nodeValue ?? '').slice(range.startOffset, range.endOffset)),
    replacement,
  );
  const edits = segments.map((range, index) => {
    const node = range.startContainer as Text;
    if (node.nodeType !== 3 || range.endContainer !== node) throw new Error('Expected text-only range segments.');
    const before = node.nodeValue ?? '';
    return {
      node,
      before,
      start: range.startOffset,
      length: distributed[index]!.length,
      after: before.slice(0, range.startOffset) + distributed[index] + before.slice(range.endOffset),
    };
  });
  for (const { node, after } of edits) node.nodeValue = after;
  return {
    range() {
      const first = edits[0]!;
      const range = first.node.ownerDocument.createRange();
      range.setStart(first.node, first.start);
      const last = edits.at(-1)!;
      range.setEnd(last.node, last.start + last.length);
      return range;
    },
    rollback() {
      for (const { node, before, after } of edits) if (node.nodeValue === after) node.nodeValue = before;
    },
  };
}

/** Apply every rendered copy in the same turn, rolling back the whole group on failure. */
export function replaceTextCopies(copies: readonly { segments: readonly Range[]; replacement: string }[]) {
  const transactions: ReturnType<typeof replaceRangeText>[] = [];
  try {
    for (const copy of copies) transactions.push(replaceRangeText(copy.segments, copy.replacement));
  } catch (error) {
    for (const transaction of transactions.reverse()) transaction.rollback();
    throw error;
  }
  return {
    primary: transactions[0],
    rollback() {
      for (const transaction of [...transactions].reverse()) transaction.rollback();
    },
  };
}
