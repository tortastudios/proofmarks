# vite-html
Run `npm install` to link the unpublished local package; the bundled review uses fixture scores.
Start the site: `npm run dev`.
Proxy: `npx proofmarks dev --judge fake --port 4860`; open its URL with `?proof=1`.
Script: restart the site with `VITE_PROOFMARKS_SCRIPT=1 npm run dev`; run `npx proofmarks serve --judge fake` and open `?proof=1`.

The examples and script-tag snippets are MIT licensed; see [../LICENSE](../LICENSE), and paste them into your own sites.
