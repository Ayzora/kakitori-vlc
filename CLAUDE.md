## Code

The core (`core/`) is TypeScript run with Bun. Use Bun's tools: `bun test`, `bun check` (type check), `bun install`, `bun run <script>`, `bunx`. In code, prefer `Bun.file` / `Bun.write` over `node:fs` reads and writes, and `Bun.spawn` / `Bun.$` for processes.

The extension (`extension/kakitori.lua`) targets VLC 3's Lua 5.1. Nothing may run at its top level except definitions.

## Agent skills

### Issue tracker

Issues and specs live as local Markdown files under `.scratch/<feature>/`. See `docs/agents/issue-tracker.md`.

### Triage labels

Default labels (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`), recorded as a `Status:` line in each issue file. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
