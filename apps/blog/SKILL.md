# Blog

Keep a blog as Markdown files and publish it as one route of the project's Ravi Page.

## Write

- Keep the posts in one folder inside your working directory, for example `posts/`. One `.md` file per post, at the top of the folder; `README.md`, files that start with `_` and subfolders are not posts.
- Start each post with front matter:

  ```
  ---
  title: Título do post
  date: 2026-11-25
  description: Uma linha que aparece no índice e no feed.
  tags: ravi, notas
  ---
  ```

  `draft: true` keeps a post out until you set it to `false` or remove it; any value other than true, yes, false or no is an error. `slug:` overrides the file name in the URL. Dates must exist (`2026-02-31` is refused).
- An optional `posts/site.json` sets the blog itself: `{"title": "...", "description": "...", "author": "...", "lang": "pt-BR", "url": "https://<host>/blog"}`. Set `url` (an `https://` address) so the RSS feed carries full links. Unknown flags are an error, so a typo never publishes to the default route.
- Write plain Markdown: headings, lists, quotes, code blocks, links and images. Raw HTML is shown as text, and only `http(s)`, `mailto` and relative links are kept. Every page carries a Content-Security-Policy that blocks scripts.

## Preview

`ravi blog build --posts posts --json` renders every page and returns the files without publishing. Read `result.result.posts` to check titles, dates and slugs.

## Publish

`ravi blog publish --execute -- --posts posts`

It renders the index, one page per post, the RSS feed and the stylesheet, and ships them together to `/blog` (change with `--route`, a path below the project home; `/` is refused). Posts end up at `<route>/<slug>.html`. A folder with no posts is refused, so a wrong folder never empties the blog. Pass `--project <project>` when the agent works in more than one Console project. Reply with the route's URL. To list or read what is published, use `ravi pages published` and `ravi pages read` directly.

If `ravi blog ...` is refused as an alias in your turn, use `ravi apps run blog <operation> --execute --json -- <args>`.

## What the app can do

The generator runs inside Ravi's script sandbox: it cannot read anything but the posts folder Ravi hands it, and it cannot reach the network, the environment or other programs. The only thing it can do outside the sandbox is `ravi pages ship` with the files it rendered and the `--route`, `--title` and `--project` flags, under the grants of the agent that calls it. Reading the posts folder and the rendered files needs the calling agent's own right to read local files (`use:tool:Read`). It never changes a page's visibility: a public blog needs the operator to run `ravi pages visibility`.
