import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fakeProvider } from './fake';
import { checkFormat, checkTarget, expandTargets, githubReport, mainContent, textReport } from './check';

const work = new URL('../../.test-work/', import.meta.url).pathname;
async function project() {
  await mkdir(work, { recursive: true });
  const dir = await mkdtemp(path.join(work, 'check-'));
  await mkdir(path.join(dir, 'content/posts'), { recursive: true });
  await mkdir(path.join(dir, 'node_modules/pkg'), { recursive: true });
  await writeFile(path.join(dir, 'content/posts/a.md'), '# A post\n\nWe leverage robust tools.\n');
  await writeFile(path.join(dir, 'content/posts/b.html'), '<main>\n  <p>We leverage robust tools.</p>\n</main>\n');
  await writeFile(path.join(dir, 'content/notes.txt'), 'Not a document.');
  await writeFile(path.join(dir, 'node_modules/pkg/readme.md'), 'Ignored.');
  return dir;
}

test('targets: files, folders without node_modules, unexpanded globs and URLs, once each', async () => {
  const dir = await project();
  try {
    const relative = async (args: string[]) =>
      (await expandTargets(args, dir)).map(t => (t.startsWith('http') ? t : path.relative(dir, t)));
    assert.deepEqual(await relative(['.']), ['content/posts/a.md', 'content/posts/b.html']);
    assert.deepEqual(await relative(['content/posts/*.md', 'content/posts/a.md', 'https://example.com/a']), [
      'content/posts/a.md',
      'https://example.com/a',
    ]);
    await assert.rejects(expandTargets(['missing.md'], dir), /Nothing to check at missing\.md/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a page's main content leaves out navigation, scripts and footers", () => {
  const html =
    '<body><nav>Menu items</nav><main><h1>Hi</h1><script>x()</script><p>Body text.</p></main><footer>Fine print</footer></body>';
  assert.equal(mainContent(html), '<h1>Hi</h1><p>Body text.</p>');
  assert.equal(mainContent('<body><header>Top</header><article>Story.</article></body>'), 'Story.');
  assert.equal(mainContent('<body><p>Only body.</p><footer>x</footer></body>'), '<p>Only body.</p>');
});

test('marks carry their rule, place and note; URLs have no line, and failures say why', async () => {
  const dir = await project();
  try {
    const markdown = await checkTarget(path.join(dir, 'content/posts/a.md'), fakeProvider, {
      cwd: dir,
      cacheDir: path.join(dir, 'cache'),
    });
    assert.equal(markdown.target, 'content/posts/a.md');
    const leverage = markdown.marks.find(m => m.rule === 'inflated' && m.match.toLowerCase().includes('leverage'))!;
    assert.deepEqual([leverage.label, leverage.line, leverage.column], ['Inflated word', 3, 4]);
    assert.match(leverage.note, /Try “use”/);

    const html = await checkTarget(path.join(dir, 'content/posts/b.html'), fakeProvider, {
      cwd: dir,
      cacheDir: path.join(dir, 'cache'),
    });
    assert.deepEqual(
      html.marks.filter(m => m.rule === 'inflated').map(m => [m.line, m.column]),
      [[2, 9]],
      'positions are in the HTML source',
    );

    const page = async () =>
      new Response('<body><nav>Menu leverage</nav><main><p>We leverage robust tools.</p></main></body>');
    const url = await checkTarget('https://example.com/a', fakeProvider, {
      fetch: page as typeof fetch,
      cacheDir: path.join(dir, 'cache'),
    });
    assert.ok(url.marks.length > 0);
    assert.ok(url.marks.every(m => m.line === undefined));
    assert.ok(!url.marks.some(m => m.match.includes('Menu')), 'the navigation is not judged');

    const missing = await checkTarget('https://example.com/gone', fakeProvider, {
      fetch: (async () => new Response('', { status: 404 })) as typeof fetch,
    });
    assert.deepEqual(missing, { target: 'https://example.com/gone', marks: [], error: 'The page answered 404.' });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('reports: plain text for people, GitHub annotations with escaping for CI', () => {
  const results = [
    {
      target: 'content/a.md',
      marks: [
        {
          rule: 'contrast',
          label: 'Not X, but Y',
          match: 'Not a tool,\nbut a revolution.',
          note: 'State the second half.',
          line: 3,
          column: 1,
        },
      ],
    },
    {
      target: 'https://example.com/a',
      marks: [{ rule: 'puffery', label: 'Puffery', match: 'Truly 100% great', note: 'Say what happened.' }],
    },
    { target: 'content/b.md', marks: [], error: 'Gone.' },
  ];
  assert.equal(
    textReport(results),
    'content/a.md: 1 mark\n  3:1  Not X, but Y  "Not a tool, but a revolution."  State the second half.\nhttps://example.com/a: 1 mark\n  Puffery  "Truly 100% great"  Say what happened.\ncontent/b.md: couldn\'t check it. Gone.\n2 marks in 3 pages',
  );
  assert.equal(
    githubReport(results),
    [
      '::warning file=content/a.md,line=3,col=1,title=Proofmarks%3A Not X%2C but Y::"Not a tool, but a revolution." State the second half.',
      '::warning title=Proofmarks%3A Puffery::https://example.com/a: "Truly 100%25 great" Say what happened.',
      "::error title=Proofmarks couldn't check this::content/b.md: Gone.",
    ].join('\n'),
  );
});

test('the check command: --fail-on sets the exit code, --json gives every mark', async () => {
  const dir = await project();
  const cli = (args: string[]) =>
    promisify(execFile)(
      process.execPath,
      [
        new URL('./bin.mjs', import.meta.url).pathname,
        'check',
        ...args,
        '--judge',
        'fake',
        '--cache-dir',
        path.join(dir, 'cache'),
      ],
      {
        cwd: dir,
        env: { PATH: process.env.PATH, HOME: dir },
      },
    ).then(
      result => ({ code: 0, stdout: result.stdout }),
      (error: { code: number; stdout: string }) => ({ code: error.code, stdout: error.stdout }),
    );
  try {
    const json = await cli(['content', '--json']);
    assert.equal(json.code, 0);
    const parsed = JSON.parse(json.stdout) as { results: { target: string; marks: unknown[] }[]; total: number };
    assert.deepEqual(
      parsed.results.map(r => r.target),
      ['content/posts/a.md', 'content/posts/b.html'],
    );
    assert.equal(
      parsed.total,
      parsed.results.reduce((sum, r) => sum + r.marks.length, 0),
    );
    assert.equal((await cli(['content', '--fail-on', '1'])).code, 1);
    assert.equal((await cli(['content', '--fail-on', String(parsed.total + 1)])).code, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('check writes GitHub annotations in GitHub Actions unless the command asks for a format', () => {
  assert.equal(checkFormat(undefined, false, {}), 'text');
  assert.equal(checkFormat(undefined, false, { GITHUB_ACTIONS: 'true' }), 'github');
  assert.equal(checkFormat('text', false, { GITHUB_ACTIONS: 'true' }), 'text');
  assert.equal(checkFormat(undefined, true, { GITHUB_ACTIONS: 'true' }), 'json');
});
