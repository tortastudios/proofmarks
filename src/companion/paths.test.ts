import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { projectRelative } from './paths';

// The gallery's reviews were made on macOS and record pieces/essay.md; on Windows, path.relative gives
// pieces\essay.md, so the review didn't match its own document there.
test('a project path is recorded with forward slashes on Windows too', () => {
  assert.equal(projectRelative('C:\\site', 'C:\\site\\pieces\\essay.md', path.win32), 'pieces/essay.md');
  assert.equal(projectRelative('/site', '/site/pieces/essay.md', path.posix), 'pieces/essay.md');
  assert.equal(projectRelative('C:\\site', 'C:\\site', path.win32), '');
});
