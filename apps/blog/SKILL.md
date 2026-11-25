# Blog

Write and keep a blog as routes of the project's Ravi Page.

## Layout

- Each post is one route: `/blog/<slug>`. The slug is lowercase words joined by dashes, taken from the title.
- `/blog` is the index: newest post first, each with its title, date and one-line summary, linking to the post.
- Posts and the index share one look. Before writing a new post, read the latest one with `ravi blog read <url> --format html` and keep its structure and style.

## Publish a post

1. Write the post as one full HTML document (a `<title>`, the date, the text). Keep it readable on a phone.
2. Publish it, passing the HTML itself with `--body` (the app cannot read files):
   `ravi blog publish --execute -- --route /blog/<slug> --title "<title>" --body "<html>"`
3. List what is published: `ravi blog posts --json`. The posts are the routes under `/blog/`.
4. Rewrite the index with every post, newest first, and publish it:
   `ravi blog publish --execute -- --route /blog --title "Blog" --body "<html>"`
5. Reply with the post's URL.

If `ravi blog ...` is refused as an alias in your turn, use `ravi apps run blog <operation> --execute --json -- <args>`.

Pass `--project <project>` on every call when the agent works in more than one Console project.

## What the app can do

It only runs `ravi pages ship`, `ravi pages published` and `ravi pages read`, with the grants of the agent that calls it. Publishing needs the agent's own permission to ship Pages; the app adds none.

Visibility follows the project's Page: a public blog needs the operator to make the route public (`ravi pages visibility`), which the app never does.
