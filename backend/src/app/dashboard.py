"""The home dashboard (PRD section 10 screen 2): the signed-in person's own work, most urgent first.

One request returns only the viewer's lists, so the page does not load the whole workspace:
- the review queue: materials that wait for one of the viewer's reviewer groups, with the deadline (PRD F6
  "Deadlines"), late ones first. Reviewers and higher only; other roles get no queue. Never the viewer's own
  materials (R1).
- the viewer's submissions that are not finished, newest first;
- the unresolved issues that the viewer owns or raised, the soonest due first;
- a few workspace counts and the approvals that expire in the next 30 days.
Everything goes through visible() and issue_visible(), so an affiliate sees only their own company's items (R4).
"""

import uuid
from datetime import date, timedelta

from fastapi import APIRouter
from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import selectinload

from app.api import APIModel, SignedIn
from app.issues import IssueOut
from app.material_access import Db, group_names_of, issue_visible, now, visible
from app.materials import LIST_LOAD, WAITING, Deadline, MaterialOut, expire_approvals
from app.models import Affiliate, Role
from app.models.materials import (
    Channel,
    GroupReview,
    GroupState,
    Issue,
    IssueStatus,
    LiveStatus,
    Material,
    MaterialStatus,
    Severity,
)

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])

DONE = (MaterialStatus.EXPIRED, MaterialStatus.RETIRED)  # not shown in My submissions
LIVE_PROBLEMS = (LiveStatus.UNAPPROVED, LiveStatus.CHANGED, LiveStatus.CONDITION_BROKEN, LiveStatus.EXPIRED_APPROVAL)
EXPIRING_DAYS = 30

ISSUE_LOAD = (
    selectinload(Issue.material).selectinload(Material.affiliate).selectinload(Affiliate.manager),
    selectinload(Issue.owner),
    selectinload(Issue.opened_by),
)


class QueueItem(APIModel):
    material: MaterialOut
    # The earliest deadline of the viewer's groups that still wait on it: one decision counts for all of them
    # (PRD F5), so it must meet the strictest one.
    deadline: Deadline
    groups: list[str]  # the viewer's groups that still wait on it


class Expiring(APIModel):
    id: uuid.UUID
    title: str
    channel: Channel
    expires_at: date


class WorkspaceSummary(APIModel):
    """Problems in the part of the workspace the viewer may see. Each one links to a filtered list."""

    live_problems: int
    overdue_issues: int
    high_issues: int  # unresolved, high severity
    expiring: list[Expiring]  # approvals that end in the next 30 days, soonest first


class Dashboard(APIModel):
    queue: list[QueueItem] | None = None  # none for a role that reviews nothing (Viewer, Submitter, Affiliate)
    submissions: list[MaterialOut]
    issues: list[IssueOut]
    workspace: WorkspaceSummary


@router.get("", response_model_exclude_none=True)
async def get_dashboard(viewer: SignedIn, db: Db) -> Dashboard:
    await expire_approvals(db, viewer)
    at = now()
    today = at.date()
    reviews = viewer.role.at_least(Role.REVIEWER)
    my_groups = await group_names_of(db, viewer) if reviews else {}

    # My submissions and my queue in one query
    mine = and_(Material.owner_id == viewer.id, Material.status.not_in(DONE))
    waiting_for_me = and_(
        Material.owner_id != viewer.id,
        Material.status.in_(WAITING),
        Material.reviews.any(and_(GroupReview.group_id.in_(list(my_groups)), GroupReview.state == GroupState.WAITING)),
    )
    materials = list(
        await db.scalars(
            select(Material)
            .where(*visible(viewer), or_(mine, waiting_for_me) if my_groups else mine)
            .options(*LIST_LOAD)
            .order_by(Material.updated_at.desc())
        )
    )

    queue: list[QueueItem] = []
    for m in materials:
        if m.owner_id == viewer.id or m.status not in WAITING:
            continue
        waiting = [r for r in m.reviews if r.group_id in my_groups and r.state is GroupState.WAITING]
        if not waiting:
            continue
        target = min(r.group.target_business_days for r in waiting)
        queue.append(
            QueueItem(
                material=MaterialOut.of(m),
                deadline=Deadline.of(m.submitted_at or m.updated_at, target, at),
                groups=[r.group.name for r in waiting],
            )
        )
    queue.sort(key=lambda q: (q.deadline.at, q.material.title))

    issues = await db.scalars(
        select(Issue)
        .where(
            *issue_visible(viewer),
            Issue.status != IssueStatus.RESOLVED,
            or_(Issue.owner_id == viewer.id, Issue.opened_by_id == viewer.id),
        )
        .options(*ISSUE_LOAD)
        .order_by(Issue.due_at, Issue.id)
    )

    # The workspace counts in one query
    unresolved = Issue.status != IssueStatus.RESOLVED
    live_problems, overdue, high = (
        await db.execute(
            select(
                select(func.count(Material.id))
                .where(*visible(viewer), Material.live_status.in_(LIVE_PROBLEMS))
                .scalar_subquery(),
                select(func.count(Issue.id)).where(*issue_visible(viewer), unresolved, Issue.due_at < at).scalar_subquery(),
                select(func.count(Issue.id))
                .where(*issue_visible(viewer), unresolved, Issue.severity == Severity.HIGH)
                .scalar_subquery(),
            )
        )
    ).one()
    expiring = await db.execute(
        select(Material.id, Material.title, Material.channel, Material.expires_at)
        .where(
            *visible(viewer),
            Material.expires_at > today,
            Material.expires_at <= today + timedelta(days=EXPIRING_DAYS),
        )
        .order_by(Material.expires_at, Material.title)
    )

    return Dashboard(
        queue=queue if reviews else None,
        submissions=[MaterialOut.of(m) for m in materials if m.owner_id == viewer.id and m.status not in DONE],
        issues=[IssueOut.of(i) for i in issues],
        workspace=WorkspaceSummary(
            live_problems=live_problems,
            overdue_issues=overdue,
            high_issues=high,
            expiring=[Expiring(id=i, title=t, channel=c, expires_at=e) for i, t, c, e in expiring.all()],
        ),
    )
