# Formats

- **Markdown and MDX:** prose, plus selected metadata fields (the description, summary and takeaways).
- **HTML:** markup is kept, and replacements are encoded.
- **Jinja-style templates** (`.jinja`, `.jinja2`, `.j2`, `.njk`, `.nunjucks`, `.twig` and `.liquid`): template expressions are protected, and edits that would cross markup or a protected region are refused. Proofmarks treats these files as text and never runs them.

When a passage appears more than once in the source and Proofmarks can't tell which one the page shows, it asks you to resolve it in your editor instead of guessing.
