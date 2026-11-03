"""Writes the audit log (PRD section 9 AuditEvent, F12). Every endpoint that changes data calls `record`.

`record` only adds the row to the session. The endpoint's own commit saves it with the change, in the same
transaction: a change that fails records nothing, and a change cannot happen without its entry.
The read API is in `app.audit_log`. This module imports only the models, so `app.auth` can use it too.
"""

import uuid
from typing import Any, NamedTuple

from fastapi.encoders import jsonable_encoder
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import User
from app.models.audit import AuditEvent


class OtherActor(NamedTuple):
    """An actor that is not a user, for example a connector that syncs a version (PRD R1)."""

    workspace_id: uuid.UUID
    label: str  # for example "Meta connector"


def record(
    db: AsyncSession,
    viewer: User | OtherActor,
    entity: str,
    entity_id: Any,
    action: str,
    data: dict[str, Any] | None = None,
) -> None:
    """Adds one entry. `data` says what changed; UUIDs and dates become strings."""
    actor_id, label = (viewer.id, None) if isinstance(viewer, User) else (None, viewer.label)
    db.add(
        AuditEvent(
            workspace_id=viewer.workspace_id,
            actor_id=actor_id,
            actor_label=label,
            entity=entity,
            entity_id=str(entity_id),
            action=action,
            data=jsonable_encoder(data) if data else None,
        )
    )


def changes(before: dict[str, Any], after: dict[str, Any]) -> dict[str, Any]:
    """The fields that differ, as {field: {"before": ..., "after": ...}}. For "updated" entries."""
    return {k: {"before": before.get(k), "after": v} for k, v in after.items() if before.get(k) != v}
