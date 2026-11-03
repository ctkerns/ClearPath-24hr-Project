"""Reads the audit log (PRD section 4: Viewers and higher read history; F12). Entries are written by `app.audit`.

Every internal user reads the log of their own workspace. Affiliates do not (R4). Nobody edits or deletes it.
"""

import uuid
from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select, tuple_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api import APIModel, InternalUser, bad_request
from app.audit import actor_name
from app.db import get_db
from app.models.audit import AuditEvent

router = APIRouter(prefix="/api/audit", tags=["audit"])
Db = Annotated[AsyncSession, Depends(get_db)]


class AuditEventOut(APIModel):
    id: uuid.UUID  # pass the last one as `before` to get the next page
    actor: str  # the user's name, or a label such as "Meta connector"
    actor_id: uuid.UUID | None
    entity: str
    entity_id: str
    action: str
    data: dict[str, Any] | None
    created_at: datetime

    @classmethod
    def of(cls, e: AuditEvent) -> "AuditEventOut":
        return cls(
            id=e.id,
            actor=actor_name(e),
            actor_id=e.actor_id,
            entity=e.entity,
            entity_id=e.entity_id,
            action=e.action,
            data=e.data,
            created_at=e.created_at,
        )


@router.get("")
async def list_events(
    viewer: InternalUser,
    db: Db,
    entity: Annotated[str | None, Query(max_length=64)] = None,
    entity_id: Annotated[str | None, Query(alias="entityId", max_length=200)] = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    before: Annotated[uuid.UUID | None, Query(description="id of the last entry of the previous page")] = None,
) -> list[AuditEventOut]:
    """Newest first. Entries of one transaction share created_at, so the id breaks ties."""
    query = select(AuditEvent).where(AuditEvent.workspace_id == viewer.workspace_id)
    if entity is not None:
        query = query.where(AuditEvent.entity == entity)
    if entity_id is not None:
        query = query.where(AuditEvent.entity_id == entity_id)
    if before is not None:
        cursor = await db.scalar(
            select(AuditEvent).where(AuditEvent.id == before, AuditEvent.workspace_id == viewer.workspace_id)
        )
        if cursor is None:
            raise bad_request("Unknown cursor")
        query = query.where(tuple_(AuditEvent.created_at, AuditEvent.id) < (cursor.created_at, cursor.id))
    rows = await db.scalars(
        query.options(selectinload(AuditEvent.actor))
        .order_by(AuditEvent.created_at.desc(), AuditEvent.id.desc())
        .limit(limit)
    )
    return [AuditEventOut.of(e) for e in rows]
