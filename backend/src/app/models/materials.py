"""Materials and their review (PRD section 6, F2 to F6, F10, F12, section 9).

A material has versions. Its current version has findings, a checklist, and required reviewer groups.
Comments and the history belong to the material, so they stay when a new version comes. The history is
the audit log (app.audit, entity "material"), not a table of its own.
Issues (F12) also live here. Most belong to a material; unapproved content found live may have none (F10).

Rule IDs (for example "REGZ-1026.24") are plain text: the rules library is another area.
Rule titles on a checklist or an issue are a copy made when the check ran, so they show what the reviewer saw.
"""

import enum
import uuid
from datetime import date, datetime
from typing import Any

from sqlalchemy import ForeignKey, Index, String, Text, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, now_default, str_enum, uuid_pk
from app.models.core import Affiliate, ReviewerGroup, User


class MaterialStatus(enum.StrEnum):
    """PRD section 6."""

    DRAFT = "draft"
    SUBMITTED = "submitted"
    IN_REVIEW = "in_review"
    CHANGES_REQUESTED = "changes_requested"
    REJECTED = "rejected"
    APPROVED = "approved"
    LIVE = "live"
    EXPIRED = "expired"
    RETIRED = "retired"


class LiveStatus(enum.StrEnum):
    """PRD F2, F10."""

    NOT_LIVE = "not_live"
    MATCHED = "matched"
    CHANGED = "changed"
    UNAPPROVED = "unapproved"
    EXPIRED_APPROVAL = "expired_approval"
    CONDITION_BROKEN = "condition_broken"


class Channel(enum.StrEnum):
    META = "meta"
    GOOGLE = "google"
    MAILCHIMP = "mailchimp"
    WORDPRESS = "wordpress"
    AFFILIATE = "affiliate"
    OTHER = "other"


class Product(enum.StrEnum):
    PERSONAL_LOAN = "personal_loan"
    CREDIT_CARD = "credit_card"
    MORTGAGE = "mortgage"
    HELOC = "heloc"
    AUTO_LOAN = "auto_loan"
    SAVINGS = "savings"


class GroupState(enum.StrEnum):
    """Where one required reviewer group stands on the current version (PRD F6)."""

    WAITING = "waiting"
    APPROVED = "approved"
    CHANGES = "changes"
    REJECTED = "rejected"


class ReviewPath(enum.StrEnum):
    FULL = "full"
    LIGHTER = "lighter"  # no material change (PRD F6)


class Outcome(enum.StrEnum):
    APPROVED = "approved"
    CHANGES_REQUESTED = "changes_requested"
    REJECTED = "rejected"


class Severity(enum.StrEnum):
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"


class FindingSource(enum.StrEnum):
    CODE = "code"  # "Rule check" author (PRD F4 layer 1)
    AI = "ai"  # "AI reviewer" author (PRD F4 layer 2)


class FindingStatus(enum.StrEnum):
    OPEN = "open"
    OUTDATED = "outdated"
    HIDDEN = "hidden"


class Decision(enum.StrEnum):
    """PRD F5, plus retracting your own approval."""

    APPROVE = "approve"
    APPROVE_CONDITIONS = "approve_conditions"
    REQUEST_CHANGES = "request_changes"
    REJECT = "reject"
    ESCALATE = "escalate"
    RETRACT = "retract"


class Material(Base):
    __tablename__ = "materials"
    __table_args__ = (
        # An approval ID is the reference for audits, so it is unique (PRD section 5).
        Index("uq_materials_workspace_approval", "workspace_id", "approval_id", unique=True),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id"), index=True)
    title: Mapped[str] = mapped_column(String(300))
    channel: Mapped[Channel] = mapped_column(str_enum(Channel, "channel"))
    product: Mapped[Product] = mapped_column(str_enum(Product, "product"))
    status: Mapped[MaterialStatus] = mapped_column(str_enum(MaterialStatus, "status"))
    live_status: Mapped[LiveStatus] = mapped_column(
        str_enum(LiveStatus, "live_status"), server_default=LiveStatus.NOT_LIVE.value
    )
    # Null for a manual upload. "found_live" when monitoring made it (PRD F10).
    source: Mapped[str | None] = mapped_column(String(32))
    owner_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), index=True)
    # Affiliate content only (PRD section 4). Affiliates see only the materials of their own company (R4).
    affiliate_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("affiliates.id"), index=True)
    # The last approval (PRD F5, F15). It stays while a newer version waits for review.
    approval_id: Mapped[str | None] = mapped_column(String(40))
    expires_at: Mapped[date | None]
    # When the current version was submitted
    submitted_at: Mapped[datetime | None]
    seeded: Mapped[bool] = mapped_column(server_default=text("false"))
    created_at: Mapped[datetime] = now_default()
    updated_at: Mapped[datetime] = now_default()

    owner: Mapped[User] = relationship(foreign_keys=[owner_id])
    affiliate: Mapped[Affiliate | None] = relationship(foreign_keys=[affiliate_id])
    versions: Mapped[list[MaterialVersion]] = relationship(
        back_populates="material", order_by="MaterialVersion.number", cascade="all, delete-orphan"
    )
    reviews: Mapped[list[GroupReview]] = relationship(
        order_by="GroupReview.position", cascade="all, delete-orphan"
    )


class MaterialVersion(Base):
    """One snapshot of the content and its details (PRD section 5)."""

    __tablename__ = "material_versions"
    __table_args__ = (UniqueConstraint("material_id", "number", name="uq_material_versions_number"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id"), index=True)
    material_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("materials.id", ondelete="CASCADE"), index=True)
    number: Mapped[int]
    submitted_at: Mapped[datetime] = now_default()
    # Null for a version that a connector synced (PRD R1). TODO: store the connector when connectors exist.
    submitted_by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    path: Mapped[ReviewPath] = mapped_column(str_enum(ReviewPath, "path"), server_default=ReviewPath.FULL.value)
    # targetStates, launchDate, endDate, destinationUrl, platformId, targeting
    details: Mapped[dict[str, Any]] = mapped_column(JSONB, server_default=text("'{}'"))
    # [{label, kind?, segments}]; a segment is text, or {text, finding} for text that a finding points to
    fields: Mapped[list[Any]] = mapped_column(JSONB, server_default=text("'[]'"))
    # [{ruleId, title, layer, result, finding?, note?}], from pre-review (PRD F4). Rule titles are a copy.
    checklist: Mapped[list[Any]] = mapped_column(JSONB, server_default=text("'[]'"))
    outcome: Mapped[Outcome | None] = mapped_column(str_enum(Outcome, "outcome"))
    outcome_by: Mapped[str | None] = mapped_column(String(300))  # for example "Alex Chen (Compliance)"

    material: Mapped[Material] = relationship(back_populates="versions")
    submitted_by: Mapped[User | None] = relationship(foreign_keys=[submitted_by_id])


class Finding(Base):
    """A problem from a code check or the AI (PRD F4). It stays on the material as Outdated after a new version."""

    __tablename__ = "material_findings"

    id: Mapped[uuid.UUID] = uuid_pk()
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id"), index=True)
    material_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("materials.id", ondelete="CASCADE"), index=True)
    version_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("material_versions.id", ondelete="CASCADE"), index=True)
    position: Mapped[int] = mapped_column(server_default=text("0"))
    source: Mapped[FindingSource] = mapped_column(str_enum(FindingSource, "source"))
    # Severity comes from the rule, never from the AI (PRD F4).
    severity: Mapped[Severity] = mapped_column(str_enum(Severity, "severity"))
    # TODO: FK (workspace_id, rule_id) to rules after the library branch merges
    rule_id: Mapped[str] = mapped_column(String(64))
    status: Mapped[FindingStatus] = mapped_column(str_enum(FindingStatus, "status"))
    flagged_text: Mapped[str] = mapped_column(Text)
    explanation: Mapped[str] = mapped_column(Text)
    suggestion: Mapped[str | None] = mapped_column(Text)


class GroupReview(Base):
    """One required reviewer group on the current version, and its decision (PRD F5, F6).
    A new version replaces these rows; the versions, comments, and history keep the old decisions."""

    __tablename__ = "material_group_reviews"
    __table_args__ = (UniqueConstraint("material_id", "group_id", name="uq_material_group_reviews_group"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id"), index=True)
    material_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("materials.id", ondelete="CASCADE"), index=True)
    group_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("reviewer_groups.id"), index=True)
    position: Mapped[int] = mapped_column(server_default=text("0"))
    state: Mapped[GroupState] = mapped_column(str_enum(GroupState, "state"), server_default=GroupState.WAITING.value)
    reason: Mapped[str] = mapped_column(Text, server_default="")  # why routing or escalation required it
    decided_by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    decided_at: Mapped[datetime | None]
    conditions: Mapped[str | None] = mapped_column(Text)  # "Approve with conditions" (PRD F5)
    escalated_by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))

    group: Mapped[ReviewerGroup] = relationship()
    decided_by: Mapped[User | None] = relationship(foreign_keys=[decided_by_id])
    escalated_by: Mapped[User | None] = relationship(foreign_keys=[escalated_by_id])


class Comment(Base):
    """A comment on a material. A decision is a comment with a decision, like a pull request review."""

    __tablename__ = "material_comments"

    id: Mapped[uuid.UUID] = uuid_pk()
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id"), index=True)
    material_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("materials.id", ondelete="CASCADE"), index=True)
    version_number: Mapped[int | None]
    author_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    role: Mapped[str] = mapped_column(String(300), server_default="")  # groups or team, as shown then
    at: Mapped[datetime] = now_default()
    body: Mapped[str] = mapped_column(Text)
    decision: Mapped[Decision | None] = mapped_column(str_enum(Decision, "decision"))
    # A comment on selected text (PRD F5): the field label and the text, as they were on version_number.
    # The AI miss rate counts these comments (PRD section 2).
    anchor_field: Mapped[str | None] = mapped_column(String(100))
    anchor_text: Mapped[str | None] = mapped_column(Text)

    author: Mapped[User] = relationship()


class LiveItem(Base):
    """Content that monitoring found live, and how it compares with the approved version (PRD F10)."""

    __tablename__ = "material_live_items"

    id: Mapped[uuid.UUID] = uuid_pk()
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id"), index=True)
    material_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("materials.id", ondelete="CASCADE"), index=True)
    connector: Mapped[str] = mapped_column(String(100))
    external_id: Mapped[str] = mapped_column(String(300))
    match: Mapped[str] = mapped_column(String(32))  # platform_id or similarity
    status: Mapped[LiveStatus] = mapped_column(str_enum(LiveStatus, "status"))
    found_at: Mapped[datetime]
    checked_at: Mapped[datetime]
    paused: Mapped[bool] = mapped_column(server_default=text("false"))
    fields: Mapped[list[Any]] = mapped_column(JSONB, server_default=text("'[]'"))  # [{label, text}]


class MaterialFile(Base):
    """An uploaded file (PRD F3): content, the ad image, or a claim proof. The bytes are on disk
    under settings.upload_dir; this row says who may read them."""

    __tablename__ = "material_files"

    id: Mapped[uuid.UUID] = uuid_pk()
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id"), index=True)
    # Null until a submission uses the file
    version_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("material_versions.id"), index=True)
    name: Mapped[str] = mapped_column(String(255))
    content_type: Mapped[str] = mapped_column(String(100))
    size: Mapped[int]
    uploaded_by_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = now_default()


class IssueStatus(enum.StrEnum):
    OPEN = "open"
    IN_PROGRESS = "in_progress"
    RESOLVED = "resolved"


class IssueSource(enum.StrEnum):
    MONITORING = "monitoring"
    REVIEWER = "reviewer"


class IssueKind(enum.StrEnum):
    """What monitoring found on live content (PRD F10). Null for an issue that is not a live problem."""

    CHANGED = "changed"
    UNAPPROVED = "unapproved"
    CONDITION_BROKEN = "condition_broken"
    EXPIRED_APPROVAL = "expired_approval"


class ActionKind(enum.StrEnum):
    PAUSE = "pause"
    RESTORE = "restore"
    NEW_VERSION = "new_version"
    NOTICE = "notice"
    CONFIRM_FIX = "confirm_fix"
    TAKE_DOWN = "take_down"
    FIND_AUTHOR = "find_author"


class Issue(Base):
    """A tracked problem with a material, or with live content that matches no material (PRD F10, F12).
    An issue with no material is for internal users only: no affiliate company owns it (R4)."""

    __tablename__ = "issues"

    id: Mapped[uuid.UUID] = uuid_pk()
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id"), index=True)
    material_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("materials.id", ondelete="CASCADE"), index=True)
    # Where the content was found, for an issue with no material. Otherwise null: the material has the channel.
    channel: Mapped[Channel | None] = mapped_column(str_enum(Channel, "channel"))
    kind: Mapped[IssueKind | None] = mapped_column(str_enum(IssueKind, "kind"))
    title: Mapped[str] = mapped_column(String(300))
    summary: Mapped[str] = mapped_column(Text, server_default="")
    severity: Mapped[Severity] = mapped_column(str_enum(Severity, "severity"))
    status: Mapped[IssueStatus] = mapped_column(str_enum(IssueStatus, "status"), server_default=IssueStatus.OPEN.value)
    source: Mapped[IssueSource] = mapped_column(str_enum(IssueSource, "source"))
    owner_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), index=True)
    opened_by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))  # reviewer issues only
    opened_at: Mapped[datetime] = now_default()
    due_at: Mapped[datetime]
    resolved_at: Mapped[datetime | None]
    # The rule (or disclosure, for example "D-4 v2") that the live content breaks, with its title as it was then.
    # TODO: FK (workspace_id, rule_id) to rules after the library branch merges. Seeded disclosure IDs carry
    # their version, so they need a separate disclosure reference first.
    rule_id: Mapped[str | None] = mapped_column(String(64))
    rule_title: Mapped[str | None] = mapped_column(String(300))
    condition: Mapped[str | None] = mapped_column(Text)  # the broken approval condition
    # What monitoring saw, and the approved version to compare with: copies, so later changes do not alter them
    live_item: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    approved: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    # The AI draft of the affiliate notice: {to, cc?, subject, body, sentAt?, sentBy?}
    notice: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    # The approved version that the live content is compared with (PRD F10), and whether the problem was already
    # in that version. Those issues give the post-approval violation rate (PRD section 2).
    approved_version_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("material_versions.id", ondelete="SET NULL"), index=True
    )
    present_at_approval: Mapped[bool] = mapped_column(server_default=text("false"))
    seeded: Mapped[bool] = mapped_column(server_default=text("false"))

    material: Mapped[Material | None] = relationship()
    owner: Mapped[User] = relationship(foreign_keys=[owner_id])
    opened_by: Mapped[User | None] = relationship(foreign_keys=[opened_by_id])
    actions: Mapped[list[IssueAction]] = relationship(order_by="IssueAction.position", cascade="all, delete-orphan")
    # The conversation. What happened to the issue is in the audit log (app.audit, entity "issue").
    comments: Mapped[list[IssueComment]] = relationship(
        order_by=lambda: [IssueComment.at, IssueComment.id], cascade="all, delete-orphan"
    )


class IssueAction(Base):
    """One remediation step (PRD F12). No step runs by itself; a person marks it done."""

    __tablename__ = "issue_actions"

    id: Mapped[uuid.UUID] = uuid_pk()
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id"), index=True)
    issue_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("issues.id", ondelete="CASCADE"), index=True)
    position: Mapped[int] = mapped_column(server_default=text("0"))
    kind: Mapped[ActionKind] = mapped_column(str_enum(ActionKind, "kind"))
    label: Mapped[str] = mapped_column(String(300))
    done_at: Mapped[datetime | None]
    done_by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    done_by_name: Mapped[str | None] = mapped_column(String(200))  # a person or "Monitoring"


class IssueComment(Base):
    """A comment on an issue: conversation, not history. Posting one also records an audit entry that points
    to it ("commented", with the comment id), so the text is stored once, here."""

    __tablename__ = "issue_comments"

    id: Mapped[uuid.UUID] = uuid_pk()
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id"), index=True)
    issue_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("issues.id", ondelete="CASCADE"), index=True)
    author_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    at: Mapped[datetime] = now_default()
    body: Mapped[str] = mapped_column(Text)

    author: Mapped[User] = relationship()
