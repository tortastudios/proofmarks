# Telemetry and privacy

Proofmarks sends your writing only to be judged, or rewritten by the agent you choose, a feedback report only when you okay it, and usage counts only if you turn them on. This page lists every request Proofmarks makes, what's in it, and who receives it.

## Usage counts are off until you turn them on

- `proofmarks telemetry status`, `on` or `off`. The choice is saved in `~/.proofmarks/telemetry.json` and applies to every Proofmarks process on the machine, including helpers that are already running, from the next request each one starts. A request already under way finishes as it began. `proofmarks status` shows whether this project's running helper sends them.
- Setup asks once. `proofmarks init` asks at a terminal, and an agent setting Proofmarks up for you asks you. `init --yes` never answers for you.
- Any off wins: `DO_NOT_TRACK=1`, `proofmarks telemetry off` or `PROOFMARKS_TELEMETRY=0`. An environment variable reaches the processes started with it and the helper they share, and a dev proxy already running when `proofmarks dev --background` finds it; `proofmarks telemetry off` reaches everything, including a dev proxy already running in the background. `PROOFMARKS_TELEMETRY=1` turns them on for one process, unless one of those says off. A CI run (`CI` set to anything but empty, `0`, `false`, `off` or `no`) keeps them off unless `PROOFMARKS_TELEMETRY=1`.
- The helper that serves your pages is shared by the Proofmarks processes working on a project, such as your agent's and `proofmarks dev`. It starts no counted request while any of them turns counts off.
- Whatever you choose, Proofmarks tunes each rule's line to your site from the decision logs in your project's reviews folder, on your machine.

### What usage counts send

| Count | When | Fields |
| --- | --- | --- |
| Install | When this install gets a relay token with counts on | Proofmarks version, how it was installed (for example npm or Homebrew), operating system and architecture, and the listing you found it through, if its install command said |
| Decision | When you keep, dismiss, undo or restore a mark Jev scored | The rule, what you did, Jev's score rounded down to 0.05, the line the mark was shown under, the model and the rules version |
| Judge use | Each hour | How many judge calls installs with counts on made, their input tokens and cost, and how many of those installs were active |
| Feedback | When a feedback report is sent | Its kind, such as a bug or a wrong mark |

The relay passes these to Torta's analytics (PostHog). Decisions and judge use go as hourly totals, and they and feedback carry no install. An install count carries a random ID that comes from the relay token, never from your machine. No count has a person profile or a location. None carries text, a URL, a file name or a token.

## Every request Proofmarks makes

| Request | When | What it carries | Where it goes |
| --- | --- | --- | --- |
| Judge (`POST /v1/systemone`) | Reviewing a page, checking files, scoring a rewrite | The passages being judged, their surrounding text, the rules' questions and the relay token | Torta's relay, which passes it to Jev (TypeSafe). With `TYPESAFE_API_KEY`, straight to Jev |
| Token (`POST /v1/install`) | When Proofmarks has no token and needs one: to judge without your own key, or to send a decision count or a feedback report. Again when the relay turns a token down, and on the first request after your choice about counts changes | With counts off, only that they're off. With counts on, the install fields above | Torta's relay |
| Decision (`POST /v1/decisions`) | Only with counts on | The decision fields above and the token | Torta's relay |
| Feedback (`POST /v1/feedback`) | When you okay a report your agent wrote with `proofmarks_send_feedback` | The report's text and the token. With counts on, also the version, how Proofmarks was installed, and the operating system and architecture | Torta's relay, then the Proofmarks team's Slack. This goes through the relay even with your own key. `PROOFMARKS_FEEDBACK=0` removes the tool |
| Health (`GET /health`) | `proofmarks status` and `proofmarks doctor` | Nothing | Torta's relay. With your own key, `GET api.typesafe.ai/v1/models` checks the key instead |
| A page you check | `proofmarks check <URL>` | An ordinary request for that page | That URL |
| Your site | The dev proxy, while you use the page, and `proofmarks doctor`, which checks the site and the proxy answer | Your browser's requests, forwarded, or a plain request for a page | Your own site |
| A connected agent | When your agent calls Proofmarks' MCP tools | What it asks for: passages, paragraphs, rules, source paths, rewrites and decisions | Your agent, which may send what it reads to its own provider, under its own terms |
| A rewrite by an agent CLI | When you ask Claude Code, Codex or pi for a rewrite | The passage, its paragraph and the rule, plus the earlier rewrites when you ask for another | That agent's provider, under its own terms. Proofmarks passes `DO_NOT_TRACK` on to it |
| Install scripts | `install.sh` and `install.ps1` | A lookup of the latest version, then the download and checksum for your system | GitHub |
| Agent setup | `proofmarks init`, when pi is installed | pi installs the Proofmarks extension: from your project's copy with the npm package, or from npm with the standalone program | npm, through pi, for the standalone program |

There are no update checks, startup pings or crash reports.

## The relay token

`~/.proofmarks/install.json` holds a random token, readable only by you. It's your key to the shared judge, which lets the relay apply its rate limits and daily budget. It isn't derived from your machine. The relay can tell one token's requests apart, for its rate limits, but while counts are off it's told nothing about the install: no version, install route, system or listing. Delete the file anytime, and Proofmarks gets a new token the next time it starts. With your own Jev key, judging needs no token, and only a feedback report would get one. If a helper that judges through the relay is already running when you set your own key, Proofmarks asks you to restart it rather than send your writing through the relay.

## What the relay sees and keeps

- **No text.** It passes each judge request to Jev and returns the answer, without saving or logging the passages.
- **Feedback reports you okay,** which it posts to the Proofmarks team's Slack.
- **Your network address,** held in memory only, to limit new tokens per network per day. It isn't stored or sent anywhere.
- **Request counts per token,** in memory only, for rate limits.
- **Its own counts of calls and cost,** in memory only, to keep the shared judge within its daily budget.
- **Budget alerts:** when the shared judge passes 80% and 100% of its daily budget, the relay posts a note to Torta's Slack. It carries no install and no text.

The relay's code is in [`relay/`](relay/).

## What code can't promise

- The relay runs on DigitalOcean's App Platform, which may keep its own request logs under DigitalOcean's terms.
- Jev, from TypeSafe, receives the passages being judged, under TypeSafe's terms.

## This website

proofmarks.dev counts visits and clicks without cookies, and not at all if your browser asks not to be tracked (Do Not Track or Global Privacy Control). The clicks are Try it, picking an install route, copying a prompt or command, a link to GitHub and opening an FAQ answer. Each count carries the page's address, the page you came from and your screen and window widths, under a random ID that lasts one page load. It has no person profile and no location. That's separate from Proofmarks itself.
