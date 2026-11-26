# Checking without the page

`proofmarks check` judges writing without opening it: in CI, before a page ships, or across many pages at once, such as programmatic SEO pages. It writes no review file; it prints the marks. Like a review, it keeps Jev's answers in its cache, so judging the same text again is free.

```sh
npx @tortastudios/proofmarks check content/
npx @tortastudios/proofmarks check content/posts/launch.md templates/pricing.html
npx @tortastudios/proofmarks check https://example.com/plumbers-in-austin https://example.com/plumbers-in-dallas
```

Use the scoped name with `npx`: the unscoped `proofmarks` on npm is someone else's package. With the standalone program, Homebrew, uv or pipx, run `proofmarks check` instead.

It takes files (Markdown, MDX, HTML and templates), folders (searched for those, skipping `node_modules`, build output and hidden folders), globs, and URLs. For a URL, Proofmarks fetches the page and judges only its main content: the `<main>` element, else `<article>`, else `<body>`, without navigation, headers, footers or scripts.

Each mark shows its line and column (files only), its rule, the marked text and the suggested fix:

```text
content/posts/launch.md: 2 marks
  3:1  Signposting  "Here's what"  Cut the opener and start with the point.
  11:1  Not X, but Y  "It isn't a tool. It's a movement."  State the second half on its own.
2 marks in 1 page
```

## Options

- `--format json` (or `--json`) prints `{ results, total }`. Each result has its `target` and `marks`, and each mark its `rule`, `label`, `match` (the marked text) and `note` (the fix), with `line`, `column` and `probability` when there are any.
- `--format github` prints GitHub Actions annotations, so marks show on the pull request's changed lines. It's the default in GitHub Actions; pass `--format text` for plain output there.
- `--fail-on <n>` exits with 1 when there are `n` or more marks in all. Without it, marks never fail the run; a page that can't be checked always does.
- `--judge fake` uses the test judge, which marks almost everything. It's for trying the command, not for real results.

## In GitHub Actions

After checking out your repository and setting up Node.js 22 or later:

```yaml
- run: npx @tortastudios/proofmarks check content --fail-on 1
  env:
    TYPESAFE_API_KEY: ${{ secrets.TYPESAFE_API_KEY }}
```

For CI, use your own Jev key, as above. Without one, each run starts with an empty home folder and asks Torta's relay for a new token, which counts against the relay's daily limit of new tokens per network. If you use the relay anyway, cache `~/.proofmarks` between runs. Usage counts stay off in CI unless `PROOFMARKS_TELEMETRY=1`.

## Bulk runs

The shared relay gives each install about 6,000 judge calls a day, which is roughly 50 to 100 pages. `check` says so when you pass more than 25. If the relay's daily budget runs out, `check` stops and says so. For bigger runs, set `TYPESAFE_API_KEY` to your own Jev key.
