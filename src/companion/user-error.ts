/** A plain message written for the person running the CLI; shown as is. Anything else is sanitized. */
export class UserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UserError';
  }
}

/** A file that can't be read says so, rather than blaming the judge: "Can't read post.md (ENOENT)". */
export function fileProblem(error: unknown) {
  const file = error as NodeJS.ErrnoException | null;
  return typeof file?.code === 'string' && /^E[A-Z]+$/.test(file.code) && typeof file.path === 'string'
    ? `Can't read ${file.path} (${file.code})`
    : undefined;
}
