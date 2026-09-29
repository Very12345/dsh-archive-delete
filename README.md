# dsh-archive-delete

Delete a conversation **straight from the DSH Web GUI sidebar**, including its
DSH archive-gate entry.

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) can only
*archive* a session: it hides the session id inside
`<DSH_HOME>/storages/workspace.json` (`global.archivedSessionIds`) and the Web
GUI then offers no list, no restore and no delete for it. This plugin fills that
gap.

## What it does

- Adds a **delete action to each sidebar row's hover card** — one click, no
  digging through the filesystem.
- Removes **both** the session directory **and** the archive-gate entry, so the
  conversation is genuinely gone rather than half-archived.
- Refuses to delete a session that is currently being driven (flock probe on
  `session.lock`), so you cannot corrupt a live run.

## Install

```sh
dsh plugin --profile <name> add @very12345/dsh-archive-delete
```

Restart the profile afterwards (or rely on `patchReload` if the profile has it
set to `live`) so the host half loads and the sidebar action appears.

## Design notes

This plugin is deliberately **standalone and DSH-version-agnostic**:

- **No coupling.** No bridge or Feishu dependency, and it imports no DSH
  service — the session store is treated as a plain directory tree. That keeps
  it from breaking anyone else's load order.
- **Version-agnostic log matching.** Session logs are matched by *shape*
  (`/^session(?:\.[a-z0-9]+)?\.jsonl\.zstd$/`), so both the v3 and v4/v0.2 naming
  schemes work without a version check.
- **Single HTTP route.** The client half injects the button; the host half
  answers it with one route that performs the removal.
- **Home resolution** follows `DSH_HOME`, then `WEBAGENT_HOME/deepseek-harness`,
  then `~/.dsh`.

## Requirements

- DSH with the Web GUI (`web` profile).
- Node.js >= 20.

## License

MIT — see [LICENSE](./LICENSE).

Not affiliated with DeepSeek. See [NOTICE](./NOTICE) for trademark details.
