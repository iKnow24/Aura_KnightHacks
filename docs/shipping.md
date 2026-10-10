# How changes get to main (no manual merging)

Every agent (Claude, Codex, Cursor) and every human works the same way:

1. Make a branch and open a pull request (PR).
2. While it's still in progress, keep it a **Draft**. Drafts never get merged.
3. When it's done, click **Ready for review** (agents: mark the PR ready).
4. The robot takes it from there:
   - it combines the PR with the latest `main`,
   - runs the checks (`server` tests and the `web` build, see `scripts/check.sh`),
   - if everything passes, it merges the PR into `main` and deletes the branch.
   - PRs that were stacked on that branch are moved onto `main` automatically and go next.
5. If it can't merge (conflict or a failing check), the PR gets a red **automerge** line
   with a link to what broke. Fix it and push. The robot tries again on its own.

The robot runs after every PR update, after every change to `main`, and every 10 minutes.

## Brakes

| Brake | What it does | How |
| --- | --- | --- |
| Draft | That PR never merges | Leave it as Draft, or "Convert to draft" |
| Pause | Nothing merges | Settings > Secrets and variables > Actions > Variables: add `AUTOMERGE_PAUSED` = `true`. Delete it to resume. |
| Freeze | From **Sun Oct 11, 8:00 AM** only PRs labeled `hotfix` merge | Automatic. Change `FREEZE_AT` in `.github/workflows/ci.yml` to move it. |

Why the freeze: the Devpost deadline is 10:00 AM and the demo video should be recorded from a
`main` that nobody is changing underneath you. Anything after 8:00 AM must be a deliberate `hotfix`.

## Rules for agents

- Open PRs against `main` when you can. Stacking on another PR's branch still works, it just waits for that one.
- Use merge, not squash or rebase, so stacked PRs stay clean.
- Run `bash scripts/check.sh` before marking a PR ready.
- If your branch was merged, start the next change from the latest `main` on a new PR.

## Files

- `.github/workflows/ci.yml`: when things run.
- `scripts/check.sh`: the checks.
- `scripts/automerge.sh`: the merge robot.
