"""Flags for re-review (PRD F7, F8, F15): a library change that an approved material depends on.

When a Manager edits a rule, saves a new disclosure version, uploads a rate sheet, or applies a regulatory
change, app.flags finds the approved and live materials whose approved version depends on it and adds one
flag to each, in the same transaction. A flag does not change the material's status: it asks a Reviewer
to look again. The Reviewer resolves it ("re-reviewed, no change needed"), or a new version resolves it.
What happened is also in the material's history (audit entries "flagged" and "flag_resolved").
"""

import enum
import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import ForeignKey, Index, String, Text, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, now_default, str_enum, uuid_pk
from app.models.core import User
from app.models.materials import Material, MaterialVersion


class FlagKind(enum.StrEnum):
    RULE_CHANGED = "rule_changed"
    DISCLOSURE_CHANGED = "disclosure_changed"
    RATE_SHEET_CHANGED = "rate_sheet_changed"
    REGULATORY_CHANGE = "regulatory_change"


class FlagResolution(enum.StrEnum):
    NO_CHANGE = "no_change"  # a Reviewer re-reviewed the approved version: it still complies
    NEW_VERSION = "new_version"  # a new version was submitted, so the flagged approval is no longer current


class MaterialFlag(Base):
    __tablename__ = "material_flags"
    __table_args__ = (
        # The open flags of a material (detail page, list count), and the flags of one library change.
        Index("ix_material_flags_open", "material_id", "resolved_at"),
        Index("ix_material_flags_source", "workspace_id", "kind", "source_id"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id"))
    material_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("materials.id", ondelete="CASCADE"))
    # The approved version that depends on the change
    version_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("material_versions.id", ondelete="CASCADE"), index=True)
    kind: Mapped[FlagKind] = mapped_column(str_enum(FlagKind, "kind"))
    # The rule, disclosure, rate sheet or regulatory change ID (library IDs are text), and its new version
    # for a rule or disclosure. Plain text, like the rule IDs on findings, so a flag outlives its source.
    source_id: Mapped[str] = mapped_column(String(100))
    source_version: Mapped[int | None]
    summary: Mapped[str] = mapped_column(Text)  # what changed, in one line, as shown on the material
    # More about the change, for example {"rules": [...]} for a regulatory change or {"rates": [...]} for a rate sheet
    data: Mapped[dict[str, Any]] = mapped_column(JSONB, server_default=text("'{}'"))
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = now_default()
    resolved_at: Mapped[datetime | None]
    resolved_by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    resolution: Mapped[FlagResolution | None] = mapped_column(str_enum(FlagResolution, "resolution"))
    resolution_note: Mapped[str | None] = mapped_column(Text)
    seeded: Mapped[bool] = mapped_column(server_default=text("false"))

    material: Mapped[Material] = relationship()
    version: Mapped[MaterialVersion] = relationship()
    created_by: Mapped[User | None] = relationship(foreign_keys=[created_by_id])
    resolved_by: Mapped[User | None] = relationship(foreign_keys=[resolved_by_id])
