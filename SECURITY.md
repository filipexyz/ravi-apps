# Security

This repository is the official source Ravi installs apps from. Ravi trusts it
only through signatures, never through GitHub itself.

## Trust model

- `keys.json` is signed by the maintainer's offline root key, whose public half
  is compiled into Ravi. It names the publication key and the block key.
- `index.json` (apps, versions, hashes) is signed by the publication key, and
  `blocklist.json` by the block key. All three have serials that only go up and
  an expiry date. Ravi refuses a file whose signature, serial or expiry is wrong,
  and refuses a download whose bytes do not hash to the signed value.
- The private keys never touch this repository, its CI or any server. Signing
  happens on the maintainer's machine. A change merged here does nothing to any
  Ravi until the maintainer signs a new index that includes it.

## What an app can do

- The index only lists `compose` apps: every command they run is the `ravi` CLI
  itself, on commands open to remote callers and outside administration, under
  the calling agent's own grants.
- App code runs only as `script` operations inside Ravi's sandbox (QuickJS in
  WebAssembly): no disk, network, environment or processes, with limits on
  memory, time and size. A script gets one folder the caller names inside the
  caller's working directory, and returns files that Ravi hands to one declared
  `ravi` command.
- Installing an app gives no agent anything. The operator exposes it agent by
  agent with `ravi apps allow`.

## Reporting a problem

Report a vulnerability privately through GitHub's "Report a vulnerability"
button on this repository (Security tab), not in a public issue. To pull a
published version quickly, the maintainer adds it to `blocklist.json`; Ravi
quarantines blocked versions on the next refresh (every 6 hours while an
official app is installed).
