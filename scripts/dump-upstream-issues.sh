#!/usr/bin/env bash
#
# Archive all issues, pull requests, and comments from the upstream
# partkeepr/PartKeepr repository into docs/upstream-issues/ as JSON.
#
# GitHub treats PRs as a special kind of issue, so the four endpoints
# we hit cover everything:
#
#   issues              : every issue AND every PR (basic fields)
#   pulls               : every PR (with PR-specific fields: head/base/merged)
#   issues/comments     : every comment on issues OR PRs (the discussion threads)
#   pulls/comments      : every PR inline review comment (code-line comments)
#
# Each call paginates through all pages via `gh api --paginate`. Output is
# concatenated JSON arrays — we use --slurp to merge pages into one file.
#
# Requires: gh (>= 2.x), authenticated via `gh auth login`.

set -euo pipefail

REPO="partkeepr/PartKeepr"
OUT_DIR="$(cd "$(dirname "$0")/.." && pwd)/docs/upstream-issues"
mkdir -p "$OUT_DIR"

if ! gh auth status >/dev/null 2>&1; then
    echo "ERROR: gh is not authenticated. Run 'gh auth login' first." >&2
    exit 1
fi

dump() {
    local endpoint="$1"
    local outfile="$2"
    local label="$3"
    echo "→ $label  (repos/$REPO/$endpoint)"
    # --paginate flattens pages: each page is a JSON array, so we --slurp
    # them with jq to produce a single flat array.
    gh api "repos/$REPO/$endpoint?state=all&per_page=100" \
        --paginate \
        --slurp \
        | jq 'flatten' \
        > "$outfile"
    local count
    count=$(jq 'length' < "$outfile")
    echo "  saved $count items → $outfile"
}

dump "issues"          "$OUT_DIR/issues.json"            "Issues + PRs (basic)"
dump "pulls"           "$OUT_DIR/pulls.json"             "Pull requests (detailed)"
dump "issues/comments" "$OUT_DIR/issue-comments.json"    "Issue/PR comments"
dump "pulls/comments"  "$OUT_DIR/pr-review-comments.json" "PR inline review comments"

# Brief README so future-you knows what's in this directory
cat > "$OUT_DIR/README.md" <<'EOF'
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
EOF

echo
echo "Done. Archive in $OUT_DIR"
ls -lh "$OUT_DIR"
