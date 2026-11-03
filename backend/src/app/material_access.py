"""Who may see and change materials and issues (PRD section 4). Shared by materials.py and issues.py."""

import uuid
from datetime import UTC, datetime
from typing import Annotated

from fastapi import Depends, HTTPException, status
from sqlalchemy import ColumnElement, false, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import SignedIn, require_role
from app.db import get_db
from app.models import ReviewerGroup, Role, User, group_memberships
from app.models.materials import Material

Db = Annotated[AsyncSession, Depends(get_db)]
Reviewer = Annotated[User, Depends(require_role(Role.REVIEWER))]


def now() -> datetime:
    return datetime.now(UTC)


def can_submit(user: User) -> bool:
    """Submitters and higher, and affiliates for their own company (PRD section 4). Viewers only read."""
    return user.role is Role.AFFILIATE or user.role.at_least(Role.SUBMITTER)


async def submitter(user: SignedIn) -> User:
    if not can_submit(user):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Your role cannot do this")
    return user


Submitter = Annotated[User, Depends(submitter)]


def visible(viewer: User) -> list[ColumnElement[bool]]:
    """WHERE clauses for the materials that the viewer may see: their workspace, and for an
    affiliate only the materials of their own company (PRD R4)."""
    clauses: list[ColumnElement[bool]] = [Material.workspace_id == viewer.workspace_id]
    if viewer.role is Role.AFFILIATE:
        # An affiliate with no company sees nothing (never "affiliate_id IS NULL", which is internal content).
        clauses.append(Material.affiliate_id == viewer.affiliate_id if viewer.affiliate_id else false())
    return clauses


async def check_visible(db: AsyncSession, viewer: User, material_id: uuid.UUID) -> None:
    """404 when the material is in another workspace or belongs to another affiliate, as if it did not exist."""
    if not await db.scalar(select(Material.id).where(Material.id == material_id, *visible(viewer))):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Material not found")


async def group_names_of(db: AsyncSession, user: User) -> dict[uuid.UUID, str]:
    """The reviewer groups the user is in, by id (PRD F6). Read from the database, not from the browser."""
    rows = await db.execute(
        select(ReviewerGroup.id, ReviewerGroup.name)
        .join(group_memberships, group_memberships.c.group_id == ReviewerGroup.id)
        .where(group_memberships.c.user_id == user.id, ReviewerGroup.workspace_id == user.workspace_id)
        .order_by(ReviewerGroup.name)
    )
    return {gid: name for gid, name in rows.all()}
