#!/usr/bin/env python3
"""
Score and group upstream PartKeepr issues by signal strength, focused on
features the user actually uses.

This is **input for review**, not a list of work items. The user has said
they want to evaluate each candidate before adopting, and to weight signals
explicitly. The score components below are tunable and labeled so judgments
can be made about whether the ranking matches reality.

Inputs:
  docs/upstream-issues/issues.json

Outputs:
  docs/issue-analysis.md   (human-readable, sectioned by feature area)
  docs/issue-analysis.json (structured, for re-use)

Score components (explicit and tunable — see WEIGHTS below):
  - per-comment activity (capped — heavy discussion = real pain)
  - reactions (+1 each, capped — quieter signal but real)
  - open vs closed (open = unresolved upstream, weighted)
  - recent activity (closed in last N years still counts, just less)
  - label boost (Bug > Feature Request > others)
  - keyword/feature-area match (boosts issues touching used features)
"""

from __future__ import annotations

import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
ISSUES = REPO / "docs/upstream-issues/issues.json"
OUT_MD = REPO / "docs/issue-analysis.md"
OUT_JSON = REPO / "docs/issue-analysis.json"

# Feature areas the user named, with case-insensitive keyword matchers. An
# issue can match multiple — we record all matches.
USED_FEATURES = {
    "stock": [r"\bstock\b", r"add[/ ]?remove stock", r"low stock", r"stock level", r"mass.?remove"],
    "parametric": [r"\bparametr", r"\bparameter\b", r"filter.*parameter", r"parameter.*filter"],
    "project": [r"\bproject\b", r"\bbom\b", r"project run", r"project report"],
    "octopart": [r"\boctopart\b", r"\bnexar\b"],
    "import": [r"\bimport\b", r"\baltium\b", r"\bbulk\b", r"\bbatch job\b", r"\bcsv\b", r"\bxlsx\b"],
    "meta_parts": [r"meta[ -]?part", r"metapart"],
    "attachments": [r"\battachment\b", r"\bdatasheet\b", r"\bupload(ed)?\b"],
}
# "Wants if fixable" — separate so we can see them clearly.
WANTED_FEATURES = {
    "barcode": [r"\bbarcode\b", r"\bscanner\b"],
    "webcam": [r"\bwebcam\b", r"\bcamera\b", r"\bphoto\b", r"\bimage capture\b"],
}
ALL_FEATURES = {**USED_FEATURES, **WANTED_FEATURES}

# Score weight knobs — easy to tune.
WEIGHTS = {
    "comment_per": 1.0,
    "comment_cap": 20,
    "reaction_per": 0.5,
    "reaction_cap": 10,
    "state_open_bonus": 5.0,
    "recent_close_bonus": 1.0,        # if closed within RECENT_YEARS
    "label_bug": 2.0,
    "label_feature": 1.0,
    "label_default": 0.5,
    "feature_match_bonus": 1.5,       # per used-feature matched (capped at 3)
    "feature_match_cap_n": 3,
}
RECENT_YEARS = 4


def parse_iso(s: str | None) -> datetime | None:
    if not s:
        return None
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def feature_areas(text: str, feature_map: dict) -> list[str]:
    matches = []
    lower = text.lower()
    for area, patterns in feature_map.items():
        if any(re.search(p, lower) for p in patterns):
            matches.append(area)
    return matches


def score_issue(issue: dict, now: datetime) -> tuple[float, dict, list[str]]:
    """Returns (score, breakdown_dict, matched_feature_areas)."""
    bd: dict[str, float] = {}

    n_comments = issue.get("comments", 0)
    bd["comments"] = min(n_comments, WEIGHTS["comment_cap"]) * WEIGHTS["comment_per"]

    rx = issue.get("reactions") or {}
    pos_reactions = (
        rx.get("+1", 0) + rx.get("heart", 0) + rx.get("hooray", 0) + rx.get("rocket", 0)
    )
    bd["reactions"] = min(pos_reactions, WEIGHTS["reaction_cap"]) * WEIGHTS["reaction_per"]

    if issue.get("state") == "open":
        bd["open_bonus"] = WEIGHTS["state_open_bonus"]
    else:
        closed = parse_iso(issue.get("closed_at"))
        if closed and (now - closed).days < RECENT_YEARS * 365:
            bd["recent_close"] = WEIGHTS["recent_close_bonus"]
        else:
            bd["recent_close"] = 0

    # Label boost — pick the strongest matching label
    label_score = 0.0
    label_names = [l.get("name", "") for l in (issue.get("labels") or [])]
    for n in label_names:
        nl = n.lower()
        if "bug" in nl:
            label_score = max(label_score, WEIGHTS["label_bug"])
        elif "feature" in nl:
            label_score = max(label_score, WEIGHTS["label_feature"])
        else:
            label_score = max(label_score, WEIGHTS["label_default"])
    bd["labels"] = label_score

    text = (issue.get("title") or "") + "\n" + (issue.get("body") or "")
    used_matches = feature_areas(text, USED_FEATURES)
    wanted_matches = feature_areas(text, WANTED_FEATURES)
    feature_count = min(len(used_matches) + len(wanted_matches),
                        WEIGHTS["feature_match_cap_n"])
    bd["feature_match"] = feature_count * WEIGHTS["feature_match_bonus"]

    return sum(bd.values()), bd, used_matches + wanted_matches


def main() -> int:
    issues = json.loads(ISSUES.read_text())
    # Drop PRs — GitHub returns them from the issues endpoint with pull_request set
    issues = [i for i in issues if "pull_request" not in i]
    now = datetime.now(timezone.utc)

    scored = []
    for issue in issues:
        sc, bd, areas = score_issue(issue, now)
        scored.append({
            "number": issue["number"],
            "title": issue["title"],
            "state": issue["state"],
            "comments": issue.get("comments", 0),
            "reactions_plus1": (issue.get("reactions") or {}).get("+1", 0),
            "labels": [l["name"] for l in (issue.get("labels") or [])],
            "areas": areas,
            "created_at": issue.get("created_at"),
            "closed_at": issue.get("closed_at"),
            "html_url": issue.get("html_url"),
            "score": round(sc, 2),
            "breakdown": {k: round(v, 2) for k, v in bd.items()},
        })

    scored.sort(key=lambda x: -x["score"])

    OUT_JSON.write_text(json.dumps(scored, indent=2))

    # ---- Markdown report ----
    md: list[str] = []
    md.append("# Upstream issue analysis (weighted ranking)\n")
    md.append(
        "_Generated by `scripts/analyze-issues.py`. **This is input for "
        "review, not adopted scope.** The user wants to evaluate each "
        "candidate before treating it as a requirement._\n\n"
    )
    md.append(
        "## Method\n\n"
        "Issues are scored by an explicit weighted sum. PRs are excluded. "
        "Higher score ≈ stronger signal that this issue represents real, "
        "current user pain.\n\n"
        "Score components (tunable in `scripts/analyze-issues.py`):\n"
    )
    for k, v in WEIGHTS.items():
        md.append(f"- `{k}` = {v}\n")
    md.append(f"\n_Recent-close window: {RECENT_YEARS} years._\n\n")

    # Per-area summary stats
    md.append("## Coverage by feature area\n\n")
    md.append("| Area | Tier | Total | Open | Top score |\n|---|---|---|---|---|\n")
    rows = []
    for area in ALL_FEATURES:
        tier = "used daily" if area in USED_FEATURES else "wants if fixable"
        in_area = [s for s in scored if area in s["areas"]]
        n_open = sum(1 for s in in_area if s["state"] == "open")
        top = max((s["score"] for s in in_area), default=0)
        rows.append((-len(in_area), area, tier, len(in_area), n_open, round(top, 1)))
    rows.sort()
    for _, area, tier, total, n_open, top in rows:
        md.append(f"| `{area}` | {tier} | {total} | {n_open} | {top} |\n")
    md.append("\n")

    # Top 30 overall
    md.append("## Top 30 issues overall (by score)\n\n")
    md.append(_render_table(scored[:30]))

    # Top 10 per area, used features first
    for area_group, header in [(USED_FEATURES, "Used daily"), (WANTED_FEATURES, "Wants if fixable")]:
        for area in area_group:
            in_area = [s for s in scored if area in s["areas"]]
            if not in_area:
                continue
            md.append(f"## {header}: `{area}` — top 10\n\n")
            md.append(_render_table(in_area[:10]))

    OUT_MD.write_text("".join(md))
    print(f"wrote {OUT_MD}")
    print(f"wrote {OUT_JSON}")
    print(f"scored {len(scored)} issues")
    return 0


def _render_table(rows: list[dict]) -> str:
    out = ["| # | State | Score | Comments | Reactions | Areas | Title |\n",
           "|---|---|---|---|---|---|---|\n"]
    for r in rows:
        title = r["title"].replace("|", "\\|")
        if len(title) > 80:
            title = title[:77] + "..."
        areas = ", ".join(r["areas"]) or "—"
        out.append(
            f"| [#{r['number']}]({r['html_url']}) | {r['state']} | "
            f"{r['score']} | {r['comments']} | {r['reactions_plus1']} | "
            f"{areas} | {title} |\n"
        )
    out.append("\n")
    return "".join(out)


if __name__ == "__main__":
    sys.exit(main())
