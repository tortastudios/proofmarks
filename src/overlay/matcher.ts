import { readerText } from './card-prose';
import type { ProofmarksFinding } from './types';
export function normalize(text: string) {
  return text.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim();
}
export function matchVariants(text: string) {
  const plain = readerText(text);
  const withoutCitations = text.replace(/ \(\[[^\]]+\]\(https?:\/\/[^\s]+\), [^)]*\)/g, '');
  return [...new Set([normalize(plain), normalize(readerText(withoutCitations))])];
}
/**
 * The text an accepted finding left on the page. An opener's deletion writes the capitalized next word, so
 * when the proposal is empty, the recorded text is what's there.
 */
export function acceptedText(finding: ProofmarksFinding) {
  return finding.proposed?.trim() ? finding.proposed : (finding.after ?? finding.proposed ?? finding.match);
}
/**
 * Where an accepted deletion's gap is in a page's text: the end of its left context meeting the start of its
 * right, read as the reader sees them. The source can differ from the page in markup, so shorter contexts are tried until
 * one meets exactly once. -1 when none does.
 */
const plain = (value: string) => readerText(value).replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ');
export function deletionGap(text: string, context: { left: string; right: string }) {
  const left = plain(context.left),
    right = left.endsWith(' ') ? plain(context.right).replace(/^ /, '') : plain(context.right);
  for (const [l, r] of [
    [24, 24],
    [12, 12],
    [0, 16],
    [16, 0],
  ] as const) {
    const before = l ? left.slice(-l) : '',
      after = r ? right.slice(0, r) : '',
      needle = before + after;
    if (needle.trim().length < 6) continue;
    const at = text.indexOf(needle);
    if (at >= 0 && text.indexOf(needle, at + 1) < 0) return at + before.length;
  }
  return -1;
}
/**
 * Where an accepted rewrite is in a page's text: its text between the end of its left context and the start
 * of its right, read as the reader sees them, so ", but" isn't found in an earlier "Not X, but Y". Shorter contexts are
 * tried until one fits exactly once. Undefined when none does.
 */
export function rewriteAt(text: string, edit: { after: string; context: { left: string; right: string } }) {
  const left = plain(edit.context.left),
    middle = left.endsWith(' ') ? plain(edit.after).replace(/^ /, '') : plain(edit.after),
    right = (middle || left).endsWith(' ') ? plain(edit.context.right).replace(/^ /, '') : plain(edit.context.right);
  const lead = /^ */.exec(middle)![0].length,
    trail = / *$/.exec(middle)![0].length;
  if (lead === middle.length) return undefined;
  for (const [l, r] of [
    [24, 24],
    [12, 12],
    [0, 16],
    [16, 0],
  ] as const) {
    const before = l ? left.slice(-l) : '',
      after = r ? right.slice(0, r) : '';
    if (!(before + after).trim()) continue;
    const needle = before + middle + after,
      at = text.indexOf(needle);
    if (at >= 0 && text.indexOf(needle, at + 1) < 0)
      return { start: at + before.length + lead, end: at + before.length + middle.length - trail };
  }
  return undefined;
}
export const skipSelector =
  'script,style,pre,svg,button,input,textarea,select,figure,[role="button"],[role="slider"],[aria-hidden="true"],[hidden],[id^="cite-"],[data-proofmarks]';
export type TextPoint = { node: Text; offset: number };
const curly: Record<string, string> = { '‘': "'", '’': "'", '“': '"', '”': '"' };
const space = /\s/;
/** One normalized character maps back to both original DOM endpoints. */
export function indexText(nodes: readonly Text[]) {
  let text = '',
    previous = '';
  const starts: TextPoint[] = [],
    ends: TextPoint[] = [];
  for (const node of nodes) {
    const value = node.textContent ?? '';
    for (let offset = 0; offset < value.length; offset++) {
      let char = value[offset]!;
      char = curly[char] ?? char;
      if (space.test(char)) char = ' ';
      if (char === ' ' && previous === ' ') {
        ends[ends.length - 1] = { node, offset: offset + 1 };
        continue;
      }
      text += char;
      previous = char;
      starts.push({ node, offset });
      ends.push({ node, offset: offset + 1 });
    }
  }
  return { text, starts, ends };
}
export function findProofmarks(root: HTMLElement, findings: readonly ProofmarksFinding[]) {
  const doc = root.ownerDocument;
  const walker = doc.createTreeWalker(root, 4);
  const nodes: Text[] = [];
  const metadata = new Map<Element, Text[]>();
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const parent = node.parentElement;
    if (!parent || parent.closest(skipSelector) || !parent.checkVisibility({ checkVisibilityCSS: true })) continue;
    const meta = parent.closest('[data-proofmarks-meta]');
    if (meta) {
      const group = metadata.get(meta) ?? [];
      group.push(node as Text);
      metadata.set(meta, group);
    } else nodes.push(node as Text);
  }

  // One index per run of text, shared by every finding in it: indexing the page once per finding was most of the
  // time it took to draw the marks.
  const indexes = new Map<readonly Text[], ReturnType<typeof indexText>>();
  const indexOf = (texts: readonly Text[]) => {
    let index = indexes.get(texts);
    if (!index) {
      index = indexText(texts);
      indexes.set(texts, index);
    }
    return index;
  };
  return findings
    .filter(finding => finding.status !== 'dismissed' && finding.status !== 'superseded')
    .map(finding => {
      const target = finding.target;
      const regions = target
        ? [...metadata]
            .filter(
              ([element]) =>
                element.getAttribute('data-proofmarks-meta') === target.field &&
                (target.index === undefined ||
                  element.getAttribute('data-proofmarks-meta-index') === String(target.index)),
            )
            .map(([, texts]) => texts)
        : [nodes];
      const accepted = finding.status === 'accepted' || finding.status === 'accepted-unrecorded',
        shown = accepted ? acceptedText(finding) : finding.match;
      if (accepted && !shown.trim()) {
        // Nothing was left: the mark goes at the gap, on the letter after it, or after the letter before it when the gap
        // ends a sentence or the text.
        const context = finding.edits?.find(edit => !edit.target && !edit.after)?.context;
        if (!context) return { finding, range: null };
        for (const nodes of regions) {
          const index = indexOf(nodes),
            gap = deletionGap(index.text, context);
          if (gap < 0) continue;
          // The source says whether the gap ends a sentence or paragraph; the page's spacing between blocks can't.
          const ends = !/^\S/.test(context.right),
            at = ends && gap > 0 ? gap - 1 : gap,
            first = index.starts[at],
            last = index.ends[at];
          if (!first || !last) continue;
          const range = doc.createRange();
          range.setStart(first.node, first.offset);
          range.setEnd(last.node, last.offset);
          return { finding, range, segments: [range], gapAfter: at < gap };
        }
        return { finding, range: null };
      }
      // [start, end) of a run's index text as a range, and one segment per text node it crosses.
      const placed = (nodes: readonly Text[], index: ReturnType<typeof indexText>, start: number, end: number) => {
        const first = index.starts[start],
          last = index.ends[end - 1];
        if (!first || !last) return undefined;
        const range = doc.createRange();
        range.setStart(first.node, first.offset);
        range.setEnd(last.node, last.offset);
        const segments: Range[] = [];
        for (const node of nodes.slice(nodes.indexOf(first.node), nodes.indexOf(last.node) + 1)) {
          const segment = doc.createRange();
          segment.setStart(node, node === first.node ? first.offset : 0);
          segment.setEnd(node, node === last.node ? last.offset : node.length);
          segments.push(segment);
        }
        return { range, segments };
      };
      // An accepted rewrite is where its recorded context puts it, when the context still fits.
      const edit = accepted ? finding.edits?.find(edit => !edit.target && edit.after && edit.context) : undefined;
      if (edit?.context)
        for (const nodes of regions) {
          const index = indexOf(nodes),
            at = rewriteAt(index.text, { after: edit.after, context: edit.context });
          const match = at && placed(nodes, index, at.start, at.end);
          if (match) return { finding, ...match };
        }
      for (const nodes of regions) {
        const index = indexOf(nodes);
        for (const candidate of matchVariants(shown)) {
          const start = index.text.indexOf(candidate);
          if (!candidate || start < 0) continue;
          const match = placed(nodes, index, start, start + candidate.length);
          if (match) return { finding, ...match };
        }
      }
      return { finding, range: null };
    });
}

/** Element ranges include inline ancestors and out-of-flow citations; text ranges do not. */
export function findingRects(match: ReturnType<typeof findProofmarks>[number]) {
  return (match.segments ?? []).flatMap(segment => [...segment.getClientRects()]);
}
export function visibleTextRects(root: HTMLElement) {
  const doc = root.ownerDocument,
    walker = doc.createTreeWalker(root, 4);
  const rects: DOMRect[] = [];
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const parent = node.parentElement;
    if (
      !node.textContent?.trim() ||
      !parent ||
      parent.closest('script,style,[hidden],[aria-hidden="true"],[data-proofmarks]') ||
      !parent.checkVisibility({ checkVisibilityCSS: true, checkOpacity: true })
    )
      continue;
    const range = doc.createRange();
    range.selectNodeContents(node);
    rects.push(
      ...[...range.getClientRects()].filter(
        r => r.width > 1 && r.height > 1 && r.bottom > 76 && r.top < innerHeight - 75,
      ),
    );
  }
  return rects;
}
