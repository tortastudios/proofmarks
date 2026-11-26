import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { findCommand, runCommand } from './command';

const work = new URL('../../.test-work/', import.meta.url).pathname;

test('agent CLIs are found as a shell would find them, including .cmd files on Windows', async () => {
  await mkdir(work, { recursive: true });
  const dir = await mkdtemp(path.join(work, 'command-'));
  try {
    // Windows matches extensions in any case; the stub uses PATHEXT's own case so case-sensitive disks agree.
    await writeFile(path.join(dir, 'codex.CMD'), '@echo off\r\n');
    await writeFile(path.join(dir, 'pi'), '#!/bin/sh\n');
    await chmod(path.join(dir, 'pi'), 0o755);
    await writeFile(path.join(dir, 'claude'), 'not executable\n');
    await chmod(path.join(dir, 'claude'), 0o644);
    assert.equal(
      await findCommand('codex', { PATH: dir, PATHEXT: '.COM;.EXE;.BAT;.CMD' }, 'win32'),
      path.join(dir, 'codex.CMD'),
    );
    assert.equal(
      await findCommand('codex', { Path: dir }, 'win32'),
      path.join(dir, 'codex.CMD'),
      'Windows spells it Path, with a default PATHEXT',
    );
    assert.equal(await findCommand('codex', { PATH: dir }, 'darwin'), undefined, 'a .cmd file is no command elsewhere');
    assert.equal(await findCommand('pi', { PATH: dir }, 'darwin'), path.join(dir, 'pi'));
    assert.equal(await findCommand('claude', { PATH: dir }, 'darwin'), undefined, 'not executable');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('runCommand returns output, and rejects with it on failure, timeout or cancel', async () => {
  const node = process.execPath,
    cwd = process.cwd();
  assert.deepEqual(await runCommand(node, ['-e', 'process.stdout.write("out");process.stderr.write("err")'], { cwd }), {
    stdout: 'out',
    stderr: 'err',
  });
  await assert.rejects(
    runCommand(node, ['-e', 'process.stderr.write("nope");process.exit(3)'], { cwd }),
    (error: Error & { stderr?: string }) => /exited with 3/.test(error.message) && error.stderr === 'nope',
  );
  await assert.rejects(runCommand(node, ['-e', 'setTimeout(()=>{},10000)'], { cwd, timeout: 200 }), /timed out/);
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 100);
  await assert.rejects(
    runCommand(node, ['-e', 'setTimeout(()=>{},10000)'], { cwd, signal: controller.signal }),
    /cancelled/,
  );
});
