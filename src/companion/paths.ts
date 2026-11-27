import path from 'node:path';

/**
 * A path inside the project as reviews and the config record it: relative, with forward slashes on every system, so a
 * review or config made on Windows works on macOS and Linux, and the other way round.
 */
export const projectRelative = (from: string, to: string, paths: path.PlatformPath = path) =>
  paths.relative(from, to).split(paths.sep).join('/');
