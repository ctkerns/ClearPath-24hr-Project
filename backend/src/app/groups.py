"""Reviewer groups and their members (PRD section 4, F5, F6, screen 9).

Every signed-in internal user can read them. Only Managers and higher change them (PRD R3).
"""

import uuid
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, status
from pydantic import Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api import APIModel, InternalUser, Manager, bad_request, conflict, not_found
from app.audit import changes, record
from app.db import get_db
from app.models import ReviewerGroup, User, UserStatus
from app.users import WorkspaceUser, load_user, uses_groups

router = APIRouter(prefix="/api/reviewer-groups", tags=["reviewer groups"])
Db = Annotated[AsyncSession, Depends(get_db)]


class GroupOut(APIModel):
    id: uuid.UUID
    name: str
    description: str
    target_business_days: int
    is_default: bool
    created_by: str | None
    created_at: datetime
    updated_by: str | None
    updated_at: datetime

    @classmethod
    def of(cls, g: ReviewerGroup) -> "GroupOut":
        return cls(
            id=g.id,
            name=g.name,
            description=g.description,
            target_business_days=g.target_business_days,
            is_default=g.is_default,
            created_by=g.created_by.name if g.created_by else None,
            created_at=g.created_at,
            updated_by=g.updated_by.name if g.updated_by else None,
            updated_at=g.updated_at,
        )


GROUP_LOAD = (selectinload(ReviewerGroup.created_by), selectinload(ReviewerGroup.updated_by))


async def load_group(db: AsyncSession, viewer: User, group_id: uuid.UUID) -> ReviewerGroup:
    group = await db.scalar(
        select(ReviewerGroup)
        .where(ReviewerGroup.id == group_id, ReviewerGroup.workspace_id == viewer.workspace_id)
        .options(*GROUP_LOAD, selectinload(ReviewerGroup.members))
        .execution_options(populate_existing=True)  # fresh members after a change
    )
    if group is None:
        raise not_found("Reviewer group not found")
    return group


async def check_name_free(db: AsyncSession, viewer: User, name: str, except_id: uuid.UUID | None = None) -> None:
    query = select(ReviewerGroup.id).where(
        ReviewerGroup.workspace_id == viewer.workspace_id, func.lower(ReviewerGroup.name) == name.lower()
    )
    if except_id:
        query = query.where(ReviewerGroup.id != except_id)
    if await db.scalar(query):
        raise conflict("Another group already uses this name")


def fields(g: ReviewerGroup) -> dict:
    """What the audit log keeps of a group."""
    return {"name": g.name, "description": g.description, "targetBusinessDays": g.target_business_days}


async def saved(db: AsyncSession, viewer: User, group_id: uuid.UUID) -> GroupOut:
    await db.commit()
    return GroupOut.of(await load_group(db, viewer, group_id))


@router.get("")
async def list_groups(viewer: InternalUser, db: Db) -> list[GroupOut]:
    groups = await db.scalars(
        select(ReviewerGroup)
        .where(ReviewerGroup.workspace_id == viewer.workspace_id)
        .options(*GROUP_LOAD)
        .order_by(ReviewerGroup.name)
    )
    return [GroupOut.of(g) for g in groups]


class GroupInput(APIModel):
    name: str = Field(min_length=1, max_length=100)
    description: str = Field(min_length=1, max_length=2000)
    target_business_days: int = Field(ge=1, le=30)


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_group(body: GroupInput, viewer: Manager, db: Db) -> GroupOut:
    name = body.name.strip()
    await check_name_free(db, viewer, name)
    group = ReviewerGroup(
        workspace_id=viewer.workspace_id,
        name=name,
        description=body.description.strip(),
        target_business_days=body.target_business_days,
        created_by_id=viewer.id,
        updated_by_id=viewer.id,
    )
    db.add(group)
    await db.flush()
    record(db, viewer, "reviewer_group", group.id, "created", fields(group))
    return await saved(db, viewer, group.id)


@router.patch("/{group_id}")
async def edit_group(group_id: uuid.UUID, body: GroupInput, viewer: Manager, db: Db) -> GroupOut:
    """Members keep their group after a rename, because membership refers to the group id, not the name.
    TODO: when routing rules and reviews exist, they refer to the id too."""
    group = await load_group(db, viewer, group_id)
    name = body.name.strip()
    await check_name_free(db, viewer, name, except_id=group.id)
    before = fields(group)
    group.name = name
    group.description = body.description.strip()
    group.target_business_days = body.target_business_days
    group.updated_by_id = viewer.id
    group.updated_at = datetime.now(UTC)
    record(db, viewer, "reviewer_group", group.id, "updated", changes(before, fields(group)))
    return await saved(db, viewer, group.id)


class MembersInput(APIModel):
    user_ids: list[uuid.UUID] = Field(min_length=1, max_length=100)


def can_join(user: User) -> bool:
    return user.status is not UserStatus.DEACTIVATED and uses_groups(user.role)


@router.post("/{group_id}/members")
async def add_members(group_id: uuid.UUID, body: MembersInput, viewer: Manager, db: Db) -> list[WorkspaceUser]:
    """Returns the group's members after the change."""
    group = await load_group(db, viewer, group_id)
    added = []
    for user_id in body.user_ids:
        user = await load_user(db, viewer, user_id)
        if not can_join(user):
            raise bad_request(f"{user.name} cannot be in a reviewer group")
        if user not in group.members:
            group.members.append(user)
            added.append(user)
    if added:
        record(db, viewer, "reviewer_group", group.id, "members_added", {"users": [{"id": u.id, "name": u.name} for u in added]})
    return await members_after(db, viewer, group.id)


@router.delete("/{group_id}/members/{user_id}")
async def remove_member(group_id: uuid.UUID, user_id: uuid.UUID, viewer: Manager, db: Db) -> list[WorkspaceUser]:
    group = await load_group(db, viewer, group_id)
    for m in group.members:
        if m.id == user_id:
            record(db, viewer, "reviewer_group", group.id, "member_removed", {"user": {"id": m.id, "name": m.name}})
    group.members = [m for m in group.members if m.id != user_id]
    return await members_after(db, viewer, group.id)


async def members_after(db: AsyncSession, viewer: User, group_id: uuid.UUID) -> list[WorkspaceUser]:
    await db.commit()
    group = await load_group(db, viewer, group_id)
    return [WorkspaceUser.of(await load_user(db, viewer, m.id)) for m in sorted(group.members, key=lambda m: m.name)]
