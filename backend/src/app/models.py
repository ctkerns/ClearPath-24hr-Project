"""Database tables (PRD section 9). Alembic compares these classes to the database to write migrations."""

import enum
import uuid
from datetime import datetime

from sqlalchemy import DateTime, Enum, ForeignKey, Index, LargeBinary, MetaData, String, func, text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

# Fixed names for indexes and constraints, so Alembic can find and change them in later migrations.
NAMING_CONVENTION = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=NAMING_CONVENTION)
    # Every datetime column is "timestamptz" (UTC in the database), never a time with no time zone.
    type_annotation_map = {datetime: DateTime(timezone=True)}


def uuid_pk() -> Mapped[uuid.UUID]:
    """UUIDv7 primary key, made by Postgres 18. UUIDv7 sorts by creation time, so indexes stay compact."""
    return mapped_column(primary_key=True, server_default=text("uuidv7()"))


def created_at() -> Mapped[datetime]:
    return mapped_column(server_default=func.now())


def str_enum(cls: type[enum.Enum], name: str) -> Enum:
    """Stores the enum value as text with a CHECK constraint. Easier to change later than a Postgres enum type."""
    return Enum(
        cls,
        name=name,
        native_enum=False,
        create_constraint=True,
        length=32,
        values_callable=lambda e: [m.value for m in e],
    )


class Role(enum.StrEnum):
    """PRD section 4. Internal roles form a hierarchy in this order; affiliate is outside it."""

    VIEWER = "viewer"
    SUBMITTER = "submitter"
    REVIEWER = "reviewer"
    MANAGER = "manager"
    ADMIN = "admin"
    AFFILIATE = "affiliate"


class UserStatus(enum.StrEnum):
    INVITED = "invited"  # F16: has no password yet, cannot sign in
    ACTIVE = "active"
    DEACTIVATED = "deactivated"  # cannot sign in; kept for the audit trail


class Workspace(Base):
    """One real workspace and one demo workspace (PRD A1). Every other table refers to one."""

    __tablename__ = "workspaces"

    id: Mapped[uuid.UUID] = uuid_pk()
    name: Mapped[str] = mapped_column(String(200))
    is_demo: Mapped[bool] = mapped_column(server_default=text("false"))
    created_at: Mapped[datetime] = created_at()


class User(Base):
    __tablename__ = "users"
    __table_args__ = (
        # Sign-in uses only the email, so an email is unique in all workspaces, not only in one.
        # The app stores emails in lower case; the index also blocks duplicates that differ only in case.
        Index("uq_users_email_lower", func.lower(text("email")), unique=True),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id"), index=True)
    email: Mapped[str] = mapped_column(String(320))
    name: Mapped[str] = mapped_column(String(200))
    title: Mapped[str | None] = mapped_column(String(200))
    # Argon2 hash. Null for an invited user who has not set a password yet.
    password_hash: Mapped[str | None] = mapped_column(String(255))
    role: Mapped[Role] = mapped_column(str_enum(Role, "role"))
    status: Mapped[UserStatus] = mapped_column(
        str_enum(UserStatus, "status"), server_default=UserStatus.ACTIVE.value
    )
    seeded: Mapped[bool] = mapped_column(server_default=text("false"))  # PRD A6
    created_at: Mapped[datetime] = created_at()
    last_active_at: Mapped[datetime | None]

    workspace: Mapped[Workspace] = relationship()


class Session(Base):
    """A signed-in browser. The cookie holds a random token; this table holds only its SHA-256 hash,
    so a copy of the database does not let anyone sign in as a user."""

    __tablename__ = "sessions"

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    token_hash: Mapped[bytes] = mapped_column(LargeBinary(32), unique=True)
    created_at: Mapped[datetime] = created_at()
    expires_at: Mapped[datetime] = mapped_column(index=True)  # index: fast cleanup of expired sessions

    user: Mapped[User] = relationship()
