import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { parse } from 'yaml';

// `npx skills add tortastudios/proofmarks` parses each SKILL.md's frontmatter with this same parser, and skips a skill
// it can't read without saying so to the agent: an unquoted "stack: npm" once dropped the setup skill.
test('every skill has frontmatter the skills CLI can read, with its folder name and a description', async () => {
  const root = new URL('../skills/', import.meta.url);
  const names = (await readdir(root, { withFileTypes: true })).filter(e => e.isDirectory()).map(e => e.name);
  assert.deepEqual(names.sort(), ['proofmarks', 'proofmarks-self-driving']);
  for (const name of names) {
    const text = await readFile(new URL(`${name}/SKILL.md`, root), 'utf8');
    const block = /^---\n([\s\S]*?)\n---\n/.exec(text);
    assert.ok(block, `${name} has frontmatter`);
    const meta = parse(block[1]!) as { name?: unknown; description?: unknown };
    assert.equal(meta.name, name);
    assert.ok(typeof meta.description === 'string' && meta.description.length > 40, `${name} has a description`);
  }
});
