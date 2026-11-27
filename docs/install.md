# Install

## With Node

Proofmarks needs Node.js 22 or later. In your site's project directory:

```sh
npm install --save-dev @tortastudios/proofmarks
npx proofmarks init
# Start your site's usual development server, then:
npx proofmarks dev --to http://localhost:3000
```

`npx proofmarks dev --background` runs it on its own instead, and starts your site first if nothing answers at its address. That's how an agent sets Proofmarks up: both keep running after the agent's session ends. `npx proofmarks dev --stop` ends them.

## Without Node

The standalone program is the same Proofmarks with Node built in. It runs on:

- macOS, Apple silicon or Intel (macOS 13.5 or later);
- Linux, x64 or arm64 (glibc 2.28 or later);
- Windows, x64.

Each download is about 45 MB. Install it once per machine, then use the commands above without `npx`, starting with `proofmarks init` in your project.

| Install with | Command | Update | Remove |
| --- | --- | --- | --- |
| Homebrew (macOS, Linux) | `brew install tortastudios/tap/proofmarks` | `brew upgrade proofmarks` | `brew uninstall proofmarks` |
| The installer (macOS, Linux) | `curl -fsSL https://github.com/tortastudios/proofmarks/releases/latest/download/install.sh \| sh` | Run it again | Delete `~/.proofmarks/bin/proofmarks` and `~/.proofmarks/versions`, then remove the PATH line the installer added. Delete all of `~/.proofmarks` only to also remove cached judgments, the relay token and your choice about usage counts |
| The installer (Windows, PowerShell) | `irm https://github.com/tortastudios/proofmarks/releases/latest/download/install.ps1 \| iex` | Run it again | Delete `%LOCALAPPDATA%\Proofmarks` and remove its `bin` folder from your PATH |
| uv or pipx | `uv tool install proofmarks` or `pipx install proofmarks` | `uv tool upgrade proofmarks` or `pipx upgrade proofmarks` | `uv tool uninstall proofmarks` or `pipx uninstall proofmarks` |

The installers download from the latest GitHub release and refuse a download that doesn't match its published SHA-256. They keep the current and previous versions. Set `PROOFMARKS_VERSION` to install a particular version, or `PROOFMARKS_HOME` to install somewhere else.

- **macOS and Linux:** the installer links `~/.proofmarks/bin/proofmarks` and prints the line to add to your PATH rather than editing your shell profile.
- **Windows:** the installer adds its `bin` folder to your user PATH.

Each release lists its archives and their checksums. The macOS programs are signed by Torta Studios and notarized by Apple.

## As a plugin for Claude Code or Codex

[Torta Studios' catalog](https://github.com/tortastudios/plugins) has a Proofmarks plugin for Claude Code and Codex. It starts Proofmarks' MCP server in every project and brings the `proofmarks` and `proofmarks-self-driving` skills:

```sh
claude plugin marketplace add tortastudios/plugins && claude plugin install proofmarks@tortastudios
codex plugin marketplace add tortastudios/plugins && codex plugin add proofmarks@tortastudios
```

Then ask the agent to "set up Proofmarks on this site". The setup skill installs Proofmarks in the project and runs `init`, which leaves the agent alone because the plugin already connects it. In a project Proofmarks isn't set up in, the plugin's server starts nothing and writes nothing. Its one tool, `proofmarks_setup`, says how to set it up.

## What init does

`init` looks for writing in `content/`, `src/content/`, `_posts/`, `posts/`, `src/posts/`, `blog/` and `templates/`, plus a root `index.html`. Point it at another folder with `--content <folder>`.

The first time, it asks before writing [configuration](configuration.md) and [connecting your agents](agents.md), and it asks again when it finds new documents. Later runs connect an agent installed since without asking. It prints the command that starts your site. An agent setting Proofmarks up for you runs `init --yes`, which accepts without asking; without a terminal and without `--yes`, `init` changes nothing.

`proofmarks doctor` checks each link: the configuration, the judge, your site, the page with the proofs, who can write rewrites, and which agents are connected. Each problem comes with the next step, and `--json` gives the same for scripts and agents. Check the document list, and set `write` to `true` only for files you want Proofmarks to edit.

Listings add `--via <name>` to `init` (for example `--via mcp-registry`), or set `PROOFMARKS_VIA` in an MCP config, so the install count can say where people found Proofmarks, for people who turn usage counts on.

There's no key to set up: reviews use Jev through Torta's relay. Usage counts are off unless you turn them on with `proofmarks telemetry on`, and `TYPESAFE_API_KEY` lets you use your own Jev key instead. See [Judge, privacy and usage counts](judge.md).

## Opening a page

Open the address `dev` prints, with `?proof=1` on the end. The proxy forwards your site and adds the review script. A page that hasn't been reviewed yet shows a badge that runs its first review.

The helper normally listens on port 4848 and the proxy on 4849. If one is taken, for example by a second project, Proofmarks uses another free port and `dev` prints the address. A port you choose with `--port` is used as given, or refused if it's taken.

## Trying it without a key

Set `"judge": { "provider": "fake", "model": "fixture-1" }` in `proofmarks.config.json`, or pass `--judge fake` to `dev` and `review`. That lets you try everything locally.

The fake judge is deterministic test data. It marks almost every candidate, so its marks shouldn't guide real editing. The [gallery](../examples/gallery/) shows real marks from saved Jev reviews without a key.
