"""Materials, versions, and review decisions (PRD section 6, F2, F3, F5, F6, F15).

Every signed-in user reads materials; affiliates only those of their own company (R4).
Submitters and affiliates submit. Reviewers decide only for the required groups they are in (R2),
never on a version they submitted (R1). Issues are in issues.py; this module's router includes them.
"""

import uuid
from datetime import date, datetime, timedelta
from typing import Any, Literal

from fastapi import APIRouter, HTTPException, UploadFile, status
from fastapi.responses import FileResponse
from pydantic import Field, field_validator, model_validator
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app import issues
from app.api import APIModel, SignedIn, bad_request, conflict, not_found
from app.config import settings
from app.material_access import (
    Db,
    Reviewer,
    Submitter,
    check_visible,
    group_names_of,
    now,
    visible,
)
from app.models import ReviewerGroup, Role, User, UserStatus, Workspace
from app.models.materials import (
    Channel,
    Comment,
    Decision,
    EventType,
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
    MaterialEvent,
    MaterialFile,
    MaterialStatus,
    MaterialVersion,
    Outcome,
    Product,
    ReviewPath,
    Severity,
)
from app.notify import NotificationType, notify_comment, notify_decision, notify_groups
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

    @classmethod
    def of(cls, m: Material) -> MaterialOut:
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
        )


LIST_LOAD = (
    selectinload(Material.owner),
    selectinload(Material.affiliate),
    selectinload(Material.reviews).selectinload(GroupReview.group),
)


async def expire_approvals(db: AsyncSession, viewer: User) -> None:
    """PRD F15: an approval ends on its expiry date, and the material becomes Expired.
    Runs before each read, so no background job is needed. TODO (F9): also end an approval early
    when a rule, disclosure, or rate it depends on changes."""
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
        db.add(event(m, None, EventType.DECISION, f"Approval {m.approval_id} expired.", actor_name="ClearPath"))
    if due:
        await db.commit()


@items.get("", response_model_exclude_none=True)
async def list_materials(viewer: SignedIn, db: Db) -> list[MaterialOut]:
    await expire_approvals(db, viewer)
    rows = await db.scalars(
        select(Material).where(*visible(viewer)).options(*LIST_LOAD).order_by(Material.updated_at.desc())
    )
    return [MaterialOut.of(m) for m in rows]


class FindingOut(APIModel):
    id: uuid.UUID
    source: FindingSource
    severity: Severity
    rule_id: str
    status: FindingStatus
    text: str
    explanation: str
    suggestion: str | None = None


class DetailGroup(APIModel):
    name: str
    state: GroupState
    members: list[str] | None = None  # who can still approve, for a waiting group
    by: str | None = None
    at: datetime | None = None
    reason: str
    escalated_by: str | None = None


class CommentOut(APIModel):
    id: uuid.UUID
    author: str
    role: str
    at: datetime
    body: str
    decision: Decision | None = None


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


class EventOut(APIModel):
    at: datetime
    actor: str
    type: EventType
    text: str


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


def group_out(r: GroupReview) -> DetailGroup:
    members = None
    if r.state is GroupState.WAITING:
        members = sorted(
            u.name for u in r.group.members if u.status is UserStatus.ACTIVE and u.role.at_least(Role.REVIEWER)
        )
    return DetailGroup(
        name=r.group.name,
        state=r.state,
        members=members,
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
    history = await db.scalars(
        select(MaterialEvent).where(MaterialEvent.material_id == m.id).order_by(MaterialEvent.at, MaterialEvent.id)
    )
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
            )
            for f in findings
        ],
        checklist=current.checklist,
        groups=[group_out(r) for r in m.reviews],
        conditions="\n".join(conditions) or None,
        comments=[
            CommentOut(id=c.id, author=c.author.name, role=c.role, at=c.at, body=c.body, decision=c.decision)
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
        history=[EventOut(at=e.at, actor=e.actor_name, type=e.type, text=e.text) for e in history],
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
    )


async def saved_detail(db: AsyncSession, viewer: User, material_id: uuid.UUID) -> MaterialDetail | None:
    await db.commit()
    return await detail_of(db, await load_material(db, viewer, material_id))


@items.get("/{material_id}", response_model_exclude_none=True)
async def get_material(material_id: uuid.UUID, viewer: SignedIn, db: Db) -> MaterialDetail | None:
    """The current version with its review, or null when the material has no version yet."""
    await expire_approvals(db, viewer)
    return await detail_of(db, await load_material(db, viewer, material_id))


def event(
    m: Material, actor: User | None, type: EventType, text: str, actor_name: str | None = None
) -> MaterialEvent:
    """A new audit log entry (PRD F2). The log is append-only."""
    return MaterialEvent(
        workspace_id=m.workspace_id,
        material_id=m.id,
        at=now(),
        actor_id=actor.id if actor else None,
        actor_name=actor_name or (actor.name if actor else "ClearPath"),
        type=type,
        text=text,
    )


# ---- Submitting (PRD F3) ----


async def workspace_of(db: AsyncSession, viewer: User) -> Workspace:
    """Read it here, not through viewer.workspace: reloading the material can refresh the viewer row,
    and an async session cannot load a relationship by itself."""
    return await db.get_one(Workspace, viewer.workspace_id)


class FieldInput(APIModel):
    label: str = Field(min_length=1, max_length=100)
    kind: Literal["image"] | None = None
    text: str = Field(max_length=20_000)


class RoutedGroup(APIModel):
    name: str = Field(min_length=1, max_length=100)
    reason: str = Field(default="", max_length=500)


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
    # The groups that the Routing tab's rules require. TODO (F6): the server evaluates the routing rules
    # when they are stored in the database (another area); until then it only checks that the groups exist.
    groups: list[RoutedGroup] = Field(default=[], max_length=20)

    @field_validator("states")
    @classmethod
    def known_states(cls, states: list[str]) -> list[str]:
        unknown = sorted(set(states) - set(US_STATES))
        if unknown:
            raise ValueError(f"Unknown states: {', '.join(unknown)}")
        return [s for s in US_STATES if s in states]

    @model_validator(mode="after")
    def check(self) -> Submission:
        self.fields = [f for f in self.fields if f.text.strip()]
        if not self.fields:
            raise ValueError("Add the content")
        if not self.nationwide and not self.states:
            raise ValueError("Choose the target states, or Nationwide")
        if self.launch_date and self.end_date and self.end_date < self.launch_date:
            raise ValueError("The end date is before the launch date")
        return self


async def routed_groups(db: AsyncSession, viewer: User, wanted: list[RoutedGroup]) -> list[tuple[ReviewerGroup, str]]:
    """The required groups. With none, the default group (PRD F6: no item is left without a reviewer)."""
    groups = list(await db.scalars(select(ReviewerGroup).where(ReviewerGroup.workspace_id == viewer.workspace_id)))
    by_name = {g.name.lower(): g for g in groups}
    result: list[tuple[ReviewerGroup, str]] = []
    for w in wanted:
        group = by_name.get(w.name.strip().lower())
        if group is None:
            raise bad_request(f"Unknown reviewer group: {w.name}")
        if all(g.id != group.id for g, _ in result):
            result.append((group, w.reason.strip()))
    if not result:
        default = next((g for g in groups if g.is_default), None)
        if default is None:
            raise bad_request("The workspace has no default reviewer group")
        result.append((default, "Default group"))
    return result


async def add_version(db: AsyncSession, viewer: User, m: Material, body: Submission, number: int) -> None:
    """Adds the version, routes it, and moves the material to In review (PRD section 6)."""
    licensed = set((await workspace_of(db, viewer)).licensed_states)
    if not body.nationwide and not set(body.states) <= licensed:
        raise bad_request("Target only states where the credit union is licensed")
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
    groups = await routed_groups(db, viewer, body.groups)

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
        path=ReviewPath.FULL,  # TODO (F6): the lighter path for a version with no material change
        details=details,
        fields=[
            {"label": f.label, "segments": [f.text.strip()], **({"kind": f.kind} if f.kind else {})} for f in body.fields
        ],
        # TODO (F4): pre-review (code checks and AI) fills the checklist and adds findings.
        checklist=[],
    )
    db.add(version)
    await db.flush()
    for f in files:
        f.version_id = version.id

    # Findings on the old version become outdated (PRD F4).
    await db.execute(
        update(Finding)
        .where(Finding.material_id == m.id, Finding.status == FindingStatus.OPEN)
        .values(status=FindingStatus.OUTDATED)
    )
    # The new version needs new decisions. The old ones stay in the versions, comments, and history.
    m.reviews.clear()
    await db.flush()
    m.reviews.extend(
        GroupReview(workspace_id=m.workspace_id, group_id=g.id, position=i, reason=reason)
        for i, (g, reason) in enumerate(groups)
    )
    m.product = body.product
    # TODO (F4): AI pre-review runs between Submitted and In review. It does not exist yet,
    # so the version goes to its reviewer groups at once.
    m.status = MaterialStatus.IN_REVIEW
    m.submitted_at = version.submitted_at
    m.updated_at = version.submitted_at
    db.add(event(m, viewer, EventType.SUBMITTED, f"Submitted version {number} by manual upload."))
    routed = ", ".join(f'{g.name} (rule "{reason}")' if reason else g.name for g, reason in groups)
    db.add(event(m, None, EventType.ROUTED, f"Required {routed}.", actor_name="Routing"))
    await notify_groups(db, viewer, NotificationType.ASSIGNMENT, m, [g for g, _ in groups])  # PRD F13


@items.post("", status_code=status.HTTP_201_CREATED, response_model_exclude_none=True)
async def submit_material(body: Submission, viewer: Submitter, db: Db) -> MaterialDetail:
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
    await add_version(db, viewer, m, body, 1)
    return await saved_detail(db, viewer, m.id)  # type: ignore[return-value]


@items.post("/{material_id}/versions", status_code=status.HTTP_201_CREATED, response_model_exclude_none=True)
async def submit_version(material_id: uuid.UUID, body: Submission, viewer: Submitter, db: Db) -> MaterialDetail:
    """Resubmit or renew (PRD F3, section 6). Any status except Retired. Title and channel stay."""
    m = await load_material(db, viewer, material_id)
    if m.status is MaterialStatus.RETIRED:
        raise conflict("A retired material cannot get a new version")
    if body.channel is not m.channel:
        raise bad_request("A new version keeps the channel")
    await add_version(db, viewer, m, body, (m.versions[-1].number if m.versions else 0) + 1)
    return await saved_detail(db, viewer, m.id)  # type: ignore[return-value]


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
        if override:
            history += f" Override reason: {override}"
            comment_body = "\n".join(x for x in (text, f"Override: {override}") if x)

    m.updated_at = now()
    db.add(
        Comment(
            workspace_id=m.workspace_id,
            material_id=m.id,
            version_number=version.number,
            author_id=viewer.id,
            role=comment_role,
            at=now(),
            body=comment_body,
            decision=d,
        )
    )
    db.add(event(m, viewer, EventType.DECISION, history))
    await notify_decision(db, viewer, m, version, d)  # PRD F13
    return await saved_detail(db, viewer, m.id)  # type: ignore[return-value]


# ---- Comments ----


class CommentInput(APIModel):
    body: str = Field(min_length=1, max_length=5000)


@items.post("/{material_id}/comments", status_code=status.HTTP_201_CREATED, response_model_exclude_none=True)
async def add_comment(material_id: uuid.UUID, body: CommentInput, viewer: Submitter, db: Db) -> MaterialDetail:
    """Reviewers comment, and Submitters and affiliates reply (PRD section 4). Viewers only read."""
    m = await load_material(db, viewer, material_id)
    text = body.body.strip()
    if not text:
        raise bad_request("Write a comment")
    number = m.versions[-1].number if m.versions else None
    groups = await group_names_of(db, viewer)
    db.add(
        Comment(
            workspace_id=m.workspace_id,
            material_id=m.id,
            version_number=number,
            author_id=viewer.id,
            role=", ".join(groups.values()) or (viewer.title or ""),
            at=now(),
            body=text,
        )
    )
    db.add(event(m, viewer, EventType.COMMENT, f"Commented on version {number}." if number else "Commented."))
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
