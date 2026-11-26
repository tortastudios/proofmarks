/** Server diagnostics stay in Full record; ordinary surfaces use reader copy. */
export function readerActionReason(reason: string): string {
  if (reason === 'Another copy of this sentence changed. Reload to try again.') return reason;
  if (/ambiguous|more than once/i.test(reason))
    return "This sentence appears more than once in the file, so it can't be edited from here.";
  if (/no longer matches|text has changed|source text.*match|source match is empty/i.test(reason))
    return 'The text changed since this proof was made.';
  if (/no nonempty rewrite|empty rewrite|no rewrite/i.test(reason)) return 'No rewrite yet.';
  return "This proof can't be applied right now.";
}
