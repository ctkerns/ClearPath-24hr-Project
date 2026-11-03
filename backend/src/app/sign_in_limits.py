"""Limits on failed sign-ins, against password guessing (PRD F1).

Each failed sign-in adds a row with the email and the client IP. When an email or an IP has too many
failures in the window (settings), sign-in returns 429 without checking the password, also for a correct one,
until the oldest failures are older than the window. The rows are in Postgres, so a restart does not reset them.
"""

from fastapi import HTTPException, Request, status
from sqlalchemy import delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.auth import SignInAttempt

TOO_MANY_FAILURES = HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Too many failed sign-ins. Try again later.")


def client_ip(request: Request) -> str:
    # Behind Caddy, uvicorn takes the client address from X-Forwarded-For (FORWARDED_ALLOW_IPS in the Dockerfile).
    return request.client.host if request.client else "unknown"


def _window_start():
    return func.now() - settings.sign_in_window


async def check(db: AsyncSession, email: str, ip: str) -> None:
    """Raises 429 when this email or this IP has too many recent failures. Unknown emails count the same as known ones."""
    by_email, by_ip = (
        await db.execute(
            select(
                func.count().filter(SignInAttempt.email == email),
                func.count().filter(SignInAttempt.ip == ip),
            ).where(SignInAttempt.created_at > _window_start(), or_(SignInAttempt.email == email, SignInAttempt.ip == ip))
        )
    ).one()
    if by_email >= settings.sign_in_max_failures_per_email or by_ip >= settings.sign_in_max_failures_per_ip:
        raise TOO_MANY_FAILURES


async def record_failure(db: AsyncSession, email: str, ip: str) -> None:
    db.add(SignInAttempt(email=email[:320], ip=ip[:45]))
    # Remove rows that no longer count, so the table stays small.
    await db.execute(delete(SignInAttempt).where(SignInAttempt.created_at <= _window_start()))
    await db.commit()


async def clear(db: AsyncSession, email: str) -> None:
    """After a correct sign-in, earlier failures of this email no longer count. The caller commits."""
    await db.execute(delete(SignInAttempt).where(SignInAttempt.email == email))
