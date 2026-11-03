"""The demo workspace's audit log. The demo starts with an empty log, so `create` adds nothing.

The log is append-only (PRD F12): a database trigger blocks every UPDATE and DELETE on audit_events.
The demo reset (PRD A1) is the one exception. The trigger allows a DELETE only when both are true:
- the transaction set `app.allow_audit_delete` to 'on' (SET LOCAL ends with the transaction), and
- the row belongs to a demo workspace. Rows of the real workspace can never be deleted.
This area is last in AREAS, so its `delete_all` runs first, before the users and the workspace go.
"""

from sqlalchemy import delete, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Workspace
from app.models.audit import AuditEvent
from app.seed.context import SeedContext


async def create(ctx: SeedContext) -> None:
    pass


async def delete_all(db: AsyncSession, workspace: Workspace) -> None:
    await db.execute(text("SET LOCAL app.allow_audit_delete = 'on'"))
    await db.execute(delete(AuditEvent).where(AuditEvent.workspace_id == workspace.id))
    await db.execute(text("SET LOCAL app.allow_audit_delete = 'off'"))
