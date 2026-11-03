"""Seeds the demo notifications (PRD F13), one row for each recipient in notifications.json.

The demo accounts get the ones that match their role: the Reviewer an assignment, the Manager a new issue,
the Submitter a comment and a decision on their own material. The row IDs come from the file's id and
the recipient, so they stay the same after a reset.
"""

import uuid

from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Workspace
from app.models.notifications import Notification, NotificationType
from app.seed.context import SeedContext, load, parse_time

ID_NAMESPACE = uuid.UUID("01a1a000-0000-7000-8000-000000000f13")


async def create(ctx: SeedContext) -> None:
    for row in load("notifications.json", "notifications"):
        actor = ctx.users.get(row["actor"]) if row.get("actor") else None
        created = parse_time(row["createdAt"])
        for name in row["recipients"]:
            ctx.db.add(
                Notification(
                    id=uuid.uuid5(ID_NAMESPACE, f"{row['id']}:{name}"),
                    workspace_id=ctx.workspace.id,
                    user_id=ctx.users[name].id,
                    type=NotificationType(row["type"]),
                    actor_id=actor.id if actor else None,
                    actor_name=row.get("actor"),
                    material_id=uuid.UUID(row["materialId"]) if row.get("materialId") else None,
                    issue_id=uuid.UUID(row["issueId"]) if row.get("issueId") else None,
                    group_name=row.get("group"),
                    summary=row.get("summary"),
                    material_title=row["material"],
                    seeded=True,
                    created_at=created,
                    read_at=created if row["read"] else None,
                )
            )


async def delete_all(db: AsyncSession, workspace: Workspace) -> None:
    await db.execute(delete(Notification).where(Notification.workspace_id == workspace.id))
