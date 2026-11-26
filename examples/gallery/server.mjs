import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { marked } from 'marked';

// The gallery: one page per piece, read from its Markdown source on every request, so an accepted rewrite shows on reload.
const port = Number(process.env.PORT ?? 3767);
const pieces = JSON.parse(await readFile(new URL('./proofmarks.config.json', import.meta.url), 'utf8')).documents;
const kinds = { 'linkedin-post': 'LinkedIn post', 'landing-page': 'Landing page', 'cover-letter': 'Cover letter', 'launch-post': 'Product launch post', newsletter: 'Newsletter', recipe: 'Recipe post', 'engineering-blog': 'Engineering blog post', 'short-story': 'Short story', essay: 'Long essay' };
const style = 'body{background:#faf8f2;color:#302a25;font:20px/1.65 Georgia,serif;margin:0}main{max-width:700px;margin:64px auto;padding:24px}h1,h2{line-height:1.2}a{color:inherit}nav{max-width:700px;margin:24px auto 0;padding:0 24px;font:15px/1.4 system-ui,sans-serif}nav a{color:#7a6f64}ul.pieces{list-style:none;padding:0}ul.pieces li{margin:0 0 18px}ul.pieces small{display:block;color:#7a6f64;font:15px/1.4 system-ui,sans-serif}';
const page = (title, body, nav = true) => `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>${style}</style>${nav ? '<nav><a href="/">All pieces</a></nav>' : ''}${body}</html>`;
const words = text => text.split(/\s+/).filter(Boolean).length;

const server = createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    if (pathname === '/') {
      const items = await Promise.all(pieces.map(async piece => {
        const source = await readFile(new URL(piece.source, import.meta.url), 'utf8');
        return `<li><a href="${piece.url}">${source.match(/^# (.+)$/m)?.[1] ?? piece.id}</a><small>${kinds[piece.id] ?? 'Writing'}, ${words(source)} words</small></li>`;
      }));
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(page('Proofmarks gallery', `<main><h1>Proofmarks gallery</h1><p>Writing of different kinds and lengths, each with a saved review. Open one to see its marks.</p><ul class="pieces">${items.join('')}</ul></main>`, false));
      return;
    }
    const piece = pieces.find(entry => entry.url === pathname);
    if (!piece) { response.writeHead(404); response.end('Not found'); return; }
    const source = await readFile(new URL(piece.source, import.meta.url), 'utf8');
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(page(source.match(/^# (.+)$/m)?.[1] ?? piece.id, `<main data-proofmarks-root>${marked.parse(source)}</main>`));
  } catch { response.writeHead(500); response.end('Could not render the page.'); }
});
server.listen(port, '127.0.0.1', () => console.log(`Gallery: http://127.0.0.1:${port}`));
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close());
