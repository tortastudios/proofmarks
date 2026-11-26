# Judge, privacy and usage counts

The judge decides what gets marked. It combines a registry of 21 rules, pattern and vocabulary checks, and calibrated questions to a model. `proofmarks review content/article.md` creates or refreshes a document's review. A refresh keeps settled decisions, and doesn't bring back marks you dismissed. Proposed rewrites are scored too, and the source only changes when you accept one.

Words inside quotation marks are left alone, since they're someone else's: a customer, a source or a character.

## Learning your site's eye

Each rule has a calibrated line: the score from Jev a passage needs before it's marked. As you accept and dismiss marks, Proofmarks moves each rule's line for your site.

- **Stricter:** if you dismiss the marks just over a rule's line and keep the ones well above it, the line rises, and marks like the ones you dismissed stop appearing.
- **Looser:** if you keep nearly every mark just over the line, it drops a step to show you more. It only drops again once you've decided on the marks it let in.
- **How far:** a rule needs 8 decided marks before its line moves. It moves in steps of 0.05, never more than 0.15 from the calibrated line. Only Accept and Dismiss count, and Undo takes a call back. Asking for a rewrite or leaving a mark open doesn't count.
- **Where it lives:** in the decision logs beside your reviews (`reviews/*.log.jsonl`), so a team that commits its reviews shares one set of lines. Settings shows each rule that moved, such as "Stricter here: you dismissed 7 of 9.", with a Reset that goes back to the calibrated line. Resets are kept in `.proofmarks/strictness.json`, beside the record of what you dismissed.
- **Rewrites and checks:** a rewrite clears a rule when it scores under your site's line for it, and `proofmarks check` uses the same lines when it runs inside your project.

## Jev, through Torta's relay

Jev is the judge. You don't need a key: Proofmarks reaches Jev through a small relay that Torta Studios runs, which holds Torta's Jev key and pays for the calls. `proofmarks status` shows how Jev is reached and whether it answers, and, while this project's helper runs, how it judges and whether it sends usage counts.

- **What leaves your machine:** the passages being judged, with their surrounding text, when you review a page or a rewrite is scored. Your site, the helper, the proxy and your edits stay local. An agent you use for rewrites sends what it's given to its own provider. [TELEMETRY.md](../TELEMETRY.md) lists every request Proofmarks makes.
- **What the relay keeps:** no text. It passes each request to Jev and returns the answer. It knows this install only by a random token, saved in `~/.proofmarks/install.json`, and keeps request counts and network addresses in memory only, for rate limits and a daily spend cap.
- **Usage counts, off until you turn them on:** run `proofmarks telemetry on`, or say yes when setup asks. Then the relay sends Torta's analytics one count for this install, with the Proofmarks version, the way it was installed, the operating system and, when a listing's install command says so, the listing it came from. It also sends hourly totals of marks kept, dismissed and undone, by rule, by score from Jev (rounded down to 0.05) and by the line each mark was shown under. Those totals aren't tied to any install, and they help tune each rule's line for everyone. Never any text, URL, file name or token. Whatever you choose, Proofmarks tunes each rule's line to your site on your machine.
- **Turning counts off:** `proofmarks telemetry off`, for every Proofmarks process on the machine, including helpers already running, from the next request each one starts. `DO_NOT_TRACK=1` keeps them off for the processes started with it, and for a dev proxy already running when `proofmarks dev --background` finds it. A CI run keeps them off too, unless `PROOFMARKS_TELEMETRY=1`.
- **Your own key:** set `TYPESAFE_API_KEY` to a Jev key of your own, and Proofmarks judges with Jev directly: judging never touches the relay, and judging and decisions send no usage counts. Feedback reports still go through the relay, and with usage counts on, a report can also send the install count and its kind. Keys never reach the page, the review files or the environment of the agents, site and rebuild commands Proofmarks starts.
- **If the shared judge is busy:** the relay has a daily budget. If it's used up, reviews pause until midnight UTC, and setting your own key keeps them going.

The relay's code is in this repository, in [`relay/`](../relay/).

## The fake judge

The `fake` judge runs locally with no key. It's deterministic test data that marks almost every candidate, for trying Proofmarks and for tests, not for real editing. Turn it on with `"judge": { "provider": "fake", "model": "fixture-1" }` or `--judge fake`.

## Other judges

When developing from source, other judges can implement the internal `JudgeProvider` contract. They aren't yet available as plugins for the command line.
