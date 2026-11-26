// Builds proofmarks.dev into site/dist: the page, with its rules taken from the registry so it can't drift
// from the product; the live demo, bundled with the overlay from source; and the assets. With --serve, it then serves
// site/dist on 127.0.0.1:4960 for a local look.
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const site = new URL('../site/', import.meta.url).pathname;
const out = path.join(site, 'dist');
const registry = JSON.parse(await readFile(new URL('../rules/rules.v3.json', import.meta.url), 'utf8'));
const escape = text => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// Each rule shows an example, and each rule that's on has a real mark on its example (rules-review.json), so the live
// marks can't drift from the rules either.
const examples = JSON.parse(await readFile(path.join(site, 'rule-examples.json'), 'utf8'));
const examplesReview = JSON.parse(await readFile(path.join(site, 'rules-review.json'), 'utf8'));
const plain = text => text.replaceAll('**', '');
for (const rule of registry.rules) {
  if (!examples[rule.id]) throw new Error(`site/rule-examples.json has no example for ${rule.id}`);
  if (
    rule.default &&
    !examplesReview.findings.some(f => f.rule === rule.id && plain(examples[rule.id]).includes(plain(f.match)))
  )
    throw new Error(`site/rules-review.json has no mark on ${rule.id}'s example`);
}
const example = text => escape(text).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
const on = registry.rules.filter(rule => rule.default);
const rows = rules =>
  rules
    .map(
      rule =>
        `<li><span class="rule-name">${escape(rule.label)}</span> <span class="rule-why">${escape(rule.why)}</span>` +
        `<p class="rule-example">${example(examples[rule.id])}</p></li>`,
    )
    .join('\n          ');
// Every command and prompt a visitor might copy is one pill button: <pm-command> for a shell command, <pm-prompt> for
// what to tell an agent.
const attribute = text => escape(text).replaceAll('"', '&quot;');
const icons =
  '<span class="command-icon" aria-hidden="true">' +
  '<svg class="icon-copy" viewBox="0 0 16 16"><rect x="5.5" y="5.5" width="8" height="8" rx="2"/><path d="M10.5 5.5V4a1.5 1.5 0 0 0-1.5-1.5H4A1.5 1.5 0 0 0 2.5 4v5A1.5 1.5 0 0 0 4 10.5h1.5"/></svg>' +
  '<svg class="icon-check" viewBox="0 0 16 16"><path d="M3.5 8.5l3 3 6-7"/></svg></span>';
const pill = (kind, text) =>
  `<button type="button" class="command" data-kind="${kind}" data-copy="${attribute(text)}" data-copied="false" ` +
  `aria-label="Copy ${attribute(text)}">` +
  (kind === 'command' ? '<span class="command-prompt" aria-hidden="true">$</span>' : '') +
  `<span class="command-text"><span class="command-value">${escape(text)}</span>` +
  '<span class="command-done" aria-hidden="true">Copied to clipboard</span></span>' +
  `${icons}</button>`;
// Agent skills use setup-skills.txt; other install routes fill setup-manual.txt with their command and how to run it.
const routes = JSON.parse(await readFile(path.join(site, 'install-routes.json'), 'utf8'));
const prompt = async name => (await readFile(path.join(site, 'prompts', `${name}.txt`), 'utf8')).trim();
const manual = await prompt('setup-manual');
const setups = await Promise.all(
  routes.map(async route => ({
    route,
    text:
      route.id === 'skills'
        ? await prompt('setup-skills')
        : manual.replaceAll('{{command}}', route.command).replaceAll('{{run}}', route.run),
  })),
);
const promptBody = (text, attributes = '') =>
  `<div class="prompt-body"${attributes}>` +
  text
    .split(/\n\s*\n/)
    .map(block => {
      const steps = block.split('\n').map(line => /^(\d+)\.\s+(.*)$/.exec(line));
      return steps.every(Boolean)
        ? `<ol>${steps.map(step => `<li>${escape(step[2])}</li>`).join('')}</ol>`
        : `<p>${escape(block.replace(/\s*\n\s*/g, ' '))}</p>`;
    })
    .join('') +
  '</div>';
const copyPrompt = text =>
  `<button type="button" class="prompt-copy" data-copy="${attribute(text)}" data-copied="false" aria-label="Copy the prompt">` +
  '<span class="prompt-copy-text">Copy prompt</span>' +
  '<span class="command-done" aria-hidden="true">Copied</span></button>';
const promptBox = async name => {
  if (name !== 'setup') {
    const text = await prompt(name);
    return `<div class="prompt-box"><div class="prompt-head"><span class="prompt-label">Prompt</span>${copyPrompt(text)}</div>${promptBody(text)}</div>`;
  }
  // A menu styled like the page, not the browser's own select: a button, then a listbox of routes.
  const chevron = '<svg class="picker-chevron" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 4.5l3 3 3-3"/></svg>';
  const check = '<svg class="picker-check" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7"/></svg>';
  const picker =
    '<div class="prompt-picker" data-picker>' +
    '<button type="button" class="picker-trigger" aria-haspopup="listbox" aria-expanded="false" aria-controls="install-routes">' +
    `<span class="sr-only">How to install: </span><span data-picker-label>${escape(setups[0].route.label)}</span>${chevron}</button>` +
    '<ul class="picker-menu" id="install-routes" role="listbox" aria-label="How to install Proofmarks" tabindex="-1" hidden>' +
    setups
      .map(
        ({ route }, i) =>
          `<li role="option" id="route-${route.id}" data-value="${route.id}" aria-selected="${i === 0}">${escape(route.label)}${check}</li>`,
      )
      .join('') +
    '</ul></div>';
  return (
    `<div class="prompt-box" data-prompt-routes><div class="prompt-head">${picker}${copyPrompt(setups[0].text)}</div>` +
    setups
      .map(({ route, text }, i) =>
        promptBody(text, ` data-route="${route.id}" data-text="${attribute(text)}"${i ? ' hidden' : ''}`),
      )
      .join('') +
    '</div>'
  );
};
const boxes = {};
for (const name of ['setup']) boxes[name] = await promptBox(name);
const page = (await readFile(path.join(site, 'index.html'), 'utf8'))
  .replace(/<pm-prompt-box name="(\w+)"\s*>\s*<\/pm-prompt-box\s*>/g, (_, name) => boxes[name])
  .replace(/<pm-(command|prompt)\s*>([^<]*)<\/pm-\1\s*>/g, (_, kind, text) =>
    pill(kind, text.trim().replace(/\s+/g, ' ')),
  )
  .replaceAll('{{ruleCount}}', String(on.length))
  .replace('{{rules}}', rows(on))
  .replace('{{offRules}}', rows(registry.rules.filter(rule => !rule.default)));
if (page.includes('{{') || page.includes('<pm-'))
  throw new Error('site/index.html has a placeholder the build does not fill');

await rm(out, { recursive: true, force: true });
await mkdir(path.join(out, 'assets'), { recursive: true });
// Visit counts need the Proofmarks PostHog project's key and host from the environment; without both, the site
// is built with none and sends nothing.
const analytics =
  process.env.PROOFMARKS_SITE_POSTHOG_KEY && process.env.PROOFMARKS_SITE_POSTHOG_HOST
    ? {
        key: process.env.PROOFMARKS_SITE_POSTHOG_KEY,
        host: process.env.PROOFMARKS_SITE_POSTHOG_HOST.replace(/\/$/, ''),
      }
    : null;
if (analytics && !/^https:\/\/[\w.-]+$/.test(analytics.host))
  throw new Error('PROOFMARKS_SITE_POSTHOG_HOST must be an https origin, such as https://us.i.posthog.com');
await build({
  entryPoints: { demo: path.join(site, 'demo.ts'), faq: path.join(site, 'faq.ts') },
  define: { SITE_ANALYTICS: JSON.stringify(analytics) },
  bundle: true,
  splitting: true,
  format: 'esm',
  outdir: out,
  platform: 'browser',
  target: 'es2022',
  minify: true,
  logLevel: 'warning',
});
await cp(path.join(site, 'site.css'), path.join(out, 'site.css'));
// The stylesheet and script carry a hash of their contents, so a deploy never meets a stale copy in a browser.
const stamp = async file =>
  createHash('sha256')
    .update(await readFile(path.join(out, file)))
    .digest('hex')
    .slice(0, 10);
await writeFile(
  path.join(out, 'index.html'),
  page
    .replace('href="/site.css"', `href="/site.css?v=${await stamp('site.css')}"`)
    .replace('src="/demo.js"', `src="/demo.js?v=${await stamp('demo.js')}"`),
);
// The FAQ shares the home page's header and footer, taken from it, so the two never drift.
const shared = name => {
  const part = new RegExp(`<${name} class="(?:top|foot)">[\\s\\S]*?</${name}>`).exec(page)?.[0];
  if (!part) throw new Error(`site/index.html has no ${name} for the FAQ`);
  return part;
};
const faq = (await readFile(path.join(site, 'faq.html'), 'utf8'))
  .replace('{{header}}', shared('header'))
  .replace('{{footer}}', shared('footer'))
  .replaceAll('{{ruleCount}}', String(on.length));
if (faq.includes('{{') || faq.includes('<pm-'))
  throw new Error('site/faq.html has a placeholder the build does not fill');
// The 404 page shares them too; App Platform serves it for any path the site doesn't have.
const notFound = (await readFile(path.join(site, '404.html'), 'utf8'))
  .replace('{{header}}', shared('header'))
  .replace('{{footer}}', shared('footer'));
if (notFound.includes('{{')) throw new Error('site/404.html has a placeholder the build does not fill');
await writeFile(
  path.join(out, '404.html'),
  notFound.replace('href="/site.css"', `href="/site.css?v=${await stamp('site.css')}"`),
);
await mkdir(path.join(out, 'faq'), { recursive: true });
await writeFile(
  path.join(out, 'faq', 'index.html'),
  faq
    .replace('href="/site.css"', `href="/site.css?v=${await stamp('site.css')}"`)
    .replace('src="/faq.js"', `src="/faq.js?v=${await stamp('faq.js')}"`),
);
await cp(path.join(site, 'assets'), path.join(out, 'assets'), { recursive: true });
// The setup skill, for agents that can't install skills: the hero's prompt points here, and it can't drift from the
// skill because it is the skill.
await cp(new URL('../skills/proofmarks/SKILL.md', import.meta.url).pathname, path.join(out, 'setup.md'));
// The install scripts, so their commands stay short: curl -fsSL https://proofmarks.dev/install.sh | sh. They are the
// repo's own, and each still downloads the latest release from GitHub.
for (const script of ['install.sh', 'install.ps1'])
  await cp(new URL(`./${script}`, import.meta.url).pathname, path.join(out, script));
// For search engines: everything may be crawled, and the sitemap lists the two pages.
for (const file of ['robots.txt', 'sitemap.xml']) await cp(path.join(site, file), path.join(out, file));
for (const asset of ['proofmarks.svg'])
  await cp(new URL(`../.github/assets/${asset}`, import.meta.url).pathname, path.join(out, 'assets', asset));
console.log(
  `Built proofmarks.dev into ${path.relative(process.cwd(), out) || out}${analytics ? ', with visit counts' : ''}`,
);

if (process.argv.includes('--serve')) {
  const types = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css',
    '.js': 'text/javascript',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.woff2': 'font/woff2',
    '.txt': 'text/plain; charset=utf-8',
    '.md': 'text/markdown; charset=utf-8',
    '.sh': 'text/plain; charset=utf-8',
    '.ps1': 'text/plain; charset=utf-8',
  };
  createServer(async (request, response) => {
    let file = path.join(out, decodeURIComponent(new URL(request.url ?? '/', 'http://site').pathname));
    if (file.endsWith('/')) file = path.join(file, 'index.html');
    if (!file.startsWith(out)) return void response.writeHead(403).end();
    try {
      const body = await readFile(file);
      // A preview is rebuilt often, so the browser never keeps a copy.
      response
        .writeHead(200, {
          'content-type': types[path.extname(file)] ?? 'application/octet-stream',
          'cache-control': 'no-store',
        })
        .end(body);
    } catch {
      response.writeHead(404).end('Not found');
    }
  }).listen(4960, '127.0.0.1', () => console.log('Serving on http://127.0.0.1:4960'));
}
