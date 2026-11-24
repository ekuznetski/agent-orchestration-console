# Project Instructions for AI Agents

This file provides instructions and context for AI coding agents working on this project.

<!-- BEGIN BEADS INTEGRATION v:1 profile:minimal hash:1105d646 -->
## Beads Issue Tracker

This project uses **bd (beads)** for issue tracking. Run `bd prime` to see full workflow context and commands.

### Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --claim  # Claim work
bd close <id>         # Complete work
```

### Rules

- Use `bd` for ALL task tracking — do NOT use TodoWrite, TaskCreate, or markdown TODO lists
- Run `bd prime` for detailed command reference and session close protocol
- Use `bd remember` for persistent knowledge — do NOT use MEMORY.md files

**Architecture in one line:** issues live in a local Dolt DB; sync uses `refs/dolt/data` on your git remote; `.beads/issues.jsonl` is a passive export. See https://github.com/gastownhall/beads/blob/main/docs/core-concepts/sync-concepts.md for details and anti-patterns.

## Agent Context Profiles

The managed Beads block is task-tracking guidance, not permission to override repository, user, or orchestrator instructions.

- **Conservative (default)**: Use `bd` for task tracking. Do not run git commits, git pushes, or Dolt remote sync unless explicitly asked. At handoff, report changed files, validation, and suggested next commands.
- **Minimal**: Keep tool instruction files as pointers to `bd prime`; use the same conservative git policy unless active instructions say otherwise.
- **Team-maintainer**: Only when the repository explicitly opts in, agents may close beads, run quality gates, commit, and push as part of session close. A current "do not commit" or "do not push" instruction still wins.

## Session Completion

This protocol applies when ending a Beads implementation workflow. It is subordinate to explicit user, repository, and orchestrator instructions.

1. **File issues for remaining work** - Create beads for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **Handle git/sync by active profile**:
   ```bash
   # Conservative/minimal/default: report status and proposed commands; wait for approval.
   git status

   # Team-maintainer opt-in only, unless current instructions forbid it:
   git pull --rebase
   git push
   git status
   ```
5. **Hand off** - Summarize changes, validation, issue status, and any blocked sync/commit/push step

**Critical rules:**
- Explicit user or orchestrator instructions override this Beads block.
- Do not commit or push without clear authority from the active profile or the current user request.
- If a required sync or push is blocked, stop and report the exact command and error.
<!-- END BEADS INTEGRATION -->

## Project rules

- What can happen at runtime comes only from `README.md`, `mock/orchestrator.d.ts` and `fixtures/events.json`. Never read `mock/orchestrator.js` to decide behaviour: it stands in for a real backend.
- No guard, fallback, try/catch, buffer or retry without naming the contract line that makes the situation possible. Ruled out by the contract, never guarded: events before `plan`, events without `type` or `seq`, agents outside `plan.subtasks`, events of an old run after `reset()`. Out-of-order delivery is in the contract and is handled by ordering on `seq`. Allowed exceptions (see docs/architecture.md): try/catch around `reduce` so a reducer bug does not freeze the store, unknown event types logged and skipped, an app error boundary with "Start over".
- Texts from the mock (`statusLine`, step `detail`, `question`, `context`, `options`, `draft`, `result`) are shown verbatim.
- A layout shift caused by a streamed event is a bug; a shift the user causes (expand, click) is fine.
- Stack: React 19, Vite, TypeScript, Tailwind v4, shadcn/ui on Base UI, Zustand 5 (useShallow for derived objects and arrays), react-error-boundary, lucide-react, Vitest with Testing Library and jsdom, Playwright, oxlint, prettier, React Compiler; package manager pnpm. Dependencies and configs only via generators (`pnpm create`, `pnpm add`, `shadcn add`, `playwright init`); name the package and why, wait for the owner's yes.
- No git commit and no push without the owner's explicit yes.
- Beads stay local in this repository: never run bd dolt push, bd dolt remote or any beads sync to a git remote, even when a git push happens.
- Code text: no Russian, no emoji, no em dash.

## Build & Test

```bash
cd app
pnpm install
pnpm dev       # http://localhost:5173 (any free port; e2e uses 5297)
pnpm build     # tsc -b and vite build
pnpm test      # Vitest unit and component tests
pnpm lint      # oxlint
pnpm format    # prettier --write src e2e *.ts
pnpm e2e       # Playwright, starts the dev server on 5297
```
