import sea from 'node:sea';
import path from 'node:path';

/** True inside the standalone program (Node's single executable), where the code and the executable are one file. */
export const standalone = sea.isSea();

/** The standalone program's version, set when it's built; undefined in the npm package. */
export const standaloneVersion = process.env.PROOFMARKS_STANDALONE_VERSION;

/** How agents start the standalone program: the command as it was run, so an upgrade through a package manager keeps the registration. */
export function standaloneCommand() {
  const invoked = process.argv[1] ?? process.execPath;
  return /[/\\]/.test(invoked) ? path.resolve(invoked) : invoked;
}
