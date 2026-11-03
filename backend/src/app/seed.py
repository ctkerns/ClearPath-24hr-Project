"""Creates the demo workspace: its users, reviewer groups, and affiliates (PRD A1, A6, F1).

    python -m app.seed           # create the demo data if it does not exist yet; else do nothing
    python -m app.seed --reset   # delete the demo workspace and create it again

The demo users are normal users with Argon2 password hashes, so they sign in through the real sign-in.
Only the demo workspace changes. The real workspace is never touched.
"""

import argparse
import asyncio
import json
import uuid
from datetime import datetime
from pathlib import Path

from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import SessionLocal, engine
from app.models import Affiliate, ReviewerGroup, Role, User, UserStatus, Workspace
from app.security import hash_password

# Public on purpose: the sign-in page shows it in the "Try the demo" panel (PRD F1).
DEMO_PASSWORD = "clearpath-demo"
DEMO_WORKSPACE_NAME = "ClearPath demo"
SEED_DATA = Path(__file__).parent / "seed_data"


def _load(name: str, key: str):
    return json.loads((SEED_DATA / name).read_text())[key]


def _time(value: str | None) -> datetime | None:
    return datetime.fromisoformat(value) if value else None


async def demo_workspace(db: AsyncSession) -> Workspace | None:
    return await db.scalar(select(Workspace).where(Workspace.is_demo))


async def delete_demo(db: AsyncSession) -> None:
    """Deletes the demo workspace and everything in it.
    Sessions and group memberships go with their users and groups (ON DELETE CASCADE)."""
    workspace = await demo_workspace(db)
    if workspace is None:
        return
    ws = workspace.id
    # Users and affiliates refer to each other, so break that link first.
    await db.execute(update(User).where(User.workspace_id == ws).values(affiliate_id=None))
    await db.execute(delete(Affiliate).where(Affiliate.workspace_id == ws))
    await db.execute(delete(ReviewerGroup).where(ReviewerGroup.workspace_id == ws))
    await db.execute(delete(User).where(User.workspace_id == ws))
    await db.delete(workspace)


async def create_demo(db: AsyncSession) -> int:
    settings = _load("workspace.json", "workspace")
    workspace = Workspace(
        name=DEMO_WORKSPACE_NAME,
        is_demo=True,
        licensed_states=settings["licensedStates"],
        approval_days=settings["approvalDays"],
    )
    db.add(workspace)
    await db.flush()  # gets the workspace id from Postgres

    rows = _load("users.json", "users")
    users: dict[str, User] = {}  # by name, because the seed files refer to people by name
    for row in rows:
        status = UserStatus(row["status"])
        user = User(
            id=uuid.UUID(row["id"]),  # fixed IDs, so the frontend demo data refers to the same people
            workspace_id=workspace.id,
            email=row["email"].lower(),
            name=row["name"],
            title=row.get("title"),
            role=Role(row["role"]),
            status=status,
            # An invited user has not chosen a password yet, so they cannot sign in.
            password_hash=None if status is UserStatus.INVITED else hash_password(DEMO_PASSWORD),
            last_active_at=_time(row.get("lastActiveAt")),
            invited_at=_time(row.get("invitedAt")),
            seeded=True,
        )
        users[user.name] = user
        db.add(user)
    await db.flush()

    groups: dict[str, ReviewerGroup] = {}
    for g in _load("reviewer-groups.json", "groups"):
        group = ReviewerGroup(
            id=uuid.UUID(g["id"]),
            workspace_id=workspace.id,
            name=g["name"],
            description=g["description"],
            target_business_days=g["targetBusinessDays"],
            is_default=g["isDefault"],
            created_at=_time(g["createdAt"]),
            created_by_id=users[g["createdBy"]].id,
            updated_at=_time(g["updatedAt"]),
            updated_by_id=users[g["updatedBy"]].id,
            seeded=True,
            members=[],
        )
        groups[group.name] = group
        db.add(group)

    affiliates: dict[str, Affiliate] = {}
    for row in rows:
        user = users[row["name"]]
        for name in row.get("groups", []):
            groups[name].members.append(user)
        if row.get("invitedBy"):
            user.invited_by_id = users[row["invitedBy"]].id
        if company := row.get("affiliate"):
            if company not in affiliates:
                affiliates[company] = Affiliate(
                    workspace_id=workspace.id,
                    name=company,
                    manager_id=users[row["affiliateManager"]].id,
                    seeded=True,
                )
                db.add(affiliates[company])
                await db.flush()
            user.affiliate_id = affiliates[company].id
    await db.flush()
    return len(rows)


async def seed(reset: bool) -> str:
    async with SessionLocal() as db, db.begin():  # one transaction: all of it or nothing
        if await demo_workspace(db) is not None:
            if not reset:
                return "Demo workspace exists. Nothing changed (use --reset to create it again)."
            await delete_demo(db)
            await db.flush()
        count = await create_demo(db)
    return f"Created the demo workspace with {count} users."


async def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--reset", action="store_true", help="delete the demo workspace and create it again")
    args = parser.parse_args()
    try:
        print(await seed(args.reset))
    finally:
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
