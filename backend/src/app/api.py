"""Shared parts of every API endpoint: the JSON style and the role checks."""

from collections.abc import Callable, Coroutine
from typing import Annotated, Any

from fastapi import Depends, HTTPException, status

from app.auth import current_user
from app.models import Role, User
from app.schemas import APIModel

__all__ = ["APIModel", "Admin", "InternalUser", "Manager", "SignedIn", "bad_request", "conflict", "not_found", "require_role"]


def require_role(minimum: Role) -> Callable[..., Coroutine[Any, Any, User]]:
    """Dependency: the signed-in user, when their role has at least the rights of `minimum` (PRD section 4).
    Otherwise 403. Use it on every endpoint, so the server, not the browser, decides what each role can do."""

    async def check(user: Annotated[User, Depends(current_user)]) -> User:
        if not user.role.at_least(minimum):
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Your role cannot do this")
        return user

    return check


# The usual checks, as types for endpoint parameters
SignedIn = Annotated[User, Depends(current_user)]  # any role, affiliates too
InternalUser = Annotated[User, Depends(require_role(Role.VIEWER))]  # any role except affiliate
Manager = Annotated[User, Depends(require_role(Role.MANAGER))]
Admin = Annotated[User, Depends(require_role(Role.ADMIN))]


def not_found(what: str = "Not found") -> HTTPException:
    return HTTPException(status.HTTP_404_NOT_FOUND, what)


def conflict(detail: str) -> HTTPException:
    return HTTPException(status.HTTP_409_CONFLICT, detail)


def bad_request(detail: str) -> HTTPException:
    return HTTPException(status.HTTP_400_BAD_REQUEST, detail)
