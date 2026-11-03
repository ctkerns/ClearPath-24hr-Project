"""In-app notifications (PRD F13): assignment, decision, comment, escalation, and new issue.

One row for each recipient. The names and titles are copies made when the notification was sent,
so a notification still reads the same after a rename. `app.notify` adds the rows.
"""

import enum
import uuid
from datetime import datetime

from sqlalchemy import ForeignKey, Index, String, Text, text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, now_default, str_enum, uuid_pk


class NotificationType(enum.StrEnum):
    """The same values as NotificationType in frontend/src/lib/notifications.ts."""

    ASSIGNMENT = "assignment"
    COMMENT = "comment"
    ESCALATION = "escalation"
    ISSUE = "issue"
    DECISION_APPROVED = "decision_approved"
    DECISION_CHANGES_REQUESTED = "decision_changes_requested"
    DECISION_REJECTED = "decision_rejected"


class Notification(Base):
    __tablename__ = "notifications"
    __table_args__ = (
        # The bell: one user's notifications, unread first, by time.
        Index("ix_notifications_user_read_time", "user_id", "read_at", "created_at"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id"), index=True)
    # The recipient. A notification is private to them, so it goes with the user.
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    type: Mapped[NotificationType] = mapped_column(str_enum(NotificationType, "type"))
    # Who did it. actor_name keeps the name as it was then; the id goes when the user goes.
    actor_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    actor_name: Mapped[str | None] = mapped_column(String(200))
    # The links. A notification about a deleted material or issue has nothing to open, so it goes too.
    material_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("materials.id", ondelete="CASCADE"), index=True)
    issue_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("issues.id", ondelete="CASCADE"), index=True)
    group_name: Mapped[str | None] = mapped_column(String(100))  # escalation and assignment
    summary: Mapped[str | None] = mapped_column(Text)  # new issue: its title
    material_title: Mapped[str] = mapped_column(String(300))  # as shown then
    seeded: Mapped[bool] = mapped_column(server_default=text("false"))  # PRD A6
    created_at: Mapped[datetime] = now_default()
    read_at: Mapped[datetime | None]
