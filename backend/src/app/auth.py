"""Sign-in, sign-out, and the current user (PRD F1).

The browser gets a random token in an httpOnly cookie. The sessions table stores only the SHA-256 hash
of the token. Each protected request uses the `current_user` dependency, which finds the session
by that hash and rejects it when it is missing or expired.
"""

import hashlib
import secrets
import uuid
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Cookie, Depends, HTTPException, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload

from app.config import settings
from app.db import get_db
from app.models import Role, Session, User, UserStatus
from app.security import hash_password, needs_rehash, verify_password

COOKIE_NAME = "clearpath_session"

# Sign-in checks the password against this hash when the email is unknown,
# so the response time does not show which emails exist.
_DUMMY_HASH = hash_password(secrets.token_urlsafe(16))

router = APIRouter(prefix="/api/auth", tags=["auth"])


class SignInRequest(BaseModel):
    email: str = Field(max_length=320)
    password: str = Field(max_length=1024)  # a limit, so nobody can send a huge password to hash


class CurrentUser(BaseModel):
    id: uuid.UUID
    email: str
    name: str
    title: str | None
    role: Role
    workspace_id: uuid.UUID
    is_demo: bool  # true in the demo workspace (PRD A1)

    @classmethod
    def of(cls, user: User) -> "CurrentUser":
        return cls(
            id=user.id,
            email=user.email,
            name=user.name,
            title=user.title,
            role=user.role,
            workspace_id=user.workspace_id,
            is_demo=user.workspace.is_demo,
        )


def _hash_token(token: str) -> bytes:
    return hashlib.sha256(token.encode()).digest()


def _set_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        COOKIE_NAME,
        token,
        max_age=int(settings.session_lifetime.total_seconds()),
        httponly=True,  # JavaScript cannot read it, so an XSS bug cannot steal the session
        secure=settings.cookie_secure,
        samesite="lax",  # other sites cannot send it with their POST requests
        path="/api",
    )


INVALID_CREDENTIALS = HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid email or password")
NOT_SIGNED_IN = HTTPException(status.HTTP_401_UNAUTHORIZED, "Not signed in")


async def current_user(
    db: Annotated[AsyncSession, Depends(get_db)],
    token: Annotated[str | None, Cookie(alias=COOKIE_NAME)] = None,
) -> User:
    """FastAPI dependency for every protected endpoint: the signed-in user, or a 401 response."""
    if not token:
        raise NOT_SIGNED_IN
    user = await db.scalar(
        select(User)
        .join(Session, Session.user_id == User.id)
        .where(Session.token_hash == _hash_token(token), Session.expires_at > func.now())
        .options(joinedload(User.workspace))
    )
    # A user who is deactivated after sign-in loses access on their next request.
    if user is None or user.status is not UserStatus.ACTIVE:
        raise NOT_SIGNED_IN
    return user


@router.post("/sign-in")
async def sign_in(
    body: SignInRequest, response: Response, db: Annotated[AsyncSession, Depends(get_db)]
) -> CurrentUser:
    """Checks the email and password, then starts a session. Every failure returns the same 401."""
    user = await db.scalar(
        select(User).where(func.lower(User.email) == body.email.strip().lower()).options(joinedload(User.workspace))
    )
    password_ok = verify_password(user.password_hash if user and user.password_hash else _DUMMY_HASH, body.password)
    if user is None or user.password_hash is None or not password_ok or user.status is not UserStatus.ACTIVE:
        raise INVALID_CREDENTIALS

    if needs_rehash(user.password_hash):
        user.password_hash = hash_password(body.password)
    user.last_active_at = datetime.now(UTC)

    # Remove this user's expired sessions, so the table does not grow without limit.
    await db.execute(delete(Session).where(Session.user_id == user.id, Session.expires_at <= func.now()))

    token = secrets.token_urlsafe(32)  # 256 random bits
    db.add(Session(user_id=user.id, token_hash=_hash_token(token), expires_at=datetime.now(UTC) + settings.session_lifetime))
    await db.commit()

    _set_cookie(response, token)
    return CurrentUser.of(user)


@router.post("/sign-out", status_code=status.HTTP_204_NO_CONTENT)
async def sign_out(
    response: Response,
    db: Annotated[AsyncSession, Depends(get_db)],
    token: Annotated[str | None, Cookie(alias=COOKIE_NAME)] = None,
) -> None:
    """Ends the session on the server, so the token stops working even if someone copied it. Always succeeds."""
    if token:
        await db.execute(delete(Session).where(Session.token_hash == _hash_token(token)))
        await db.commit()
    response.delete_cookie(COOKIE_NAME, path="/api", httponly=True, secure=settings.cookie_secure, samesite="lax")


@router.get("/me")
async def me(user: Annotated[User, Depends(current_user)]) -> CurrentUser:
    """The signed-in user. The frontend calls this when it starts, to know who is signed in."""
    return CurrentUser.of(user)
