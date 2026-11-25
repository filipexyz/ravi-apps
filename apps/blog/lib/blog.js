// Blog generator for Ravi Apps. Runs inside Ravi's script sandbox (QuickJS):
// no disk, network, environment or processes. Ravi hands in the Markdown
// posts from the folder named by --posts and publishes the files this returns.
//
// input:  { args: string[], files: { "<path>.md": "<markdown>", "site.json"?: "<json>" } }
// output: { files: { "index.html", "<slug>.html", "feed.xml", "style.css" }, args, result }

"use strict";

var VERSION = "0.2.0";

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeXml(text) {
  return escapeHtml(text);
}

// Only links that cannot run script: http(s), mailto, in-page and relative paths.
function safeUrl(url) {
  var value = String(url).trim();
  if (/^(https?:|mailto:)/i.test(value)) return value;
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return null;
  if (value.indexOf("//") === 0) return null;
  return value;
}

function parseArgs(args) {
  var options = {};
  for (var i = 0; i < args.length; i++) {
    var token = args[i];
    if (token.indexOf("--") !== 0) throw new Error("unexpected argument: " + token);
    var eq = token.indexOf("=");
    var name = eq > 0 ? token.slice(2, eq) : token.slice(2);
    var value = eq > 0 ? token.slice(eq + 1) : args[++i];
    if (value === undefined) throw new Error("--" + name + " needs a value");
    options[name] = value;
  }
  return options;
}

function parseFrontMatter(source) {
  var text = source.replace(/\r\n?/g, "\n");
  var meta = {};
  if (text.indexOf("---\n") !== 0) return { meta: meta, body: text };
  var end = text.indexOf("\n---", 4);
  if (end < 0) return { meta: meta, body: text };
  var lines = text.slice(4, end).split("\n");
  for (var i = 0; i < lines.length; i++) {
    var match = /^([A-Za-z][A-Za-z0-9_-]*)\s*:\s*(.*)$/.exec(lines[i]);
    if (!match) continue;
    var value = match[2].trim();
    if (/^".*"$|^'.*'$/.test(value)) value = value.slice(1, -1);
    meta[match[1].toLowerCase()] = value;
  }
  var rest = text.slice(end + 4);
  return { meta: meta, body: rest.replace(/^[^\n]*\n/, "") };
}

// Inline Markdown: code, images, links, bold, italic. Everything is escaped first.
function renderInline(text) {
  var codes = [];
  var out = String(text).replace(/`([^`\n]+)`/g, function (_, code) {
    codes.push("<code>" + escapeHtml(code) + "</code>");
    return "\u0000" + (codes.length - 1) + "\u0000";
  });
  out = escapeHtml(out);
  out = out.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, function (all, alt, src) {
    var url = safeUrl(src.replace(/&amp;/g, "&"));
    return url === null ? alt : '<img src="' + escapeHtml(url) + '" alt="' + alt + '" loading="lazy">';
  });
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, function (all, label, href) {
    var url = safeUrl(href.replace(/&amp;/g, "&"));
    if (url === null) return label;
    var external = /^https?:/i.test(url);
    return '<a href="' + escapeHtml(url) + '"' + (external ? ' rel="noopener noreferrer"' : "") + ">" + label + "</a>";
  });
  out = out.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  out = out.replace(/(^|[^\w])_([^_\n]+)_(?=[^\w]|$)/g, "$1<em>$2</em>");
  return out.replace(/\u0000(\d+)\u0000/g, function (_, index) {
    return codes[Number(index)];
  });
}

// Block Markdown: headings, paragraphs, lists, quotes, fenced code, rules.
// Raw HTML is never passed through.
function renderMarkdown(source) {
  var lines = source.replace(/\r\n?/g, "\n").split("\n");
  var html = [];
  var i = 0;
  function isBlank(line) {
    return /^\s*$/.test(line);
  }
  while (i < lines.length) {
    var line = lines[i];
    if (isBlank(line)) {
      i++;
      continue;
    }
    var fence = /^```\s*([A-Za-z0-9_+-]*)\s*$/.exec(line);
    if (fence) {
      var code = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) code.push(lines[i++]);
      i++;
      var cls = fence[1] ? ' class="language-' + escapeHtml(fence[1]) + '"' : "";
      html.push("<pre><code" + cls + ">" + escapeHtml(code.join("\n")) + "</code></pre>");
      continue;
    }
    var heading = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (heading) {
      var level = Math.min(6, heading[1].length + 1);
      html.push("<h" + level + ">" + renderInline(heading[2]) + "</h" + level + ">");
      i++;
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      html.push("<hr>");
      i++;
      continue;
    }
    if (/^\s*>/.test(line)) {
      var quote = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) quote.push(lines[i++].replace(/^\s*>\s?/, ""));
      html.push("<blockquote>" + renderMarkdown(quote.join("\n")) + "</blockquote>");
      continue;
    }
    var unordered = /^\s*[-*+]\s+/;
    var ordered = /^\s*\d+[.)]\s+/;
    if (unordered.test(line) || ordered.test(line)) {
      var pattern = unordered.test(line) ? unordered : ordered;
      var tag = pattern === unordered ? "ul" : "ol";
      var items = [];
      while (i < lines.length && pattern.test(lines[i])) {
        var item = lines[i++].replace(pattern, "");
        while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !pattern.test(lines[i])) item += " " + lines[i++].trim();
        items.push("<li>" + renderInline(item) + "</li>");
      }
      html.push("<" + tag + ">" + items.join("") + "</" + tag + ">");
      continue;
    }
    var paragraph = [];
    while (
      i < lines.length &&
      !isBlank(lines[i]) &&
      !/^```/.test(lines[i]) &&
      !/^#{1,6}\s/.test(lines[i]) &&
      !/^\s*>/.test(lines[i]) &&
      !unordered.test(lines[i]) &&
      !ordered.test(lines[i])
    ) {
      paragraph.push(lines[i++].trim());
    }
    html.push("<p>" + renderInline(paragraph.join(" ")) + "</p>");
  }
  return html.join("\n");
}

function slugify(text) {
  var slug = String(text)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return slug || "post";
}

function parseDate(value) {
  var match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || "").trim());
  if (!match) return null;
  var date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return isNaN(date.getTime()) ? null : date;
}

function formatDate(date, lang) {
  var months = {
    pt: ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"],
    en: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
  };
  var list = String(lang).toLowerCase().indexOf("pt") === 0 ? months.pt : months.en;
  return date.getUTCDate() + " " + list[date.getUTCMonth()] + " " + date.getUTCFullYear();
}

function plainText(html) {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z#0-9]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

var STYLE = [
  ":root{--bg:#fbfaf8;--fg:#1d1c1a;--muted:#6b6862;--line:#e6e2dc;--accent:#2f5d50;--code:#f1eee9;",
  "--font:ui-serif,Georgia,'Times New Roman',serif;--sans:ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif}",
  "@media (prefers-color-scheme:dark){:root{--bg:#141413;--fg:#ecebe8;--muted:#9c9890;--line:#2c2b29;--accent:#8fc1ae;--code:#1f1e1c}}",
  "*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}",
  "body{margin:0;background:var(--bg);color:var(--fg);font:18px/1.65 var(--font)}",
  "a{color:var(--accent)}a:hover{text-decoration-thickness:2px}",
  ".wrap{max-width:42rem;margin:0 auto;padding:2.5rem 1rem 4rem}",
  "header.site{display:flex;justify-content:space-between;align-items:baseline;gap:1rem;border-bottom:1px solid var(--line);padding-bottom:1rem;margin-bottom:2rem;font-family:var(--sans)}",
  "header.site a.name{color:var(--fg);text-decoration:none;font-weight:650;font-size:1.05rem}",
  "header.site nav a{color:var(--muted);font-size:.9rem;text-decoration:none}",
  "h1{font-size:2.1rem;line-height:1.2;margin:0 0 .4rem}h2{font-size:1.5rem;margin:2.2rem 0 .6rem}h3{font-size:1.2rem;margin:1.8rem 0 .5rem}",
  ".meta{color:var(--muted);font:.9rem/1.4 var(--sans);margin-bottom:2rem}",
  ".intro{color:var(--muted);margin:0 0 2.5rem}",
  "ul.posts{list-style:none;padding:0;margin:0}ul.posts li{padding:1.1rem 0;border-bottom:1px solid var(--line)}",
  "ul.posts a{font-size:1.2rem;font-weight:600;text-decoration:none;color:var(--fg)}ul.posts a:hover{color:var(--accent)}",
  "ul.posts time{display:block;color:var(--muted);font:.85rem var(--sans)}ul.posts p{margin:.3rem 0 0;color:var(--muted)}",
  "article img{max-width:100%;height:auto;border-radius:6px}",
  "pre{background:var(--code);padding:1rem;border-radius:6px;overflow-x:auto;font-size:.85rem;line-height:1.5}",
  "code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.88em}p code{background:var(--code);padding:.1em .3em;border-radius:4px}",
  "blockquote{margin:1.5rem 0;padding:0 1rem;border-left:3px solid var(--line);color:var(--muted)}",
  "hr{border:0;border-top:1px solid var(--line);margin:2.5rem 0}",
  ".tags{font:.8rem var(--sans);color:var(--muted)}",
  "footer{margin-top:3rem;padding-top:1rem;border-top:1px solid var(--line);color:var(--muted);font:.8rem var(--sans)}",
  "@media (max-width:480px){body{font-size:17px}h1{font-size:1.7rem}.wrap{padding-top:1.5rem}}",
].join("\n");

function layout(site, title, body, description) {
  return (
    "<!doctype html>\n" +
    '<html lang="' + escapeHtml(site.lang) + '">\n<head>\n<meta charset="utf-8">\n' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">\n' +
    "<title>" + escapeHtml(title) + "</title>\n" +
    (description ? '<meta name="description" content="' + escapeHtml(description) + '">\n' : "") +
    '<link rel="stylesheet" href="style.css">\n' +
    '<link rel="alternate" type="application/rss+xml" title="' + escapeHtml(site.title) + '" href="feed.xml">\n' +
    "</head>\n<body>\n<div class=\"wrap\">\n" +
    '<header class="site"><a class="name" href="index.html">' + escapeHtml(site.title) + "</a>" +
    '<nav><a href="feed.xml">RSS</a></nav></header>\n' +
    body +
    "\n<footer>" + escapeHtml(site.footer) + "</footer>\n</div>\n</body>\n</html>\n"
  );
}

function readSite(files, options) {
  var site = {};
  if (typeof files["site.json"] === "string") {
    try {
      var parsed = JSON.parse(files["site.json"]);
      if (parsed && typeof parsed === "object") site = parsed;
    } catch (error) {
      throw new Error("site.json is not valid JSON");
    }
  }
  function pick(key, fallback) {
    var value = options[key] !== undefined ? options[key] : site[key];
    return typeof value === "string" && value.trim() ? value.trim() : fallback;
  }
  var lang = pick("lang", "pt-BR");
  var pt = lang.toLowerCase().indexOf("pt") === 0;
  return {
    title: pick("title", "Blog"),
    description: pick("description", ""),
    author: pick("author", ""),
    lang: lang,
    url: pick("url", ""),
    footer: pick("footer", pt ? "Publicado com Ravi." : "Published with Ravi."),
    empty: pt ? "Nenhum post publicado ainda." : "No posts yet.",
  };
}

function build(input) {
  var options = parseArgs(input.args || []);
  var files = input.files || {};
  var site = readSite(files, options);
  var includeDrafts = options.drafts === "true";
  var posts = [];
  var slugs = {};
  var paths = Object.keys(files).sort();
  for (var p = 0; p < paths.length; p++) {
    var path = paths[p];
    if (!/\.(md|markdown)$/i.test(path)) continue;
    var parsed = parseFrontMatter(files[path]);
    var meta = parsed.meta;
    if (meta.draft === "true" && !includeDrafts) continue;
    var base = path.replace(/^.*\//, "").replace(/\.(md|markdown)$/i, "");
    var slug = slugify(meta.slug || base);
    if (slug === "index" || slug === "feed" || slug === "style") slug = slug + "-post";
    if (slugs[slug]) throw new Error("two posts use the slug " + slug + ": " + slugs[slug] + " and " + path);
    slugs[slug] = path;
    var body = parsed.body;
    var title = meta.title;
    if (!title) {
      var firstHeading = /^#\s+(.+)$/m.exec(body);
      title = firstHeading ? firstHeading[1].trim() : base;
      if (firstHeading) body = body.replace(firstHeading[0], "");
    }
    var date = parseDate(meta.date);
    if (meta.date && !date) throw new Error(path + ": date must be YYYY-MM-DD");
    var content = renderMarkdown(body);
    posts.push({
      slug: slug,
      title: title,
      date: date,
      description: meta.description || plainText(content).slice(0, 180),
      tags: (meta.tags || "")
        .split(",")
        .map(function (tag) {
          return tag.trim();
        })
        .filter(Boolean),
      content: content,
    });
  }
  posts.sort(function (a, b) {
    var at = a.date ? a.date.getTime() : 0;
    var bt = b.date ? b.date.getTime() : 0;
    return bt - at || (a.title < b.title ? -1 : 1);
  });

  var out = { "style.css": STYLE + "\n" };
  for (var k = 0; k < posts.length; k++) {
    var post = posts[k];
    var metaLine = [];
    if (post.date) metaLine.push('<time datetime="' + post.date.toISOString().slice(0, 10) + '">' + formatDate(post.date, site.lang) + "</time>");
    if (site.author) metaLine.push(escapeHtml(site.author));
    var tags = post.tags.length ? '<p class="tags">' + post.tags.map(escapeHtml).join(" · ") + "</p>" : "";
    out[post.slug + ".html"] = layout(
      site,
      post.title + " · " + site.title,
      "<article>\n<h1>" + escapeHtml(post.title) + "</h1>\n" +
        (metaLine.length ? '<div class="meta">' + metaLine.join(" · ") + "</div>\n" : "") +
        post.content + "\n" + tags + "\n</article>",
      post.description,
    );
  }

  var list = posts
    .map(function (post) {
      return (
        '<li><a href="' + post.slug + '.html">' + escapeHtml(post.title) + "</a>" +
        (post.date ? '<time datetime="' + post.date.toISOString().slice(0, 10) + '">' + formatDate(post.date, site.lang) + "</time>" : "") +
        (post.description ? "<p>" + escapeHtml(post.description) + "</p>" : "") +
        "</li>"
      );
    })
    .join("\n");
  out["index.html"] = layout(
    site,
    site.title,
    "<h1>" + escapeHtml(site.title) + "</h1>\n" +
      (site.description ? '<p class="intro">' + escapeHtml(site.description) + "</p>\n" : "") +
      (posts.length ? '<ul class="posts">\n' + list + "\n</ul>" : "<p>" + escapeHtml(site.empty) + "</p>"),
    site.description,
  );

  var root = site.url ? site.url.replace(/\/+$/, "") + "/" : "";
  var items = posts
    .slice(0, 50)
    .map(function (post) {
      return (
        "<item><title>" + escapeXml(post.title) + "</title>" +
        (root ? "<link>" + escapeXml(root + post.slug + ".html") + "</link><guid>" + escapeXml(root + post.slug + ".html") + "</guid>" : "<guid isPermaLink=\"false\">" + escapeXml(post.slug) + "</guid>") +
        (post.date ? "<pubDate>" + post.date.toUTCString() + "</pubDate>" : "") +
        "<description>" + escapeXml(post.description) + "</description></item>"
      );
    })
    .join("\n");
  out["feed.xml"] =
    '<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0"><channel>' +
    "<title>" + escapeXml(site.title) + "</title>" +
    (root ? "<link>" + escapeXml(root) + "</link>" : "") +
    "<description>" + escapeXml(site.description || site.title) + "</description>" +
    "<language>" + escapeXml(site.lang) + "</language>\n" +
    items +
    "\n</channel></rss>\n";

  var shipArgs = ["--route", options.route || "/blog", "--title", site.title];
  if (options.project) shipArgs.push("--project", options.project);
  return {
    files: out,
    args: shipArgs,
    result: {
      generator: "blog " + VERSION,
      posts: posts.map(function (post) {
        return { slug: post.slug, title: post.title, date: post.date ? post.date.toISOString().slice(0, 10) : null };
      }),
      files: Object.keys(out).sort(),
    },
  };
}

function main(input) {
  return build(input);
}
