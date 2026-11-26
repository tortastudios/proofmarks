# fastapi-jinja
First, from the repository's root: `pnpm install --frozen-lockfile && pnpm build`. Then come back to this folder.
Install: `uv sync`; optionally run `npm install` to link the helper from this checkout.
Start the site: `uv run uvicorn app:app --host 127.0.0.1 --port 3765`.
Proxy: `node ../../dist/companion/bin.mjs dev --judge fake --port 4860`; open its URL with `?proof=1`.
Script: restart with `APP_ENV=development PROOFMARKS_SCRIPT=1 uv run uvicorn app:app --host 127.0.0.1 --port 3765`; run `node ../../dist/companion/bin.mjs serve --judge fake` and open `?proof=1`.

The examples and script-tag snippets are MIT licensed; see [../LICENSE](../LICENSE), and paste them into your own sites.
