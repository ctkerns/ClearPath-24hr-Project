"""Database tables (PRD section 9). Alembic compares these classes to the database to write migrations.

One module per area: `core` has the tables every area uses (workspaces, users, sessions, groups).
A new area adds its own module here, for example `library.py`, and imports from `app.models.base`
and `app.models.core`. This package imports every module in it, so Alembic and the tests see all tables
without a change to this file.
"""

import importlib
import pkgutil

from app.models.base import Base, now_default, str_enum, uuid_pk
from app.models.core import (
    ROLE_ORDER,
    Affiliate,
    ReviewerGroup,
    Role,
    Session,
    User,
    UserStatus,
    Workspace,
    group_memberships,
)

for _module in pkgutil.iter_modules(__path__):
    importlib.import_module(f"{__name__}.{_module.name}")

__all__ = [
    "ROLE_ORDER",
    "Affiliate",
    "Base",
    "ReviewerGroup",
    "Role",
    "Session",
    "User",
    "UserStatus",
    "Workspace",
    "group_memberships",
    "now_default",
    "str_enum",
    "uuid_pk",
]
