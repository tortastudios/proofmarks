import { normalize } from './matcher';
export const words = (text: string) =>
  [...text.matchAll(/\S+/gu)].map(match => ({
    text: match[0],
    start: match.index,
    end: match.index + match[0].length,
  }));
export function wordDiff(before: readonly string[], after: readonly string[]) {
  const lengths = Array.from({ length: before.length + 1 }, () => new Uint16Array(after.length + 1));
  for (let i = before.length - 1; i >= 0; i--)
    for (let j = after.length - 1; j >= 0; j--)
      lengths[i]![j] =
        normalize(before[i]!) === normalize(after[j]!)
          ? 1 + lengths[i + 1]![j + 1]!
          : Math.max(lengths[i + 1]![j]!, lengths[i]![j + 1]!);
  const kept: { old: number; next: number }[] = [],
    removed: number[] = [],
    added: number[] = [];
  let i = 0,
    j = 0;
  while (i < before.length || j < after.length) {
    if (i < before.length && j < after.length && normalize(before[i]!) === normalize(after[j]!)) {
      kept.push({ old: i++, next: j++ });
    } else if (i < before.length && (j === after.length || lengths[i + 1]![j]! >= lengths[i]![j + 1]!))
      removed.push(i++);
    else added.push(j++);
  }
  return { kept, removed, added };
}
export function morphFallback({
  count,
  nextCount,
  inline,
  blocks,
  supported,
}: {
  count: number;
  nextCount: number;
  inline: boolean;
  blocks: boolean;
  supported: boolean;
}) {
  return !supported
    ? 'highlight unsupported'
    : count > 60 || nextCount > 60
      ? 'over 60 words'
      : blocks
        ? 'multiple blocks'
        : inline
          ? 'formatted inline or citation'
          : undefined;
}
type Word = { text: string; rect: DOMRect };
export type WordSnapshot = { words: Word[]; font: CSSStyleDeclaration; range: Range };
export function snapshotWords(range: Range): WordSnapshot | undefined {
  const node = range.startContainer;
  if (node.nodeType !== 3 || range.endContainer !== node) return;
  const doc = node.ownerDocument!,
    win = doc.defaultView!,
    font = win.getComputedStyle(node.parentElement!);
  const measured: Word[] = [];
  for (const token of words(range.toString())) {
    const r = doc.createRange();
    r.setStart(node, range.startOffset + token.start);
    r.setEnd(node, range.startOffset + token.end);
    const rects = [...r.getClientRects()].filter(r => r.width > 0);
    if (rects.length !== 1) return;
    const r0 = rects[0]!;
    measured.push({ text: token.text, rect: new DOMRect(r0.x + win.scrollX, r0.y + win.scrollY, r0.width, r0.height) });
  }
  return { words: measured, font, range };
}
export function prepareWords(range: Range, replacement: string) {
  const win = range.startContainer.ownerDocument!.defaultView!;
  const blocks =
    range.startContainer.parentElement?.closest('p,li,blockquote') !==
    range.endContainer.parentElement?.closest('p,li,blockquote');
  const inline =
    !!range.cloneContents().querySelector('*') ||
    range.startContainer.parentElement !== range.startContainer.parentElement?.closest('p,li,blockquote');
  const reason = morphFallback({
    count: words(range.toString()).length,
    nextCount: words(replacement).length,
    inline,
    blocks,
    supported: 'highlights' in win.CSS && 'Highlight' in win,
  });
  if (reason) return { reason };
  const snapshot = snapshotWords(range);
  return snapshot ? { snapshot } : { reason: 'split word or text nodes' };
}
/** Decorative document-space copies; the authoritative text is already at its final layout. */
export function playWords(
  parent: ShadowRoot,
  host: HTMLElement,
  before: WordSnapshot,
  after: WordSnapshot,
  done: () => void,
  measure?: (error: number) => void,
) {
  const doc = host.ownerDocument,
    win = doc.defaultView!;
  const container = doc.createElement('div');
  container.className = 'word-morph';
  container.setAttribute('aria-hidden', 'true');
  const origin = host.getBoundingClientRect();
  Object.assign(container.style, {
    position: 'absolute',
    left: `${-origin.x - win.scrollX}px`,
    top: `${-origin.y - win.scrollY}px`,
    pointerEvents: 'none',
    zIndex: '21',
  });
  parent.append(container);
  const styles = doc.createElement('style');
  styles.textContent = '::highlight(proofmarks-morph){color:transparent;text-shadow:none}';
  host.append(styles);
  const highlight = new Highlight(after.range);
  CSS.highlights.set('proofmarks-morph', highlight);
  const animations: Animation[] = [];
  const diff = wordDiff(
    before.words.map(w => w.text),
    after.words.map(w => w.text),
  );
  const pending: { span: HTMLSpanElement; word: Word; frames: Keyframe[]; options: KeyframeAnimationOptions }[] = [];
  const add = (
    word: Word,
    font: CSSStyleDeclaration,
    kind: string,
    frames: Keyframe[],
    options: KeyframeAnimationOptions,
  ) => {
    const span = doc.createElement('span');
    span.textContent = word.text;
    span.dataset.word = word.text;
    span.dataset.kind = kind;
    Object.assign(span.style, {
      position: 'absolute',
      left: `${word.rect.x}px`,
      top: `${word.rect.y}px`,
      whiteSpace: 'pre',
      font: font.font,
      fontFamily: font.fontFamily,
      fontSize: font.fontSize,
      fontWeight: font.fontWeight,
      fontStyle: font.fontStyle,
      fontStretch: font.fontStretch,
      fontVariant: font.fontVariant,
      letterSpacing: font.letterSpacing,
      lineHeight: `${word.rect.height}px`,
      color: font.color,
      textTransform: font.textTransform,
      willChange: 'transform,opacity',
    });
    if (kind === 'removed') span.style.opacity = '0';
    span.dataset.x = String(word.rect.x);
    span.dataset.y = String(word.rect.y);
    container.append(span);
    pending.push({ span, word, frames, options });
  };
  const ease = 'cubic-bezier(.22,1,.36,1)';
  for (const pair of diff.kept) {
    const a = before.words[pair.old]!,
      b = after.words[pair.next]!;
    add(
      b,
      after.font,
      'kept',
      [
        { transform: `translate3d(${a.rect.x - b.rect.x}px,${a.rect.y - b.rect.y}px,0)` },
        { transform: 'translate3d(0,0,0)' },
      ],
      { duration: 200, easing: ease },
    );
  }
  for (const index of diff.removed)
    add(before.words[index]!, before.font, 'removed', [{ opacity: 1 }, { opacity: 0 }], {
      duration: 120,
      easing: ease,
    });
  for (const index of diff.added)
    add(
      after.words[index]!,
      after.font,
      'added',
      [
        { opacity: 0, transform: 'translate3d(0,3px,0)' },
        { opacity: 1, transform: 'translate3d(0,0,0)' },
      ],
      { duration: 160, delay: 40, fill: 'backwards', easing: ease },
    );
  // Batch writes, glyph-box reads, then corrections; never force layout once per word.
  const corrections = pending.map(({ span, word }) => {
    const range = doc.createRange();
    range.selectNodeContents(span);
    const rect = range.getBoundingClientRect();
    return { x: word.rect.x - rect.x - win.scrollX, y: word.rect.y - rect.y - win.scrollY };
  });
  pending.forEach(({ span, word, frames, options }, index) => {
    const correction = corrections[index]!;
    span.style.left = `${word.rect.x + correction.x}px`;
    span.style.top = `${word.rect.y + correction.y}px`;
    animations.push(span.animate(frames, options));
  });
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    for (const animation of animations) animation.cancel();
    if (measure) {
      let error = 0;
      for (const span of container.querySelectorAll<HTMLElement>('[data-kind]:not([data-kind=removed])')) {
        const range = doc.createRange();
        range.selectNodeContents(span);
        const rect = range.getBoundingClientRect();
        error = Math.max(
          error,
          Math.abs(rect.x + win.scrollX - Number(span.dataset.x)),
          Math.abs(rect.y + win.scrollY - Number(span.dataset.y)),
        );
      }
      measure(error);
    }
    if (CSS.highlights.get('proofmarks-morph') === highlight) CSS.highlights.delete('proofmarks-morph');
    container.remove();
    styles.remove();
    done();
  };
  void Promise.all(animations.map(animation => animation.finished)).then(finish, () => {});
  return finish;
}
