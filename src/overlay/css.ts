/**
 * Marks a stylesheet. Prettier formats the CSS inside css`...`, and the browser build minifies it
 * (scripts/build-browser.mjs), so the source stays readable and the page script stays small.
 */
export const css = (strings: TemplateStringsArray, ...values: string[]) =>
  strings.reduce((all, part, i) => all + part + (values[i] ?? ''), '');
