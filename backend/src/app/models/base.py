"""The base class and column helpers that every table module uses."""

import enum
import uuid
from datetime import datetime

from sqlalchemy import DateTime, Enum, MetaData, func, text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

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


def now_default() -> Mapped[datetime]:
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
