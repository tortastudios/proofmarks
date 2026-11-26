import { smartQuotes } from './smart-quotes';

/** Shared reader-text projection for cards, DOM anchors and optimistic display; never source writes. */
export function readerText(source: string): string {
  const literals: string[] = [];
  source = source.replace(
    /\\([\x21-\x2f\x3a-\x40\x5b-\x60\x7b-\x7e])|(`+)([\s\S]*?)\2/g,
    (_match, escaped: string | undefined, _ticks: string, code: string) => {
      let literal = escaped ?? code.replace(/\r?\n/g, ' ');
      if (escaped === undefined && /^ .* $/.test(literal) && /\S/.test(literal)) literal = literal.slice(1, -1);
      literals.push(literal);
      return `\uE000${literals.length - 1}\uE001`;
    },
  );
  // Walk balanced destinations so a URL containing parentheses cannot leak into prose.
  let text = '';
  for (let i = 0; i < source.length;) {
    if (source[i] === '[') {
      let labelEnd = i + 1,
        depth = 1;
      for (; labelEnd < source.length; labelEnd++) {
        if (source[labelEnd] === '\\') {
          labelEnd++;
          continue;
        }
        if (source[labelEnd] === '[') depth++;
        if (source[labelEnd] === ']' && !--depth) break;
      }
      if (depth === 0 && source[labelEnd + 1] === '(') {
        let end = labelEnd + 2,
          nesting = 1;
        for (; end < source.length; end++) {
          if (source[end] === '\\') {
            end++;
            continue;
          }
          if (source[end] === '(') nesting++;
          if (source[end] === ')' && !--nesting) break;
        }
        if (nesting === 0) {
          text += readerText(source.slice(i + 1, labelEnd));
          i = end + 1;
          continue;
        }
      }
    }
    text += source[i++];
  }
  // Keep escaped punctuation and code literal while removing paired emphasis only.
  for (let i = 0; i < 4; i++)
    text = text
      .replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, '$2')
      .replace(/\*(?=\S)([^*]*?\S)\*/g, '$1')
      .replace(/(?<![\p{L}\p{N}])_(?=\S)([^_]*?\S)_(?![\p{L}\p{N}])/gu, '$1');
  return smartQuotes(text).replace(/\uE000(\d+)\uE001/g, (match, n: string) => literals[Number(n)] ?? match);
}

export const cardProse = readerText;
