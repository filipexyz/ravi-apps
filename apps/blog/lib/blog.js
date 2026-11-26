// Blog generator for Ravi Apps. Runs inside Ravi's script sandbox (QuickJS):
// no disk, network, environment or processes. Ravi hands in the Markdown
// posts from the folder named by --posts and publishes the files this returns.
//
// input:  { args: string[], files: { "<path>.md": "<markdown>", "site.json"?: "<json>" } }
// output: { files: { "index.html", "<slug>.html", "feed.xml", "style.css" }, args, result }

"use strict";

var VERSION = "0.2.0";

// Characters XML 1.0 forbids, plus the C1 controls and the line separators
// some parsers treat as line ends: dropped from everything the generator emits.
var FORBIDDEN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u2028\u2029\uFFFE\uFFFF]/g;

function clean(text) {
  return String(text).replace(FORBIDDEN, "");
}

function escapeHtml(text) {
  return clean(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeXml(text) {
  return escapeHtml(text);
}

// Only links that cannot run script. A destination with a control character,
// a space, a backslash or a quote is refused outright (browsers drop some of
// those before reading the scheme). Absolute links must be http(s) or mailto;
// anything else must look like a plain relative path, in-page anchor or query.
var URL_CHARS = /^[A-Za-z0-9._~!$&'()*+,;=:@%\/?#-]+$/;
function safeUrl(url) {
  var value = String(url);
  if (!value || value.length > 2000 || !URL_CHARS.test(value) || /['()]/.test(value.charAt(0))) return null;
  if (/^https?:\/\/[A-Za-z0-9]/i.test(value) || /^mailto:[A-Za-z0-9]/i.test(value)) return value;
  if (value.charAt(0) === "/" && value.charAt(1) === "/") return null;
  // A relative path holds no ":" before its first "/", "?" or "#", so it can never name a scheme.
  var head = value.split(/[\/?#]/)[0];
  if (head.indexOf(":") >= 0) return null;
  return value;
}

var KNOWN_OPTIONS = ["title", "description", "author", "lang", "url", "footer", "drafts", "route", "project"];

function parseArgs(args) {
  var options = {};
  for (var i = 0; i < args.length; i++) {
    var token = args[i];
    if (token.indexOf("--") !== 0) throw new Error("unexpected argument: " + token);
    var eq = token.indexOf("=");
    var name = eq > 0 ? token.slice(2, eq) : token.slice(2);
    var value = eq > 0 ? token.slice(eq + 1) : args[++i];
    if (value === undefined) throw new Error("--" + name + " needs a value");
    if (KNOWN_OPTIONS.indexOf(name) < 0) throw new Error("unknown flag --" + name + " (known: --" + KNOWN_OPTIONS.join(", --") + ")");
    if (Object.prototype.hasOwnProperty.call(options, name)) throw new Error("--" + name + " was given twice");
    options[name] = value;
  }
  return options;
}

function normalizeText(source) {
  return clean(String(source).replace(/^\uFEFF/, "").replace(/\r\n?|[\u2028\u2029]/g, "\n"));
}

function parseFrontMatter(source) {
  // Blank lines before the opening --- are allowed, so a stray one cannot hide a draft flag.
  var text = normalizeText(source).replace(/^(?:[ \t]*\n)+/, "");
  var meta = Object.create(null);
  if (!/^---[ \t]*\n/.test(text)) return { meta: meta, body: text };
  var start = text.indexOf("\n") + 1;
  var end = text.indexOf("\n---", start - 1);
  if (end < 0) throw new Error("front matter opened with --- is never closed");
  var lines = text.slice(start, end).split("\n");
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

// Inline Markdown: code, images, links, bold, italic. Every piece of markup
// the renderer emits is parked behind a placeholder as soon as it is built,
// so later passes only ever see escaped text and can never rewrite a tag.
function renderInline(text) {
  var parked = [];
  function park(html) {
    parked.push(html);
    return "\uE000" + (parked.length - 1) + "\uE000";
  }
  var out = clean(text).replace(/\uE000/g, "");
  out = out.replace(/`([^`\n]+)`/g, function (_, code) {
    return park("<code>" + escapeHtml(code) + "</code>");
  });
  out = out.replace(/!\[([^\]\uE000]*)\]\(([^)\s\uE000]+)\)/g, function (all, alt, src) {
    var url = safeUrl(src);
    return url === null
      ? park(escapeHtml(alt))
      : park('<img src="' + escapeHtml(url) + '" alt="' + escapeHtml(alt) + '" loading="lazy">');
  });
  out = out.replace(/\[([^\]\uE000]+)\]\(([^)\s\uE000]+)\)/g, function (all, label, href) {
    var url = safeUrl(href);
    var inner = emphasis(escapeHtml(label));
    if (url === null) return park(inner);
    var external = /^https?:/i.test(url);
    return park(
      '<a href="' + escapeHtml(url) + '"' + (external ? ' rel="noopener noreferrer"' : "") + ">" + inner + "</a>",
    );
  });
  out = emphasis(escapeHtml(out));
  return out.replace(/\uE000(\d+)\uE000/g, function (_, index) {
    return parked[Number(index)];
  });
}

// Bold and italic over text that is already escaped and holds no tags.
function emphasis(escaped) {
  return escaped
    .replace(/\*\*([^*\n\uE000]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n\uE000]+)\*/g, "$1<em>$2</em>")
    .replace(/(^|[^\w])_([^_\n\uE000]+)_(?=[^\w]|$)/g, "$1<em>$2</em>");
}

// Block Markdown: headings, paragraphs, lists, quotes, fenced code, rules.
// Raw HTML is never passed through.
var FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
var MAX_QUOTE_DEPTH = 8;

// "Title ##" -> "Title", without a regex that backtracks on long runs of spaces.
function headingText(text) {
  var end = text.length;
  while (end > 0 && (text.charAt(end - 1) === " " || text.charAt(end - 1) === "\t")) end--;
  var hashes = end;
  while (hashes > 0 && text.charAt(hashes - 1) === "#") hashes--;
  if (hashes < end && (hashes === 0 || text.charAt(hashes - 1) === " " || text.charAt(hashes - 1) === "\t")) end = hashes;
  while (end > 0 && (text.charAt(end - 1) === " " || text.charAt(end - 1) === "\t")) end--;
  return text.slice(0, end);
}

function renderMarkdown(source, depth) {
  depth = depth || 0;
  var lines = normalizeText(source).split("\n");
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
    var fence = FENCE.exec(line);
    if (fence) {
      var marker = fence[1];
      var close = new RegExp("^ {0,3}" + (marker.charAt(0) === "`" ? "`" : "~") + "{" + marker.length + ",}[ \\t]*$");
      var info = /^[A-Za-z0-9_+#.-]{1,40}/.exec(fence[2].trim());
      var code = [];
      i++;
      while (i < lines.length && !close.test(lines[i])) code.push(lines[i++]);
      i++;
      var cls = info ? ' class="language-' + escapeHtml(info[0]) + '"' : "";
      html.push("<pre><code" + cls + ">" + escapeHtml(code.join("\n")) + "</code></pre>");
      continue;
    }
    var heading = /^(#{1,6})[ \t]+(.*)$/.exec(line);
    if (heading) {
      var level = Math.min(6, heading[1].length + 1);
      html.push("<h" + level + ">" + renderInline(headingText(heading[2])) + "</h" + level + ">");
      i++;
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      html.push("<hr>");
      i++;
      continue;
    }
    if (/^\s*>/.test(line) && depth < MAX_QUOTE_DEPTH) {
      var quote = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) quote.push(lines[i++].replace(/^\s*>\s?/, ""));
      html.push("<blockquote>" + renderMarkdown(quote.join("\n"), depth + 1) + "</blockquote>");
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
    // The first line always belongs to the paragraph, so every pass consumes at least one line.
    var paragraph = [lines[i++].trim()];
    while (
      i < lines.length &&
      !isBlank(lines[i]) &&
      !FENCE.test(lines[i]) &&
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
  var year = Number(match[1]);
  var month = Number(match[2]);
  var day = Number(match[3]);
  var date = new Date(Date.UTC(year, month - 1, day));
  // Impossible dates (2026-02-31) are refused instead of rolled over.
  if (isNaN(date.getTime()) || date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return null;
  }
  return date;
}

function parseBoolean(value, what) {
  if (value === undefined) return false;
  var text = String(value).trim().toLowerCase();
  if (text === "true" || text === "yes") return true;
  if (text === "false" || text === "no" || text === "") return false;
  throw new Error(what + " must be true or false, not " + JSON.stringify(String(value).slice(0, 40)));
}

// What the script hands to `ravi pages ship`. Ravi passes these as separate
// arguments without a shell and refuses a value that starts with "-"; the
// patterns here keep them to what a blog route, title and project look like.
var ROUTE = /^\/[a-z0-9][a-z0-9-]{0,62}(?:\/[a-z0-9][a-z0-9-]{0,62}){0,3}$/;
var PROJECT = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;

function checkShipValues(route, title, project) {
  if (!ROUTE.test(route)) {
    throw new Error("--route must be a path such as /blog (lowercase letters, digits and -, not the project home /)");
  }
  if (!title || title.length > 120 || /^-/.test(title) || /[\u0000-\u001F\u007F-\u009F]/.test(title)) {
    throw new Error("the site title must be 1 to 120 characters, without control characters, and not start with -");
  }
  if (project !== undefined && !PROJECT.test(project)) {
    throw new Error("--project must be a project id or slug (letters, digits, _ . -)");
  }
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

// No script runs on these pages, whatever a post contains.
var CSP = "default-src 'none'; style-src 'self'; img-src 'self' https: data:; base-uri 'none'; form-action 'none'";

function layout(site, title, body, description) {
  return (
    "<!doctype html>\n" +
    '<html lang="' + escapeHtml(site.lang) + '">\n<head>\n<meta charset="utf-8">\n' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">\n' +
    '<meta http-equiv="Content-Security-Policy" content="' + CSP + '">\n' +
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
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) site = parsed;
    } catch (error) {
      throw new Error("site.json is not valid JSON");
    }
  }
  function pick(key, fallback) {
    var value = options[key] !== undefined ? options[key] : site[key];
    return typeof value === "string" && value.trim() ? value.trim() : fallback;
  }
  var lang = pick("lang", "pt-BR");
  if (!/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,2}$/.test(lang)) throw new Error("lang must be a language tag such as pt-BR");
  var pt = lang.toLowerCase().indexOf("pt") === 0;
  var url = pick("url", "");
  if (url && (!/^https?:\/\//i.test(url) || safeUrl(url) === null)) throw new Error("url must be an http(s) address");
  return {
    title: pick("title", "Blog"),
    description: pick("description", ""),
    author: pick("author", ""),
    lang: lang,
    url: url,
    footer: pick("footer", pt ? "Publicado com Ravi." : "Published with Ravi."),
    empty: pt ? "Nenhum post publicado ainda." : "No posts yet.",
  };
}

function build(input) {
  var options = parseArgs(input.args || []);
  var files = input.files || {};
  var site = readSite(files, options);
  var includeDrafts = parseBoolean(options.drafts, "--drafts");
  var route = options.route || "/blog";
  checkShipValues(route, site.title, options.project);
  var posts = [];
  var slugs = Object.create(null);
  var paths = Object.keys(files).sort();
  var sources = 0;
  for (var p = 0; p < paths.length; p++) {
    var path = paths[p];
    // Posts are the Markdown files at the top of the folder; README and _notes are not posts.
    if (path.indexOf("/") >= 0 || !/\.(md|markdown)$/i.test(path) || /^(readme|_)/i.test(path)) continue;
    sources++;
    var parsed = parseFrontMatter(files[path]);
    var meta = parsed.meta;
    if (parseBoolean(meta.draft, path + ": draft") && !includeDrafts) continue;
    var base = path.replace(/^.*\//, "").replace(/\.(md|markdown)$/i, "");
    var slug = slugify(meta.slug || base);
    if (slug === "index" || slug === "feed" || slug === "style") slug = slug + "-post";
    if (slugs[slug]) throw new Error("two posts use the slug " + slug + ": " + slugs[slug] + " and " + path);
    slugs[slug] = path;
    var body = parsed.body;
    var title = meta.title ? clean(meta.title) : "";
    if (!title) {
      var firstHeading = /^#\s+(.+)$/m.exec(body);
      title = firstHeading ? headingText(firstHeading[1].trim()) : base;
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
  if (sources === 0) {
    throw new Error("no posts: the folder has no .md files at its top level, so nothing would replace the current blog");
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

  var shipArgs = ["--route", route, "--title", site.title];
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
