import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { telemetryCommand } from './telemetry';

test('proofmarks telemetry: off until turned on, kept for every process, and honest when the environment outranks it', async () => {
  const work = new URL('../../.test-work/', import.meta.url).pathname;
  await mkdir(work, { recursive: true });
  const dir = await mkdtemp(path.join(work, 'telemetry-')),
    file = path.join(dir, 'telemetry.json'),
    saved = {
      PROOFMARKS_TELEMETRY: process.env.PROOFMARKS_TELEMETRY,
      DO_NOT_TRACK: process.env.DO_NOT_TRACK,
      CI: process.env.CI,
    };
  try {
    for (const name of Object.keys(saved)) delete process.env[name];
    assert.equal(
      await telemetryCommand(undefined, file),
      'Usage counts are off. Proofmarks tunes its rules to your site on this machine. To help tune them for everyone, run proofmarks telemetry on.',
    );
    assert.equal(
      await telemetryCommand('on', file),
      'Usage counts are on. Thank you, they help tune the rules for everyone.',
    );
    assert.equal(JSON.parse(await readFile(file, 'utf8')).on, true);
    assert.match(await telemetryCommand('status', file), /^Usage counts are on: .*never your writing\./);
    process.env.DO_NOT_TRACK = '1';
    assert.equal(await telemetryCommand('status', file), 'Usage counts are off because DO_NOT_TRACK is set.');
    assert.equal(
      await telemetryCommand('on', file),
      'Saved for later. Usage counts are off because DO_NOT_TRACK is set.',
    );
    delete process.env.DO_NOT_TRACK;
    assert.equal(
      await telemetryCommand('off', file),
      'Usage counts are off. Proofmarks still tunes its rules to your site on this machine.',
    );
    await assert.rejects(telemetryCommand('maybe', file), /Usage: proofmarks telemetry \[status\|on\|off\]/);
  } finally {
    for (const [name, value] of Object.entries(saved))
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    await rm(dir, { recursive: true, force: true });
  }
});
