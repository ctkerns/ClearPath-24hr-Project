"""Creates the demo workspace and its users (PRD A1, A6, F1).

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

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import SessionLocal, engine
from app.models import Role, User, UserStatus, Workspace
from app.security import hash_password

# Public on purpose: the sign-in page shows it in the "Try the demo" panel (PRD F1).
DEMO_PASSWORD = "clearpath-demo"
DEMO_WORKSPACE_NAME = "ClearPath demo"
USERS_FILE = Path(__file__).parent / "seed_data" / "users.json"


async def demo_workspace(db: AsyncSession) -> Workspace | None:
    return await db.scalar(select(Workspace).where(Workspace.is_demo))


async def delete_demo(db: AsyncSession) -> None:
    """Deletes the demo workspace and everything in it. Sessions go with their users (ON DELETE CASCADE)."""
    workspace = await demo_workspace(db)
    if workspace is None:
        return
    await db.execute(delete(User).where(User.workspace_id == workspace.id))
    await db.delete(workspace)


async def create_demo(db: AsyncSession) -> int:
    workspace = Workspace(name=DEMO_WORKSPACE_NAME, is_demo=True)
    db.add(workspace)
    await db.flush()  # gets the workspace id from Postgres

    rows = json.loads(USERS_FILE.read_text())["users"]
    for row in rows:
        status = UserStatus(row["status"])
        last_active = row.get("lastActiveAt")
        db.add(
            User(
                id=uuid.UUID(row["id"]),  # fixed IDs, so the frontend demo data refers to the same people
                workspace_id=workspace.id,
                email=row["email"].lower(),
                name=row["name"],
                title=row.get("title"),
                role=Role(row["role"]),
                status=status,
                # An invited user has not chosen a password yet, so they cannot sign in.
                password_hash=None if status is UserStatus.INVITED else hash_password(DEMO_PASSWORD),
                last_active_at=datetime.fromisoformat(last_active) if last_active else None,
                seeded=True,
            )
        )
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
