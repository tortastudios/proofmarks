# Integrations

## The helper and the proxy

The **helper** runs on your machine. It loads the project configuration, serves review data and saves edits. MCP connections and browser pages share one helper per project, and it shuts down when the processes using it exit.

The **proxy** (`proofmarks dev`) forwards your development server and adds the review script to its HTML. It passes streaming responses and WebSockets through. Your site doesn't import Proofmarks; the page's address, or a unique passage of its text, identifies the document.

## The script tag

Instead of the proxy, start `proofmarks serve` and add this to your site, **in development only**:

```html
<script src="http://127.0.0.1:4848/__proofmarks/script.js" defer></script>
```

Change the origin if the helper prints another port, and put `data-proofmarks-root` on the element that holds the writing when you can. Never include the script in a public production page.

## Packages

- `@tortastudios/proofmarks/react` exports the optional `Proofmarks` component, which only runs in development:

  ```tsx
  import { Proofmarks } from '@tortastudios/proofmarks/react';

  <Proofmarks reviewId="article" rootSelector="#main-content" />
  ```

  Pass `base` if the helper isn't at `http://127.0.0.1:4848`.
- `@tortastudios/proofmarks/next` exports development-only route handlers backed by the same source writing.
- `@tortastudios/proofmarks/overlay` exports `mountProofmarks({root, findings, rules, ...callbacks})`. Its handle offers `setReview`, `setRoot`, `setAgents`, `setCompanionStatus` and `unmount`.
- `@tortastudios/proofmarks/config` exports configuration loading and validation.
- `@tortastudios/proofmarks/cli` is the command-line entry point.

The browser script and its handwriting font ship prebuilt, so an installed package needs no TypeScript runner or bundler.

## Examples

- [Gallery](../examples/gallery/): nine kinds of writing in Markdown (a LinkedIn post, a landing page, a cover letter, a launch post, a newsletter, a recipe, an engineering blog post, a short story and a long essay), each with a saved Jev review.
- [Static HTML](../examples/static/): plain HTML served by Python's own server.
- [Vite HTML](../examples/vite-html/): a Vite development server.
- [Next.js MDX](../examples/next-mdx/): MDX rendered by Next.js.
- [FastAPI and Jinja](../examples/fastapi-jinja/): server-rendered Markdown and a template.

Each example uses the fake judge. From a checkout, run `pnpm install && pnpm build` at the root first, then follow the example's README.
