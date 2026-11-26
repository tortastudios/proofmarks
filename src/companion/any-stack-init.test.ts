import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import path from 'node:path';
import { init } from './init';
import { loadConfig } from '../config/index';
const work = new URL('../../.test-work/', import.meta.url);
for (const stack of ['next', 'vite', 'jinja', 'static'])
  test(`init detects ${stack}, writes stack config and prints proxy/script quick starts`, async () => {
    await mkdir(work, { recursive: true });
    const root = await mkdtemp(new URL('stack-', work).pathname);
    try {
      if (stack === 'next') {
        await writeFile(
          path.join(root, 'package.json'),
          JSON.stringify({ dependencies: { next: '16', velite: '0.3' } }),
        );
        await mkdir(path.join(root, 'content'));
        await writeFile(path.join(root, 'content/article.mdx'), 'Article.');
      } else if (stack === 'jinja') {
        await writeFile(path.join(root, 'pyproject.toml'), '[project]\nname="fixture"\n');
        await mkdir(path.join(root, 'templates'));
        await writeFile(path.join(root, 'templates/index.html'), '<p>Hello {{ name }}</p>');
      } else {
        if (stack === 'vite')
          await writeFile(path.join(root, 'package.json'), JSON.stringify({ devDependencies: { vite: '7' } }));
        await writeFile(path.join(root, 'index.html'), '<p>Article.</p>');
      }
      const output: string[] = [];
      await init({
        projectRoot: root,
        home: path.join(root, 'no-home'),
        confirm: async () => true,
        print: line => {
          output.push(line);
        },
        run: async () => {
          throw new Error('stub absent');
        },
      });
      const config = await loadConfig(root);
      assert.equal(config.documents[0]!.format, stack === 'next' ? 'mdx' : stack === 'jinja' ? 'jinja' : 'html');
      assert.equal(config.documents[0]!.url, stack === 'next' ? '/article*' : '/');
      assert.equal(
        config.devServer,
        stack === 'next'
          ? 'http://localhost:3000'
          : stack === 'vite'
            ? 'http://localhost:5173'
            : 'http://localhost:8000',
      );
      if (stack === 'next') assert.equal(config.rebuild, 'npx velite');
      assert.match(output.join('\n'), /proofmarks dev --to/);
      assert.match(output.join('\n'), /development only/);
      assert.match(output.join('\n'), /script.js/);
      const raw = JSON.parse(await readFile(path.join(root, 'proofmarks.config.json'), 'utf8'));
      raw.origins = ['javascript:bad'];
      await writeFile(path.join(root, 'proofmarks.config.json'), JSON.stringify(raw));
      await assert.rejects(loadConfig(root), /origins/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
test('init finds blog posts where Astro and Jekyll keep them, takes --content, and prints the real dev command', async () => {
  await mkdir(work, { recursive: true });
  const quiet = {
    home: '/nonexistent-home',
    confirm: async () => true,
    run: async () => {
      throw new Error('stub absent');
    },
  };
  const astro = await mkdtemp(new URL('astro-', work).pathname),
    jekyll = await mkdtemp(new URL('jekyll-', work).pathname),
    custom = await mkdtemp(new URL('custom-', work).pathname);
  try {
    await writeFile(
      path.join(astro, 'package.json'),
      JSON.stringify({ scripts: { dev: 'astro dev' }, dependencies: { astro: '7' } }),
    );
    await mkdir(path.join(astro, 'src/content/blog'), { recursive: true });
    await writeFile(path.join(astro, 'src/content/blog/first-post.md'), 'A post.');
    const astroOut: string[] = [];
    await init({
      projectRoot: astro,
      ...quiet,
      print: line => {
        astroOut.push(line);
      },
    });
    const a = await loadConfig(astro);
    assert.deepEqual(
      a.documents.map(d => [d.id, d.source, d.review, d.url]),
      [['blog-first-post', 'src/content/blog/first-post.md', 'reviews/blog-first-post.json', '/*/first-post*']],
    );
    assert.equal(a.devServer, 'http://localhost:4321');
    assert.match(
      astroOut.join('\n'),
      /Quick start \(astro\):\nnpm run dev\nproofmarks dev --to http:\/\/localhost:4321/,
    );
    await writeFile(path.join(jekyll, '_config.yml'), 'title: x\n');
    await mkdir(path.join(jekyll, '_posts'));
    await writeFile(path.join(jekyll, '_posts/2026-11-12-hello.md'), 'Hello.');
    await init({ projectRoot: jekyll, ...quiet, print: () => {} });
    const j = await loadConfig(jekyll);
    assert.deepEqual(
      j.documents.map(d => [d.id, d.review, d.url]),
      [['2026-11-12-hello', '_reviews/2026-11-12-hello.json', '/*/hello*']],
    );
    assert.equal(j.devServer, 'http://localhost:4000');
    await mkdir(path.join(custom, 'writing'));
    await writeFile(path.join(custom, 'writing/notes.md'), 'Notes.');
    await assert.rejects(
      init({ projectRoot: custom, ...quiet, print: () => {} }),
      /proofmarks init --content <folder>/,
    );
    await assert.rejects(
      init({ projectRoot: custom, content: ['../elsewhere'], ...quiet, print: () => {} }),
      /No folder/,
    );
    await init({ projectRoot: custom, content: ['writing'], ...quiet, print: () => {} });
    const c = await loadConfig(custom);
    assert.deepEqual(
      c.documents.map(d => [d.id, d.source]),
      [['notes', 'writing/notes.md']],
    );
    // An existing config's dev server wins over the guess.
    const raw = JSON.parse(await readFile(path.join(custom, 'proofmarks.config.json'), 'utf8'));
    raw.devServer = 'http://localhost:9999';
    await writeFile(path.join(custom, 'proofmarks.config.json'), JSON.stringify(raw));
    const again: string[] = [];
    await init({
      projectRoot: custom,
      ...quiet,
      print: line => {
        again.push(line);
      },
    });
    assert.match(again.join('\n'), /proofmarks dev --to http:\/\/localhost:9999/);
  } finally {
    for (const dir of [astro, jekyll, custom]) await rm(dir, { recursive: true, force: true });
  }
});
