---
name: proofmarks
description: Set up Proofmarks on a person's website, so it marks AI-sounding writing on their real pages and their agent can rewrite it. Use when the person asks to "set up Proofmarks", "install Proofmarks", "add Proofmarks to my site" or "proofread my site", or wants to proof a page and the proofmarks_* tools aren't connected. Works on any stack, with npm for Node sites and the standalone program for Python, static and other sites.
---

# Set up Proofmarks

Do the whole setup for the person; they shouldn't need to type a command. Proofmarks runs on their machine, next to their site's development server: it shows proofreading marks on the real page, and Accept writes a rewrite into the source file. Its judge (Jev) is free to use through Torta's relay, with no key.

Don't call setup done until `proofmarks doctor` passes and a review returns real marks. If you can't check something, say exactly which part is unchecked.

## 1. Find the site and what's installed

- Work in the site's project folder: where its writing lives (Markdown or MDX in `content/`, `posts/`, `blog/` or `_posts/`, HTML pages, or templates). If it's unclear which folder, ask one short question.
- Check for an existing install: `npx --no-install proofmarks --version` or `proofmarks --version`. If either works, skip to step 3.
- Check for Node 22 or later (`node --version`) and the package manager (the lockfile: `pnpm-lock.yaml`, `yarn.lock`, `bun.lock`, or `package-lock.json`).

## 2. Install

- **A Node site (a `package.json`, and Node 22 or later):** add it as a development dependency with the project's package manager: `npm install --save-dev @tortastudios/proofmarks` (or `pnpm add -D`, `yarn add -D`, `bun add -d`). Run its commands as `npx proofmarks …`.
- **Anything else (Python, static, Ruby, no Node):** install the standalone program, which needs no Node. Run its commands as `proofmarks …`.
  - macOS or Linux with Homebrew: `brew install tortastudios/tap/proofmarks`
  - macOS or Linux without it: `curl -fsSL https://github.com/tortastudios/proofmarks/releases/latest/download/install.sh | sh`
  - Windows (PowerShell): `irm https://github.com/tortastudios/proofmarks/releases/latest/download/install.ps1 | iex`
  - With uv or pipx: `uv tool install proofmarks` or `pipx install proofmarks`

## 3. Configure

Run `proofmarks init --yes` in the project folder. Add `--content <folder>` if the writing isn't in a usual place. `--yes` accepts for the person: without it, `init` waits for a yes that you can't give, and changes nothing.

`init` writes `proofmarks.config.json`, connects Proofmarks to the agents it finds (Claude Code, Codex and pi), prints the command for any it can't connect, and prints the command that starts the site.

## 4. Start the site and Proofmarks

Run `proofmarks dev --background` in the project folder. If nothing answers at `devServer` in `proofmarks.config.json`, it first starts the site with the command `init` printed (for example `npm run dev`). It returns once the page is served and prints the address that shows it with Proofmarks on it. Both keep running after your session ends, which a process you start yourself usually doesn't; `proofmarks dev --stop` ends them.

If it says the site didn't answer, read `.proofmarks/site.log`: the site may be on another address (fix `devServer`), or need a different command (start it so it outlives your session, then run `proofmarks dev --background` again).

## 5. Check it end to end

1. Run `proofmarks doctor`. For every line marked ✗, follow its "Next:" step, then run it again. Lines marked – are warnings: Proofmarks works without them.
2. Run `proofmarks review <one document's source path>`. It should report marks from Jev, such as "Reviewed content/post.md: 4 marks". Zero marks on very plain writing is possible; try a second document before deciding something's wrong.
3. Open the page in the person's browser by running `open <address>` on macOS, `xdg-open <address>` on Linux or `start <address>` on Windows. The address is the one `proofmarks dev` printed, plus a document's path, plus `?proof=1`. Don't just print it.

## 6. Tell the person

In a few short lines:

- what you set up, and which files changed (`proofmarks.config.json`, a reviews folder, and `package.json` if you used npm);
- the page address to open, with `?proof=1`;
- that a rewrite only changes their file when they press Accept, and Undo puts it back;
- how to have an agent proof a page for them: restart this agent session (in Claude Code, run `/mcp`) so it picks up Proofmarks, then say "proof this page". The self-driving skill comes with `npx skills add tortastudios/proofmarks`, which installs this skill too.

Then ask once, in these words, with the link to everything usage counts send (https://github.com/tortastudios/proofmarks/blob/main/TELEMETRY.md), and run `proofmarks telemetry on` only if they say yes:

> Want to help tune Proofmarks' rules for everyone? Saying yes sends counts of which marks you keep or dismiss (the rule and its score, never your writing), and one count for this install with its version, system and where you found Proofmarks. Saying no sends nothing extra, and Proofmarks still tunes the rules to your site, on your machine. You can change it anytime with `proofmarks telemetry on` or `off`.

## Rules

- Never ask for or store a Jev key. None is needed, and `TYPESAFE_API_KEY` is only for people who want their own.
- Never turn usage counts on yourself. Only the person's yes does that, and `init --yes` never answers it.
- Don't commit, push or deploy anything. Proofmarks is for development; it never belongs in production.
- Leave processes the person started alone. Stop only what you started, and only if they ask.

## Troubleshooting

- **`init` found no writing:** run `proofmarks init --yes --content <folder>` with the folder the writing is in.
- **"Port 4849 is in use":** another `proofmarks dev` is running, maybe for another project. Proofmarks picks another port when you don't pass `--port`; use the address it prints.
- **The page shows no marks:** check the address has `?proof=1`, and that the page shows a document listed in `proofmarks.config.json`. Run `proofmarks review` on its source.
- **"Proofmarks' shared judge has reached today's limit":** it resets at midnight UTC; the person can set `TYPESAFE_API_KEY` to their own Jev key to keep going.
- **Something in Proofmarks itself looks wrong:** tell the person, and with their okay report it with `proofmarks_send_feedback` once the tools are connected.
