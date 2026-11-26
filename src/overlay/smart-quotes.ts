/** English prose typography only. No dash, ellipsis or source-file rewriting. */
export function smartQuotes(text: string): string {
  // URLs and backtick-delimited examples are literal even in frontmatter prose.
  const literals: { start: number; value: string }[] = [];
  const masked = text.replace(
    /(?:https?:\/\/|www\.|mailto:)[^\s<>"`]+|(`+)[\s\S]*?\1/g,
    (value, _ticks, start: number) => {
      literals.push({ start, value });
      return 'x'.repeat(value.length);
    },
  );
  const chars = [...masked];
  // Quote substitutions preserve UTF-16 length, keeping literal ranges and AST slices exact.
  let result = '';
  for (let i = 0; i < chars.length; i++) {
    const char = chars[i];
    if (char !== "'" && char !== '"') {
      result += char;
      continue;
    }
    const before = chars[i - 1] ?? '';
    const after = chars[i + 1] ?? '';
    const previous = result.at(-1) ?? '';
    const opening = (!previous || /[\s([{“‘]/u.test(previous)) && /\S/u.test(after);
    // Contractions, possessives, abbreviated years and common leading elisions.
    const apostrophe =
      char === "'" &&
      (/[\p{L}\p{N}]/u.test(before) ||
        /^(?:\d{2}(?:s)?\b|(?:tis|twas|twere|em|cause|bout|til)\b)/i.test(chars.slice(i + 1).join('')));
    result += char === "'" ? (opening && !apostrophe ? '‘' : '’') : opening ? '“' : '”';
  }
  for (const literal of literals) {
    result = result.slice(0, literal.start) + literal.value + result.slice(literal.start + literal.value.length);
  }
  return result;
}
