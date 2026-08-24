# Status board

This repository has an approver status board — a one-page snapshot of the
current phase, the release-gate ladder, what the open gate still needs, open
items, and recent activity.

- **Where:** [docs/gate-board.html](gate-board.html) — open it locally in a
  browser, or browse it through the git web UI once pushed.
- **Refreshing:** say **"refresh the gate board"** in a Claude Code session in
  this repo. The board is rebuilt from the controlled documents and the live
  repository state (branch, commit, test run); nothing on it is recalled from
  memory.
- **Binding:** [.claude/gate-board.json](../.claude/gate-board.json) — names
  the source documents, the test command, and the board location.

## The one rule

**The board is a rendering, never a source of truth.** It summarises
[CLAUDE.md](../CLAUDE.md), [RELEASING.md](../RELEASING.md), and
[ROADMAP.md](../ROADMAP.md). A decision, defect, or gate outcome recorded only
on the board does not exist — record it in those documents first, then refresh.
If the board disagrees with the documents, the documents win and the board is
stale.

## When to refresh

- After a release verification pass (passed or failed)
- After recording a ruling, defect, or deferred item in RELEASING.md or ROADMAP.md
- After a merge to main
- Before handing the project to anyone else
- When returning to the repository after a long gap
