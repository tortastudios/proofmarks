# static
First, from the repository's root: `pnpm install --frozen-lockfile && pnpm build`. Then come back to this folder.
No other install needed: use Python 3 and the helper at `../../dist/companion/bin.mjs` from this checkout.
Start the site: `python3 -m http.server 3766 --bind 127.0.0.1`.
Proxy: `node ../../dist/companion/bin.mjs dev --judge fake --port 4860`; open its URL with `?proof=1`.
Script: run `node ../../dist/companion/bin.mjs serve --judge fake` and open `?proof=1&proofmarks-script=1` locally; remove the script block before publishing.

The examples and script-tag snippets are MIT licensed; see [../LICENSE](../LICENSE), and paste them into your own sites.
