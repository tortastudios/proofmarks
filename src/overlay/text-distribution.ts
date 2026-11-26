import { wordDiff } from './word-morph';
/** Preserve surviving inline text in its original node so React can reconcile it. */
export function distributeReplacement(pieces: readonly string[], replacement: string) {
  const before = pieces.join(''),
    tokenize = (text: string) =>
      [...text.matchAll(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*|\s+|[^\p{L}\p{N}\s]/gu)].map(m => ({
        text: m[0],
        start: m.index,
      }));
  const old = tokenize(before),
    next = tokenize(replacement),
    anchors = new Map(
      wordDiff(
        old.map(t => t.text),
        next.map(t => t.text),
      ).kept.map(pair => [pair.next, pair.old]),
    );
  const ends: number[] = [];
  pieces.reduce((offset, piece) => {
    ends.push(offset + piece.length);
    return offset + piece.length;
  }, 0);
  const output = pieces.map(() => '');
  let segment = 0;
  for (const [index, token] of next.entries()) {
    const anchor = anchors.get(index),
      original = anchor === undefined ? undefined : old[anchor];
    for (let i = 0; i < token.text.length; i++) {
      if (original) {
        const position =
          original.start +
          Math.min(original.text.length - 1, Math.floor((i * original.text.length) / token.text.length));
        while (segment < ends.length - 1 && position >= ends[segment]!) segment++;
      }
      output[segment] = (output[segment] ?? '') + token.text[i];
    }
  }
  return output;
}
