---
name: "speckit-worktree"
description: "Move the spec just created by /speckit-specify into its own git worktree and branch, keeping master clean."
compatibility: "Requires spec-kit project structure with .specify/ directory"
user-invocable: true
disable-model-invocation: false
---

Run from the master checkout right after `/speckit-specify`.

1. Run `.specify/scripts/powershell/create-feature-worktree.ps1 -Json` from the repository root.
2. If it fails, report the error text verbatim and stop. Do not work around guards (wrong branch,
   dirty tree, existing branch/path).
3. On success, report `BRANCH_NAME`, `WORKTREE_PATH`, and `SPEC_DIR`, and tell the user to start a
   new session in `WORKTREE_PATH` and run `/speckit-clarify` or `/speckit-plan` there.
4. Do not push, and do not run further Spec Kit commands in the worktree.
