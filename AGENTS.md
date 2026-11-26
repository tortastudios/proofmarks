# Proofmarks

This file is for coding agents working on this repository. To use Proofmarks in your own project, see [README.md](README.md) and [docs/](docs/).

## Layout

- `src/companion/`: the CLI, the helper, the MCP server, `init` and the standalone program's hooks.
- `src/server/`: the page API (reviews, decisions, the change stream, source edits).
- `src/overlay/`: the browser overlay (plain DOM in a shadow root) and the React wrapper.
- `src/judge/`, `src/detect/` and `rules/`: the judge, pattern checks and the rule registry.
- `src/agents/`, `src/hosts/headless/` and `src/pi/`: agent registration, rewrites with no conversation, and the pi extension.
- `scripts/`: builds, smoke tests, the standalone program, installers, wheels and the Homebrew formula.
- `examples/`: runnable examples; `gallery` is the main one. `docs/`: the user docs.

## Commands

```sh
pnpm install --frozen-lockfile
pnpm format          # Prettier; lint fails on unformatted code
pnpm typecheck && pnpm lint && pnpm test
pnpm build && pnpm smoke:package   # the package smoke needs uv
```

[CONTRIBUTING.md](CONTRIBUTING.md) covers the standalone program, releases and running tests with a CI-like PATH.

## Rules

- **Tests:** they use the fake judge and stub agent commands only. Never call Jev or a real agent CLI from a test, and keep test output under `.test-work/`.
- **Package size:** the npm package is public and has a size budget (`scripts/smoke-package.mjs`). Avoid new runtime dependencies.
- **Compatibility:** keep MCP tool names, event shapes and source-editing behavior compatible. Agents and saved reviews depend on them.
- **Overlay:**
  - margin labels never move when someone interacts with the page;
  - visible changes need a look in a real browser, keyboard use and reduced motion.
- **Copy:** plain sentence case, no em dashes.
- **The handwriting font** is generated. After changing it, rerun `scripts/subset-font.py` rather than editing `src/overlay/font-data.ts`.
- **Commits:** a short imperative subject, and a body explaining the behavior and how it was verified.
