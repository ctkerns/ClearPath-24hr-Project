"""Tables for sign-in safety and invites: invite tokens and failed sign-ins (PRD F1, F16)."""

import uuid
from datetime import datetime

from sqlalchemy import ForeignKey, Index, LargeBinary, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, now_default, uuid_pk


class InviteToken(Base):
    """The link in an invite email (F16). Like sessions, this table holds only the SHA-256 hash of the token.
    One per invited user: a resend replaces it, accepting deletes it, and cancelling the invite deletes the user and it."""

    __tablename__ = "invite_tokens"

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), unique=True)
    token_hash: Mapped[bytes] = mapped_column(LargeBinary(32), unique=True)
    created_at: Mapped[datetime] = now_default()
    expires_at: Mapped[datetime]


class SignInAttempt(Base):
    """One failed sign-in (F1). Sign-in counts recent rows per email and per client IP to slow down password guessing.
    It never stores the password. Rows older than the window are deleted."""

    __tablename__ = "sign_in_attempts"
    __table_args__ = (
        Index("ix_sign_in_attempts_email_created_at", "email", "created_at"),
        Index("ix_sign_in_attempts_ip_created_at", "ip", "created_at"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    email: Mapped[str] = mapped_column(String(320))  # in lower case, as typed: also emails that are not users
    ip: Mapped[str] = mapped_column(String(45))  # long enough for IPv6
    created_at: Mapped[datetime] = now_default()
