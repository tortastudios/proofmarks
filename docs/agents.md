# Agents and MCP tools

Rewrites come from an agent, chosen in a proof card's agent menu. A rewrite stays a proposal until you accept it.

## With no conversation

If Claude Code, Codex or pi is installed, the menu offers it "with no conversation". For each rewrite, Proofmarks runs `claude -p`, `codex exec` or `pi -p` itself, with the agent's tools turned off, and shows the result on the card. There's nothing to start, and it uses the agent's own sign-in. Each run sees the passage, its paragraph and the rule, and gives up after 90 seconds. Rewrite all runs several at once, up to a limit.

## Self-driving: the agent proofs the page

Tell an agent that has Proofmarks connected to "proof this page" (in Claude Code, `/mcp__proofmarks__proof`). It opens the page in your browser and refreshes the proofs. Then it writes a rewrite for each one, checking every draft with the judge before proposing it, up to three drafts per proof. You watch the rewrites arrive on the page and accept the ones you like. The agent never accepts, dismisses or edits the source itself.

To teach any agent the loop, install the skill:

```sh
npx skills add tortastudios/proofmarks
```

## With an agent you're working with

`init` registers Proofmarks' MCP server with Claude Code and Codex, and installs the Proofmarks extension for pi. A session that has it shows up in the menu.

Ask the agent to "watch Proofmarks". In Claude Code, `/mcp__proofmarks__watch` does the same. The agent then works in a loop until you stop it:

1. It waits for requests from the page.
2. It writes and proposes each rewrite.
3. It waits again.

While it watches, that session is busy; interrupt it to talk, then ask it to watch again.

This works in any MCP client, including the Claude and Codex desktop apps, Cursor, VS Code, `claude -p` and the Agent SDK.

To register the server by hand:

```sh
claude mcp add proofmarks -- npx --no-install proofmarks mcp --project /absolute/path/to/your/project
```

With the standalone program, use `proofmarks` in place of `npx --no-install proofmarks`.

Started without `--project` in a project Proofmarks isn't set up in, as a plugin or the MCP Registry starts it, the server starts nothing and writes nothing. Its one tool, `proofmarks_setup`, tells the agent how to set Proofmarks up.

An Agent SDK program can watch Proofmarks unattended:

```ts
import { query } from '@anthropic-ai/claude-agent-sdk';

for await (const message of query({
  prompt: 'Watch Proofmarks: call proofmarks_watch. For each rewrite request, claim it, write one rewrite and propose it, then watch again.',
  options: {
    mcpServers: { proofmarks: { command: 'npx', args: ['--no-install', 'proofmarks', 'mcp', '--project', process.cwd()] } },
    allowedTools: ['mcp__proofmarks__*'],
  },
})) if (message.type === 'result') console.log(message.result);
```

## pi

pi gets an extension instead of an MCP entry, and `init` installs it when pi is installed. With the npm package, that's:

```sh
pi install -l ./node_modules/@tortastudios/proofmarks
```

With the standalone program, `init` installs the same version from npm instead, since pi always runs on Node: `pi install -l npm:@tortastudios/proofmarks@<version>`. After upgrading Proofmarks, run `init` again to match.

Each pi session in the project then connects to Proofmarks itself:

- Rewrite requests arrive in the conversation as they happen.
- Decisions reach pi as information for its next turn.

An MCP entry named `proofmarks` in pi's `mcp.json` takes the extension's place, so remove it: `pi mcp remove proofmarks` for your own settings, or `pi mcp remove proofmarks --local` for the project's.

## Claude Code, pushed

Claude Code can also take requests as they happen, with no watch loop, through its channels research preview:

```sh
claude --dangerously-load-development-channels server:proofmarks
```

The flag lets a channel that isn't on Anthropic's approved list run, after a warning. It doesn't change permissions. It doesn't work with `claude -p` or the Agent SDK, and on Team and Enterprise plans an admin has to turn channels on.

## The MCP tools

| Tool | What it does |
| --- | --- |
| `proofmarks_list_reviews` | Lists the project's reviews, with source paths, counts and whether each can be written. |
| `proofmarks_review` | Reviews a document and refreshes its review, keeping proposals and decisions. |
| `proofmarks_pending_rewrites` | Reads the rewrite requests waiting, with the passage, its paragraph, the rule and earlier versions. |
| `proofmarks_watch` | Waits for requests aimed at this agent, and for decisions. |
| `proofmarks_claim` | Claims a request for 120 seconds, so only one agent writes it. |
| `proofmarks_propose_rewrite` | Proposes a rewrite for a request this agent claimed. The judge scores it, and it waits for you on the card. |
| `proofmarks_check_rewrite` | Scores a draft rewrite with the judge and saves nothing, so the agent can revise before proposing. |
| `proofmarks_request_rewrites` | Asks for rewrites of a page's open proofs on the agent's own behalf, as Rewrite all does. Used only when you ask the agent to proof the page. |
| `proofmarks_open_page` | Opens the page in your browser through `proofmarks dev`, so you can watch. |
| `proofmarks_report_failure` | Tells the card why a claimed rewrite couldn't be written, so you can retry. |
| `proofmarks_decisions` | Reads the review's decision history. Accept, Dismiss and Undo are information, never requests. |
| `proofmarks_send_feedback` | Reports a problem with Proofmarks itself to Torta, with a proposed fix if the agent has one. See below. |

None of the tools edit source files. Only Accept on the page does.

## Feedback

When an agent runs into a problem with Proofmarks itself, such as a tool that fails or confuses it, a mark that's plainly wrong, a missed habit or unclear docs, it can report it with `proofmarks_send_feedback`, including a proposed fix. The agent is told to show you the report first and send it only with your okay, and never to include your writing, file paths or keys unless you ask.

Reports go through Torta's relay to the Proofmarks team's Slack, even with your own Jev key. They include the Proofmarks version, how it was installed and the operating system only if you've turned usage counts on. If the relay can't be reached, the agent gets a prefilled GitHub issue to give you instead. `PROOFMARKS_FEEDBACK=0` removes the tool.
