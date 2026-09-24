# Agent Skills

Void discovers first-version Agent Skills from these direct-child roots:

- `<workspace>/.void/skills/*/SKILL.md`
- `<workspace>/.agents/skills/*/SKILL.md`
- `~/.void/skills/*/SKILL.md`
- `~/.agents/skills/*/SKILL.md`

Project roots are loaded only when the workspace is trusted. Project skills take precedence over user skills, and `.void/skills` takes precedence over `.agents/skills` within the same scope. Skills require `name` and `description` frontmatter before they are disclosed to the model.

The initial implementation intentionally does not scan `.claude/skills` and does not map experimental `allowed-tools` metadata into Void approval policy. Those are follow-ups; Void's existing tool approval settings remain authoritative.

## OpenSpec

OpenSpec does not currently generate Void-native skills directly. If `openspec init` was run with Codex output and created `.codex/skills`, copy those skills into Void's project skill root:

```bash
mkdir -p .void/skills
cp -a .codex/skills/. .void/skills/
```

Keep `.codex` if other tools still use it. Void discovers the copied skills from `.void/skills` when the workspace is trusted and Agent Skills are enabled.

For best routing, add a broad `.void/skills/openspec/SKILL.md` router skill alongside the generated OpenSpec skills. The router should direct natural-language requests to:

- `openspec-propose` for creating a new change.
- `openspec-apply-change` for implementing or continuing an existing change.
- `openspec-explore` for requirements, architecture, and tradeoff exploration.
- `openspec-archive-change` for archiving completed changes.

Explicit invocation is deterministic with `$skill-name`, for example `$openspec-apply-change add-next`. Natural-language requests work through the skills catalog and the `openspec` router skill.
