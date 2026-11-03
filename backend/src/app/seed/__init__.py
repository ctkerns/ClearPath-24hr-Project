"""Creates the demo workspace and all its data (PRD A1, A6, F1).

    python -m app.seed           # create the demo data if it does not exist yet; else do nothing
    python -m app.seed --reset   # delete the demo workspace and create it again

The CLI also adds about a year of past reviews for the metrics page (seed/history.py). The tests leave it out.

The demo users are normal users with Argon2 password hashes, so they sign in through the real sign-in.
Only the demo workspace changes. The real workspace is never touched.

One module per area, each with `create(ctx)` and `delete_all(db, workspace)`. AREAS runs `create` in order
(an area can use the rows of the areas before it) and `delete_all` in the opposite order.
A new area adds its module to AREAS and its JSON files to seed/data.
"""

from types import ModuleType

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import SessionLocal
from app.models import Workspace
from app.seed import audit, core, library, materials, routing_integrations
from app.seed import history
from app.seed.context import DEMO_PASSWORD, DEMO_WORKSPACE_NAME, SeedContext

__all__ = ["AREAS", "DEMO_PASSWORD", "DEMO_WORKSPACE_NAME", "create_demo", "delete_demo", "seed"]

AREAS: list[ModuleType] = [
    core,
    library,
    routing_integrations,
    materials,
    history,
    audit,  # last, so its rows go first on a reset
]


async def demo_workspace(db: AsyncSession) -> Workspace | None:
    return await db.scalar(select(Workspace).where(Workspace.is_demo))


async def delete_demo(db: AsyncSession) -> None:
    """Deletes the demo workspace and everything in it."""
    workspace = await demo_workspace(db)
    if workspace is None:
        return
    for area in reversed(AREAS):
        await area.delete_all(db, workspace)
        await db.flush()


async def create_demo(db: AsyncSession, history: bool = False) -> int:
    """Returns the number of users, for the message. `history` adds about a year of past reviews."""
    ctx = SeedContext(db=db, history=history)
    for area in AREAS:
        await area.create(ctx)
        await db.flush()
    return len(ctx.users)


async def seed(reset: bool, history: bool = False) -> str:
    async with SessionLocal() as db, db.begin():  # one transaction: all of it or nothing
        if await demo_workspace(db) is not None:
            if not reset:
                return "Demo workspace exists. Nothing changed (use --reset to create it again)."
            await delete_demo(db)
        count = await create_demo(db, history)
    return f"Created the demo workspace with {count} users."
