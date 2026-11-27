# Changelog

## [0.1.2]

November 26, 2026.

- The MCP server starts quietly in a project Proofmarks isn't set up in, as a plugin or the MCP Registry starts it: it starts nothing and writes nothing, and its one tool, `proofmarks_setup`, tells the agent how to set Proofmarks up.
- Every MCP tool has a title, which hosts show when they ask before running one.
- The package carries its MCP Registry name, `dev.proofmarks/proofmarks`, and pi's `pi-package` keyword, and its homepage is proofmarks.dev.

## [0.1.1]

November 26, 2026.

- `init` gives an index page its folder's address, so `blog/first-week/index.html` matches its page at `/blog/first-week/`. A plain HTML page gets its own path, and a Markdown page bundle its folder's name.
- Proofmarks works inside an agent's sandbox, such as Codex's: `doctor` and `dev` see the running proxy, `dev --stop` says to run it in a terminal, and a judge cache that can't be written no longer stops a review.
- The setup prompt says you're OK with Proofmarks sending your pages' text to Torta's relay, so an agent that checks before sending text elsewhere lets the first review through.

## [0.1.0]

November 26, 2026.

- Standalone package with a built CLI, local helper, MCP server and browser overlay.
- Optional React and Next.js integrations and validated project configuration.
- Markdown, MDX, HTML and Jinja-style source adapters.
- Five runnable examples, including a gallery of nine kinds of writing with saved Jev reviews.
- Local security checks, revision-aware editing and a durable decision history.
- A pi extension that pushes rewrite requests into pi sessions, like Claude Code's channel.
- A standalone program for macOS, Linux and Windows that needs no Node, installed with Homebrew, a one-line installer, or uv and pipx.
- Setup your agent does for you: the `proofmarks` skill installs, configures, starts and checks Proofmarks from "set up Proofmarks on this site". `init --yes` accepts without a prompt, and `proofmarks doctor` checks every link and names the next step.
- Self-driving: ask an agent to "proof this page" (`/mcp__proofmarks__proof`, or the `proofmarks-self-driving` skill). It opens the page, rewrites every proof, checks each draft with the judge before proposing, and leaves Accept to you.
- Proofmarks learns your site's eye: each rule's line moves with the marks you accept and dismiss, at most 0.15 from the calibrated line. Settings shows the rules that moved, each with a Reset, and rewrites and `proofmarks check` use the same lines.
- `proofmarks dev --background` starts the proxy, and the site if it isn't running, on their own, so they outlive the agent session that set Proofmarks up; `--stop` ends both.
- `proofmarks check` judges files, folders, globs and URLs without the page, for CI and bulk runs: plain text, JSON or GitHub annotations (the default in GitHub Actions), and `--fail-on` for the exit code.
- A project turns rules on or off in `proofmarks.config.json` (`"rules": { "title-case": true }`). Title case heading is the one rule that starts off.
- Em dash, connecting colon and bold inflation are on, confirmed by the decision model and calibrated on new planted passages and 18F posts: a dash that sets up a reveal, a colon that hinges a setup to its payoff, bold on ordinary words. Asides in dashes, colons before a list and bold labels are left alone.
- No Jev key needed: reviews go through Torta's relay, which keeps no text. `TYPESAFE_API_KEY` still uses your own key directly.
- Usage counts are off until you turn them on (`proofmarks telemetry on`, or yes when setup asks). `DO_NOT_TRACK=1` and `proofmarks telemetry off` keep them off everywhere, and CI runs keep them off unless `PROOFMARKS_TELEMETRY=1`. [TELEMETRY.md](https://github.com/tortastudios/proofmarks/blob/main/TELEMETRY.md) lists every request Proofmarks makes.
