# Contributing an app

1. Add `apps/<id>/ravi.app.json` (schema `ravi.app/v1`) and any text files the app needs, such as a `SKILL.md` that teaches the agent to use it. No binaries, no dot files, at most 100 files and 1 MiB.
2. Every command must be `ravi ...`. Mark an operation `"mutating": true` when the command it runs changes anything.
3. Put the app's own logic in a `script` operation: a `.js` file that defines `function main(input)` and returns `{ files, args, result }`. It runs in Ravi's sandbox, so it cannot read files, use the network or start programs; declare `input.dir` for the folder it should receive and `handoff` for the `ravi` command that takes its files. See `apps/blog` for a complete example.
4. Check it locally with a Ravi that has the store:

   ```bash
   ravi apps index build --check    # derives the class and the grants, writes nothing
   ravi apps install --from apps/<id>    # dry run: shows what installing would do
   ```

5. Open a pull request. A pull request may change only `apps/`; the maintainer reviews every line of code, and nothing reaches any Ravi until it is signed. CI runs the same check and shows the grants each version would run with.

A maintainer merges, then builds and signs the index on their own machine:

```bash
ravi apps index build
ravi apps index sign index.json --key ~/.ravi-keys/publish.pem
ravi apps index verify
```

## Withdrawing a version

```bash
ravi apps index block --id <id> --version <v> --reason "..."
ravi apps index sign blocklist.json --key ~/.ravi-keys/block.pem
```

The block list and the index must be re-signed before they expire (30 days): `ravi apps index block` without `--id` renews the block list, and `ravi apps index build` issues a new index serial. `keys.json` expires after a year and is re-signed with the root key.

Report security problems privately: see [SECURITY.md](SECURITY.md).
