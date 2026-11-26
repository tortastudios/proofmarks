# Configuration

`proofmarks.config.json` lives at the project root, and `init` writes it for you. Paths are relative to that folder and must stay inside it. Each document has an identity, a source, a review file and a write permission:

```json
{
  "version": 1,
  "roots": ["content"],
  "documents": [{
    "id": "article",
    "source": "content/article.md",
    "review": "reviews/article.json",
    "write": true,
    "url": "/article*",
    "format": "markdown"
  }],
  "judge": { "provider": "jev", "model": "jev-1.14.0" },
  "devServer": "http://localhost:3000"
}
```

- **`roots`** are the folders Proofmarks may read writing from.
- **`write`** lets Accept, Dismiss and Undo change that document. Leave it `false` for files Proofmarks should only review.
- **`url`** matches the page that shows the document (`*` matches any run of characters). A page can also be matched by a unique passage of its text.
- **`format`** is `markdown`, `mdx`, `html` or `jinja`, inferred from the file's extension when left out. See [Formats](formats.md).
- **`judge`** picks the judge. See [Judge, privacy and usage counts](judge.md).
- **`devServer`** is where `proofmarks dev` forwards by default.

Optional fields:

- **`rebuild`** runs your trusted local build command after an edit, for sites that don't reload on their own.
- **`rules`** turns rules on or off for this project, by id: `"rules": { "title-case": true, "em-dash": false }`. One rule starts off: `title-case` (title case headings). It's a style choice with no decision-model question, so once it's on, every title case heading is marked. Every id is in [`rules/rules.v3.json`](../rules/rules.v3.json), and a misspelled one stops the review with a message naming it.
- **`origins`** allows more exact browser origins, such as a second port your site uses.
- **`tailnetHosts`** and **`tailscaleUsers`** allow private access, for example from your phone, through a Tailscale proxy you control. Both are required. Read [SECURITY.md](../SECURITY.md) before allowing access beyond your own machine.

Source and review paths can't go through symlinks.
