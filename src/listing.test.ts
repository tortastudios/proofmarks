import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = async (file: string) => JSON.parse(await readFile(new URL(`../${file}`, import.meta.url), 'utf8'));

test("the MCP Registry's server.json names the package and version npm has", async () => {
  const pkg = await read('package.json'),
    server = await read('server.json');
  assert.equal(server.name, pkg.mcpName);
  assert.equal(server.version, pkg.version);
  assert.deepEqual(
    server.packages.map((entry: { identifier: string; version: string }) => [entry.identifier, entry.version]),
    [[pkg.name, pkg.version]],
  );
  assert.ok(pkg.keywords.includes('pi-package'), "pi's package catalog lists npm packages with this keyword");
});
