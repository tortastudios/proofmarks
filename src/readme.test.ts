import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// The README lists the rules by hand, so this keeps it from drifting from the registry the way the site's build does.
test("the README's rules table lists every rule as the registry has it, on or off", async () => {
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
  const registry = JSON.parse(await readFile(new URL('../rules/rules.v3.json', import.meta.url), 'utf8')) as {
    rules: { label: string; why: string; default: boolean }[];
  };
  const [onTable, offTable] = readme.split('Off by default');
  assert.ok(offTable, 'the README has an off-by-default table');
  const row = (rule: { label: string; why: string }) => `| ${rule.label} | ${rule.why} |`;
  for (const rule of registry.rules) {
    assert.ok(
      (rule.default ? onTable : offTable)!.includes(row(rule)),
      `${rule.label} is listed as the registry has it`,
    );
  }
  const on = registry.rules.filter(rule => rule.default).length,
    off = registry.rules.length - on;
  assert.ok(readme.includes(`against ${on} rules`), `How it works counts ${on} rules`);
  assert.ok(readme.includes(`${on} on by default, and ${off} you can turn on`), 'the summary counts both');
});
