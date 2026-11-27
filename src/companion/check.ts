import { readdir, readFile, stat } from 'node:fs/promises';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { adapterFor, inferFormat, matchRegion, type Format } from '../adapters/index';
import { detect } from '../detect/index';
import type { JudgeProvider } from '../judge/types';
import { registeredReview } from './detector';
import type { Strictness } from './strictness';
import { projectRelative } from './paths';

/**
 * proofmarks check: marks without the page, for CI and bulk runs such as programmatic SEO pages. Files,
 * folders, globs and URLs; nothing is saved. A URL's page is fetched and only its main content is judged.
 */
export type CheckedMark = {
  rule: string;
  label: string;
  match: string;
  note: string;
  line?: number;
  column?: number;
  probability?: number;
};
export type Checked = { target: string; marks: CheckedMark[]; error?: string };

const DOCUMENT = /\.(?:md|mdx|html?|jinja2?|j2|njk|nunjucks|twig|liquid)$/i;
const SKIP = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'out',
  '.next',
  '.astro',
  '.proofmarks',
  'vendor',
  'venv',
  '.venv',
  '__pycache__',
]);
const isUrl = (value: string) => /^https?:\/\//i.test(value);

async function walk(directory: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || SKIP.has(entry.name)) continue;
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(full)));
    else if (entry.isFile() && DOCUMENT.test(entry.name)) files.push(full);
  }
  return files.sort();
}

/** Files, folders (searched for documents), globs your shell didn't expand, and URLs, in order and without repeats. */
export async function expandTargets(args: string[], cwd = process.cwd()) {
  const targets: string[] = [];
  for (const arg of args) {
    if (isUrl(arg)) {
      targets.push(arg);
      continue;
    }
    const absolute = path.resolve(cwd, arg);
    const info = await stat(absolute).catch(() => undefined);
    if (info?.isDirectory()) targets.push(...(await walk(absolute)));
    else if (info?.isFile()) targets.push(absolute);
    else if (/[*?[]/.test(arg) && typeof fs.glob === 'function') {
      for await (const match of fs.glob(arg, { cwd })) if (DOCUMENT.test(match)) targets.push(path.resolve(cwd, match));
    } else throw new Error(`Nothing to check at ${arg}.`);
  }
  return [...new Set(targets)];
}

/** A page's main content: its <main>, else its <article>, else its <body>, without scripts, navigation or footers. */
export function mainContent(html: string) {
  const pick = (tag: string) => new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*)</${tag}>`, 'i').exec(html)?.[1];
  const content = pick('main') ?? pick('article') ?? pick('body') ?? html;
  return content.replace(/<(script|style|noscript|svg|nav|header|footer|aside|form|template)\b[\s\S]*?<\/\1>/gi, '');
}

const position = (source: string, offset: number) => {
  const before = source.slice(0, offset).split('\n');
  return { line: before.length, column: before.at(-1)!.length + 1 };
};

export async function checkTarget(
  target: string,
  provider: JudgeProvider,
  options: {
    cacheDir?: string;
    signal?: AbortSignal;
    fetch?: typeof fetch;
    cwd?: string;
    /** Inside a project, its learned lines, so a check marks what the page would. */
    strictness?: (bases: Record<string, number>) => Promise<Strictness[]>;
    /** Inside a project, the rules its config turns on or off. */
    rules?: Record<string, boolean>;
  } = {},
): Promise<Checked> {
  const cwd = options.cwd ?? process.cwd();
  const shown = isUrl(target) ? target : projectRelative(cwd, target) || target;
  try {
    let source: string, format: Format;
    if (isUrl(target)) {
      const response = await (options.fetch ?? fetch)(target, {
        signal: AbortSignal.timeout(20000),
        headers: { accept: 'text/html' },
      });
      if (!response.ok) throw new Error(`The page answered ${response.status}.`);
      source = mainContent(await response.text());
      format = 'html';
    } else {
      source = await readFile(target, 'utf8');
      format = inferFormat(target);
    }
    const markup = format === 'html' || format === 'jinja';
    const text = markup
      ? adapterFor(format)
          .regions(source)
          .filter(region => region.editable && region.kind === 'body')
          .map(region => region.text)
          .join('\n\n')
      : source;
    const review = await registeredReview(detect, text, shown, provider, {
      cacheDir: options.cacheDir,
      signal: options.signal,
      kind: markup ? 'text' : 'mdx',
      strictness: options.strictness,
      rules: options.rules,
    });
    const labels = new Map(review.rules.map(rule => [rule.id, rule.label]));
    const marks = review.findings.map(finding => {
      let at: { line: number; column: number } | undefined;
      // A URL's main content isn't a file anyone edits, so its marks have no line.
      if (!isUrl(target)) {
        try {
          at = position(source, markup ? matchRegion(source, finding.match, format).start : finding.span.start);
        } catch {
          /* A match that crosses markup has no single place in the source. */
        }
      }
      return {
        rule: finding.rule,
        label: labels.get(finding.rule) ?? finding.rule,
        match: finding.match,
        note: finding.note ?? '',
        ...at,
        ...(finding.judge?.probability !== undefined ? { probability: finding.judge.probability } : {}),
      };
    });
    return { target: shown, marks };
  } catch (error) {
    return { target: shown, marks: [], error: (error as Error).message };
  }
}

const quoteText = (text: string) => `"${text.replace(/\s+/g, ' ').trim()}"`;
/** The report's format: what the command asks for, else GitHub annotations in GitHub Actions, else text. */
export function checkFormat(given: string | undefined, json: boolean, env: NodeJS.ProcessEnv = process.env) {
  if (json) return 'json';
  return given ?? (env.GITHUB_ACTIONS === 'true' ? 'github' : 'text');
}

export function textReport(results: Checked[]) {
  const lines: string[] = [];
  for (const result of results) {
    if (result.error) {
      lines.push(`${result.target}: couldn't check it. ${result.error}`);
      continue;
    }
    lines.push(`${result.target}: ${result.marks.length} ${result.marks.length === 1 ? 'mark' : 'marks'}`);
    for (const mark of result.marks)
      lines.push(
        `  ${mark.line ? `${mark.line}:${mark.column}  ` : ''}${mark.label}  ${quoteText(mark.match)}  ${mark.note}`,
      );
  }
  const total = results.reduce((sum, result) => sum + result.marks.length, 0);
  lines.push(
    `${total} ${total === 1 ? 'mark' : 'marks'} in ${results.length} ${results.length === 1 ? 'page' : 'pages'}`,
  );
  return lines.join('\n');
}

/** GitHub Actions workflow commands: each mark shows on the pull request's changed lines. */
export function githubReport(results: Checked[]) {
  const data = (value: string) => value.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
  const property = (value: string) => data(value).replace(/:/g, '%3A').replace(/,/g, '%2C');
  const lines: string[] = [];
  for (const result of results) {
    if (result.error) {
      lines.push(
        `::error title=${property("Proofmarks couldn't check this")}::${data(`${result.target}: ${result.error}`)}`,
      );
      continue;
    }
    for (const mark of result.marks) {
      const where = /^https?:/.test(result.target)
        ? ''
        : `file=${property(result.target)}${mark.line ? `,line=${mark.line},col=${mark.column}` : ''},`;
      const message = `${/^https?:/.test(result.target) ? `${result.target}: ` : ''}${quoteText(mark.match)} ${mark.note}`;
      lines.push(`::warning ${where}title=${property(`Proofmarks: ${mark.label}`)}::${data(message)}`);
    }
  }
  return lines.join('\n');
}
