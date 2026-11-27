import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alive } from './alive';

const failing = (code: string) => () => {
  throw Object.assign(new Error(code), { code });
};

test("a process that can't be signalled from a sandbox is still running", () => {
  assert.equal(alive(process.pid), true);
  assert.equal(alive(123, failing('EPERM')), true);
  assert.equal(alive(123, failing('ESRCH')), false);
});
