<h1>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/assets/proofmarks-dark.svg">
    <img src=".github/assets/proofmarks.svg" alt="Proofmarks" width="240">
  </picture>
</h1>

[![npm](https://img.shields.io/npm/v/@tortastudios/proofmarks)](https://www.npmjs.com/package/@tortastudios/proofmarks)
[![PyPI](https://img.shields.io/pypi/v/proofmarks)](https://pypi.org/project/proofmarks/)
[![CI](https://github.com/tortastudios/proofmarks/actions/workflows/ci.yml/badge.svg)](https://github.com/tortastudios/proofmarks/actions/workflows/ci.yml)
[![License: FSL-1.1-MIT](https://img.shields.io/badge/license-FSL--1.1--MIT-blue)](LICENSE.md)

**See your writing the way an editor does.** Proofmarks marks what reads like AI slop on your page, says why, and rewrites it with the agent you already use. Accept writes the rewrite straight into your source file. See it work on [proofmarks.dev](https://proofmarks.dev).

![Proofmarks on a blog post: "I realized rejection isn't a verdict. It's data." and the opener "Here's the kicker:" get handwritten marks in the margin. The first mark's card sends it to Claude Code, which writes a rewrite, and Accept puts it in the post. Accept on the second deletes the opener, and both stay marked Accepted.](.github/assets/proofmarks.gif)

## Quick start

Paste this into your agent, in your site's project:

```text
Set up Proofmarks on this site, so it marks AI-sounding writing on my pages.

1. Run: npx skills add tortastudios/proofmarks --yes
2. Read the proofmarks skill it installed and follow it. If the install failed, follow https://proofmarks.dev/setup.md instead.
```

The agent installs Proofmarks, configures it, checks it with `proofmarks doctor`, and opens your page. There's no key to set up.

Or by hand, with Node.js 22 or later:

```sh
npm install --save-dev @tortastudios/proofmarks
npx proofmarks init
npx proofmarks dev --to http://localhost:3000
```

Open the address `dev` prints, with `?proof=1` on the end. To look around first, open the [gallery](examples/gallery/): nine kinds of writing, each with a saved review.

No Node? Install Proofmarks with `brew install tortastudios/tap/proofmarks`, a one-line installer or `uv tool install proofmarks`, then run the same commands without `npx`. See [Install](docs/install.md).

## How it works

1. **Mark.** Proofmarks reads the page's source, whether Markdown, MDX, HTML or a template, and checks each passage against 20 rules, from "Not X, but Y" to "Generic voice". Code finds the candidates, and a decision model confirms each one. The marks land in the margin of the page you already have open.
2. **Rewrite.** Select a mark to see why it's there. Ask your agent for a rewrite: it gets the passage, its paragraph and the rule, and the decision model checks its draft before you see it.
3. **Decide.** Accept writes the rewrite into the source file. Dismiss keeps the mark from coming back. Undo restores the original. As you decide, each rule's line moves toward what your site keeps and dismisses.

Ask your agent to "proof this page", and it drafts a rewrite for every mark while you watch; you accept them. In CI, `proofmarks check` marks a pull request's changed lines without opening the page: see [Checking without the page](docs/check.md).

<details>
<summary><strong>The rules:</strong> 20 on by default, and 1 you can turn on</summary>

| Rule | What it marks | Example |
| --- | --- | --- |
| Inflated word | A fancy word stands in for a plain one. | We leverage customer feedback to shape every release. |
| Filler | Words that delay the point without adding to it. | In order to get started, open the settings page and pick a plan. |
| Brochure verb | A costume for “is” or “has”. | The dashboard serves as a single home for your team's work. |
| Promotional adjective | Praise instead of description. | Our seamless onboarding gets new hires working on their first day. |
| Signposting | Announces a point instead of making it. | Simply put, most teams never read their own documentation. |
| Not X, but Y | Sets up a claim just to knock it down. | It's not a tool. It's a new way of working. |
| List of three | Three items for rhythm, not because there are three. | The new plan is faster, simpler, and more powerful. |
| Stacked hedges | Several hedges in one claim dodge commitment. | This could potentially help some teams in certain cases. |
| Vague attribution | Cites authority nobody can check. | Experts agree that shorter meetings lead to better decisions. |
| Trailing -ing clause | Bolts an unsupported conclusion onto a fact. | Signups doubled in March, highlighting the strength of our brand. |
| Chatbot residue | A conversational leftover that addresses no real reader. | Thanks for reading this far. I hope this helps! |
| False range | “From X to Y” with no real scale between them. | From solo founders to global enterprises, anyone can use it. |
| Puffery | Asserts importance instead of showing it. | The results of this launch speak for themselves. |
| Generic voice | Could describe any company; no specific detail or stance. | Marketing is all about understanding your audience. When you know what your customers want, you can create content that speaks to them. The key is to stay consistent and keep learning. |
| Repetition | Says the same thing again without adding to it. | Our support team answers within an hour, so you never wait long for help. Getting help is quick because the team replies fast, and those fast replies mean nobody is left waiting for an answer. |
| Over-explaining | Explains what the reader already knows. | To send a message, type your words into the box. The box is the white area at the bottom of the screen. When you have finished typing, press Send, and the message is sent. |
| Uniform rhythm | Every sentence has the same length and shape. | We start early. We test everything. We ship on Fridays. We read every reply. We fix what breaks. |
| Em dash | A dramatic pause before a reveal. | The update is small — but it changes how the whole team works. |
| Connecting colon | A colon used as a hinge between claims, not to introduce a list. | The answer was simple: we stopped holding weekly meetings. |
| Bold inflation | Bold used for emphasis instead of scanning. | Our new dashboard is **incredibly** easy to use. |

Off by default, and turned on in [`proofmarks.config.json`](docs/configuration.md):

| Rule | What it marks | Example |
| --- | --- | --- |
| Title case heading | Title Case headings read like marketing copy. | How We Rebuilt Our Onboarding Flow |

</details>

## Agents

Proofmarks works with the agent you already use. `init` connects the ones it finds, and each proof card lets you choose who rewrites.

| Agent | How it takes rewrites |
| --- | --- |
| Any agent, self-driving | Ask it to "proof this page" (in Claude Code, `/mcp__proofmarks__proof`). It rewrites every proof, checking each draft with the decision model, while you watch the page. You accept. |
| Claude Code, Codex or pi, with no conversation | Proofmarks runs it for each rewrite, with its tools turned off. There's nothing to start. |
| An agent you're working with | Ask it to "watch Proofmarks" (in Claude Code, `/mcp__proofmarks__watch`). This works in any MCP client, including the desktop apps, Cursor, VS Code, `claude -p` and the Agent SDK. |
| pi | Requests arrive in the session on their own, through the Proofmarks extension. |
| Claude Code, pushed | Requests arrive on their own when you start it with `claude --dangerously-load-development-channels server:proofmarks`, a research preview. |

## Privacy

- **Your writing leaves your machine only to be judged or rewritten.** Judging goes through Torta's relay to Jev, TypeSafe's decision model, and the relay doesn't keep the passages. Rewrites go to the agent you choose.
- **Usage counts are off unless you turn them on** (`proofmarks telemetry on`). If you do, Proofmarks sends counts of the marks you keep or dismiss, never your writing, to tune the rules for everyone. Either way, it tunes its rules to your site on your machine.
- **No account, no key.** Or set your own Jev key (`TYPESAFE_API_KEY`), and judging skips the relay.

[TELEMETRY.md](TELEMETRY.md) lists everything Proofmarks sends, and to whom.

## Docs

- [Install](docs/install.md): npm, Homebrew, the installers, uv and pipx, and what `init` does.
- [Configuration](docs/configuration.md): documents, write access, rebuilds and private access.
- [Agents and MCP tools](docs/agents.md): self-driving, watch mode, the twelve tools, feedback, pi, push and setting up by hand.
- [Integrations](docs/integrations.md): the proxy, the script tag, React, Next.js and the examples.
- [Formats](docs/formats.md): Markdown, MDX, HTML and templates.
- [Checking without the page](docs/check.md): `proofmarks check` for CI and bulk runs, on files, folders and URLs.
- [Judge, privacy and usage counts](docs/judge.md): Jev, what is sent and kept, opting out, and using your own key.
- [FAQ](docs/faq.md), [security](SECURITY.md) and [contributing](CONTRIBUTING.md).

## License

[FSL-1.1-MIT](LICENSE.md): use Proofmarks for anything except a commercial product or service that competes with it, including on your own sites and your clients' sites. Each version becomes MIT two years after its release. The [examples](examples/LICENSE) and script-tag snippets are MIT, and the Caveat handwriting font keeps its [OFL](src/overlay/OFL.txt).
