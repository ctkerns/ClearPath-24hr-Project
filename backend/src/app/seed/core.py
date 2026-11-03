"""Seeds the tables every area uses: the demo workspace, its users, reviewer groups, and affiliates."""

import uuid
from functools import cache

from sqlalchemy import delete, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Affiliate, ReviewerGroup, Role, User, UserStatus, Workspace
from app.security import hash_password
from app.seed.context import (
    DEMO_PASSWORD,
    DEMO_WORKSPACE_NAME,
    SeedContext,
    load,
    parse_time,
)


@cache
def demo_password_hash() -> str:
    """One Argon2 hash for every demo user: they all share DEMO_PASSWORD, and hashing is slow on purpose.
    The cache keeps it for the life of the process, so tests and demo resets hash only once."""
    return hash_password(DEMO_PASSWORD)


async def create(ctx: SeedContext) -> None:
    db = ctx.db
    settings = load("workspace.json", "workspace")
    workspace = Workspace(
        name=DEMO_WORKSPACE_NAME,
        is_demo=True,
        licensed_states=settings["licensedStates"],
        approval_days=settings["approvalDays"],
        issue_due_days_high=settings["issueDueDays"]["high"],
        issue_due_days_medium=settings["issueDueDays"]["medium"],
        issue_due_days_low=settings["issueDueDays"]["low"],
    )
    db.add(workspace)
    await db.flush()  # gets the workspace id from Postgres
    ctx.workspace = workspace

    rows = load("users.json", "users")
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
            password_hash=None if status is UserStatus.INVITED else demo_password_hash(),
            last_active_at=parse_time(row.get("lastActiveAt")),
            invited_at=parse_time(row.get("invitedAt")),
            seeded=True,
        )
        users[user.name] = user
        db.add(user)
    await db.flush()

    groups: dict[str, ReviewerGroup] = {}
    for g in load("reviewer-groups.json", "groups"):
        group = ReviewerGroup(
            id=uuid.UUID(g["id"]),
            workspace_id=workspace.id,
            name=g["name"],
            description=g["description"],
            target_business_days=g["targetBusinessDays"],
            is_default=g["isDefault"],
            created_at=parse_time(g["createdAt"]),
            created_by_id=users[g["createdBy"]].id,
            updated_at=parse_time(g["updatedAt"]),
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
    ctx.users = users
    ctx.groups = groups
    ctx.affiliates = affiliates




async def delete_all(db: AsyncSession, workspace: Workspace) -> None:
    """Sessions and group memberships go with their users and groups (ON DELETE CASCADE)."""
    ws = workspace.id
    # Users and affiliates refer to each other, so break that link first.
    await db.execute(update(User).where(User.workspace_id == ws).values(affiliate_id=None))
    await db.execute(delete(Affiliate).where(Affiliate.workspace_id == ws))
    await db.execute(delete(ReviewerGroup).where(ReviewerGroup.workspace_id == ws))
    await db.execute(delete(User).where(User.workspace_id == ws))
    await db.delete(workspace)
