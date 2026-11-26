# FAQ

**Do I need a Jev key?**
No. Proofmarks reaches Jev through Torta's relay, which pays for the calls and keeps no text. You can still use your own key with `TYPESAFE_API_KEY`. See [Judge, privacy and usage counts](judge.md).

**Does Proofmarks track me?**
Not unless you turn on usage counts. If you do (`proofmarks telemetry on`, or yes when setup asks), it counts how many marks people keep and dismiss under each rule, added up by the hour and not tied to anyone, to tune the rules for everyone. It also sends one count for your install, with the version, how it was installed, the operating system and, if the listing says, which listing you found it through. Never your writing. Either way, Proofmarks tunes its rules to your site on your machine. [TELEMETRY.md](../TELEMETRY.md) lists every request.

**Do I need Node for a Python or static site?**
No. The [standalone program](install.md#without-node) has Node built in. With Node 22 or later you can also use the npm package. Your site can use any stack either way.

**Does it support CMS content?**
Not yet. The source has to be a local file in the project.

**Does it rewrite automatically?**
No. Agents propose rewrites and you decide. Accept writes the source. Undo restores the recorded edit while the surrounding source still matches.

**Does it work in production?**
No. It's a development tool, so keep its helper, proxy and script out of public production sites.

**Which agents does it work with?**
It works with Claude Code, Codex and pi directly, and with any MCP client through watch mode. See [Agents](agents.md).
