import ts from 'typescript';
import { readFile, readdir, unlink, access } from 'node:fs/promises';
import path from 'node:path';
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const keep = new Set();
async function visit(file) {
  file = path.resolve(file);
  if (keep.has(file)) return;
  keep.add(file);
  const source = await readFile(file, 'utf8');
  for (const imported of ts.preProcessFile(source, true, true).importedFiles) {
    const name = imported.fileName;
    if (!name.startsWith('.')) continue;
    const base = path.resolve(path.dirname(file), name);
    const candidates = /\.mjs$/.test(base)
      ? [base.replace(/\.mjs$/, '.d.mts')]
      : /\.js$/.test(base)
        ? [base.replace(/\.js$/, '.d.ts')]
        : [base + '.d.ts', base + '.d.mts', path.join(base, 'index.d.ts')];
    let found;
    for (const candidate of candidates) {
      try {
        await access(candidate);
        found = candidate;
        break;
      } catch {
        /* Try the next declaration form. */
      }
    }
    if (!found) throw Error(`Missing declaration dependency ${name} in ${file}`);
    await visit(found);
  }
}
for (const entry of Object.values(pkg.exports)) if (typeof entry === 'object' && entry.types) await visit(entry.types);
async function prune(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) await prune(file);
    else if (!keep.has(path.resolve(file))) await unlink(file);
  }
}
await prune('dist/types');
