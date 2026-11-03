"""Policy library tables (PRD F7, F8, F9, section 9): rules, disclosures, building blocks, rate sheets,
and the regulatory change queue.

Rules, disclosures, rate sheets and regulatory changes have short text IDs that people read, like "REGZ-1026.24"
or "D-7". Materials refer to them by these IDs. Each workspace has its own set, so the primary key is
(workspace_id, id): the demo workspace and the real workspace can both have a rule "RATE-01".
"""

import enum
import uuid
from datetime import date, datetime
from typing import Any

from sqlalchemy import (
    ARRAY,
    Float,
    ForeignKey,
    ForeignKeyConstraint,
    String,
    Text,
)
from sqlalchemy import text as sql  # several tables have a column named text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, now_default, str_enum, uuid_pk
from app.models.core import User


class RuleKind(enum.StrEnum):
    REGULATION = "regulation"
    POLICY = "policy"  # company rules (F8)


class CheckLayer(enum.StrEnum):
    """F4: layer 1 is code checks, layer 2 is the AI review."""

    CODE = "code"
    AI = "ai"


class Severity(enum.StrEnum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"


class BlockKind(enum.StrEnum):
    HEADLINE = "headline"
    CLAIM = "claim"
    CTA = "cta"
    DISCLOSURE = "disclosure"


class RateKind(enum.StrEnum):
    APR = "apr"  # loans and cards
    APY = "apy"  # savings and certificates


class RegChangeStatus(enum.StrEnum):
    WAITING = "waiting"
    IN_REVIEW = "in_review"  # a Manager opened it
    APPLIED = "applied"
    DISMISSED = "dismissed"


def text_id() -> Mapped[str]:
    return mapped_column(String(64), primary_key=True)


def workspace_key() -> Mapped[uuid.UUID]:
    return mapped_column(ForeignKey("workspaces.id"), primary_key=True)


class Rule(Base):
    """One rule (F7). The row holds the current version; rule_versions holds the history."""

    __tablename__ = "rules"

    workspace_id: Mapped[uuid.UUID] = workspace_key()
    id: Mapped[str] = text_id()
    version: Mapped[int]
    title: Mapped[str] = mapped_column(String(200))
    kind: Mapped[RuleKind] = mapped_column(str_enum(RuleKind, "rule_kind"))
    text: Mapped[str] = mapped_column(Text)
    # "federal", a state code such as "CA", or "all" for company policy
    jurisdiction: Mapped[str] = mapped_column(String(16))
    # Empty means every product or every channel
    products: Mapped[list[str]] = mapped_column(ARRAY(String(32)), server_default=sql("'{}'"))
    channels: Mapped[list[str]] = mapped_column(ARRAY(String(32)), server_default=sql("'{}'"))
    citation_label: Mapped[str | None] = mapped_column(String(200))
    citation_url: Mapped[str | None] = mapped_column(String(500))
    effective_date: Mapped[date]
    owner_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    severity: Mapped[Severity] = mapped_column(str_enum(Severity, "severity"))
    layer: Mapped[CheckLayer] = mapped_column(str_enum(CheckLayer, "layer"))
    # How the rule is checked, for example {"type": "phrase_banned", "phrases": [...]}. The API validates the shape.
    check: Mapped[dict[str, Any]] = mapped_column("check_config", JSONB)
    seeded: Mapped[bool] = mapped_column(server_default=sql("false"))
    created_at: Mapped[datetime] = now_default()

    owner: Mapped[User] = relationship()
    versions: Mapped[list["RuleVersion"]] = relationship(
        order_by="RuleVersion.version.desc()", cascade="all, delete-orphan", passive_deletes=True
    )


class RuleVersion(Base):
    """One line of a rule's history: who changed it, when it takes effect, and why."""

    __tablename__ = "rule_versions"
    __table_args__ = (
        ForeignKeyConstraint(["workspace_id", "rule_id"], ["rules.workspace_id", "rules.id"], ondelete="CASCADE"),
    )

    workspace_id: Mapped[uuid.UUID] = workspace_key()
    rule_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    version: Mapped[int] = mapped_column(primary_key=True)
    effective_date: Mapped[date]
    by_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    note: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = now_default()

    by: Mapped[User] = relationship()


class Disclosure(Base):
    """An approved disclosure text (F8). Materials must use it word for word."""

    __tablename__ = "disclosures"

    workspace_id: Mapped[uuid.UUID] = workspace_key()
    id: Mapped[str] = text_id()
    title: Mapped[str] = mapped_column(String(200))
    version: Mapped[int]
    text: Mapped[str] = mapped_column(Text)
    products: Mapped[list[str]] = mapped_column(ARRAY(String(32)), server_default=sql("'{}'"))
    # Null means every licensed state
    states: Mapped[list[str] | None] = mapped_column(ARRAY(String(2)))
    placement: Mapped[str] = mapped_column(Text)
    effective_date: Mapped[date]
    owner_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    seeded: Mapped[bool] = mapped_column(server_default=sql("false"))
    created_at: Mapped[datetime] = now_default()

    owner: Mapped[User] = relationship()
    versions: Mapped[list["DisclosureVersion"]] = relationship(
        order_by="DisclosureVersion.version.desc()", cascade="all, delete-orphan", passive_deletes=True
    )


class DisclosureVersion(Base):
    """Each version keeps its full text, so the page can show what changed."""

    __tablename__ = "disclosure_versions"
    __table_args__ = (
        ForeignKeyConstraint(
            ["workspace_id", "disclosure_id"], ["disclosures.workspace_id", "disclosures.id"], ondelete="CASCADE"
        ),
    )

    workspace_id: Mapped[uuid.UUID] = workspace_key()
    disclosure_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    version: Mapped[int] = mapped_column(primary_key=True)
    effective_date: Mapped[date]
    by_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    note: Mapped[str] = mapped_column(Text)
    text: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = now_default()

    by: Mapped[User] = relationship()


class BuildingBlock(Base):
    """A pre-approved piece of text (F9). The tool finds it in a material by its exact text."""

    __tablename__ = "building_blocks"

    id: Mapped[uuid.UUID] = uuid_pk()
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id"), index=True)
    kind: Mapped[BlockKind] = mapped_column(str_enum(BlockKind, "block_kind"))
    text: Mapped[str] = mapped_column(Text)
    products: Mapped[list[str]] = mapped_column(ARRAY(String(32)), server_default=sql("'{}'"))
    # Null means every licensed state
    states: Mapped[list[str] | None] = mapped_column(ARRAY(String(2)))
    approved_by_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    approved_at: Mapped[date]
    expires_at: Mapped[date]
    # The approved material it was saved from. TODO: a foreign key when materials are in the database.
    saved_from_id: Mapped[uuid.UUID]
    saved_from_title: Mapped[str] = mapped_column(String(300))
    # How many materials contain this exact text. TODO: count it from the materials when they are in the database.
    used_in: Mapped[int] = mapped_column(server_default=sql("0"))
    seeded: Mapped[bool] = mapped_column(server_default=sql("false"))
    created_at: Mapped[datetime] = now_default()

    approved_by: Mapped[User] = relationship()


class RateSheet(Base):
    """One uploaded rate sheet CSV (F8). Each upload is a full sheet that replaces the one before it."""

    __tablename__ = "rate_sheets"

    workspace_id: Mapped[uuid.UUID] = workspace_key()
    # Seeded sheets have IDs like "2026-11"; an upload gets a UUIDv7.
    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: str(uuid.uuid7()))
    effective_date: Mapped[date]
    uploaded_at: Mapped[datetime] = now_default()
    uploaded_by_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    file: Mapped[str] = mapped_column(String(255))
    seeded: Mapped[bool] = mapped_column(server_default=sql("false"))

    uploaded_by: Mapped[User] = relationship()
    rows: Mapped[list["RateSheetRow"]] = relationship(
        order_by="RateSheetRow.position", cascade="all, delete-orphan", passive_deletes=True
    )


class RateSheetRow(Base):
    """One offer on a sheet, in the order of the CSV."""

    __tablename__ = "rate_sheet_rows"
    __table_args__ = (
        ForeignKeyConstraint(
            ["workspace_id", "sheet_id"], ["rate_sheets.workspace_id", "rate_sheets.id"], ondelete="CASCADE"
        ),
    )

    workspace_id: Mapped[uuid.UUID] = workspace_key()
    sheet_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    position: Mapped[int] = mapped_column(primary_key=True)
    # Stable across uploads, so a row can be compared with the same offer on an older sheet
    key: Mapped[str] = mapped_column(String(100))
    product: Mapped[str] = mapped_column(String(32))
    offer: Mapped[str] = mapped_column(String(300))
    rate: Mapped[RateKind] = mapped_column(str_enum(RateKind, "rate_kind"))
    # Fractions: 0.0899 is 8.99%
    min: Mapped[float] = mapped_column(Float)
    max: Mapped[float] = mapped_column(Float)
    fees: Mapped[str] = mapped_column(Text)


class RegChange(Base):
    """One item in the regulatory change queue (F7). A feed connector adds them; the demo seeds them."""

    __tablename__ = "reg_changes"

    workspace_id: Mapped[uuid.UUID] = workspace_key()
    id: Mapped[str] = mapped_column(String(100), primary_key=True)
    title: Mapped[str] = mapped_column(String(300))
    summary: Mapped[str] = mapped_column(Text)
    source: Mapped[str] = mapped_column(String(100))  # the feed, for example "compliance.ai"
    agency: Mapped[str] = mapped_column(String(100))
    citation_label: Mapped[str] = mapped_column(String(200))
    citation_url: Mapped[str] = mapped_column(String(500))
    published_at: Mapped[date]
    effective_date: Mapped[date]
    status: Mapped[RegChangeStatus] = mapped_column(
        str_enum(RegChangeStatus, "reg_change_status"), server_default=RegChangeStatus.WAITING.value
    )
    reviewing_by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    decided_by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    decided_at: Mapped[datetime | None]
    decision_note: Mapped[str | None] = mapped_column(Text)
    seeded: Mapped[bool] = mapped_column(server_default=sql("false"))
    created_at: Mapped[datetime] = now_default()

    reviewing_by: Mapped[User | None] = relationship(foreign_keys=[reviewing_by_id])
    decided_by: Mapped[User | None] = relationship(foreign_keys=[decided_by_id])
    edits: Mapped[list["RegChangeEdit"]] = relationship(
        order_by="RegChangeEdit.position", cascade="all, delete-orphan", passive_deletes=True
    )


class RegChangeEdit(Base):
    """The suggested new text for one rule. After the change is applied, `before` is the text the rule had."""

    __tablename__ = "reg_change_edits"
    __table_args__ = (
        ForeignKeyConstraint(
            ["workspace_id", "change_id"], ["reg_changes.workspace_id", "reg_changes.id"], ondelete="CASCADE"
        ),
        ForeignKeyConstraint(["workspace_id", "rule_id"], ["rules.workspace_id", "rules.id"]),
    )

    workspace_id: Mapped[uuid.UUID] = workspace_key()
    change_id: Mapped[str] = mapped_column(String(100), primary_key=True)
    position: Mapped[int] = mapped_column(primary_key=True)
    rule_id: Mapped[str] = mapped_column(String(64), index=True)
    before: Mapped[str] = mapped_column(Text)
    after: Mapped[str] = mapped_column(Text)
