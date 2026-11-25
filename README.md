# Ravi Apps

The official index of [Ravi](https://ravi.bot) apps. Ravi installs from here and from nowhere else by default.

```bash
ravi apps search                         # what is in the index
ravi apps install blog                   # shows the plan: version, files hash, what it can run
ravi apps install blog --execute         # installs; no agent sees it yet
ravi apps allow blog --agent main --execute
```

## How trust works

- `keys.json` names the keys that may sign this index. It is signed by a root key compiled into Ravi.
- `index.json` lists every published version: its file hash, its bundle, its class and the grants it runs with. It is signed by a publication key that never touches CI.
- `blocklist.json` withdraws versions. Ravi refreshes it every 6 hours and quarantines what it names.
- Every signed file has a serial that only goes up and an expiry, so an old copy cannot be replayed.

Ravi checks all of this itself; nothing in this repository runs on your machine.

## What an app can be here

Only **compose** apps: every command they run is `ravi` itself, aimed at a command that remote callers may use, and never an administration command (permissions, credentials, daemon, settings and the like). A compose app can do nothing the agent that calls it could not already do. Ravi derives the class from the manifest; nobody declares it.

An app's own logic ships as JavaScript and runs as a `script` operation inside Ravi's sandbox (QuickJS in WebAssembly): no disk, network, environment or other programs, with limits on memory, time and size. The script receives the files of one folder the caller names and returns files, which Ravi hands to one declared `ravi` command. Apps that need to run any other program are not accepted. See [SECURITY.md](SECURITY.md).

## Layout

```
apps/<id>/            the app as written: ravi.app.json plus text files (SKILL.md, lib/*.js, ...)
bundles/<id>-<v>.json what Ravi downloads, built from apps/<id>/ by `ravi apps index build`
index.json(.sig)      the signed list
keys.json(.sig)       publication and block keys, signed by the root key
blocklist.json(.sig)  withdrawn versions
```

A published version never changes. To change an app, raise its `version`.

## Apps

| App | What it does |
|---|---|
| [`blog`](apps/blog/) | Turns a folder of Markdown posts into a blog (post pages, index, RSS feed, its own theme) and publishes it as one Ravi Pages route. |

See [CONTRIBUTING.md](CONTRIBUTING.md) to propose an app.
