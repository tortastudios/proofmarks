/** Keep delimiters out of both searchable regions; offsets are file-absolute. */
export function sourceRegions(source) {
  const opening = /^\uFEFF?---[^\S\r\n]*\r?\n/.exec(source);
  if (!opening) return [{ text: source, offset: 0 }];
  const rest = source.slice(opening[0].length),
    closing = /^---[^\S\r\n]*(?:\r?\n|$)/m.exec(rest);
  if (!closing) return [{ text: source, offset: 0 }];
  const end = opening[0].length + closing.index,
    body = end + closing[0].length;
  return [
    { text: source.slice(body), offset: body },
    { text: source.slice(opening[0].length, end), offset: opening[0].length },
  ];
}
export const normalizeSource = text => text.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim();
/** Select once for an original/rewrite family so metadata cannot mask body state. */
export function preferredRegion(source, needles, exact = false) {
  const regions = sourceRegions(source),
    normalize = exact ? text => text : normalizeSource;
  return (
    regions.find(r => needles.some(n => n && normalize(n) && normalize(r.text).includes(normalize(n)))) ??
    regions[0] ?? { text: source, offset: 0 }
  );
}
export function occurrencesInRegion(text, needle) {
  const n = normalizeSource(needle ?? '');
  if (!n) return 0;
  const haystack = normalizeSource(text);
  let count = 0,
    at = haystack.indexOf(n);
  while (at >= 0) {
    count++;
    at = haystack.indexOf(n, at + 1);
  }
  return count;
}

/** Exact scalar spans, never keys/comments/delimiters. Unsupported YAML fails closed. */
/** @returns {{target: import("./types").ProofmarksTarget, text:string, offset:number, quote:string}[]} */
export function metaRegions(source) {
  const front = sourceRegions(source)[1];
  if (!front) return [];
  const lines = [...front.text.matchAll(/[^\r\n]*(?:\r?\n|$)/g)],
    regions = [];
  let field,
    index = 0;
  for (const line of lines) {
    const raw = line[0].replace(/\r?\n$/, ''),
      key = /^(description|summary|takeaways):\s*(.*)$/.exec(raw);
    if (key) {
      field = key[1];
      index = 0;
    } else if (/^\S/.test(raw) && !raw.startsWith('#')) field = undefined;
    let value, start, target;
    if (key && field !== 'takeaways') {
      value = key[2];
      start = raw.length - value.length;
      target = { kind: 'meta', field };
    } else if (field === 'takeaways') {
      const item = /^\s+-\s+(.*)$/.exec(raw);
      if (!item) continue;
      value = item[1];
      start = raw.length - value.length;
      target = { kind: 'meta', field, index: index++ };
    } else continue;
    if (!value || /^[>|&*!\[{]/.test(value)) continue;
    let quote = '';
    if (value[0] === '"' || value[0] === "'") {
      quote = value[0];
      const end =
        quote === '"' ? /^"(?:[^"\\]|\\.)*"/.exec(value)?.[0].length : /^'(?:[^']|'')*'/.exec(value)?.[0].length;
      if (!end || !/^\s*(?:#.*)?$/.test(value.slice(end))) continue;
      value = value.slice(1, end - 1);
      start++;
    } else {
      value = value.replace(/\s+#.*$/, '').trimEnd();
    }
    regions.push({ target, text: value, offset: front.offset + line.index + start, quote });
  }
  return regions;
}
export const sameTarget = (a, b) => a?.kind === b?.kind && a?.field === b?.field && a?.index === b?.index;
export function metaRegion(source, target) {
  const matches = metaRegions(source).filter(r => sameTarget(r.target, target));
  if (matches.length !== 1 || !matches[0]) throw Error('Metadata field is missing or ambiguous.');
  return matches[0];
}
export function findingTarget(source, finding) {
  if (finding.target) return finding.target;
  const needles = [finding.match, finding.before, finding.after, finding.proposed].filter(Boolean),
    regions = sourceRegions(source);
  if (!regions[1] || needles.some(n => occurrencesInRegion(regions[0].text, n))) return undefined;
  const descriptions = metaRegions(source).filter(
    r => r.target.field === 'description' && needles.some(n => occurrencesInRegion(r.text, n)),
  );
  return descriptions.length === 1 ? descriptions[0].target : undefined;
}
export function findingRegion(source, finding, exact = false) {
  const target = findingTarget(source, finding);
  return target
    ? metaRegion(source, target)
    : finding.edits?.length
      ? (sourceRegions(source)[0] ?? { text: source, offset: 0 })
      : preferredRegion(source, [finding.match, finding.before, finding.proposed, finding.after], exact);
}
export function hiddenCopies(source, finding) {
  if (findingTarget(source, finding)) return [];
  const text = finding.before ?? finding.match;
  if (!text) return [];
  return metaRegions(source)
    .filter(r => {
      const at = r.text.indexOf(text);
      return at >= 0 && r.text.indexOf(text, at + 1) < 0;
    })
    .map(r => r.target);
}
