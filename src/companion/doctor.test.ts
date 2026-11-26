import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fixture } from '../server/fixture';
import { recordDevPage } from './dev-page';
import { doctor, doctorReport } from './doctor';

const serve = async (html: string) => {
  const server = createServer((_request, response) => response.end(html)).listen(0, '127.0.0.1');
  await once(server, 'listening');
  return server;
};
const port = (server: Server) => (server.address() as { port: number }).port;
const noAgents = async () => ({
  agents: [],
  headless: [{ id: 'headless:claude', label: 'Claude Code', available: false }],
  target: null,
  resolvedTarget: null,
});

test('doctor checks each link and says what to do next', async () => {
  const root = await fixture();
  const site = await serve('<p>Hi</p>'),
    proxy = await serve('<p>Hi</p><script src="/__proofmarks/script.js" defer></script>');
  try {
    const config = JSON.parse(await readFile(path.join(root, 'proofmarks.config.json'), 'utf8'));
    await writeFile(
      path.join(root, 'proofmarks.config.json'),
      JSON.stringify({ ...config, devServer: `http://127.0.0.1:${port(site)}` }),
    );
    const judge = async () => ({ route: "Torta's relay", connected: true });

    // Not running yet: the page check fails and says to start proofmarks dev.
    let checks = await doctor(root, { judge, agents: noAgents });
    assert.deepEqual(
      checks.map(c => [c.id, c.status]),
      [
        ['project', 'ok'],
        ['judge', 'ok'],
        ['site', 'ok'],
        ['page', 'fail'],
        ['rewrites', 'warn'],
        ['agents', 'warn'],
      ],
    );
    assert.match(checks.find(c => c.id === 'page')!.next!, /proofmarks dev/);

    await recordDevPage(root, { port: port(proxy), pid: process.pid, to: 'site' });
    const agents = async () => ({
      agents: [
        {
          id: 'a',
          host: 'claude-code' as const,
          label: 'Claude Code',
          project: root,
          startedAt: 'now',
          delivery: 'watch' as const,
        },
      ],
      headless: [{ id: 'headless:codex', label: 'Codex', available: true }],
      target: null,
      resolvedTarget: null,
    });
    checks = await doctor(root, { judge, agents });
    assert.ok(
      checks.every(c => c.status === 'ok'),
      doctorReport(checks),
    );
    assert.equal(
      checks.find(c => c.id === 'page')!.detail,
      `Open http://127.0.0.1:${port(proxy)}/essay?proof=1 to see the proofs.`,
    );
    assert.equal(checks.find(c => c.id === 'rewrites')!.detail, 'Claude Code and Codex can write them');
    assert.match(doctorReport(checks), /^✓ Project: 1 document in /);

    // The judge down, the site stopped.
    site.close();
    checks = await doctor(root, { judge: async () => ({ route: "Torta's relay", connected: false }), agents });
    assert.deepEqual(
      checks.filter(c => c.status === 'fail').map(c => c.id),
      ['judge', 'site'],
    );
    assert.match(
      doctorReport(checks),
      /✗ Judge: Jev through Torta's relay, not answering\n    Next: Check your internet connection/,
    );
  } finally {
    site.close();
    proxy.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('outside a project, doctor says to run init --yes and still checks the judge', async () => {
  const work = new URL('../../.test-work/', import.meta.url).pathname;
  await mkdir(work, { recursive: true });
  const empty = await mkdtemp(path.join(work, 'doctor-'));
  try {
    const checks = await doctor(empty, { judge: async () => ({ route: 'your key', connected: true }) });
    assert.deepEqual(
      checks.map(c => [c.id, c.status]),
      [
        ['project', 'fail'],
        ['judge', 'ok'],
      ],
    );
    assert.match(checks[0]!.next!, /proofmarks init --yes/);
  } finally {
    await rm(empty, { recursive: true, force: true });
  }
});
