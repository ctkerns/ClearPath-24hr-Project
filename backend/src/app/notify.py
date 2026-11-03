"""Sends in-app notifications (PRD F13). The write endpoints call these functions.

Like `app.audit.record`, `notify` only adds rows to the session. The endpoint's own commit saves them
with the change, in the same transaction: a change that fails notifies nobody.
Rules for every notification:
- Never the actor: nobody gets a notification about their own action.
- Only active users. Deactivated users cannot sign in, and invited users have not joined yet.
- The affiliate manager gets a copy of an affiliate's notifications (PRD section 4).
- An affiliate gets nothing about another company's material (R4).
TODO (F13): Slack and email delivery. TODO (F6): the SLA reminder to the group and the Managers.
"""

import uuid
from collections.abc import Iterable

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Affiliate, ReviewerGroup, Role, User, UserStatus, group_memberships
from app.models.materials import Comment, Decision, Issue, Material, MaterialStatus, MaterialVersion
from app.models.notifications import Notification, NotificationType

__all__ = ["NotificationType", "notify", "notify_comment", "notify_decision", "notify_groups", "notify_new_issue"]


async def notify(
    db: AsyncSession,
    recipients: Iterable[uuid.UUID | None],
    type: NotificationType,
    *,
    actor: User,
    material: Material,
    issue: Issue | None = None,
    group: str | None = None,
    summary: str | None = None,
) -> set[uuid.UUID]:
    """Adds one notification for each recipient that the rules above allow. Returns who got one."""
    wanted = {r for r in recipients if r is not None}
    users = await active_users(db, actor, wanted)
    # The affiliate manager gets a copy (PRD section 4).
    company_ids = {u.affiliate_id for u in users if u.role is Role.AFFILIATE and u.affiliate_id}
    if company_ids:
        managers = await db.scalars(select(Affiliate.manager_id).where(Affiliate.id.in_(company_ids)))
        users += await active_users(db, actor, {m for m in managers if m} - {u.id for u in users})
    sent: set[uuid.UUID] = set()
    for u in users:
        if u.role is Role.AFFILIATE and u.affiliate_id != material.affiliate_id:
            continue  # R4
        sent.add(u.id)
        db.add(
            Notification(
                workspace_id=actor.workspace_id,
                user_id=u.id,
                type=type,
                actor_id=actor.id,
                actor_name=actor.name,
                material_id=material.id,
                issue_id=issue.id if issue else None,
                group_name=group,
                summary=summary,
                material_title=material.title,
            )
        )
    return sent


async def active_users(db: AsyncSession, actor: User, ids: set[uuid.UUID]) -> list[User]:
    """The active users among `ids` in the actor's workspace, without the actor."""
    ids = ids - {actor.id}
    if not ids:
        return []
    rows = await db.scalars(
        select(User).where(User.id.in_(ids), User.workspace_id == actor.workspace_id, User.status == UserStatus.ACTIVE)
    )
    return list(rows)


async def notify_groups(
    db: AsyncSession, actor: User, type: NotificationType, material: Material, groups: Iterable[ReviewerGroup]
) -> None:
    """Assignment and escalation (PRD F6): the Reviewers in each group. A Reviewer in two of the groups
    gets one notification, which names the first group."""
    done: set[uuid.UUID] = {actor.id}
    for g in groups:
        members = await db.scalars(
            select(User.id)
            .join(group_memberships, group_memberships.c.user_id == User.id)
            .where(group_memberships.c.group_id == g.id, User.role.in_([Role.REVIEWER, Role.MANAGER, Role.ADMIN]))
        )
        done |= await notify(db, set(members) - done, type, actor=actor, material=material, group=g.name)


DECISION_TYPES = {
    Decision.APPROVE: NotificationType.DECISION_APPROVED,
    Decision.APPROVE_CONDITIONS: NotificationType.DECISION_APPROVED,
    Decision.REQUEST_CHANGES: NotificationType.DECISION_CHANGES_REQUESTED,
    Decision.REJECT: NotificationType.DECISION_REJECTED,
}


async def notify_decision(
    db: AsyncSession, actor: User, material: Material, version: MaterialVersion, decision: Decision
) -> None:
    """PRD F5: the owner, and the submitter of the version when that is someone else.
    An approval notifies only when it completes the approval (every required group approved),
    because before that the material still waits."""
    type = DECISION_TYPES.get(decision)
    if type is None:
        return  # escalate uses notify_groups; retract is not in the F13 list
    if type is NotificationType.DECISION_APPROVED and material.status is not MaterialStatus.APPROVED:
        return  # other required groups still wait
    await notify(db, {material.owner_id, version.submitted_by_id}, type, actor=actor, material=material)


async def notify_comment(db: AsyncSession, actor: User, material: Material) -> None:
    """The owner, and everyone who already commented or decided on the material (a decision is also
    a comment), like the people in a pull request thread. Kept simple: no mentions or subscriptions yet."""
    authors = await db.scalars(select(Comment.author_id).where(Comment.material_id == material.id).distinct())
    await notify(db, {material.owner_id, *authors}, NotificationType.COMMENT, actor=actor, material=material)


async def notify_new_issue(db: AsyncSession, actor: User, issue: Issue, material: Material) -> None:
    """PRD F12: the owner and the Managers (Admins have every Manager right, section 4).
    For affiliate content also the affiliate manager."""
    managers = await db.scalars(
        select(User.id).where(User.workspace_id == actor.workspace_id, User.role.in_([Role.MANAGER, Role.ADMIN]))
    )
    affiliate_manager = None
    if material.affiliate_id:
        affiliate_manager = await db.scalar(select(Affiliate.manager_id).where(Affiliate.id == material.affiliate_id))
    await notify(
        db,
        {issue.owner_id, affiliate_manager, *managers},
        NotificationType.ISSUE,
        actor=actor,
        material=material,
        issue=issue,
        summary=issue.title,
    )
