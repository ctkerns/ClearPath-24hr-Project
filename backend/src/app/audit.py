"""Writes the audit log (PRD section 9 AuditEvent, F12). Every endpoint that changes data calls `record`.

`record` only adds the row to the session. The endpoint's own commit saves it with the change, in the same
transaction: a change that fails records nothing, and a change cannot happen without its entry.
The read API is in `app.audit_log` (Admin page). The History tab of a material and the activity of an issue
read their own entries with `history`, under the visibility rules of the material or issue, not of that API.
This module imports only the models, so `app.auth` can use it too.
"""

import uuid
from datetime import datetime
from typing import Any, NamedTuple

from fastapi.encoders import jsonable_encoder
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models import User
from app.models.audit import AuditEvent


class OtherActor(NamedTuple):
    """An actor that is not a user, for example a connector that syncs a version (PRD R1)."""

    workspace_id: uuid.UUID
    label: str  # for example "Meta connector", "Routing", "Monitoring"


def entry(
    viewer: User | OtherActor,
    entity: str,
    entity_id: Any,
    action: str,
    data: dict[str, Any] | None = None,
    *,
    at: datetime | None = None,
    id: uuid.UUID | None = None,
) -> AuditEvent:
    """One entry, not yet added to a session. Endpoints use `record`; only the demo seed passes `at` and `id`,
    for its past events. Without `at` the database sets the time: the start of the transaction."""
    actor_id, label = (viewer.id, None) if isinstance(viewer, User) else (None, viewer.label)
    given = {k: v for k, v in (("id", id), ("created_at", at)) if v is not None}  # else the server defaults
    return AuditEvent(
        **given,
        workspace_id=viewer.workspace_id,
        actor_id=actor_id,
        actor_label=label,
        entity=entity,
        entity_id=str(entity_id),
        action=action,
        data=jsonable_encoder(data) if data else None,
    )


def record(
    db: AsyncSession,
    viewer: User | OtherActor,
    entity: str,
    entity_id: Any,
    action: str,
    data: dict[str, Any] | None = None,
) -> None:
    """Adds one entry. `data` says what changed; UUIDs and dates become strings."""
    db.add(entry(viewer, entity, entity_id, action, data))


async def history(db: AsyncSession, workspace_id: uuid.UUID, entity: str, entity_id: Any) -> list[AuditEvent]:
    """The entries of one thing, oldest first. Entries of one transaction share created_at; the id (UUIDv7)
    keeps the order they were written in. The caller checks first that the viewer may see the thing."""
    rows = await db.scalars(
        select(AuditEvent)
        .where(AuditEvent.workspace_id == workspace_id, AuditEvent.entity == entity, AuditEvent.entity_id == str(entity_id))
        .options(selectinload(AuditEvent.actor))
        .order_by(AuditEvent.created_at, AuditEvent.id)
    )
    return list(rows)


def actor_name(e: AuditEvent) -> str:
    """The user's name, or the label of a system actor such as "Routing"."""
    return e.actor.name if e.actor else e.actor_label or "System"


def changes(before: dict[str, Any], after: dict[str, Any]) -> dict[str, Any]:
    """The fields that differ, as {field: {"before": ..., "after": ...}}. For "updated" entries."""
    return {k: {"before": before.get(k), "after": v} for k, v in after.items() if before.get(k) != v}
