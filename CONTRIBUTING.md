# Contributing an app

1. Add `apps/<id>/ravi.app.json` (schema `ravi.app/v1`) and any text files the app needs, such as a `SKILL.md` that teaches the agent to use it. No binaries, no dot files, at most 100 files and 1 MiB.
2. Every command must be `ravi ...`. Mark an operation `"mutating": true` when the command it runs changes anything.
3. Check it locally with a Ravi that has the store:

   ```bash
   ravi apps index build --check    # derives the class and the grants, writes nothing
   ravi apps install --from apps/<id>    # dry run: shows what installing would do
   ```

4. Open a pull request. CI runs the same check and shows the grants each version would run with.

A maintainer merges, then builds and signs the index on their own machine:

```bash
ravi apps index build
ravi apps index sign index.json --key ~/.ravi-keys/publish.key
ravi apps index verify
```

## Withdrawing a version

```bash
ravi apps index block --id <id> --version <v> --reason "..."
ravi apps index sign blocklist.json --key ~/.ravi-keys/block.key
```

The block list must be re-signed before it expires (30 days): `ravi apps index block` without `--id` renews it.
