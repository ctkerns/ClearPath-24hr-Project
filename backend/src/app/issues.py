"""Issues on materials, and their remediation (PRD F12).

Everyone reads the issues of the materials they may see (affiliates: only their own company's, R4).
An issue with no material (unapproved content found live, F10) is for internal users only.
Any Reviewer or higher opens an issue on any material. The issue owner, or a Manager and higher,
changes its status and runs its actions. Submitters and higher, and affiliates, comment.

What happens to an issue is in the audit log (entity "issue"); its comments are in issue_comments. The activity
list shows both, oldest first. Whoever may see the issue sees its activity (issue_visible), not only the
users who may read the audit log page.
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
from app.audit import actor_name, history, record
from app.material_access import Db, Reviewer, Submitter, can_submit, issue_visible, now, visible
from app.models import Affiliate, Role, User, UserStatus
from app.models.audit import AuditEvent
from app.models.materials import (
    ActionKind,
    Channel,
    Issue,
    IssueComment,
    IssueKind,
    IssueSource,
    IssueStatus,
    Material,
    MaterialVersion,
    Outcome,
    Severity,
)
from app.notify import notify_new_issue
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
    kind: IssueKind | None = None
    material: IssueMaterial | None = None  # none for unapproved content that matches no material (PRD F10)
    channel: Channel | None = None  # the material's, or where monitoring found the content
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
        m = i.material
        company = m.affiliate if m else None
        return cls(
            id=i.id,
            title=i.title,
            severity=i.severity,
            status=i.status,
            source=i.source,
            kind=i.kind,
            material=IssueMaterial(id=m.id, title=m.title, channel=m.channel) if m else None,
            channel=m.channel if m else i.channel,
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


# Issue audit actions that the activity list leaves out: the comment itself is in the list.
NOT_ACTIVITY = {"commented"}


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
    def of(cls, i: Issue, events: list[AuditEvent]) -> IssueDetail:
        activity = [
            ActivityOut(at=e.created_at, actor=actor_name(e), text=(e.data or {}).get("text", ""))
            for e in events
            if e.action not in NOT_ACTIVITY
        ] + [ActivityOut(at=c.at, actor=c.author.name, text=c.body, comment=True) for c in i.comments]
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
            # sorted is stable: at the same time, an entry comes before the comment it goes with
            activity=sorted(activity, key=lambda a: a.at),
        )


ISSUE_LOAD = (
    selectinload(Issue.material).selectinload(Material.affiliate).selectinload(Affiliate.manager),
    selectinload(Issue.owner),
    selectinload(Issue.opened_by),
    selectinload(Issue.actions),
    selectinload(Issue.comments).selectinload(IssueComment.author),
)


async def load_issue(db: AsyncSession, viewer: User, issue_id: uuid.UUID) -> Issue:
    issue = await db.scalar(
        select(Issue)
        .where(Issue.id == issue_id, *issue_visible(viewer))
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
        .where(*issue_visible(viewer))
        .options(*ISSUE_LOAD)
        .order_by(Issue.opened_at.desc())
    )
    return [IssueOut.of(i) for i in rows]


async def detail_of(db: AsyncSession, issue: Issue) -> IssueDetail:
    """The caller loaded the issue with issue_visible(viewer)."""
    return IssueDetail.of(issue, await history(db, issue.workspace_id, "issue", issue.id))


@router.get("/{issue_id}", response_model_exclude_none=True)
async def get_issue(issue_id: uuid.UUID, viewer: SignedIn, db: Db) -> IssueDetail:
    return await detail_of(db, await load_issue(db, viewer, issue_id))


class NewIssue(APIModel):
    material_id: uuid.UUID
    title: str = Field(min_length=1, max_length=300)
    summary: str = Field(min_length=1, max_length=5000)
    severity: Severity
    owner_id: uuid.UUID
    due_at: datetime
    # A live problem (PRD F10), when the reviewer found one
    kind: IssueKind | None = None
    # The problem was already in the approved version, for example when the reviewer disagrees with an approval (F5)
    present_at_approval: bool = False


async def add_comment(db: AsyncSession, issue: Issue, author: User, text: str) -> IssueComment:
    comment = IssueComment(workspace_id=issue.workspace_id, issue_id=issue.id, author_id=author.id, body=text)
    db.add(comment)
    await db.flush()  # for its id
    return comment


@router.post("", status_code=status.HTTP_201_CREATED, response_model_exclude_none=True)
async def raise_issue(body: NewIssue, viewer: Reviewer, db: Db) -> IssueOut:
    """PRD F5, F12: any Reviewer or higher, on any material, at any time.
    Notifies the owner and the Managers, and the affiliate manager for affiliate content (F13)."""
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
    # The approved version that the issue is about (PRD section 2: post-approval violation rate)
    approved = await db.scalar(
        select(MaterialVersion.id)
        .where(MaterialVersion.material_id == material.id, MaterialVersion.outcome == Outcome.APPROVED)
        .order_by(MaterialVersion.number.desc())
        .limit(1)
    )
    if body.present_at_approval and approved is None:
        raise bad_request("This material has no approved version")

    issue = Issue(
        workspace_id=viewer.workspace_id,
        material_id=material.id,
        title=title,
        summary=summary,
        severity=body.severity,
        status=IssueStatus.OPEN,
        source=IssueSource.REVIEWER,
        kind=body.kind,
        approved_version_id=approved,
        present_at_approval=body.present_at_approval,
        owner_id=owner.id,
        opened_by_id=viewer.id,
        opened_at=now(),
        due_at=body.due_at,
        actions=[],
        comments=[],
    )
    db.add(issue)
    await db.flush()
    owner_ref = {"id": owner.id, "name": owner.name}
    record(db, viewer, "issue", issue.id, "raised", {
        "materialId": material.id, "title": title, "severity": body.severity, "owner": owner_ref,
        "dueAt": body.due_at, "text": f"Raised this issue and assigned it to {owner.name}.",
    })
    # The material's History shows it too (PRD F2): one entry there, so the History tab reads one thing.
    record(db, viewer, "material", material.id, "issue_raised", {
        "issueId": issue.id, "title": title, "owner": owner_ref,
        "text": f'Raised the issue "{title}" and assigned it to {owner.name}.',
    })
    await notify_new_issue(db, viewer, issue, material)  # PRD F13
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
    return await detail_of(db, await load_issue(db, viewer, issue_id))


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
    before = issue.status
    issue.status = body.status
    issue.resolved_at = now() if body.status is IssueStatus.RESOLVED else None
    data: dict[str, Any] = {"before": before, "after": body.status, "text": f"Changed the status to {STATUS_LABEL[body.status]}."}
    if note:
        # The note is a comment in the conversation; the entry points to it, so the text is stored once.
        data["commentId"] = (await add_comment(db, issue, viewer, note)).id
    record(db, viewer, "issue", issue.id, "status_changed", data)
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
    record(db, viewer, "issue", issue.id, "action_done", {  # PRD F12: the audit log records who ran it
        "actionId": action.id, "kind": action.kind, "label": action.label, "text": f"Marked done: {action.label}."
    })
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
    record(db, viewer, "issue", issue.id, "notice_sent", {
        "to": issue.notice["to"], "subject": issue.notice["subject"], "text": f"Sent the correction notice to {issue.notice['to']}."
    })
    return await saved(db, viewer, issue)


class IssueCommentInput(APIModel):
    text: str = Field(min_length=1, max_length=5000)


@router.post("/{issue_id}/comments", status_code=status.HTTP_201_CREATED, response_model_exclude_none=True)
async def comment(issue_id: uuid.UUID, body: IssueCommentInput, viewer: Submitter, db: Db) -> IssueDetail:
    issue = await load_issue(db, viewer, issue_id)
    text = body.text.strip()
    if not text:
        raise bad_request("Write a comment")
    c = await add_comment(db, issue, viewer, text)
    record(db, viewer, "issue", issue.id, "commented", {"commentId": c.id})  # the text is in issue_comments
    return await saved(db, viewer, issue)
