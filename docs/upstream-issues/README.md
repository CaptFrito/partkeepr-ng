# Upstream issue/PR archive

Snapshot of every issue, pull request, and comment from
[partkeepr/PartKeepr](https://github.com/partkeepr/PartKeepr) at the moment
this script was last run, captured in case the upstream goes dark.

## Files

| File | Contents |
|---|---|
| `issues.json` | Every issue **and** every PR (GitHub returns PRs from the issues endpoint with a `pull_request` field set). Basic fields only. |
| `pulls.json` | Every PR with PR-specific fields: `head`, `base`, `merged`, `mergeable_state`, etc. Overlaps with `issues.json`; cross-reference by `number`. |
| `issue-comments.json` | Every comment on every issue or PR (the conversational thread). The `issue_url` field tells you which issue/PR each one belongs to. |
| `pr-review-comments.json` | Every inline code-line review comment on PRs. The `pull_request_url` field links them to a PR. |

## Refresh

```bash
./scripts/dump-upstream-issues.sh
```

Re-running overwrites the JSON files. Commit the result if the upstream
gains new activity you want to capture.
