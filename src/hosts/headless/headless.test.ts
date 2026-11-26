import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { eventFixture } from '../../events/fixture';
import { updateRequest, eventFeed } from '../../events/index';
import { ReviewService } from '../../companion/service';
import { fakeProvider } from '../../companion/fake';
import { HeadlessRunner, cliArguments, cleanRewrite, promptForRewrite } from './index';
test('headless arguments isolate tools/context/MCP and text normalization is shared', () => {
  const claude = cliArguments('claude', '/isolated');
  assert.ok(claude.includes('--strict-mcp-config'));
  assert.equal(claude[claude.indexOf('--tools') + 1], '');
  assert.equal(claude[claude.indexOf('--setting-sources') + 1], '');
  const codex = cliArguments('codex', '/isolated');
  assert.equal(codex[codex.indexOf('--sandbox') + 1], 'read-only');
  assert.ok(codex.includes('--ephemeral'));
  assert.ok(codex.includes('--ignore-user-config'));
  assert.ok(codex.includes('mcp_servers={}'));
  const pi = cliArguments('pi', '/isolated');
  for (const flag of ['--no-tools', '--no-mcp', '--no-context-files', '--no-extensions']) assert.ok(pi.includes(flag));
  assert.equal(cleanRewrite('```text\n"A better sentence."\n```'), 'A better sentence.');
  assert.match(
    promptForRewrite({ label: 'Contrast', why: 'Problem', fix: 'Be direct' }, 'Original', 'Context'),
    /untrusted data/,
  );
});
test('one headless run per active finding goes through proposal judging and durable events', async () => {
  const f = await eventFixture();
  let calls = 0;
  const service = await ReviewService.create({ root: f.root, provider: fakeProvider, cacheDir: f.base + '/cache' }),
    runner = new HeadlessRunner(
      service,
      async () => {
        calls++;
        await delay(20);
        return 'It produces a report.';
      },
      async () => true,
    );
  try {
    await updateRequest(
      f.store,
      'fixture',
      'F1',
      f => ({ ...f, rewriteRequest: { status: 'pending', target: 'headless:claude' } }),
      'rewrite.requested',
    );
    await runner.start('fixture', 'F1');
    await runner.start('fixture', 'F1');
    await runner.idle();
    assert.equal(calls, 1);
    const finding = (await f.store.read('fixture')).review!.findings[0]!;
    assert.equal(finding.proposed, 'It produces a report.');
    assert.equal(finding.rewriteRequest?.status, 'proposed');
    assert.ok(finding.judge?.after);
    assert.deepEqual(
      (await eventFeed(f.store)).events.map(e => e.type),
      ['rewrite.requested', 'rewrite.claimed', 'rewrite.proposed'],
    );
  } finally {
    await runner.close();
    await f.close();
  }
});
test('cancellation stops a claimed run and records a plain failure', async () => {
  const f = await eventFixture(),
    service = await ReviewService.create({ root: f.root, provider: fakeProvider }),
    runner = new HeadlessRunner(
      service,
      async (_cli, _prompt, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('sensitive provider detail')), { once: true });
        }),
      async () => true,
    );
  try {
    await updateRequest(
      f.store,
      'fixture',
      'F1',
      f => ({ ...f, rewriteRequest: { status: 'pending', target: 'headless:claude' } }),
      'rewrite.requested',
    );
    await runner.start('fixture', 'F1');
    await delay(20);
    await runner.cancel('fixture', 'F1');
    const request = (await f.store.read('fixture')).review!.findings[0]?.rewriteRequest;
    assert.equal(request?.status, 'failed');
    assert.equal(request?.error, 'Cancelled');
  } finally {
    await runner.close();
    await f.close();
  }
});
test('Codex catalog preserves model identities while removing every model-selected tool surface', async () => {
  const { textOnlyCatalog } = await import('./index');
  const original = {
    models: [
      {
        slug: 'test-model',
        shell_type: 'unified_exec',
        apply_patch_tool_type: 'freeform',
        experimental_supported_tools: ['clock'],
        tool_mode: 'code_mode_only',
        multi_agent_version: 'v2',
      },
    ],
  };
  const result = textOnlyCatalog(original);
  assert.equal(result.models[0]?.slug, 'test-model');
  assert.equal(result.models[0]?.shell_type, 'disabled');
  assert.equal(result.models[0]?.apply_patch_tool_type, null);
  assert.deepEqual(result.models[0]?.experimental_supported_tools, []);
  assert.equal(result.models[0]?.tool_mode, 'direct');
  assert.equal(original.models[0]?.shell_type, 'unified_exec');
});
test('real subprocess adapters use isolated cwd, strip provider secrets, normalize output and clean scratch directories', async () => {
  const f = await eventFixture();
  const { mkdir, writeFile, readdir } = await import('node:fs/promises');
  const path = await import('node:path');
  const { runText } = await import('./index');
  const bin = path.join(f.base, 'bin'),
    scratch = path.join(f.base, 'scratch');
  await mkdir(bin);
  await mkdir(scratch);
  const previousPath = process.env.PATH,
    previousScratch = process.env.PROOFMARKS_SCRATCH_DIR;
  try {
    const stub = `#!${process.execPath}\nimport fs from 'node:fs';import path from 'node:path';const args=process.argv.slice(2),cli=path.basename(process.argv[1]);if(process.env.TYPESAFE_API_KEY||process.env.ANTHROPIC_API_KEY||process.env.OPENAI_API_KEY)process.exit(42);if(cli==='codex'&&args[0]==='debug'){console.log(JSON.stringify({models:[{slug:'stub'}]}));process.exit(0);}if(cli==='codex'){const file=args[args.indexOf('--output-last-message')+1];fs.writeFileSync(file,'"A concrete observation."');}if(cli==='claude')console.log(JSON.stringify({result:'\\x60\\x60\\x60text\\nA concrete observation.\\n\\x60\\x60\\x60'}));process.stdin.resume();`;
    for (const cli of ['claude', 'codex']) await writeFile(path.join(bin, cli), stub, { mode: 0o700 });
    process.env.PATH = bin + path.delimiter + (previousPath ?? '');
    process.env.PROOFMARKS_SCRATCH_DIR = scratch;
    for (const cli of ['claude', 'codex'] as const)
      assert.equal(
        await runText(cli, 'Synthetic fixture rewrite.', AbortSignal.timeout(5000)),
        'A concrete observation.',
      );
    assert.deepEqual(await readdir(scratch), []);
  } finally {
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
    if (previousScratch === undefined) delete process.env.PROOFMARKS_SCRATCH_DIR;
    else process.env.PROOFMARKS_SCRATCH_DIR = previousScratch;
    await f.close();
  }
});
test('Rewrite all runs at most two CLIs at once; queued requests start as slots free and a cancelled one never starts', async () => {
  const f = await eventFixture([
    'It is not a plan, but a promise.',
    'It is not a guess, but a bet.',
    'It is not a wish, but a goal.',
  ]);
  let live = 0,
    peak = 0;
  const prompts: string[] = [],
    gates: (() => void)[] = [];
  const service = await ReviewService.create({ root: f.root, provider: fakeProvider, cacheDir: f.base + '/cache' }),
    runner = new HeadlessRunner(
      service,
      async (_cli, prompt) => {
        prompts.push(prompt);
        live++;
        peak = Math.max(peak, live);
        await new Promise<void>(resolve => gates.push(resolve));
        live--;
        return 'Rewrite ' + prompts.length + '.';
      },
      async () => true,
    );
  const running = async (count: number) => {
    for (let i = 0; i < 500 && prompts.length < count; i++) await delay(5);
    assert.equal(prompts.length, count);
  };
  try {
    for (const id of ['F1', 'F2', 'F3', 'F4'])
      await updateRequest(
        f.store,
        'fixture',
        id,
        f => ({ ...f, rewriteRequest: { status: 'pending', target: 'headless:claude' } }),
        'rewrite.requested',
      );
    for (const id of ['F1', 'F2', 'F3', 'F4']) await runner.start('fixture', id);
    await running(2);
    await delay(30);
    assert.equal(prompts.length, 2, 'the other two wait in the queue');
    await runner.cancel('fixture', 'F4');
    gates.shift()!();
    await running(3);
    while (gates.length || prompts.length < 3) {
      gates.shift()?.();
      await delay(5);
    }
    await runner.idle();
    assert.equal(peak, 2);
    assert.equal(prompts.length, 3);
    const findings = (await f.store.read('fixture')).review!.findings;
    assert.deepEqual(
      findings.map(f => f.rewriteRequest?.status),
      ['proposed', 'proposed', 'proposed', 'failed'],
    );
  } finally {
    await runner.close();
    await f.close();
  }
});
test('another version tells the CLI which rewrites to differ from', async () => {
  assert.doesNotMatch(
    promptForRewrite({ label: 'Contrast', why: 'Problem', fix: 'Be direct' }, 'Original', 'Context'),
    /earlierRewrites|another version/,
  );
  const prompt = promptForRewrite({ label: 'Contrast', why: 'Problem', fix: 'Be direct' }, 'Original', 'Context', [
    'First try.',
  ]);
  assert.match(prompt, /differs from every earlier rewrite/);
  assert.deepEqual(JSON.parse(prompt.slice(prompt.indexOf('\n') + 1)).earlierRewrites, ['First try.']);
});
