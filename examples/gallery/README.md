# Gallery

Nine kinds of writing, short to long, each with a saved Jev review, so you can see real marks without a key:

| Piece | Kind | Words |
| --- | --- | --- |
| [`linkedin-post`](pieces/linkedin-post.md) | LinkedIn post | 200 |
| [`landing-page`](pieces/landing-page.md) | Landing page | 270 |
| [`cover-letter`](pieces/cover-letter.md) | Cover letter | 290 |
| [`launch-post`](pieces/launch-post.md) | Product launch post | 380 |
| [`newsletter`](pieces/newsletter.md) | Newsletter | 450 |
| [`recipe`](pieces/recipe.md) | Recipe post | 530 |
| [`engineering-blog`](pieces/engineering-blog.md) | Engineering blog post | 730 |
| [`short-story`](pieces/short-story.md) | Short story | 790 |
| [`essay`](pieces/essay.md) | Long essay | 1,280 |

Every company, person and product in them is invented.

To run it, build the package at the repository root first (`pnpm install && pnpm build`). Then, here:

```sh
npm install && npm run dev
```

In another terminal here, run `node ../../dist/companion/bin.mjs dev --judge fake`, and open the address it prints with `?proof=1`. Choose a piece from the index.

Each review was made by Jev; decisions, requests and proposals start empty. Reviewing again uses the fake judge, which marks almost everything, so it isn't meant as a real judgment. The examples and script-tag snippets are MIT licensed; see [../LICENSE](../LICENSE).
