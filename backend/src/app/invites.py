"""Invite links: the email an invited user gets, and accepting the invite (PRD F16).

An Admin invites someone (users.py). They get an email with a link that has a random token. Like sessions,
the database stores only the SHA-256 hash of the token. The link works for `invite_lifetime`.
A resend makes a new token, so the old link stops working. Accepting sets the password, makes the user
active, deletes the token, and signs them in. API responses never contain the token.
"""

import secrets
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload, selectinload

from app import mail
from app.auth import CurrentUser, hash_token, start_session
from app.config import settings
from app.db import get_db
from app.models import User, UserStatus, Workspace
from app.models.auth import InviteToken
from app.schemas import APIModel
from app.security import hash_password

router = APIRouter(prefix="/api/auth", tags=["auth"])
Db = Annotated[AsyncSession, Depends(get_db)]

# Only these two answers, so a wrong link tells nothing about the users.
UNKNOWN_INVITE = HTTPException(status.HTTP_404_NOT_FOUND, "Invite not found")
EXPIRED_INVITE = HTTPException(status.HTTP_410_GONE, "Invite expired")


async def new_token(db: AsyncSession, user: User) -> str:
    """A new invite token for an invited user, in place of any older one. The caller commits, then calls send_invite."""
    await db.execute(delete(InviteToken).where(InviteToken.user_id == user.id))
    token = secrets.token_urlsafe(32)  # 256 random bits
    db.add(InviteToken(user_id=user.id, token_hash=hash_token(token), expires_at=datetime.now(UTC) + settings.invite_lifetime))
    return token


async def send_invite(db: AsyncSession, to: str, inviter: User, token: str) -> None:
    """The invite email. Call it after the commit, so nobody gets a link that does not work."""
    workspace = await db.scalar(select(Workspace.name).where(Workspace.id == inviter.workspace_id))
    link = f"{settings.app_url.rstrip('/')}/accept-invite?token={token}"
    days = settings.invite_lifetime.days
    mail.send(
        to,
        f"{inviter.name} invited you to ClearPath Review",
        f"{inviter.name} invited you to the {workspace} workspace in ClearPath Review.\n\n"
        f"Open this link to choose your password and sign in:\n{link}\n\n"
        f"The link works for {days} days. If it stops working, ask {inviter.name} to send the invite again.\n",
    )


async def find_invite(db: AsyncSession, token: str, lock: bool = False) -> tuple[InviteToken, User]:
    """The token row and its invited user, or 404 (unknown, used, or cancelled) or 410 (expired)."""
    query = select(InviteToken).where(InviteToken.token_hash == hash_token(token))
    invite = await db.scalar(query.with_for_update() if lock else query)  # lock: two tabs cannot accept at once
    if invite is None:
        raise UNKNOWN_INVITE
    user = await db.scalar(
        select(User)
        .where(User.id == invite.user_id, User.status == UserStatus.INVITED)
        .options(joinedload(User.workspace), selectinload(User.groups))
    )
    if user is None:
        raise UNKNOWN_INVITE
    if invite.expires_at <= datetime.now(UTC):
        raise EXPIRED_INVITE
    return invite, user


class InviteInfo(APIModel):
    """What the accept page shows before the person chooses a password."""

    name: str
    email: str
    workspace_name: str


@router.get("/invite/{token}")
async def invite_info(token: str, db: Db) -> InviteInfo:
    _, user = await find_invite(db, token)
    return InviteInfo(name=user.name, email=user.email, workspace_name=user.workspace.name)


class AcceptInvite(BaseModel):
    token: str = Field(max_length=200)
    password: str = Field(min_length=settings.password_min_length, max_length=1024)
    name: str | None = Field(default=None, max_length=200)  # empty: keep the name from the invite


@router.post("/accept-invite")
async def accept_invite(body: AcceptInvite, response: Response, db: Db) -> CurrentUser:
    """Sets the password, makes the user active, and signs them in, like sign-in does."""
    invite, user = await find_invite(db, body.token, lock=True)
    if body.name and body.name.strip():
        user.name = body.name.strip()
    user.password_hash = hash_password(body.password)
    user.status = UserStatus.ACTIVE
    await db.delete(invite)
    await start_session(db, user, response)  # commits
    return CurrentUser.of(user)
