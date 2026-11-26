import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, rm, symlink } from 'node:fs/promises';
import path from 'node:path';
import { loadConfig } from './index';
import { ReviewStore } from '../companion/state';
async function fixture() {
  const work = new URL('../../.test-work/', import.meta.url);
  await mkdir(work, { recursive: true });
  const base = await mkdtemp(new URL('config-', work).pathname);
  await mkdir(path.join(base, 'content/essays'), { recursive: true });
  await mkdir(path.join(base, 'content/reviews'));
  await writeFile(path.join(base, 'content/essays/proofmarks-fixture.mdx'), 'Fixture text.');
  const config = {
    version: 1,
    roots: ['content/essays'],
    documents: [
      {
        id: 'fixture-v3',
        source: 'content/essays/proofmarks-fixture.mdx',
        review: 'content/reviews/proofmarks-fixture.v3.json',
        write: true,
      },
    ],
    judge: { provider: 'fake', model: 'fixture-1' },
  };
  const save = async (value: unknown = config) =>
    writeFile(path.join(base, 'proofmarks.config.json'), JSON.stringify(value));
  await save();
  return { base, config, save, close: () => rm(base, { recursive: true }) };
}
test('config resolves paths, missing outputs and explicit review identities; unlisted writes fail', async () => {
  const f = await fixture();
  try {
    const config = await loadConfig(f.base);
    assert.equal(config.documents[0]?.sourcePath, path.join(f.base, f.config.documents[0]!.source));
    assert.equal(config.documents[0]?.write, true);
    const store = await ReviewStore.create(config.roots[0]!);
    assert.equal(store.file('fixture-v3'), config.documents[0]!.reviewPath);
    assert.equal(store.output(config.documents[0]!.sourcePath), config.documents[0]!.reviewPath);
    assert.throws(() => store.file('unlisted'), /not listed/);
    assert.throws(
      () => store.output(config.documents[0]!.sourcePath, path.join(f.base, 'content/reviews/unlisted.json')),
      /not listed/,
    );
    await f.save({ ...f.config, documents: [{ ...f.config.documents[0], write: false }] });
    assert.throws(
      () =>
        new ReviewStore(config.roots[0]!, {
          ...config,
          documents: config.documents.map(d => ({ ...d, write: false })),
        }).output(config.documents[0]!.sourcePath),
      /not listed/,
    );
  } finally {
    await f.close();
  }
});
test('config rejects malformed JSON, schema versions, duplicates, traversal and symlinks', async () => {
  const f = await fixture();
  try {
    await writeFile(path.join(f.base, 'proofmarks.config.json'), '{');
    await assert.rejects(loadConfig(f.base), /valid JSON/);
    for (const config of [
      { ...f.config, version: 2 },
      { ...f.config, documents: [f.config.documents[0], f.config.documents[0]] },
      { ...f.config, roots: ['../'] },
      { ...f.config, documents: [{ ...f.config.documents[0], review: '../escape.json' }] },
    ]) {
      await f.save(config);
      await assert.rejects(loadConfig(f.base));
    }
    await symlink(path.join(f.base, 'content/reviews'), path.join(f.base, 'alias'));
    await f.save({ ...f.config, documents: [{ ...f.config.documents[0], review: 'alias/missing.json' }] });
    await assert.rejects(loadConfig(f.base), /symlink/);
    await symlink(path.join(f.base, 'missing'), path.join(f.base, 'broken'));
    await f.save({ ...f.config, documents: [{ ...f.config.documents[0], review: 'broken/new.json' }] });
    await assert.rejects(loadConfig(f.base), /symlink/);
  } finally {
    await f.close();
  }
});
test('config write flags apply to every filename in every environment, using temporary project copies', async () => {
  const f = await fixture();
  const before = process.env.NODE_ENV;
  try {
    for (const filename of ['reference-article.mdx', 'proofmarks-fixture.mdx', 'ordinary-draft.md']) {
      const source = `content/essays/${filename}`;
      await writeFile(path.join(f.base, source), 'Temporary stand-in; never the project source.');
      for (const environment of ['test', 'development', 'production']) {
        process.env.NODE_ENV = environment;
        for (const write of [true, false]) {
          await f.save({
            ...f.config,
            documents: [{ id: 'draft', source, review: 'content/reviews/reference-article.json', write }],
          });
          const config = await loadConfig(f.base),
            document = config.documents[0]!;
          assert.equal(document.write, write, `${filename}, ${environment}, write=${write}`);
          const store = new ReviewStore(config.roots[0]!, config);
          if (write) assert.equal(store.output(document.sourcePath), document.reviewPath);
          else assert.throws(() => store.output(document.sourcePath), /not listed as writable/);
        }
      }
    }
  } finally {
    if (before === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = before;
    await f.close();
  }
});

test('config takes rules to turn on or off, as true or false', async () => {
  const f = await fixture();
  try {
    await f.save({ ...f.config, rules: { 'em-dash': true, contrast: false } });
    assert.deepEqual((await loadConfig(f.base)).rules, { 'em-dash': true, contrast: false });
    await f.save({ ...f.config, rules: { 'em-dash': 'yes' } });
    await assert.rejects(loadConfig(f.base), /rules/);
  } finally {
    await f.close();
  }
});
