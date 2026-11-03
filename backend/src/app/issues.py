"""Issues on materials, and their remediation (PRD F12).

Everyone reads the issues of the materials they may see (affiliates: only their own company's, R4).
Any Reviewer or higher opens an issue on any material. The issue owner, or a Manager and higher,
changes its status and runs its actions. Submitters and higher, and affiliates, comment.
"""

import uuid
from datetime import datetime
from typing import Any

from fastapi import APIRouter, HTTPException, status
from pydantic import Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api import APIModel, SignedIn, bad_request, conflict, not_found
from app.material_access import Db, Reviewer, Submitter, can_submit, now, visible
from app.models import Affiliate, Role, User, UserStatus
from app.models.materials import (
    ActionKind,
    Channel,
    EventType,
    Issue,
    IssueEvent,
    IssueSource,
    IssueStatus,
    Material,
    MaterialEvent,
    Severity,
)
from app.users import load_user

router = APIRouter(prefix="/api/issues", tags=["issues"])

STATUS_LABEL = {IssueStatus.OPEN: "Open", IssueStatus.IN_PROGRESS: "In progress", IssueStatus.RESOLVED: "Resolved"}


class IssueMaterial(APIModel):
    id: uuid.UUID
    title: str
    channel: Channel


class IssueOut(APIModel):
    """A row of the issue list. It carries a summary of the material, so the list needs one request."""

    id: uuid.UUID
    title: str
    severity: Severity
    status: IssueStatus
    source: IssueSource
    material: IssueMaterial
    affiliate: str | None = None
    affiliate_manager: str | None = None  # takes over affiliate issues after the due date (PRD section 4)
    opened_by: str | None = None
    owner: str
    owner_id: uuid.UUID
    due_at: datetime
    opened_at: datetime
    resolved_at: datetime | None = None

    @classmethod
    def of(cls, i: Issue) -> IssueOut:
        company = i.material.affiliate
        return cls(
            id=i.id,
            title=i.title,
            severity=i.severity,
            status=i.status,
            source=i.source,
            material=IssueMaterial(id=i.material.id, title=i.material.title, channel=i.material.channel),
            affiliate=company.name if company else None,
            affiliate_manager=company.manager.name if company and company.manager else None,
            opened_by=i.opened_by.name if i.opened_by else None,
            owner=i.owner.name,
            owner_id=i.owner_id,
            due_at=i.due_at,
            opened_at=i.opened_at,
            resolved_at=i.resolved_at,
        )


class RuleRef(APIModel):
    id: str
    title: str


class ActionOut(APIModel):
    id: uuid.UUID
    kind: ActionKind
    label: str
    done: bool
    done_by: str | None = None
    done_at: datetime | None = None


class ActivityOut(APIModel):
    at: datetime
    actor: str
    text: str
    comment: bool | None = None


class IssueDetail(APIModel):
    id: uuid.UUID
    summary: str
    rule: RuleRef | None = None
    condition: str | None = None
    live_item: dict[str, Any] | None = None
    approved: dict[str, Any] | None = None
    actions: list[ActionOut]
    notice: dict[str, Any] | None = None
    activity: list[ActivityOut]

    @classmethod
    def of(cls, i: Issue) -> IssueDetail:
        return cls(
            id=i.id,
            summary=i.summary,
            rule=RuleRef(id=i.rule_id, title=i.rule_title or "") if i.rule_id else None,
            condition=i.condition,
            live_item=i.live_item,
            approved=i.approved,
            actions=[
                ActionOut(id=a.id, kind=a.kind, label=a.label, done=a.done_at is not None, done_by=a.done_by_name, done_at=a.done_at)
                for a in i.actions
            ],
            notice=i.notice,
            activity=[ActivityOut(at=e.at, actor=e.actor_name, text=e.text, comment=e.is_comment or None) for e in i.activity],
        )


ISSUE_LOAD = (
    selectinload(Issue.material).selectinload(Material.affiliate).selectinload(Affiliate.manager),
    selectinload(Issue.owner),
    selectinload(Issue.opened_by),
    selectinload(Issue.actions),
    selectinload(Issue.activity),
)


async def load_issue(db: AsyncSession, viewer: User, issue_id: uuid.UUID) -> Issue:
    issue = await db.scalar(
        select(Issue)
        .join(Material, Material.id == Issue.material_id)
        .where(Issue.id == issue_id, Issue.workspace_id == viewer.workspace_id, *visible(viewer))
        .options(*ISSUE_LOAD)
        .execution_options(populate_existing=True)
    )
    if issue is None:
        raise not_found("Issue not found")
    return issue


@router.get("", response_model_exclude_none=True)
async def list_issues(viewer: SignedIn, db: Db) -> list[IssueOut]:
    rows = await db.scalars(
        select(Issue)
        .join(Material, Material.id == Issue.material_id)
        .where(Issue.workspace_id == viewer.workspace_id, *visible(viewer))
        .options(*ISSUE_LOAD)
        .order_by(Issue.opened_at.desc())
    )
    return [IssueOut.of(i) for i in rows]


@router.get("/{issue_id}", response_model_exclude_none=True)
async def get_issue(issue_id: uuid.UUID, viewer: SignedIn, db: Db) -> IssueDetail:
    return IssueDetail.of(await load_issue(db, viewer, issue_id))


class NewIssue(APIModel):
    material_id: uuid.UUID
    title: str = Field(min_length=1, max_length=300)
    summary: str = Field(min_length=1, max_length=5000)
    severity: Severity
    owner_id: uuid.UUID
    due_at: datetime


def log(issue: Issue, actor: User, text: str, comment: bool = False) -> None:
    issue.activity.append(
        IssueEvent(workspace_id=issue.workspace_id, at=now(), actor_id=actor.id, actor_name=actor.name, text=text, is_comment=comment)
    )


@router.post("", status_code=status.HTTP_201_CREATED, response_model_exclude_none=True)
async def raise_issue(body: NewIssue, viewer: Reviewer, db: Db) -> IssueOut:
    """PRD F5, F12: any Reviewer or higher, on any material, at any time.
    TODO (F13): notify the owner and the Managers, and the affiliate manager for affiliate content."""
    material = await db.scalar(select(Material).where(Material.id == body.material_id, *visible(viewer)))
    if material is None:
        raise not_found("Material not found")
    title, summary = body.title.strip(), body.summary.strip()
    if not title or not summary:
        raise bad_request("Write a title and a summary")
    if body.due_at.tzinfo is None:
        raise bad_request("The due date needs a time zone")
    if body.due_at <= now():
        raise bad_request("The due date has passed")
    owner = await load_user(db, viewer, body.owner_id)
    if owner.status is not UserStatus.ACTIVE:
        raise bad_request("The owner must be an active user")
    # An affiliate can own only an issue on their own company's content (PRD R4).
    if owner.role is Role.AFFILIATE and owner.affiliate_id != material.affiliate_id:
        raise bad_request("This affiliate cannot own an issue on this material")

    issue = Issue(
        workspace_id=viewer.workspace_id,
        material_id=material.id,
        title=title,
        summary=summary,
        severity=body.severity,
        status=IssueStatus.OPEN,
        source=IssueSource.REVIEWER,
        owner_id=owner.id,
        opened_by_id=viewer.id,
        opened_at=now(),
        due_at=body.due_at,
        actions=[],
        activity=[],
    )
    log(issue, viewer, f"Raised this issue and assigned it to {owner.name}.")
    db.add(issue)
    db.add(
        MaterialEvent(
            workspace_id=material.workspace_id,
            material_id=material.id,
            at=now(),
            actor_id=viewer.id,
            actor_name=viewer.name,
            type=EventType.ISSUE,
            text=f'Raised the issue "{title}" and assigned it to {owner.name}.',
        )
    )
    await db.flush()
    issue_id = issue.id
    await db.commit()
    return IssueOut.of(await load_issue(db, viewer, issue_id))


def check_can_manage(viewer: User, issue: Issue) -> None:
    """PRD F12: the issue owner or a Manager runs actions. Owners who only view cannot (section 4)."""
    owner = viewer.id == issue.owner_id and can_submit(viewer)
    if not owner and not viewer.role.at_least(Role.MANAGER):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the issue owner or a Manager can do this")


async def saved(db: AsyncSession, viewer: User, issue: Issue) -> IssueDetail:
    issue_id = issue.id
    await db.commit()
    return IssueDetail.of(await load_issue(db, viewer, issue_id))


class StatusChange(APIModel):
    status: IssueStatus
    note: str = Field(default="", max_length=5000)  # required to resolve: how it was fixed, for auditors


@router.patch("/{issue_id}", response_model_exclude_none=True)
async def change_status(issue_id: uuid.UUID, body: StatusChange, viewer: SignedIn, db: Db) -> IssueDetail:
    issue = await load_issue(db, viewer, issue_id)
    check_can_manage(viewer, issue)
    if body.status is issue.status:
        raise conflict(f"The issue is already {STATUS_LABEL[body.status].lower()}")
    note = body.note.strip()
    if body.status is IssueStatus.RESOLVED and not note:
        raise bad_request("Write how the problem was fixed")
    issue.status = body.status
    issue.resolved_at = now() if body.status is IssueStatus.RESOLVED else None
    log(issue, viewer, f"Changed the status to {STATUS_LABEL[body.status]}.")
    if note:
        log(issue, viewer, note, comment=True)
    return await saved(db, viewer, issue)


@router.post("/{issue_id}/actions/{action_id}/done", response_model_exclude_none=True)
async def complete_action(issue_id: uuid.UUID, action_id: uuid.UUID, viewer: SignedIn, db: Db) -> IssueDetail:
    """Records that a person ran the step. TODO (F11): run it through the connector, for example pause the ad."""
    issue = await load_issue(db, viewer, issue_id)
    check_can_manage(viewer, issue)
    action = next((a for a in issue.actions if a.id == action_id), None)
    if action is None:
        raise not_found("Action not found")
    if issue.status is IssueStatus.RESOLVED:
        raise conflict("The issue is resolved")
    if action.done_at is not None:
        raise conflict("This step is already done")
    action.done_at, action.done_by_id, action.done_by_name = now(), viewer.id, viewer.name
    log(issue, viewer, f"Marked done: {action.label}.")
    return await saved(db, viewer, issue)


class NoticeInput(APIModel):
    subject: str = Field(min_length=1, max_length=300)
    body: str = Field(min_length=1, max_length=20_000)


@router.post("/{issue_id}/notice", response_model_exclude_none=True)
async def send_notice(issue_id: uuid.UUID, body: NoticeInput, viewer: SignedIn, db: Db) -> IssueDetail:
    """A person edits and sends the AI draft (PRD F12). TODO (F13): send the email."""
    issue = await load_issue(db, viewer, issue_id)
    check_can_manage(viewer, issue)
    if not issue.notice:
        raise conflict("This issue has no notice")
    if issue.notice.get("sentAt"):
        raise conflict("The notice was sent already")
    if issue.status is IssueStatus.RESOLVED:
        raise conflict("The issue is resolved")
    at = now()
    # A new dict, so SQLAlchemy sees the change to the JSONB column.
    issue.notice = {
        **issue.notice,
        "subject": body.subject.strip(),
        "body": body.body.strip(),
        "sentAt": at.isoformat(),
        "sentBy": viewer.name,
    }
    for a in issue.actions:
        if a.kind is ActionKind.NOTICE and a.done_at is None:
            a.done_at, a.done_by_id, a.done_by_name = at, viewer.id, viewer.name
    log(issue, viewer, f"Sent the correction notice to {issue.notice['to']}.")
    return await saved(db, viewer, issue)


class IssueComment(APIModel):
    text: str = Field(min_length=1, max_length=5000)


@router.post("/{issue_id}/comments", status_code=status.HTTP_201_CREATED, response_model_exclude_none=True)
async def comment(issue_id: uuid.UUID, body: IssueComment, viewer: Submitter, db: Db) -> IssueDetail:
    issue = await load_issue(db, viewer, issue_id)
    text = body.text.strip()
    if not text:
        raise bad_request("Write a comment")
    log(issue, viewer, text, comment=True)
    return await saved(db, viewer, issue)
