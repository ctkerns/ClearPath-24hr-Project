"""Metrics (PRD F14, the metrics of PRD section 2).

The server sends one record per final decision and one per live violation, made from the review tables.
The page counts them for its filters (date, channel, product, reviewer group), so every number on the page
comes from the same records. Internal users only (Viewer and higher); affiliates get 403 (PRD section 4).

A final decision is a version with the outcome Approved or Rejected. Its review cycle is that version and
the versions before it, back to the previous final decision: "Changes requested" versions are its rounds.
"""

import re
import uuid
from collections import defaultdict
from datetime import datetime, timedelta
from typing import Literal

from fastapi import APIRouter
from sqlalchemy import select

from app.api import APIModel, InternalUser
from app.material_access import Db, now
from app.models import ReviewerGroup
from app.models.materials import (
    Channel,
    Comment,
    Decision,
    Finding,
    FindingSource,
    FindingStatus,
    GroupReview,
    Issue,
    IssueKind,
    Material,
    MaterialVersion,
    Outcome,
    Product,
    ReviewPath,
)

router = APIRouter(prefix="/api/metrics", tags=["metrics"])

# The page compares a period with the one before it; the longest period is 12 months.
HISTORY = timedelta(days=2 * 366)
FINAL = (Outcome.APPROVED, Outcome.REJECTED)
DECIDING = (Decision.APPROVE, Decision.APPROVE_CONDITIONS, Decision.REJECT)


class DecisionRecord(APIModel):
    decided_at: datetime
    channel: Channel
    product: Product
    groups: list[str]  # the required reviewer groups
    path: Literal["full", "no_change"]
    turnaround_days: float  # business days from the first submission of the cycle to the decision
    rounds: int  # versions in the cycle
    outcome: Literal["approved", "rejected"]
    findings: list[str]  # rule IDs of the findings that were not hidden, one per finding
    ai_findings: int
    ai_outdated: int
    human_comments: int  # comments on selected text
    human_uncovered: int  # of those, the ones that no AI finding on the same version overlaps
    later_violation: bool  # monitoring later found a problem that was already in this approved version


class ViolationRecord(APIModel):
    found_at: datetime
    channel: Channel
    product: Product | None = None  # none for content that matches no material
    kind: IssueKind
    days_to_fix: float | None = None  # none while the issue is open


class Metrics(APIModel):
    decisions: list[DecisionRecord]
    violations: list[ViolationRecord]


def business_days(start: datetime, end: datetime) -> float:
    """Days between two times, without Saturdays and Sundays (UTC), to one decimal."""
    total = timedelta()
    day = start.replace(hour=0, minute=0, second=0, microsecond=0)
    while day < end:
        nxt = day + timedelta(days=1)
        if day.weekday() < 5:
            total += min(end, nxt) - max(start, day)
        day = nxt
    return round(max(total.total_seconds(), 0) / 86400, 1)


def normal(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip().casefold()


def overlaps(a: str, b: str) -> bool:
    """True when one text contains the other. Findings store only their text, not a position."""
    a, b = normal(a), normal(b)
    return bool(a and b) and (a in b or b in a)


@router.get("", response_model_exclude_none=True)
async def get_metrics(viewer: InternalUser, db: Db) -> Metrics:
    ws = viewer.workspace_id
    since = now() - HISTORY

    materials = {m.id: m for m in await db.scalars(select(Material).where(Material.workspace_id == ws))}
    versions: dict[uuid.UUID, list[MaterialVersion]] = defaultdict(list)
    for v in await db.scalars(
        select(MaterialVersion).where(MaterialVersion.workspace_id == ws).order_by(MaterialVersion.number)
    ):
        versions[v.material_id].append(v)
    group_names = dict((await db.execute(select(ReviewerGroup.id, ReviewerGroup.name).where(ReviewerGroup.workspace_id == ws))).all())
    current_groups: dict[uuid.UUID, list[str]] = defaultdict(list)
    current_decided: dict[uuid.UUID, datetime] = {}
    for r in await db.scalars(select(GroupReview).where(GroupReview.workspace_id == ws).order_by(GroupReview.position)):
        current_groups[r.material_id].append(group_names[r.group_id])
        if r.decided_at and (r.material_id not in current_decided or r.decided_at > current_decided[r.material_id]):
            current_decided[r.material_id] = r.decided_at
    # Comments by (material, version number): the deciding ones and the ones on selected text
    comments: dict[tuple[uuid.UUID, int], list[Comment]] = defaultdict(list)
    for c in await db.scalars(
        select(Comment).where(
            Comment.workspace_id == ws,
            (Comment.decision.in_(DECIDING)) | (Comment.anchor_text.is_not(None)),
        )
    ):
        if c.version_number is not None:
            comments[(c.material_id, c.version_number)].append(c)
    findings: dict[uuid.UUID, list[Finding]] = defaultdict(list)
    for f in await db.scalars(select(Finding).where(Finding.workspace_id == ws).order_by(Finding.position)):
        findings[f.version_id].append(f)
    issues = list(await db.scalars(select(Issue).where(Issue.workspace_id == ws)))
    missed = {i.approved_version_id for i in issues if i.present_at_approval and i.approved_version_id}

    decisions: list[DecisionRecord] = []
    for material_id, rows in versions.items():
        m = materials[material_id]
        start = 0
        for i, v in enumerate(rows):
            if v.outcome not in FINAL:
                continue
            cycle, start = rows[start : i + 1], i + 1
            deciding = [c for c in comments[(m.id, v.number)] if c.decision in DECIDING]
            is_current = v is rows[-1]
            if deciding:
                decided_at = max(c.at for c in deciding)
            elif is_current and m.id in current_decided:
                decided_at = current_decided[m.id]
            else:
                continue  # no record of when it was decided (some seeded demo versions)
            if decided_at < since:
                continue
            if is_current:
                groups = current_groups[m.id]
            else:
                # Older versions keep no group rows. A deciding comment's role names the groups it covered.
                groups = []
                for c in deciding:
                    for name in c.role.split(", "):
                        if name in group_names.values() and name not in groups:
                            groups.append(name)
            cycle_findings = [f for x in cycle for f in findings[x.id]]
            ai = [f for f in cycle_findings if f.source is FindingSource.AI]
            ai_by_number = {x.number: [f.flagged_text for f in findings[x.id] if f.source is FindingSource.AI] for x in cycle}
            anchored = [c for x in cycle for c in comments[(m.id, x.number)] if c.anchor_text]
            uncovered = [
                c for c in anchored if not any(overlaps(c.anchor_text or "", t) for t in ai_by_number[c.version_number or 0])
            ]
            decisions.append(
                DecisionRecord(
                    decided_at=decided_at,
                    channel=m.channel,
                    product=m.product,
                    groups=groups,
                    path="no_change" if v.path is ReviewPath.LIGHTER else "full",
                    turnaround_days=business_days(cycle[0].submitted_at, decided_at),
                    rounds=len(cycle),
                    outcome="approved" if v.outcome is Outcome.APPROVED else "rejected",
                    findings=[f.rule_id for f in cycle_findings if f.status is not FindingStatus.HIDDEN],
                    ai_findings=len(ai),
                    ai_outdated=sum(f.status is FindingStatus.OUTDATED for f in ai),
                    human_comments=len(anchored),
                    human_uncovered=len(uncovered),
                    later_violation=v.outcome is Outcome.APPROVED and v.id in missed,
                )
            )

    violations: list[ViolationRecord] = []
    for issue in issues:
        m = materials.get(issue.material_id) if issue.material_id else None
        channel = m.channel if m else issue.channel
        if issue.kind is None or channel is None or issue.opened_at < since:
            continue
        violations.append(
            ViolationRecord(
                found_at=issue.opened_at,
                channel=channel,
                product=m.product if m else None,
                kind=issue.kind,
                days_to_fix=round((issue.resolved_at - issue.opened_at).total_seconds() / 86400, 1)
                if issue.resolved_at
                else None,
            )
        )

    decisions.sort(key=lambda d: d.decided_at)
    violations.sort(key=lambda v: v.found_at)
    return Metrics(decisions=decisions, violations=violations)
