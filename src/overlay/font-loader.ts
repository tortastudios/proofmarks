/** Bundlers split this asset; the standalone browser build supplies a script-relative loader. */
export async function loadHandwritingFont() {
  return (await import('./font-data')).handwritingFont;
}
