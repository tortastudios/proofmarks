import { entities } from './entities';
import { sourceRegions, metaRegions } from '../overlay/source-regions.mjs';
export type Format = 'markdown' | 'mdx' | 'html' | 'jinja';
export type Span = { start: number; end: number };
export type Region = Span & {
  text: string;
  kind: 'body' | 'meta';
  field?: string;
  editable: boolean;
  starts?: number[];
  ends?: number[];
};
export type ContentAdapter = {
  regions(source: string): Region[];
  apply(source: string, span: Span, replacement: string, options?: { sourceText?: boolean }): string;
};

const encode = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function decoded(raw: string, offset: number) {
  let text = '';
  const starts: number[] = [],
    ends: number[] = [];
  for (let i = 0; i < raw.length;) {
    const entity = /^&(#x[\da-f]+|#\d+|[a-z][\da-z]+);/i.exec(raw.slice(i));
    let value: string | undefined;
    if (entity) {
      const name = entity[1]!;
      const point =
        name[0] === '#'
          ? name[1]?.toLowerCase() === 'x'
            ? parseInt(name.slice(2), 16)
            : parseInt(name.slice(1), 10)
          : NaN;
      value = Number.isFinite(point) && point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : entities[name];
    }
    const length = value && entity ? entity[0].length : 1;
    value ??= raw[i]!;
    text += value;
    for (let j = 0; j < value.length; j++) {
      starts.push(offset + i);
      ends.push(offset + i + length);
    }
    i += length;
  }
  return { text, starts, ends };
}
function htmlRegions(source: string, jinja: boolean): Region[] {
  const regions: Region[] = [];
  // Tokens retain offsets; quoted attributes may contain > and template expressions.
  const tokens =
    /<!--[\s\S]*?(?:-->|$)|<(script|style|template)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)|<![^>]*>|<\/?[a-z][^>"']*(?:(?:"[^"]*"|'[^']*')[^>"']*)*>|{{[\s\S]*?}}|{%[\s\S]*?%}|{#[\s\S]*?#}/gi;
  let cursor = 0;
  const add = (start: number, end: number, editable: boolean) => {
    if (end > start) regions.push({ start, end, ...decoded(source.slice(start, end), start), kind: 'body', editable });
  };
  for (const token of source.matchAll(tokens)) {
    const start = token.index;
    if (!jinja && /^\{/.test(token[0])) continue;
    add(cursor, start, true);
    if (/^\{/.test(token[0])) add(start, start + token[0].length, false);
    cursor = start + token[0].length;
  }
  add(cursor, source.length, true);
  return regions;
}
const markdown: ContentAdapter = {
  regions(source) {
    const body = sourceRegions(source)[0]!;
    return [
      { start: body.offset, end: body.offset + body.text.length, text: body.text, kind: 'body', editable: true },
      ...metaRegions(source).map(r => ({
        start: r.offset,
        end: r.offset + r.text.length,
        text: r.text,
        kind: 'meta' as const,
        field: r.target.field,
        editable: true,
      })),
    ];
  },
  apply(source, span, replacement) {
    if (!this.regions(source).some(r => r.editable && span.start >= r.start && span.end <= r.end))
      throw new Error('This source span is not editable.');
    return source.slice(0, span.start) + replacement + source.slice(span.end);
  },
};
function html(jinja: boolean): ContentAdapter {
  return {
    regions: source => htmlRegions(source, jinja),
    apply(source, span, replacement, options) {
      if (!this.regions(source).some(r => r.editable && span.start >= r.start && span.end <= r.end))
        throw new Error('This match crosses markup or a template expression and cannot be edited.');
      const encoded = options?.sourceText
        ? replacement
        : jinja
          ? encode(replacement).replace(/\{/g, '&#123;').replace(/\}/g, '&#125;')
          : encode(replacement);
      return source.slice(0, span.start) + encoded + source.slice(span.end);
    },
  };
}
const adapters = { markdown, mdx: markdown, html: html(false), jinja: html(true) };
export function adapterFor(format: Format): ContentAdapter {
  return adapters[format];
}
export function inferFormat(file: string): Format {
  return /\.mdx$/i.test(file) ? 'mdx' : /\.md$/i.test(file) ? 'markdown' : /\.html?$/i.test(file) ? 'html' : 'jinja';
}
/** Matching preserves encoded source offsets and refuses ambiguous or masked spans. */
export function matchRegion(source: string, match: string, format: Format): Span {
  const normalize = (text: string) => text.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim();
  const needle = normalize(match);
  if (!needle) throw new Error('The match is empty.');
  const matches: Span[] = [];
  for (const region of adapterFor(format)
    .regions(source)
    .filter(r => r.editable && r.kind === 'body')) {
    let text = '';
    const starts: number[] = [],
      ends: number[] = [];
    for (let i = 0; i < region.text.length; i++) {
      let char = region.text[i]!.replace(/[‘’]/g, "'").replace(/[“”]/g, '"');
      if (/\s/.test(char)) char = ' ';
      if (char === ' ' && text.endsWith(' ')) {
        ends[ends.length - 1] = region.ends?.[i] ?? region.start + i + 1;
        continue;
      }
      text += char;
      starts.push(region.starts?.[i] ?? region.start + i);
      ends.push(region.ends?.[i] ?? region.start + i + 1);
    }
    let index = text.indexOf(needle);
    while (index >= 0) {
      matches.push({ start: starts[index]!, end: ends[index + needle.length - 1]! });
      index = text.indexOf(needle, index + 1);
    }
  }
  if (matches.length !== 1)
    throw new Error(
      matches.length
        ? 'The source match is ambiguous (more than once).'
        : 'This match is unavailable or crosses markup or a template expression and cannot be edited.',
    );
  return matches[0]!;
}
