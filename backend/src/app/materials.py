"""Materials, versions, and review decisions (PRD section 6, F2, F3, F5, F6, F15).

Every signed-in user reads materials; affiliates only those of their own company (R4).
Submitters and affiliates submit. Reviewers decide only for the required groups they are in (R2),
never on a version they submitted (R1). Issues are in issues.py; this module's router includes them.
"""

import uuid
from datetime import date, datetime, timedelta
from typing import Annotated, Any, Literal

from fastapi import APIRouter, BackgroundTasks, HTTPException, Query, UploadFile, status
from fastapi.responses import FileResponse
from pydantic import Field, field_validator, model_validator
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app import ai_review, flags, issues, material_list, prereview
from app.api import APIModel, SignedIn, bad_request, conflict, not_found
from app.audit import OtherActor, actor_name, history, record
from app.business_days import days_left, review_deadline
from app.channels import check_fields
from app.config import settings
from app.flags import FlagOut
from app.listing import Facets, total_of
from app.material_access import (
    Db,
    Reviewer,
    Submitter,
    check_visible,
    group_names_of,
    now,
    visible,
)
from app.material_list import MaterialFilters
from app.models import ReviewerGroup, Role, User, UserStatus, Workspace
from app.models.audit import AuditEvent
from app.models.materials import (
    Channel,
    Comment,
    Decision,
    Finding,
    FindingSource,
    FindingStatus,
    GroupReview,
    GroupState,
    Issue,
    IssueSource,
    IssueStatus,
    LiveItem,
    LiveStatus,
    Material,
    MaterialFile,
    MaterialStatus,
    MaterialVersion,
    Outcome,
    Product,
    ReviewPath,
    Severity,
)
from app.notify import NotificationType, notify_comment, notify_decision, notify_groups
from app.routing_eval import route
from app.workspace import US_STATES

items = APIRouter(prefix="/api/materials", tags=["materials"])

# Material statuses where the current version waits for its reviewer groups
WAITING = (MaterialStatus.SUBMITTED, MaterialStatus.IN_REVIEW)
APPROVED = (MaterialStatus.APPROVED, MaterialStatus.LIVE)


# ---- Reading ----


class GroupSummary(APIModel):
    name: str
    state: GroupState


class MaterialOut(APIModel):
    """A row of the repository list (PRD F2)."""

    id: uuid.UUID
    title: str
    channel: Channel
    product: Product
    status: MaterialStatus
    live_status: LiveStatus
    groups: list[GroupSummary]
    owner: str
    affiliate: str | None = None
    source: str | None = None
    approval_id: str | None = None
    expires_at: date | None = None
    submitted_at: datetime | None = None  # only while the current version waits for review
    updated_at: datetime
    open_flags: int | None = None  # flags for re-review that no one resolved yet (PRD F7); none: left out

    @classmethod
    def of(cls, m: Material, open_flags: int = 0) -> MaterialOut:
        return cls(
            id=m.id,
            title=m.title,
            channel=m.channel,
            product=m.product,
            status=m.status,
            live_status=m.live_status,
            groups=[GroupSummary(name=r.group.name, state=r.state) for r in m.reviews],
            owner=m.owner.name,
            affiliate=m.affiliate.name if m.affiliate else None,
            source=m.source,
            approval_id=m.approval_id,
            expires_at=m.expires_at,
            submitted_at=m.submitted_at if m.status in WAITING else None,
            updated_at=m.updated_at,
            open_flags=open_flags or None,
        )


LIST_LOAD = (
    selectinload(Material.owner),
    selectinload(Material.affiliate),
    selectinload(Material.reviews).selectinload(GroupReview.group),
)


async def expire_approvals(db: AsyncSession, viewer: User) -> None:
    """PRD F15: an approval ends on its expiry date, and the material becomes Expired.
    Runs before each read, so no background job is needed. A rule, disclosure, or rate that the approval
    depends on does not end it early: app.flags flags the material for re-review instead (see there)."""
    today = now().date()
    due = list(
        await db.scalars(
            select(Material).where(
                Material.workspace_id == viewer.workspace_id,
                Material.status.in_(APPROVED),
                Material.expires_at <= today,
            )
        )
    )
    for m in due:
        if m.status is MaterialStatus.LIVE:
            m.live_status = LiveStatus.EXPIRED_APPROVAL  # still live with no valid approval (PRD F10)
        m.status = MaterialStatus.EXPIRED
        m.updated_at = now()
        record(db, OtherActor(m.workspace_id, "ClearPath"), "material", m.id, "approval_expired", {
            "approvalId": m.approval_id, "expiresAt": m.expires_at, "text": f"Approval {m.approval_id} expired."
        })
    if due:
        await db.commit()


class MaterialPage(APIModel):
    """One page of the list, the number of materials that match, and the counts for the filter menus."""

    items: list[MaterialOut]
    total: int
    facets: Facets | None = None


@items.get("", response_model_exclude_none=True)
async def list_materials(viewer: SignedIn, db: Db, p: Annotated[MaterialFilters, Query()]) -> MaterialPage:
    """Filters, search, sort and paging are in app.material_list; the parameters are in app.listing."""
    await expire_approvals(db, viewer)
    query = material_list.page_query(viewer, p)
    rows = list(await db.scalars(query.options(*LIST_LOAD)))
    unpaged = p.offset == 0 and (p.limit is None or len(rows) < p.limit)
    counts = await flags.open_flag_counts(db, viewer)  # open F7 flags per material
    return MaterialPage(
        items=[MaterialOut.of(m, counts.get(m.id, 0)) for m in rows],
        total=len(rows) if unpaged else await total_of(db, query.limit(None).offset(None)),
        facets=await material_list.facets_of(db, viewer, p) if p.facets else None,
    )


class FindingEdit(APIModel):
    """The exact fix (Finding.edit): replace puts `text` in place of the flagged text, append adds it at the end."""

    op: Literal["replace", "append"]
    text: str
    by: Literal["ai"] | None = None  # the AI review wrote this fix for a code finding


class FindingOut(APIModel):
    id: uuid.UUID
    source: FindingSource
    severity: Severity
    rule_id: str
    status: FindingStatus
    text: str
    explanation: str
    suggestion: str | None = None
    edit: FindingEdit | None = None


class Deadline(APIModel):
    """When a waiting group's review is due (PRD F6 "Deadlines"): the submit time plus the group's target
    business days. Days left are calendar days to the due day (UTC): 0 is today, negative is late."""

    at: datetime
    target_days: int
    days_left: int
    overdue: bool

    @classmethod
    def of(cls, submitted_at: datetime, target_days: int, at: datetime) -> Deadline:
        due = review_deadline(submitted_at, target_days)
        return cls(at=due, target_days=target_days, days_left=days_left(due, at), overdue=due < at)


def group_deadline(m: Material, r: GroupReview, at: datetime) -> Deadline | None:
    """The deadline of one required group, while it still waits on the current version."""
    if r.state is not GroupState.WAITING or m.status not in WAITING or m.submitted_at is None:
        return None
    return Deadline.of(m.submitted_at, r.group.target_business_days, at)


class DetailGroup(APIModel):
    name: str
    state: GroupState
    members: list[str] | None = None  # who can still approve, for a waiting group
    deadline: Deadline | None = None  # for a waiting group, while the material waits for review
    by: str | None = None
    at: datetime | None = None
    reason: str
    escalated_by: str | None = None


class CommentAnchor(APIModel):
    """The selected text that a comment is about (PRD F5), in one field of the version."""

    field: str = Field(min_length=1, max_length=100)
    text: str = Field(min_length=1, max_length=2000)


class CommentOut(APIModel):
    id: uuid.UUID
    author: str
    role: str
    at: datetime
    body: str
    decision: Decision | None = None
    anchor: CommentAnchor | None = None


class FieldText(APIModel):
    label: str
    text: str


class VersionOut(APIModel):
    number: int
    submitted_at: datetime
    submitted_by: str
    path: ReviewPath
    outcome: Outcome | None = None
    outcome_by: str | None = None
    current: bool | None = None
    fields: list[FieldText] | None = None  # older versions only; the current one is in MaterialDetail.fields


HistoryType = Literal["submitted", "prereview", "routed", "decision", "comment", "live", "issue", "flag"]

# The audit actions on a material (entity "material"), and the kind of line the History tab shows for each.
HISTORY_TYPE: dict[str, HistoryType] = {
    "submitted": "submitted",
    "prereviewed": "prereview",
    "ai_reviewed": "prereview",  # app.ai_review (PRD F4 layer 2)
    "ai_review_unavailable": "prereview",  # no key, or the AI call failed: code checks only
    "ai_review_skipped": "prereview",  # no AI rule applies to the material, so the model was not called
    "routed": "routed",
    "approved": "decision",
    "approved_with_conditions": "decision",
    "changes_requested": "decision",
    "rejected": "decision",
    "escalated": "decision",
    "approval_retracted": "decision",
    "approval_expired": "decision",
    "decided": "decision",  # a decision copied from the old history table, when its text named no outcome
    "commented": "comment",
    "live_checked": "live",
    "issue_raised": "issue",
    "flagged": "flag",  # a library change flagged the approved version for re-review (PRD F7, app.flags)
    "flag_resolved": "flag",
}


class EventOut(APIModel):
    """One line of the History tab: an audit entry of the material (PRD F2)."""

    at: datetime
    actor: str
    type: HistoryType
    text: str

    @classmethod
    def of(cls, e: AuditEvent) -> EventOut:
        data = e.data or {}
        text = data.get("text") or routed_text(data)
        return cls(at=e.created_at, actor=actor_name(e), type=HISTORY_TYPE.get(e.action, "decision"), text=text)


def routed_text(data: dict[str, Any]) -> str:
    """For a "routed" entry written before entries had their text: the groups and their rules."""
    parts = []
    for g in data.get("groups", []):
        rules = g.get("rules") or []
        names = ", ".join(f'"{n}"' for n in rules)
        parts.append(f"{g['name']} ({'rules' if len(rules) > 1 else 'rule'} {names})" if rules else g["name"])
    return f"Required {', '.join(parts)}." if parts else ""


class LiveItemOut(APIModel):
    id: uuid.UUID
    connector: str
    external_id: str
    match: str
    status: LiveStatus
    found_at: datetime
    checked_at: datetime
    paused: bool
    fields: list[FieldText]


class ActionDone(APIModel):
    label: str
    done: bool


class MaterialIssueOut(APIModel):
    id: uuid.UUID
    title: str
    severity: Severity
    status: IssueStatus
    owner: str
    due_at: datetime
    opened_at: datetime
    source: IssueSource
    actions: list[ActionDone]


class FileOut(APIModel):
    id: uuid.UUID
    name: str
    content_type: str
    size: int


class MaterialDetail(APIModel):
    """One material's current version with its review (PRD F2, F4, F5)."""

    id: uuid.UUID
    version: int
    version_count: int
    submitted_at: datetime
    submitted_by: str
    path: ReviewPath
    details: dict[str, Any]
    fields: list[dict[str, Any]]
    findings: list[FindingOut]
    checklist: list[dict[str, Any]]
    groups: list[DetailGroup]
    conditions: str | None = None
    comments: list[CommentOut]
    versions: list[VersionOut]
    history: list[EventOut]
    live: list[LiveItemOut]
    issues: list[MaterialIssueOut]
    files: list[FileOut]
    flags: list[FlagOut]  # open flags for re-review (PRD F7)


def plain(fields: list[dict[str, Any]]) -> list[FieldText]:
    """Fields as plain text, without the finding marks."""
    return [
        FieldText(label=f["label"], text="".join(s if isinstance(s, str) else s["text"] for s in f["segments"]))
        for f in fields
    ]


def name_of(user: User | None) -> str:
    return user.name if user else "Connector"  # TODO: the connector name, when connectors submit versions


async def load_material(db: AsyncSession, viewer: User, material_id: uuid.UUID) -> Material:
    material = await db.scalar(
        select(Material)
        .where(Material.id == material_id, *visible(viewer))
        .options(
            *LIST_LOAD,
            selectinload(Material.reviews).selectinload(GroupReview.group).selectinload(ReviewerGroup.members),
            selectinload(Material.reviews).selectinload(GroupReview.decided_by),
            selectinload(Material.reviews).selectinload(GroupReview.escalated_by),
            selectinload(Material.versions).selectinload(MaterialVersion.submitted_by),
        )
        .execution_options(populate_existing=True)  # fresh rows after a change
    )
    if material is None:
        raise not_found("Material not found")
    return material


def group_out(m: Material, r: GroupReview, at: datetime) -> DetailGroup:
    members = None
    if r.state is GroupState.WAITING:
        members = sorted(
            u.name for u in r.group.members if u.status is UserStatus.ACTIVE and u.role.at_least(Role.REVIEWER)
        )
    return DetailGroup(
        name=r.group.name,
        state=r.state,
        members=members,
        deadline=group_deadline(m, r, at),
        by=r.decided_by.name if r.decided_by else None,
        at=r.decided_at,
        reason=r.reason,
        escalated_by=r.escalated_by.name if r.escalated_by else None,
    )


async def detail_of(db: AsyncSession, m: Material) -> MaterialDetail | None:
    """None when the material has no version yet (for example a seeded draft)."""
    if not m.versions:
        return None
    current = m.versions[-1]
    findings = await db.scalars(select(Finding).where(Finding.material_id == m.id).order_by(Finding.position))
    comments = await db.scalars(
        select(Comment).where(Comment.material_id == m.id).options(selectinload(Comment.author)).order_by(Comment.at, Comment.id)
    )
    # The caller loaded m with visible(viewer), so whoever sees the material sees its history (PRD F2, R4).
    events = await history(db, m.workspace_id, "material", m.id)
    live = await db.scalars(select(LiveItem).where(LiveItem.material_id == m.id).order_by(LiveItem.found_at))
    material_issues = await db.scalars(
        select(Issue)
        .where(Issue.material_id == m.id)
        .options(selectinload(Issue.owner), selectinload(Issue.actions))
        .order_by(Issue.opened_at)
    )
    files = await db.scalars(select(MaterialFile).where(MaterialFile.version_id == current.id).order_by(MaterialFile.created_at))
    conditions = [r.conditions for r in m.reviews if r.state is GroupState.APPROVED and r.conditions]

    return MaterialDetail(
        id=m.id,
        version=current.number,
        version_count=len(m.versions),
        submitted_at=current.submitted_at,
        submitted_by=name_of(current.submitted_by),
        path=current.path,
        details=current.details,
        fields=current.fields,
        findings=[
            FindingOut(
                id=f.id,
                source=f.source,
                severity=f.severity,
                rule_id=f.rule_id,
                status=f.status,
                text=f.flagged_text,
                explanation=f.explanation,
                suggestion=f.suggestion,
                edit=FindingEdit(**f.edit) if f.edit else None,
            )
            for f in findings
        ],
        checklist=current.checklist,
        groups=[group_out(m, r, now()) for r in m.reviews],
        conditions="\n".join(conditions) or None,
        comments=[
            CommentOut(
                id=c.id,
                author=c.author.name,
                role=c.role,
                at=c.at,
                body=c.body,
                decision=c.decision,
                anchor=CommentAnchor(field=c.anchor_field or "", text=c.anchor_text) if c.anchor_text else None,
            )
            for c in comments
        ],
        versions=[
            VersionOut(
                number=v.number,
                submitted_at=v.submitted_at,
                submitted_by=name_of(v.submitted_by),
                path=v.path,
                outcome=v.outcome,
                outcome_by=v.outcome_by,
                current=True if v is current else None,
                fields=None if v is current else plain(v.fields),
            )
            for v in m.versions
        ],
        history=[EventOut.of(e) for e in events],
        live=[
            LiveItemOut(
                id=li.id,
                connector=li.connector,
                external_id=li.external_id,
                match=li.match,
                status=li.status,
                found_at=li.found_at,
                checked_at=li.checked_at,
                paused=li.paused,
                fields=[FieldText(**f) for f in li.fields],
            )
            for li in live
        ],
        issues=[
            MaterialIssueOut(
                id=i.id,
                title=i.title,
                severity=i.severity,
                status=i.status,
                owner=i.owner.name,
                due_at=i.due_at,
                opened_at=i.opened_at,
                source=i.source,
                actions=[ActionDone(label=a.label, done=a.done_at is not None) for a in i.actions],
            )
            for i in material_issues
        ],
        files=[FileOut(id=f.id, name=f.name, content_type=f.content_type, size=f.size) for f in files],
        flags=await flags.open_flags(db, m.id),
    )


async def saved_detail(db: AsyncSession, viewer: User, material_id: uuid.UUID) -> MaterialDetail | None:
    await db.commit()
    return await detail_of(db, await load_material(db, viewer, material_id))


@items.get("/{material_id}", response_model_exclude_none=True)
async def get_material(material_id: uuid.UUID, viewer: SignedIn, db: Db) -> MaterialDetail | None:
    """The current version with its review, or null when the material has no version yet."""
    await expire_approvals(db, viewer)
    return await detail_of(db, await load_material(db, viewer, material_id))


# ---- Submitting (PRD F3) ----


async def workspace_of(db: AsyncSession, viewer: User) -> Workspace:
    """Read it here, not through viewer.workspace: reloading the material can refresh the viewer row,
    and an async session cannot load a relationship by itself."""
    return await db.get_one(Workspace, viewer.workspace_id)


class FieldInput(APIModel):
    label: str = Field(min_length=1, max_length=100)
    kind: Literal["image"] | None = None
    text: str = Field(max_length=20_000)


class Submission(APIModel):
    """A new material, or a new version of one. A new version keeps the title and channel."""

    title: str = Field(default="", max_length=300)
    channel: Channel
    product: Product
    fields: list[FieldInput] = Field(min_length=1, max_length=30)
    file_ids: list[uuid.UUID] = Field(default=[], max_length=30)
    nationwide: bool = False
    states: list[str] = Field(default=[], max_length=51)
    targeting: str = Field(default="", max_length=2000)
    launch_date: date | None = None
    end_date: date | None = None
    destination_url: str = Field(default="", max_length=2000)
    # No `groups` field: the server alone decides the required groups (PRD R2, F6; app/routing_eval.py).
    # A body that still sends `groups` has them ignored, like any unknown field.

    @field_validator("states")
    @classmethod
    def known_states(cls, states: list[str]) -> list[str]:
        unknown = sorted(set(states) - set(US_STATES))
        if unknown:
            raise ValueError(f"Unknown states: {', '.join(unknown)}")
        return [s for s in US_STATES if s in states]

    @model_validator(mode="after")
    def check(self) -> Submission:
        # Only the channel's own fields, in platform order (app/channels.py). A new version has the material's channel.
        self.fields = [f for f in check_fields(self.channel, self.fields) if f.text.strip()]
        if not self.fields:
            raise ValueError("Add the content")
        if not self.nationwide and not self.states:
            raise ValueError("Choose the target states, or Nationwide")
        if self.launch_date and self.end_date and self.end_date < self.launch_date:
            raise ValueError("The end date is before the launch date")
        return self


async def add_version(db: AsyncSession, viewer: User, m: Material, body: Submission, number: int) -> MaterialVersion:
    """Adds the version, routes it, runs the code checks, and moves the material to In review (PRD section 6).
    The endpoint schedules the AI review after its commit (`ai_review.schedule`)."""
    licensed = set((await workspace_of(db, viewer)).licensed_states)
    if not body.nationwide and not set(body.states) <= licensed:
        raise bad_request("Target only states where ClearPath is licensed")
    files = list(
        await db.scalars(
            select(MaterialFile).where(
                MaterialFile.id.in_(body.file_ids),
                MaterialFile.workspace_id == viewer.workspace_id,
                MaterialFile.uploaded_by_id == viewer.id,
                MaterialFile.version_id.is_(None),
            )
        )
    )
    if len(files) != len(set(body.file_ids)):
        raise bad_request("Unknown file")
    # PRD F6, R2: the server evaluates the routing rules on its own data. Product and states are the
    # version's content (checked above); the channel and the affiliate are the material's.
    routing = await route(
        db,
        viewer,
        product=body.product,
        channel=m.channel,
        affiliate_id=m.affiliate_id,
        nationwide=body.nationwide,
        states=body.states,
        at=now(),
        changes=None,  # TODO (F6): the no-material-change code checks against the last approved version
    )
    groups = [(g.group, g.reason) for g in routing.groups]

    details: dict[str, Any] = {"targetStates": "Nationwide" if body.nationwide else ", ".join(body.states)}
    for key, value in (
        ("launchDate", body.launch_date and body.launch_date.isoformat()),
        ("endDate", body.end_date and body.end_date.isoformat()),
        ("destinationUrl", body.destination_url.strip()),
        ("targeting", body.targeting.strip()),
        # The platform ID stays: it links the material to the live item (PRD F10).
        ("platformId", m.versions[-1].details.get("platformId") if m.versions else None),
    ):
        if value:
            details[key] = value
    version = MaterialVersion(
        workspace_id=m.workspace_id,
        material_id=m.id,
        number=number,
        submitted_at=now(),
        submitted_by_id=viewer.id,
        path=routing.result.path,
        details=details,
        fields=[
            {"label": f.label, "segments": [f.text.strip()], **({"kind": f.kind} if f.kind else {})} for f in body.fields
        ],
        checklist=[],  # pre-review fills it: code checks now, the AI rules after the AI review (PRD F4)
    )
    db.add(version)
    await db.flush()
    for f in files:
        f.version_id = version.id

    # The new version needs new decisions. The old ones stay in the versions, comments, and history.
    m.reviews.clear()
    await db.flush()
    m.reviews.extend(
        GroupReview(workspace_id=m.workspace_id, group_id=g.id, position=i, reason=reason)
        for i, (g, reason) in enumerate(groups)
    )
    m.product = body.product
    # The version goes to its reviewer groups at once. The AI review runs in the background and only adds
    # suggestions (PRD F4), so reviewers can start with the code findings; a person can always review without AI.
    m.status = MaterialStatus.IN_REVIEW
    m.submitted_at = version.submitted_at
    m.updated_at = version.submitted_at
    record(db, viewer, "material", m.id, "submitted", {"version": number, "text": f"Submitted version {number} by manual upload."})
    await flags.resolve_for_new_version(db, viewer, m, number)  # the flagged approval is no longer current
    routed = {"version": number, **routing.audit(), "text": routing.history_text()}
    record(db, OtherActor(m.workspace_id, "Routing"), "material", m.id, "routed", routed)  # PRD F6
    await prereview.run(db, m, version)  # code checks; marks old findings outdated (PRD F4)
    await notify_groups(db, viewer, NotificationType.ASSIGNMENT, m, [g for g, _ in groups])  # PRD F13
    return version


@items.post("", status_code=status.HTTP_201_CREATED, response_model_exclude_none=True)
async def submit_material(body: Submission, viewer: Submitter, db: Db, background: BackgroundTasks) -> MaterialDetail:
    """A new material with its first version. The owner is the person who uploads it (PRD section 4);
    an affiliate's material belongs to their company."""
    if not body.title.strip():
        raise bad_request("Add a title")
    m = Material(
        workspace_id=viewer.workspace_id,
        title=body.title.strip(),
        channel=body.channel,
        product=body.product,
        status=MaterialStatus.SUBMITTED,
        owner_id=viewer.id,
        affiliate_id=viewer.affiliate_id if viewer.role is Role.AFFILIATE else None,
        reviews=[],
        versions=[],
    )
    db.add(m)
    await db.flush()
    version = await add_version(db, viewer, m, body, 1)
    detail = await saved_detail(db, viewer, m.id)
    ai_review.schedule(background, version)  # after the commit, so the upload never waits for the AI
    return detail  # type: ignore[return-value]


@items.post("/{material_id}/versions", status_code=status.HTTP_201_CREATED, response_model_exclude_none=True)
async def submit_version(material_id: uuid.UUID, body: Submission, viewer: Submitter, db: Db, background: BackgroundTasks) -> MaterialDetail:
    """Resubmit or renew (PRD F3, section 6). Any status except Retired. Title and channel stay."""
    m = await load_material(db, viewer, material_id)
    if m.status is MaterialStatus.RETIRED:
        raise conflict("A retired material cannot get a new version")
    if body.channel is not m.channel:
        raise bad_request("A new version keeps the channel")
    version = await add_version(db, viewer, m, body, (m.versions[-1].number if m.versions else 0) + 1)
    detail = await saved_detail(db, viewer, m.id)
    ai_review.schedule(background, version)
    return detail  # type: ignore[return-value]


# ---- Decisions (PRD F5, F6) ----


class DecisionInput(APIModel):
    decision: Decision
    text: str = Field(default="", max_length=5000)
    group: str | None = Field(default=None, max_length=100)  # escalate: the group to add
    override: str | None = Field(default=None, max_length=2000)  # approve with an open High finding


def fmt_day(d: date) -> str:
    return f"{d:%b} {d.day}, {d.year}"


async def next_approval_id(db: AsyncSession, viewer: User, version: int) -> str:
    """For example CP-2026-0142-v3 (PRD section 5): a number for each approval in the year, and the version."""
    year = now().year
    taken = await db.scalars(
        select(Material.approval_id).where(
            Material.workspace_id == viewer.workspace_id, Material.approval_id.like(f"CP-{year}-%")
        )
    )
    numbers = [int(a.split("-")[2]) for a in taken if a and a.split("-")[2].isdigit()]
    return f"CP-{year}-{max(numbers, default=0) + 1:04d}-v{version}"


@items.post("/{material_id}/decisions", response_model_exclude_none=True)
async def decide(material_id: uuid.UUID, body: DecisionInput, viewer: Reviewer, db: Db) -> MaterialDetail:
    m = await load_material(db, viewer, material_id)
    if not m.versions:
        raise conflict("This material has no version to review")
    version = m.versions[-1]
    text = body.text.strip()
    if body.decision is not Decision.APPROVE and not text:
        raise bad_request("Write a reason")
    groups_of_viewer = await group_names_of(db, viewer)
    d = body.decision
    on = f"on version {version.number}"
    history = ""
    comment_role = ", ".join(groups_of_viewer.values())
    comment_body = text
    action = ""  # the audit action, below
    data: dict[str, Any] = {"version": version.number, "decision": d}

    if d is Decision.RETRACT:
        # PRD F5: only your own approval, at any time. Its groups wait again (section 6).
        mine = [r for r in m.reviews if r.state is GroupState.APPROVED and r.decided_by_id == viewer.id]
        if not mine:
            raise bad_request("You have no approval to retract")
        for r in mine:
            r.state, r.decided_by_id, r.decided_at, r.conditions = GroupState.WAITING, None, None, None
        if m.status in APPROVED:
            m.status = MaterialStatus.IN_REVIEW
            m.approval_id = None
            m.expires_at = None
            m.submitted_at = version.submitted_at
            if m.live_status is not LiveStatus.NOT_LIVE:
                m.live_status = LiveStatus.UNAPPROVED  # live content with no approval (PRD F10)
        version.outcome = version.outcome_by = None
        history = f"Retracted own approval {on}: {text}"
        action, data["groups"] = "approval_retracted", [r.group.name for r in mine]

    elif d is Decision.ESCALATE:
        # PRD F6: add a required group, with a reason. The item stays In review.
        if m.status is not MaterialStatus.IN_REVIEW:
            raise conflict("This material is not in review")
        if not body.group:
            raise bad_request("Choose a group")
        group = await db.scalar(
            select(ReviewerGroup).where(
                ReviewerGroup.workspace_id == viewer.workspace_id,
                func.lower(ReviewerGroup.name) == body.group.strip().lower(),
            )
        )
        if group is None:
            raise bad_request("Unknown reviewer group")
        if any(r.group_id == group.id for r in m.reviews):
            raise conflict(f"{group.name} is already required")
        m.reviews.append(
            GroupReview(
                workspace_id=m.workspace_id,
                group_id=group.id,
                position=len(m.reviews),
                reason=text,
                escalated_by_id=viewer.id,
            )
        )
        history = f"Escalated: added {group.name} as a required group. {text}"
        action, data["groups"] = "escalated", [group.name]
        comment_body = f"{group.name}: {text}"
        await notify_groups(db, viewer, NotificationType.ESCALATION, m, [group])  # PRD F13

    else:
        if m.status is not MaterialStatus.IN_REVIEW:
            raise conflict("This material is not in review")
        approving = d in (Decision.APPROVE, Decision.APPROVE_CONDITIONS)
        if approving and version.submitted_by_id == viewer.id:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "You cannot approve a version that you submitted")  # R1
        # R2 and F5: the decision counts for every waiting required group that the viewer is in.
        mine = [r for r in m.reviews if r.state is GroupState.WAITING and r.group_id in groups_of_viewer]
        if not mine:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "You are not in a required group that still waits")
        names = ", ".join(r.group.name for r in mine)
        comment_role = names
        override = (body.override or "").strip()
        if approving:
            high = await db.scalar(
                select(func.count()).where(
                    Finding.version_id == version.id,
                    Finding.status == FindingStatus.OPEN,
                    Finding.severity == Severity.HIGH,
                )
            )
            # PRD F6: an open High finding blocks approval, unless the Reviewer writes an override reason.
            if high and not override:
                raise bad_request("An open High finding blocks approval. Write an override reason.")
        state = {
            Decision.APPROVE: GroupState.APPROVED,
            Decision.APPROVE_CONDITIONS: GroupState.APPROVED,
            Decision.REQUEST_CHANGES: GroupState.CHANGES,
            Decision.REJECT: GroupState.REJECTED,
        }[d]
        for r in mine:
            r.state, r.decided_by_id, r.decided_at = state, viewer.id, now()
            r.conditions = text if d is Decision.APPROVE_CONDITIONS else None
        action, data["groups"] = {
            Decision.APPROVE: "approved",
            Decision.APPROVE_CONDITIONS: "approved_with_conditions",
            Decision.REQUEST_CHANGES: "changes_requested",
            Decision.REJECT: "rejected",
        }[d], [r.group.name for r in mine]
        if d is Decision.APPROVE_CONDITIONS:
            data["conditions"] = text
        history = {
            Decision.APPROVE: f"Approved for {names} {on}.",
            Decision.APPROVE_CONDITIONS: f"Approved with conditions for {names} {on}: {text}",
            Decision.REQUEST_CHANGES: f"Requested changes for {names} {on}: {text}",
            Decision.REJECT: f"Rejected for {names} {on}: {text}",
        }[d]
        outcome_by = f"{viewer.name} ({names})"
        if d is Decision.REQUEST_CHANGES:
            m.status, version.outcome, version.outcome_by = MaterialStatus.CHANGES_REQUESTED, Outcome.CHANGES_REQUESTED, outcome_by
        elif d is Decision.REJECT:
            m.status, version.outcome, version.outcome_by = MaterialStatus.REJECTED, Outcome.REJECTED, outcome_by
        elif all(r.state is GroupState.APPROVED for r in m.reviews):
            # PRD F5, F6, F15: one member of each required group approved. The approval gets an ID and an expiry.
            m.status = MaterialStatus.APPROVED
            m.approval_id = await next_approval_id(db, viewer, version.number)
            m.expires_at = now().date() + timedelta(days=(await workspace_of(db, viewer)).approval_days)
            version.outcome, version.outcome_by = Outcome.APPROVED, outcome_by
            history += f" Approval ID {m.approval_id}, expires {fmt_day(m.expires_at)}."
            data |= {"approvalId": m.approval_id, "expiresAt": m.expires_at}
        if override:
            history += f" Override reason: {override}"  # PRD F6: the audit log records the override reason
            data["override"] = override
            comment_body = "\n".join(x for x in (text, f"Override: {override}") if x)

    m.updated_at = now()
    decision = Comment(
        workspace_id=m.workspace_id,
        material_id=m.id,
        version_number=version.number,
        author_id=viewer.id,
        role=comment_role,
        at=now(),
        body=comment_body,
        decision=d,
    )
    db.add(decision)
    await db.flush()
    record(db, viewer, "material", m.id, action, data | {"commentId": decision.id, "text": history})
    await notify_decision(db, viewer, m, version, d)  # PRD F13
    return await saved_detail(db, viewer, m.id)  # type: ignore[return-value]


# ---- Comments ----


class CommentInput(APIModel):
    body: str = Field(min_length=1, max_length=5000)
    anchor: CommentAnchor | None = None  # a comment on selected text of the current version


@items.post("/{material_id}/comments", status_code=status.HTTP_201_CREATED, response_model_exclude_none=True)
async def add_comment(material_id: uuid.UUID, body: CommentInput, viewer: Submitter, db: Db) -> MaterialDetail:
    """Reviewers comment, and Submitters and affiliates reply (PRD section 4). Viewers only read."""
    m = await load_material(db, viewer, material_id)
    text = body.body.strip()
    if not text:
        raise bad_request("Write a comment")
    number = m.versions[-1].number if m.versions else None
    anchor = body.anchor
    if anchor:
        # The selected text must be in that field of the current version.
        fields = {f.label: f.text for f in plain(m.versions[-1].fields)} if m.versions else {}
        if anchor.text not in fields.get(anchor.field, ""):
            raise bad_request("The selected text is not in the current version")
    groups = await group_names_of(db, viewer)
    comment = Comment(
        workspace_id=m.workspace_id,
        material_id=m.id,
        version_number=number,
        author_id=viewer.id,
        role=", ".join(groups.values()) or (viewer.title or ""),
        at=now(),
        body=text,
        anchor_field=anchor.field if anchor else None,
        anchor_text=anchor.text if anchor else None,
    )
    db.add(comment)
    await db.flush()
    record(db, viewer, "material", m.id, "commented", {
        "version": number, "commentId": comment.id, "text": f"Commented on version {number}." if number else "Commented."
    })
    m.updated_at = now()
    await notify_comment(db, viewer, m)  # PRD F13
    return await saved_detail(db, viewer, m.id)  # type: ignore[return-value]


# ---- Files (PRD F3) ----


@items.post("/files", status_code=status.HTTP_201_CREATED)
async def upload_file(file: UploadFile, viewer: Submitter, db: Db) -> FileOut:
    """One file for a submission: content, the ad image, or a claim proof. A submission then refers to its id.
    The file is stored on disk under settings.upload_dir. TODO: object storage, and a virus scan."""
    data = await file.read(settings.upload_max_bytes + 1)
    if len(data) > settings.upload_max_bytes:
        raise HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, "The file is too large")
    if not data:
        raise bad_request("The file is empty")
    row = MaterialFile(
        workspace_id=viewer.workspace_id,
        name=(file.filename or "file")[:255],
        content_type=(file.content_type or "application/octet-stream")[:100],
        size=len(data),
        uploaded_by_id=viewer.id,
    )
    db.add(row)
    await db.flush()
    settings.upload_dir.mkdir(parents=True, exist_ok=True)
    (settings.upload_dir / str(row.id)).write_bytes(data)
    await db.commit()
    return FileOut(id=row.id, name=row.name, content_type=row.content_type, size=row.size)


@items.get("/files/{file_id}")
async def download_file(file_id: uuid.UUID, viewer: SignedIn, db: Db) -> FileResponse:
    """Only for people who may see the material. A file that no submission uses yet only for its uploader."""
    row = await db.scalar(select(MaterialFile).where(MaterialFile.id == file_id, MaterialFile.workspace_id == viewer.workspace_id))
    if row is None:
        raise not_found("File not found")
    if row.version_id is None:
        if row.uploaded_by_id != viewer.id:
            raise not_found("File not found")
    else:
        material_id = await db.scalar(select(MaterialVersion.material_id).where(MaterialVersion.id == row.version_id))
        await check_visible(db, viewer, material_id)  # type: ignore[arg-type]
    # Always a download, never shown inline, so an uploaded HTML or SVG file cannot run script on this site.
    return FileResponse(
        settings.upload_dir / str(row.id),
        media_type=row.content_type,
        filename=row.name,
        headers={"X-Content-Type-Options": "nosniff"},
    )


# One router for the area: materials, and the issues on them.
router = APIRouter()
router.include_router(items)
router.include_router(issues.router)
