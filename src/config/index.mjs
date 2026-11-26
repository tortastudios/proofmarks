import { readFile, realpath, lstat } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
export class ConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConfigError';
  }
}
const schema = z
  .object({
    version: z.literal(1),
    documents: z.array(
      z
        .object({
          id: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/),
          source: z.string().min(1),
          review: z.string().min(1),
          write: z.boolean().default(false),
          url: z.string().startsWith('/').optional(),
          format: z.enum(['markdown', 'mdx', 'html', 'jinja']).optional(),
        })
        .strict(),
    ),
    rebuild: z.string().min(1).optional(),
    devServer: z
      .string()
      .url()
      .refine(value => /^https?:/.test(value), 'Expected an HTTP(S) URL')
      .optional(),
    origins: z
      .array(
        z
          .string()
          .url()
          .refine(value => {
            try {
              const url = new URL(value);
              return /^https?:$/.test(url.protocol) && url.origin === value;
            } catch {
              return false;
            }
          }, 'Expected an HTTP(S) origin'),
      )
      .default([]),
    tailnetHosts: z.array(z.string().regex(/^[a-zA-Z0-9.-]+(?::[0-9]+)?$/)).default([]),
    tailscaleUsers: z.array(z.string().min(1)).default([]),
    roots: z.array(z.string().min(1)).min(1),
    // Rules this project turns on or off; the rest keep their defaults. Ids are checked against the registry
    // when a review runs.
    rules: z.record(z.string().regex(/^[a-z][a-z0-9-]*$/), z.boolean()).optional(),
    judge: z.object({ provider: z.enum(['jev', 'fake']), model: z.string().min(1) }).strict(),
  })
  .strict();
const within = (root, file) => {
  const rel = path.relative(root, file);
  return rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel);
};
// Resolve missing output leaves through their nearest existing ancestor, too.
async function resolvePath(root, value) {
  if (path.isAbsolute(value)) throw new ConfigError('Config paths must be relative to the project root');
  const candidate = path.resolve(root, value);
  if (!within(root, candidate)) throw new ConfigError('Config path escapes the project root');
  let ancestor = candidate;
  const leaves = [];
  for (;;) {
    try {
      const canonical = await realpath(ancestor);
      if (!within(root, canonical) || canonical !== ancestor)
        throw new ConfigError('Config path resolves through a symlink or outside the project root');
      return path.join(canonical, ...leaves.reverse());
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      try {
        if ((await lstat(ancestor)).isSymbolicLink()) throw new ConfigError('Config path contains a broken symlink');
      } catch (statError) {
        if (statError.code !== 'ENOENT') throw statError;
      }
      leaves.push(path.basename(ancestor));
      ancestor = path.dirname(ancestor);
    }
  }
}
/** Relative document fields remain suitable for review JSON; absolute fields are validated filesystem paths. */
export async function loadConfig(projectRoot) {
  let root;
  try {
    root = await realpath(projectRoot);
  } catch {
    throw new ConfigError('Project root is not an accessible directory');
  }
  const configFile = await resolvePath(root, 'proofmarks.config.json');
  let raw;
  try {
    raw = await readFile(configFile, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT')
      throw new ConfigError('No proofmarks.config.json found; run proofmarks init or pass --root');
    throw error;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ConfigError('proofmarks.config.json is not valid JSON');
  }
  const result = schema.safeParse(parsed);
  if (!result.success)
    throw new ConfigError(
      'Invalid proofmarks.config.json: ' + result.error.issues.map(i => i.path.join('.') + ' ' + i.message).join('; '),
    );
  const config = result.data;
  const ids = new Set();
  const reviews = new Set();
  const roots = await Promise.all(config.roots.map(value => resolvePath(root, value)));
  for (const directory of roots) {
    try {
      if (!(await lstat(directory)).isDirectory()) throw new Error();
    } catch {
      throw new ConfigError('Configured root must be an accessible directory');
    }
  }
  const documents = [];
  for (const entry of config.documents) {
    if (ids.has(entry.id) || reviews.has(entry.review))
      throw new ConfigError('Duplicate document identity or review path');
    ids.add(entry.id);
    reviews.add(entry.review);
    const sourcePath = await resolvePath(root, entry.source);
    const reviewPath = await resolvePath(root, entry.review);
    if (
      !/\.(?:md|mdx|html?|jinja2?|j2|njk|nunjucks|twig|liquid)$/.test(sourcePath) ||
      !/\.json$/.test(reviewPath) ||
      !roots.some(dir => within(dir, sourcePath))
    )
      throw new ConfigError('Document source or review path is invalid');
    try {
      if (!(await lstat(sourcePath)).isFile()) throw new Error();
    } catch {
      throw new ConfigError('Document source must be an accessible file');
    }
    try {
      if (!(await lstat(reviewPath)).isFile()) throw new ConfigError('Document review must be a file');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    const logPath = await resolvePath(root, entry.review.replace(/\.json$/, '.log.jsonl'));
    const format =
      entry.format ??
      (/\.mdx$/.test(sourcePath)
        ? 'mdx'
        : /\.md$/.test(sourcePath)
          ? 'markdown'
          : /\.html?$/.test(sourcePath)
            ? 'html'
            : 'jinja');
    documents.push({ ...entry, format, sourcePath, reviewPath, logPath });
  }
  return { ...config, projectRoot: root, roots, documents };
}
