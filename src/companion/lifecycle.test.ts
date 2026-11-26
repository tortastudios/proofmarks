import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readdir, readFile, writeFile, rm, access } from 'node:fs/promises';
import path from 'node:path';
import { fixture } from '../server/fixture';
import { createServer, type Server } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { acquireHelper, helperStatus, passOffToRunningDev, portInUse } from './lifecycle';
import { devProxy } from '../proxy/index';
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
// Spawned helpers load TypeScript and may build the page script first, so allow a slow CI machine 30 s.
async function waitFor(check: () => Promise<boolean>, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await pause(50);
  }
  throw new Error('Lifecycle condition timed out');
}
async function absent(file: string) {
  try {
    await access(file);
    return false;
  } catch {
    return true;
  }
}
test('helper is reused, stale pid state recovers, and last lease release stops it', async () => {
  const root = await fixture();
  let first: Awaited<ReturnType<typeof acquireHelper>> | undefined, second: typeof first;
  try {
    first = await acquireHelper({ projectRoot: root, judge: 'fake', cacheDir: path.join(root, 'cache'), port: 0 });
    second = await acquireHelper({ projectRoot: root, judge: 'fake', cacheDir: path.join(root, 'cache'), port: 0 });
    assert.equal(second.pid, first.pid);
    assert.equal(second.port, first.port);
    const saved = JSON.parse(await readFile(path.join(root, '.proofmarks/companion.json'), 'utf8'));
    assert.deepEqual(Object.keys(saved).sort(), ['pid', 'port', 'route', 'startedAt']);
    assert.equal(saved.route, 'fake');
    await first.release();
    assert.equal((await fetch(`http://127.0.0.1:${second.port}/__proofmarks/status`)).status, 200);
    await second.release();
    await waitFor(() => absent(path.join(root, '.proofmarks/companion.json')));
    await writeFile(
      path.join(root, '.proofmarks/companion.json'),
      JSON.stringify({ port: 1, pid: 2147483647, startedAt: 'stale' }),
    );
    first = await acquireHelper({ projectRoot: root, judge: 'fake', cacheDir: path.join(root, 'cache'), port: 0 });
    assert.notEqual(first.pid, saved.pid);
    await first.release();
    await waitFor(() => absent(path.join(root, '.proofmarks/companion.json')));
  } finally {
    await first?.release();
    await second?.release();
    await rm(root, { recursive: true, force: true });
  }
});
test('two actual MCP processes share one helper until both exit', async () => {
  const root = await fixture();
  const children: ReturnType<typeof spawn>[] = [];
  try {
    for (let i = 0; i < 2; i++) {
      const child = spawn(
        process.execPath,
        [
          new URL('./bin.mjs', import.meta.url).pathname,
          'mcp',
          '--project',
          root,
          '--judge',
          'fake',
          '--cache-dir',
          path.join(root, 'cache'),
        ],
        { stdio: ['pipe', 'ignore', 'ignore'] },
      );
      children.push(child);
    }
    const leases = path.join(root, '.proofmarks/leases');
    await waitFor(async () => {
      try {
        const { readdir } = await import('node:fs/promises');
        return (await readdir(leases)).length === 2 && !(await absent(path.join(root, '.proofmarks/companion.json')));
      } catch {
        return false;
      }
    });
    const state = JSON.parse(await readFile(path.join(root, '.proofmarks/companion.json'), 'utf8'));
    children[0]!.stdin!.end();
    await once(children[0]!, 'exit');
    assert.equal((await fetch(`http://127.0.0.1:${state.port}/__proofmarks/status`)).status, 200);
    const status = await helperStatus(root);
    assert.equal(status?.route, 'fake judge');
    assert.equal(typeof status?.usageCounts, 'boolean', 'the helper says whether it sends usage counts');
    children[1]!.stdin!.end();
    await once(children[1]!, 'exit');
    await waitFor(() => absent(path.join(root, '.proofmarks/companion.json')));
  } finally {
    for (const child of children) child.kill();
    await rm(root, { recursive: true, force: true });
  }
});

// Two consecutive free ports well away from the real defaults, so a running Proofmarks (4848 and 4849) doesn't matter.
const free = (port: number) =>
  new Promise<boolean>(resolve => {
    const probe = createNetServer();
    probe.once('error', () => resolve(false));
    probe.listen(port, '127.0.0.1', () => probe.close(() => resolve(true)));
  });
async function freePair() {
  for (;;) {
    const base = 41000 + Math.floor(Math.random() * 5000);
    if ((await free(base)) && (await free(base + 1)) && (await free(base + 2))) return base;
  }
}
const portOf = (server: Server) => (server.address() as { port: number }).port;
const closeServer = (server: Server) =>
  new Promise<void>(resolve => {
    server.close(() => resolve());
    server.closeAllConnections();
  });

test('two projects run dev side by side in either order, and a chosen port that is taken says so plainly', async () => {
  const upstream = createServer((_req, res) => {
    res.setHeader('content-type', 'text/html');
    res.end('<p>Hi</p>');
  });
  await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve));
  const to = `http://127.0.0.1:${portOf(upstream)}`,
    base = await freePair();
  try {
    // The bug: with both helpers started first, the second fell back to 4849 and the first project's proxy failed.
    for (const order of ['helpers first', 'one project at a time']) {
      const roots = [await fixture(), await fixture()],
        helpers: Awaited<ReturnType<typeof acquireHelper>>[] = [],
        proxies: Server[] = [];
      const helper = async (root: string) => {
        const started = await acquireHelper({
          projectRoot: root,
          judge: 'fake',
          cacheDir: path.join(root, 'cache'),
          preferredPort: base,
          owner: 'dev',
        });
        helpers.push(started);
        return started;
      };
      const proxy = async (root: string, started: { port: number }) => {
        const server = await devProxy({ projectRoot: root, to, helperPort: started.port, preferredPort: base + 1 });
        proxies.push(server);
        return server;
      };
      try {
        let a, b, pa, pb;
        if (order === 'helpers first') {
          a = await helper(roots[0]!);
          b = await helper(roots[1]!);
          pa = await proxy(roots[0]!, a);
          pb = await proxy(roots[1]!, b);
        } else {
          a = await helper(roots[0]!);
          pa = await proxy(roots[0]!, a);
          b = await helper(roots[1]!);
          pb = await proxy(roots[1]!, b);
        }
        assert.deepEqual([a.port, portOf(pa)], [base, base + 1], order);
        assert.notEqual(b.port, base + 1, `${order}: the second helper never takes the proxy's port`);
        assert.equal(new Set([a.port, b.port, portOf(pa), portOf(pb)]).size, 4, order);
        for (const server of [pa, pb])
          assert.match(await (await fetch(`http://127.0.0.1:${portOf(server)}/`)).text(), /<p>Hi<\/p>/, order);
      } finally {
        for (const server of proxies) await closeServer(server);
        for (const started of helpers) await started.release();
        for (const root of roots) {
          await waitFor(() => absent(path.join(root, '.proofmarks/companion.json')));
          await rm(root, { recursive: true, force: true });
        }
      }
    }
    const root = await fixture(),
      taken = createServer();
    await new Promise<void>(resolve => taken.listen(base, '127.0.0.1', resolve));
    try {
      await assert.rejects(acquireHelper({ projectRoot: root, judge: 'fake', port: base }), {
        message: portInUse(base),
      });
      await assert.rejects(devProxy({ projectRoot: root, to, helperPort: 1, port: base }), {
        message: `Port ${base} is in use. Pass --port <n> to use another.`,
      });
    } finally {
      await closeServer(taken);
      await rm(root, { recursive: true, force: true });
    }
  } finally {
    await closeServer(upstream);
  }
});

test("a lease says when its process turns usage counts off, and your own key won't reuse a helper judging through the relay", async () => {
  const root = await fixture(),
    previous = { key: process.env.TYPESAFE_API_KEY, dnt: process.env.DO_NOT_TRACK };
  let helper: Awaited<ReturnType<typeof acquireHelper>> | undefined;
  try {
    delete process.env.TYPESAFE_API_KEY;
    process.env.DO_NOT_TRACK = '1';
    helper = await acquireHelper({ projectRoot: root, judge: 'jev', cacheDir: path.join(root, 'cache'), port: 0 });
    const leases = path.join(root, '.proofmarks/leases');
    const [lease] = await readdir(leases);
    assert.equal(JSON.parse(await readFile(path.join(leases, lease!), 'utf8')).off, true);
    assert.equal(JSON.parse(await readFile(path.join(root, '.proofmarks/companion.json'), 'utf8')).route, 'relay');
    process.env.TYPESAFE_API_KEY = 'own-key';
    await assert.rejects(
      acquireHelper({ projectRoot: root, judge: 'jev', cacheDir: path.join(root, 'cache'), port: 0 }),
      /already running for this project and judges through Torta's relay/,
    );
  } finally {
    for (const [name, value] of [
      ['TYPESAFE_API_KEY', previous.key],
      ['DO_NOT_TRACK', previous.dnt],
    ] as const)
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    await helper?.release();
    await waitFor(() => absent(path.join(root, '.proofmarks/companion.json')));
    await rm(root, { recursive: true, force: true });
  }
});

test("dev --background hands this shell's off to the dev proxy already running, once, for as long as it runs", async () => {
  const root = await fixture(),
    leases = path.join(root, '.proofmarks', 'leases'),
    previous = { dnt: process.env.DO_NOT_TRACK, telemetry: process.env.PROOFMARKS_TELEMETRY };
  const { mkdir } = await import('node:fs/promises');
  await mkdir(leases, { recursive: true });
  // This test process stands in for the running proxy, whose own lease says nothing about counts.
  await writeFile(path.join(leases, 'dev.json'), JSON.stringify({ pid: process.pid, owner: 'dev', off: false }));
  const offLeases = async () => {
    const found = [];
    for (const name of await readdir(leases)) {
      const lease = JSON.parse(await readFile(path.join(leases, name), 'utf8'));
      if (lease.off === true) found.push(lease);
    }
    return found;
  };
  try {
    delete process.env.DO_NOT_TRACK;
    process.env.PROOFMARKS_TELEMETRY = '1';
    await passOffToRunningDev(root, process.pid);
    assert.deepEqual(await offLeases(), [], "a shell that doesn't turn counts off changes nothing");
    process.env.DO_NOT_TRACK = '1';
    await passOffToRunningDev(root, process.pid);
    await passOffToRunningDev(root, process.pid);
    assert.deepEqual(await offLeases(), [{ pid: process.pid, owner: 'dev', off: true }], 'once');
    // Where the lease can't be written, the shell is told rather than left thinking counts are off.
    await rm(leases, { recursive: true });
    await writeFile(leases, 'not a folder');
    await assert.rejects(passOffToRunningDev(root, process.pid), /Couldn't turn usage counts off for the dev proxy/);
  } finally {
    if (previous.dnt === undefined) delete process.env.DO_NOT_TRACK;
    else process.env.DO_NOT_TRACK = previous.dnt;
    if (previous.telemetry === undefined) delete process.env.PROOFMARKS_TELEMETRY;
    else process.env.PROOFMARKS_TELEMETRY = previous.telemetry;
    await rm(root, { recursive: true, force: true });
  }
});
