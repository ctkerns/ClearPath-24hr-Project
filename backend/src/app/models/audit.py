"""The audit log (PRD section 9 AuditEvent, F12 "the audit log is append-only").

One row for each change: who did what to which thing. The migration adds a trigger that blocks UPDATE
and DELETE, so nobody can edit or delete entries, also not with SQL. One exception: the demo reset
(PRD A1) deletes the demo workspace's rows, see `app.seed.audit`.
"""

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import ForeignKey, Index, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, now_default, uuid_pk
from app.models.core import User


class AuditEvent(Base):
    __tablename__ = "audit_events"
    __table_args__ = (
        # The history of one thing, newest first; also the whole workspace's log by time.
        Index("ix_audit_events_entity", "workspace_id", "entity", "entity_id", "created_at"),
        Index("ix_audit_events_workspace_time", "workspace_id", "created_at"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    # No ON DELETE CASCADE on these keys: a delete of a user or workspace must not remove its history.
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id"))
    # Null when the actor is not a user, for example a connector (PRD R1). Then actor_label names it.
    actor_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"), index=True)
    actor_label: Mapped[str | None] = mapped_column(Text)
    entity: Mapped[str] = mapped_column(Text)  # "user", "rule", "routing_rule", ...
    entity_id: Mapped[str] = mapped_column(Text)  # text, because library IDs are text like "REGZ-1026.24"
    action: Mapped[str] = mapped_column(Text)  # "created", "updated", "role_changed", ...
    data: Mapped[dict[str, Any] | None] = mapped_column(JSONB)  # what changed
    created_at: Mapped[datetime] = now_default()

    actor: Mapped[User | None] = relationship()
