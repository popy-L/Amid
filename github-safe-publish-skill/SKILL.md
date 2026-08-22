---
name: github-safe-publish
description: Safely publish or repair a local Git repository on GitHub, especially on Windows when proxies, missing CLI credentials, browser-upload fallbacks, malformed remote trees, or conflicting histories complicate the upload.
---

# GitHub Safe Publish

Publish the intended local snapshot without leaking secrets or silently damaging unrelated remote history.

## Establish the source of truth

- Inspect the local branch, worktree, remotes, ignore rules, and recent commits before changing anything.
- Treat existing local edits as user-owned. Do not clean, reset, or rewrite them merely to simplify publishing.
- Inspect the remote before deciding between a normal push, merge/rebase, or replacement.
- A newly created repository is not automatically disposable: replacing its history still requires explicit authorization once remote commits exist.

## Check the publication boundary

Before staging or uploading, inspect candidate paths rather than scanning or printing ignored secrets unnecessarily.

- Confirm `.env`, provider credentials, local databases, runtime state, caches, generated files, and personal documents are ignored as appropriate.
- Use `git status --ignored`, `git check-ignore`, and `git ls-files` to distinguish ignored data from tracked data.
- Scan candidate tracked/uploaded text for likely credentials without echoing secret values into the conversation.
- Verify the intended tree with `git ls-tree -r --name-only HEAD` after committing.

## Diagnose GitHub connectivity on Windows

Browser access does not prove that Git can reach GitHub. The browser, Git configuration, process environment, and system proxy can use different routes.

Check separately:

1. `git config --global --get http.proxy` and `https.proxy`.
2. `HTTP_PROXY` and `HTTPS_PROXY` in the active process.
3. Whether the configured loopback port is actually listening.
4. Direct DNS and TCP 443 reachability when proxy bypass is tested.

Common failure pattern: Git points to an old local proxy port while the active proxy client moved to another port. Update persistent global configuration only when the user asks or clearly approves it; otherwise prefer a one-shot `git -c http.proxy=... -c https.proxy=...` test.

Do not describe a failed route as “GitHub rejected the IP” unless there is evidence of an HTTP response saying so. A timeout, reset, dead loopback proxy, TLS failure, and authentication rejection are different failures.

## Prefer native Git

Use native Git push when network access and credentials work. It preserves directory structure, symlinks, executable bits, and commit history.

After pushing, verify:

- the upstream branch;
- local and remote commit IDs;
- `git status --short --branch`;
- the remote top-level tree.

## Browser upload fallback

Use browser upload only when native Git/API credentials are unavailable and the upload is small enough to verify manually.

- Uploading selected files through a browser may flatten nested paths even when JavaScript supplies `webkitRelativePath`.
- Never assume a successful browser commit preserved the intended directory tree. Open the repository tree and verify it immediately.
- Stop after the first structural mismatch. Do not compound it by uploading the remaining batches.
- Do not place secrets into browser automation payloads, logs, screenshots, or temporary scripts.

If a browser fallback produced a malformed tree, keep the correct local repository as the source of truth and repair the remote with native Git when connectivity returns.

## Repair conflicting or malformed remote history

Fetch first and show the divergence. Prefer non-destructive synchronization when the histories represent independent valuable work.

History replacement is appropriate only when all of these are true:

- the user identifies the local snapshot as authoritative;
- the remote commits are known failed uploads or otherwise intentionally disposable;
- the exact target branch is known;
- the user explicitly authorizes replacing that branch after the risk is explained.

Use `--force-with-lease`, not an unconditional force push, then fetch and verify the resulting remote tree. Stop if the lease fails; do not bypass evidence of a concurrent remote update.

## Report the result

State what was published, which branch tracks which remote, whether history was replaced, and whether sensitive/local-only data remained excluded. If only part of the workflow succeeded, distinguish “locally committed” from “pushed to GitHub.”
