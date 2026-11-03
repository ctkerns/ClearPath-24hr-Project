"""The viewer's own in-app notifications (PRD F13). Every signed-in user has them, affiliates too.

`app.notify` writes them. Reading them or marking them read is not an audited change.
"""

import uuid
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Query, status
from pydantic import Field
from sqlalchemy import select, update

from app.api import APIModel, SignedIn
from app.material_access import Db, now
from app.models.notifications import Notification, NotificationType

router = APIRouter(prefix="/api/notifications", tags=["notifications"])


class NotificationOut(APIModel):
    """The shape of AppNotification in frontend/src/lib/notifications.ts."""

    id: uuid.UUID
    type: NotificationType
    actor: str | None = None
    material: str
    material_id: uuid.UUID | None = None
    issue_id: uuid.UUID | None = None
    group: str | None = None
    summary: str | None = None
    created_at: datetime
    read: bool


@router.get("", response_model_exclude_none=True)
async def list_notifications(
    viewer: SignedIn, db: Db, limit: Annotated[int, Query(ge=1, le=200)] = 50
) -> list[NotificationOut]:
    """The newest first. The page counts the unread ones."""
    rows = await db.scalars(
        select(Notification)
        .where(Notification.user_id == viewer.id, Notification.workspace_id == viewer.workspace_id)
        .order_by(Notification.created_at.desc(), Notification.id.desc())
        .limit(limit)
    )
    return [
        NotificationOut(
            id=n.id,
            type=n.type,
            actor=n.actor_name,
            material=n.material_title,
            material_id=n.material_id,
            issue_id=n.issue_id,
            group=n.group_name,
            summary=n.summary,
            created_at=n.created_at,
            read=n.read_at is not None,
        )
        for n in rows
    ]


class MarkRead(APIModel):
    ids: list[uuid.UUID] | None = Field(default=None, max_length=500)  # none: all of the viewer's


@router.post("/read", status_code=status.HTTP_204_NO_CONTENT)
async def mark_read(body: MarkRead, viewer: SignedIn, db: Db) -> None:
    """Ids that are not the viewer's change nothing, with no error, so nobody learns which ids exist."""
    query = update(Notification).where(
        Notification.user_id == viewer.id,
        Notification.workspace_id == viewer.workspace_id,
        Notification.read_at.is_(None),
    )
    if body.ids is not None:
        query = query.where(Notification.id.in_(body.ids))
    await db.execute(query.values(read_at=now()))
    await db.commit()
