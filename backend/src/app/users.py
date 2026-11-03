"""Workspace users: the list, roles, reviewer groups, invites, and deactivation (PRD section 4, F16, screen 9).

Every signed-in internal user can read the list (pickers and group pages need it). Only Admins change it.
"""

import uuid
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, status
from pydantic import EmailStr, Field
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app import invites
from app.api import Admin, APIModel, InternalUser, bad_request, conflict, not_found
from app.audit import record
from app.db import get_db
from app.models import Affiliate, ReviewerGroup, Role, Session, User, UserStatus

router = APIRouter(prefix="/api/users", tags=["users"])
Db = Annotated[AsyncSession, Depends(get_db)]


class WorkspaceUser(APIModel):
    id: uuid.UUID
    name: str
    email: str
    role: Role
    groups: list[str]
    title: str
    status: UserStatus
    last_active_at: datetime | None = None
    invited_at: datetime | None = None
    invited_by: str | None = None  # name
    affiliate: str | None = None  # company name, affiliates only
    affiliate_manager: str | None = None  # name, affiliates only

    @classmethod
    def of(cls, u: User) -> "WorkspaceUser":
        return cls(
            id=u.id,
            name=u.name,
            email=u.email,
            role=u.role,
            groups=[g.name for g in u.groups],
            title=u.title or "",
            status=u.status,
            last_active_at=u.last_active_at,
            invited_at=u.invited_at,
            invited_by=u.invited_by.name if u.invited_by else None,
            affiliate=u.affiliate.name if u.affiliate else None,
            affiliate_manager=u.affiliate.manager.name if u.affiliate and u.affiliate.manager else None,
        )


USER_LOAD = (
    selectinload(User.groups),
    selectinload(User.invited_by),
    selectinload(User.affiliate).selectinload(Affiliate.manager),
)


def uses_groups(role: Role) -> bool:
    """Only Reviewers and higher approve, so only they can be in reviewer groups (PRD F6)."""
    return role.at_least(Role.REVIEWER)


async def load_users(db: AsyncSession, workspace_id: uuid.UUID) -> list[User]:
    return list(
        await db.scalars(select(User).where(User.workspace_id == workspace_id).options(*USER_LOAD).order_by(User.name))
    )


async def load_user(db: AsyncSession, viewer: User, user_id: uuid.UUID) -> User:
    """A user in the viewer's workspace. A user of another workspace gives 404, as if it did not exist."""
    user = await db.scalar(
        select(User)
        .where(User.id == user_id, User.workspace_id == viewer.workspace_id)
        .options(*USER_LOAD)
        # Read the row and its relationships again, also when this session already has the object.
        .execution_options(populate_existing=True)
    )
    if user is None:
        raise not_found("User not found")
    return user


async def groups_by_name(db: AsyncSession, workspace_id: uuid.UUID, names: list[str]) -> list[ReviewerGroup]:
    wanted = {n.strip().lower() for n in names}
    found = list(
        await db.scalars(
            select(ReviewerGroup).where(
                ReviewerGroup.workspace_id == workspace_id, func.lower(ReviewerGroup.name).in_(wanted)
            )
        )
    )
    if len(found) != len(wanted):
        raise bad_request("Unknown reviewer group")
    return found


async def reload(db: AsyncSession, viewer: User, user_id: uuid.UUID) -> WorkspaceUser:
    await db.commit()
    return WorkspaceUser.of(await load_user(db, viewer, user_id))


@router.get("")
async def list_users(viewer: InternalUser, db: Db) -> list[WorkspaceUser]:
    return [WorkspaceUser.of(u) for u in await load_users(db, viewer.workspace_id)]


class UserChange(APIModel):
    """Send only what changes."""

    role: Role | None = None
    status: UserStatus | None = None  # active or deactivated


@router.patch("/{user_id}")
async def change_user(user_id: uuid.UUID, body: UserChange, viewer: Admin, db: Db) -> WorkspaceUser:
    user = await load_user(db, viewer, user_id)
    if user.id == viewer.id:
        # So the workspace cannot lose its last Admin by accident.
        raise bad_request("You cannot change your own role or status")

    if body.role is not None and body.role != user.role:
        if Role.AFFILIATE in (body.role, user.role):
            raise bad_request("An affiliate cannot become an internal user, or the opposite. Invite them again.")
        record(db, viewer, "user", user.id, "role_changed", {"before": user.role, "after": body.role})
        user.role = body.role
        if not uses_groups(body.role):
            user.groups.clear()  # below Reviewer, groups no longer apply

    if body.status is not None and body.status != user.status:
        if user.status is UserStatus.INVITED or body.status is UserStatus.INVITED:
            raise bad_request("Cancel or resend an invite instead")
        record(db, viewer, "user", user.id, "deactivated" if body.status is UserStatus.DEACTIVATED else "reactivated")
        user.status = body.status
        if body.status is UserStatus.DEACTIVATED:
            # Sign them out everywhere at once. Their materials, decisions, and history stay.
            await db.execute(delete(Session).where(Session.user_id == user.id))

    return await reload(db, viewer, user.id)


class GroupsChange(APIModel):
    groups: list[str] = Field(max_length=50)  # group names


@router.put("/{user_id}/groups")
async def set_groups(user_id: uuid.UUID, body: GroupsChange, viewer: Admin, db: Db) -> WorkspaceUser:
    user = await load_user(db, viewer, user_id)
    if body.groups and not uses_groups(user.role):
        raise bad_request("Only Reviewers and higher roles can be in reviewer groups")
    before = [g.name for g in user.groups]
    user.groups = await groups_by_name(db, viewer.workspace_id, body.groups) if body.groups else []
    record(db, viewer, "user", user.id, "groups_changed", {"before": before, "after": sorted(g.name for g in user.groups)})
    return await reload(db, viewer, user.id)


class Invite(APIModel):
    emails: list[EmailStr] = Field(min_length=1, max_length=50)
    role: Role
    groups: list[str] = []
    affiliate: str | None = Field(default=None, max_length=200)  # company name, for role affiliate
    affiliate_manager_id: uuid.UUID | None = None  # internal user, for role affiliate


def name_from_email(email: str) -> str:
    """A first guess at the name, like the invite dialog shows. The person can change it later."""
    local = email.split("@")[0]
    return " ".join(part.capitalize() for part in local.replace("_", ".").replace("-", ".").split(".") if part)


@router.post("/invites", status_code=status.HTTP_201_CREATED)
async def invite(body: Invite, viewer: Admin, db: Db) -> list[WorkspaceUser]:
    """Adds invited users and emails each one a link to set a password (F16). Until then they cannot sign in."""
    emails = sorted({e.lower() for e in body.emails})
    taken = list(await db.scalars(select(User.email).where(func.lower(User.email).in_(emails))))
    if taken:
        raise conflict(f"Already a user: {', '.join(taken)}")

    affiliate = None
    if body.role is Role.AFFILIATE:
        if not body.affiliate or not body.affiliate.strip() or body.affiliate_manager_id is None:
            raise bad_request("An affiliate needs a company and an affiliate manager")
        manager = await load_user(db, viewer, body.affiliate_manager_id)
        if manager.status is not UserStatus.ACTIVE or not manager.role.at_least(Role.SUBMITTER):
            raise bad_request("The affiliate manager must be an active internal user who can submit")
        company = body.affiliate.strip()
        affiliate = await db.scalar(
            select(Affiliate).where(
                Affiliate.workspace_id == viewer.workspace_id, func.lower(Affiliate.name) == company.lower()
            )
        )
        if affiliate is None:
            affiliate = Affiliate(workspace_id=viewer.workspace_id, name=company, manager_id=manager.id)
            db.add(affiliate)
            await db.flush()

    groups = await groups_by_name(db, viewer.workspace_id, body.groups) if body.groups and uses_groups(body.role) else []
    now = datetime.now(UTC)
    added = [
        User(
            workspace_id=viewer.workspace_id,
            email=email,
            name=name_from_email(email),
            role=body.role,
            status=UserStatus.INVITED,
            invited_at=now,
            invited_by_id=viewer.id,
            affiliate_id=affiliate.id if affiliate else None,
            groups=list(groups),
        )
        for email in emails
    ]
    db.add_all(added)
    await db.flush()
    tokens = [await invites.new_token(db, u) for u in added]
    ids = [u.id for u in added]
    for u in added:
        data = {"email": u.email, "role": u.role, "groups": [g.name for g in groups]}
        record(db, viewer, "user", u.id, "invited", data | ({"affiliate": affiliate.name} if affiliate else {}))
    await db.commit()
    for user, token in zip(added, tokens, strict=True):
        await invites.send_invite(db, user.email, viewer, token)
    return [WorkspaceUser.of(await load_user(db, viewer, i)) for i in ids]


@router.post("/{user_id}/resend-invite")
async def resend_invite(user_id: uuid.UUID, viewer: Admin, db: Db) -> WorkspaceUser:
    user = await load_user(db, viewer, user_id)
    if user.status is not UserStatus.INVITED:
        raise bad_request("This user is not invited")
    user.invited_at = datetime.now(UTC)
    user.invited_by_id = viewer.id
    record(db, viewer, "user", user.id, "invite_resent")
    token = await invites.new_token(db, user)  # the old link stops working
    await db.commit()
    await invites.send_invite(db, user.email, viewer, token)
    return await reload(db, viewer, user.id)


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def cancel_invite(user_id: uuid.UUID, viewer: Admin, db: Db) -> None:
    """Only an invite that nobody accepted can be removed: it has no history. Deactivate everyone else.
    The invite link goes with the user (ON DELETE CASCADE)."""
    user = await load_user(db, viewer, user_id)
    if user.status is not UserStatus.INVITED:
        raise bad_request("Only an invited user can be removed. Deactivate this user instead.")
    record(db, viewer, "user", user.id, "invite_cancelled", {"email": user.email})
    await db.delete(user)
    await db.commit()
