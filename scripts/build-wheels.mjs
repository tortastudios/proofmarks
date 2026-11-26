// Builds the Python wheels for `uv tool install proofmarks` and `pipx install proofmarks`: one per platform, each
// carrying that platform's standalone program and a few lines of Python that hand straight over to it. Run after
// build-standalone.mjs. Writes .standalone/wheels/.
//
//   node scripts/build-wheels.mjs [--target <target> ...]   (default: every target that has been built)
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..'),
  work = path.join(root, '.standalone');
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')),
  version = pkg.version;
// Node 26's official builds need macOS 13.5 or later and glibc 2.28 or later.
const tags = {
  'darwin-arm64': 'macosx_13_0_arm64',
  'darwin-x64': 'macosx_13_0_x86_64',
  'linux-x64': 'manylinux_2_28_x86_64',
  'linux-arm64': 'manylinux_2_28_aarch64',
  'win-x64': 'win_amd64',
};
const asked = process.argv.slice(2).flatMap((arg, i, all) => (all[i - 1] === '--target' ? [arg] : []));
const built = [];
for (const target of Object.keys(tags)) {
  try {
    await stat(path.join(work, `proofmarks-${version}-${target}`));
    built.push(target);
  } catch {
    /* Not built. */
  }
}
const targets = asked.length ? asked : built;
if (!targets.length) throw new Error('Build the standalone program first: node scripts/build-standalone.mjs');
const out = path.join(work, 'wheels');
await mkdir(out, { recursive: true });

const python = {
  '__init__.py': `"""Proofmarks: a proofreader for AI-sounding writing, drawn on your real page."""\n\n__version__ = "${version}"\n`,
  '__main__.py': 'from ._run import main\n\nmain()\n',
  '_run.py': `"""Runs the standalone Proofmarks program that ships inside this package."""

import os
import subprocess
import sys
from pathlib import Path


def main():
    folder = Path(__file__).resolve().parent / "standalone" / "dist" / "companion"
    program = folder / ("proofmarks.exe" if os.name == "nt" else "proofmarks")
    if os.name == "nt":
        sys.exit(subprocess.call([str(program), *sys.argv[1:]]))
    # Named "proofmarks", so the program registers the command on PATH with agents, not this folder.
    os.execv(str(program), ["proofmarks", *sys.argv[1:]])
`,
};
// PyPI shows the README without the repository around it, so its relative links and images point at this release on GitHub.
const repository = `https://github.com/tortastudios/proofmarks`,
  raw = `https://raw.githubusercontent.com/tortastudios/proofmarks/v${version}/`;
const relative = target => !/^(?:[a-z]+:|#|\/)/i.test(target);
const readme = (await readFile(path.join(root, 'README.md'), 'utf8'))
  .replace(/(!?)\[([^\]]*)\]\(([^)\s]+)\)/g, (all, image, text, target) =>
    relative(target) ? `${image}[${text}](${image ? raw : `${repository}/blob/v${version}/`}${target})` : all,
  )
  .replace(/\b(src|srcset)="([^"]+)"/g, (all, attribute, target) =>
    relative(target) ? `${attribute}="${raw}${target}"` : all,
  );
const record = async (folder, relative) => {
  const bytes = await readFile(path.join(folder, relative));
  return `${relative},sha256=${createHash('sha256').update(bytes).digest('base64url')},${bytes.length}`;
};
async function files(folder, prefix = '') {
  const found = [];
  for (const entry of await readdir(path.join(folder, prefix), { withFileTypes: true })) {
    const relative = path.posix.join(prefix, entry.name);
    if (entry.isDirectory()) found.push(...(await files(folder, relative)));
    else if (entry.isFile()) found.push(relative);
  }
  return found;
}

for (const target of targets) {
  const tag = tags[target];
  if (!tag) throw new Error(`Unknown target ${target}`);
  const stage = path.join(work, 'wheel-stage', target),
    info = `proofmarks-${version}.dist-info`;
  await rm(stage, { recursive: true, force: true });
  await mkdir(path.join(stage, 'proofmarks'), { recursive: true });
  for (const [name, text] of Object.entries(python)) await writeFile(path.join(stage, 'proofmarks', name), text);
  // The archive's contents, without its top-level launcher: the console script below replaces it.
  const archived = path.join(work, `proofmarks-${version}-${target}`);
  await cp(archived, path.join(stage, 'proofmarks/standalone'), {
    recursive: true,
    filter: source => !['proofmarks', 'proofmarks.cmd'].includes(path.relative(archived, source)),
  });
  await mkdir(path.join(stage, info));
  await writeFile(
    path.join(stage, info, 'METADATA'),
    [
      'Metadata-Version: 2.4',
      'Name: proofmarks',
      `Version: ${version}`,
      'Summary: A proofreader for AI-sounding writing, drawn on your real page. Works with any stack and any MCP agent.',
      'License-Expression: FSL-1.1-MIT',
      'Project-URL: Homepage, https://github.com/tortastudios/proofmarks',
      'Project-URL: Issues, https://github.com/tortastudios/proofmarks/issues',
      'Requires-Python: >=3.8',
      'Description-Content-Type: text/markdown',
      '',
      readme,
    ].join('\n'),
  );
  await writeFile(
    path.join(stage, info, 'WHEEL'),
    `Wheel-Version: 1.0\nGenerator: proofmarks build-wheels.mjs\nRoot-Is-Purelib: false\nTag: py3-none-${tag}\n`,
  );
  await writeFile(path.join(stage, info, 'entry_points.txt'), '[console_scripts]\nproofmarks = proofmarks._run:main\n');
  const listed = (await files(stage)).sort();
  await writeFile(
    path.join(stage, info, 'RECORD'),
    [...(await Promise.all(listed.map(file => record(stage, file)))), `${info}/RECORD,,`, ''].join('\n'),
  );
  const wheel = path.join(out, `proofmarks-${version}-py3-none-${tag}.whl`);
  await rm(wheel, { force: true });
  // zip keeps each file's mode, so the program stays executable once installed.
  execFileSync('zip', ['-qrX', wheel, 'proofmarks', info], { cwd: stage });
  console.log(path.relative(root, wheel));
}
await rm(path.join(work, 'wheel-stage'), { recursive: true, force: true });
