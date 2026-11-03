"""Connectors (PRD F11, section 10 "Integrations" tab): status, Verified label, last sync, accounts and default owners.

Only Admins read and change them (PRD section 4): the tab is Admin-only, and no other screen reads it.
No call goes to a real platform yet. Connect, disconnect and "Sync now" change only the stored state.
TODO: run the OAuth flow, store the token encrypted, run the sync, and write the audit log.
"""

import uuid
from datetime import UTC, datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends
from pydantic import Field
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api import Admin, APIModel, bad_request, conflict, not_found
from app.db import get_db
from app.models import Role, User, UserStatus
from app.models.integrations import (
    Integration,
    IntegrationAccount,
    IntegrationErrorCode,
    IntegrationStatus,
    Provider,
)
from app.users import load_user

router = APIRouter(prefix="/api/integrations", tags=["integrations"])
Db = Annotated[AsyncSession, Depends(get_db)]

# Connectors whose content becomes materials, so each account needs a default owner (PRD section 4).
# The same list as `ownsContent` in the frontend's integration-data.ts.
OWNS_CONTENT = {
    Provider.META,
    Provider.GOOGLE_ADS,
    Provider.MAILCHIMP,
    Provider.KLAVIYO,
    Provider.WORDPRESS,
    Provider.WEBFLOW,
    Provider.CRAWLER,
    Provider.SEED_INBOX,
}
# Tested against a real account (PRD F11 "Test access"). A new workspace starts with these labels.
VERIFIED = {
    Provider.META,
    Provider.GOOGLE_ADS,
    Provider.MAILCHIMP,
    Provider.WORDPRESS,
    Provider.CRAWLER,
    Provider.SLACK,
    Provider.EMAIL_ALERTS,
}
ORDER = list(Provider)  # the frontend's PROVIDERS order


class AccountOut(APIModel):
    id: uuid.UUID
    name: str
    detail: str
    default_owner_id: uuid.UUID | None


class ErrorOut(APIModel):
    code: IntegrationErrorCode
    at: datetime


class AvailableAccount(APIModel):
    name: str
    detail: str


class IntegrationOut(APIModel):
    id: uuid.UUID
    provider: Provider
    status: IntegrationStatus
    verified: bool
    last_sync_at: datetime | None
    error: ErrorOut | None
    accounts: list[AccountOut]
    available: list[AvailableAccount]

    @classmethod
    def of(cls, i: Integration) -> "IntegrationOut":
        return cls(
            id=i.id,
            provider=i.provider,
            status=i.status,
            verified=i.verified,
            last_sync_at=i.last_sync_at,
            error=ErrorOut(code=i.error_code, at=i.error_at) if i.error_code and i.error_at else None,
            accounts=[AccountOut.model_validate(a) for a in i.accounts],
            available=[AvailableAccount.model_validate(a) for a in i.available],
        )


async def load_all(db: AsyncSession, viewer: User) -> list[Integration]:
    rows = await db.scalars(
        select(Integration)
        .where(Integration.workspace_id == viewer.workspace_id)
        .options(selectinload(Integration.accounts))
        .execution_options(populate_existing=True)
    )
    return sorted(rows, key=lambda i: ORDER.index(i.provider))


async def load_one(db: AsyncSession, viewer: User, integration_id: uuid.UUID) -> Integration:
    integration = await db.scalar(
        select(Integration)
        .where(Integration.id == integration_id, Integration.workspace_id == viewer.workspace_id)
        .options(selectinload(Integration.accounts))
        .execution_options(populate_existing=True)
    )
    if integration is None:
        raise not_found("Connector not found")
    return integration


async def add_missing(db: AsyncSession, viewer: User) -> None:
    """Every workspace lists every connector. A workspace gets a "Not connected" row for each one it lacks.
    ON CONFLICT DO NOTHING, so two first visits at once do not fail."""
    rows: list[dict[str, Any]] = [
        {"workspace_id": viewer.workspace_id, "provider": p, "verified": p in VERIFIED} for p in Provider
    ]
    await db.execute(insert(Integration).values(rows).on_conflict_do_nothing(constraint="uq_integrations_workspace_provider"))
    await db.commit()


async def saved(db: AsyncSession, viewer: User, integration_id: uuid.UUID) -> IntegrationOut:
    await db.commit()
    return IntegrationOut.of(await load_one(db, viewer, integration_id))


@router.get("")
async def list_integrations(viewer: Admin, db: Db) -> list[IntegrationOut]:
    integrations = await load_all(db, viewer)
    if len(integrations) < len(ORDER):
        await add_missing(db, viewer)
        integrations = await load_all(db, viewer)
    return [IntegrationOut.of(i) for i in integrations]


@router.post("/{integration_id}/sync")
async def sync_now(integration_id: uuid.UUID, viewer: Admin, db: Db) -> IntegrationOut:
    """Records the sync time only. TODO: fetch drafts and live content from the platform (F10, F11)."""
    integration = await load_one(db, viewer, integration_id)
    if integration.status is not IntegrationStatus.CONNECTED:
        raise conflict("Connect this connector before you sync it")
    integration.last_sync_at = datetime.now(UTC)
    return await saved(db, viewer, integration.id)


async def check_owner(db: AsyncSession, viewer: User, owner_id: uuid.UUID) -> None:
    """A default owner uploads fixes and handles issues, so: an active internal user who can submit."""
    owner = await load_user(db, viewer, owner_id)  # 404 for a user of another workspace
    if owner.status is not UserStatus.ACTIVE or not owner.role.at_least(Role.SUBMITTER):
        raise bad_request(f"{owner.name} cannot be a default owner")


class ConnectInput(APIModel):
    account_names: list[str] = Field(min_length=1, max_length=50)
    default_owner_id: uuid.UUID | None = None


@router.post("/{integration_id}/connect")
async def connect(integration_id: uuid.UUID, body: ConnectInput, viewer: Admin, db: Db) -> IntegrationOut:
    """Connect, or reconnect after an error, with the accounts the Admin picked from the offered ones.
    Accounts that stay keep their default owner; new ones get `defaultOwnerId`.
    TODO: in a real workspace this follows the platform's OAuth sign-in. No password or key comes here."""
    integration = await load_one(db, viewer, integration_id)
    offered = {a["name"]: a for a in integration.available}
    unknown = sorted(set(body.account_names) - set(offered))
    if unknown:
        raise bad_request(f"Not an account on this platform: {', '.join(unknown)}")
    owns_content = integration.provider in OWNS_CONTENT
    if owns_content:
        if body.default_owner_id is None:
            raise bad_request("Choose a default owner")
        await check_owner(db, viewer, body.default_owner_id)

    picked = list(dict.fromkeys(body.account_names))
    keep = [a for a in integration.accounts if a.name in picked]
    kept = {a.name for a in keep}
    added = [
        IntegrationAccount(
            workspace_id=viewer.workspace_id,
            name=name,
            detail=offered[name].get("detail", ""),
            default_owner_id=body.default_owner_id if owns_content else None,
        )
        for name in picked
        if name not in kept
    ]
    integration.accounts = keep + added
    integration.status = IntegrationStatus.CONNECTED
    integration.error_code = None
    integration.error_at = None
    integration.last_sync_at = datetime.now(UTC)
    return await saved(db, viewer, integration.id)


@router.post("/{integration_id}/disconnect")
async def disconnect(integration_id: uuid.UUID, viewer: Admin, db: Db) -> IntegrationOut:
    """Stops intake and monitoring. Materials, issues and history from this connector stay.
    TODO: delete the stored token."""
    integration = await load_one(db, viewer, integration_id)
    integration.status = IntegrationStatus.NOT_CONNECTED
    integration.error_code = None
    integration.error_at = None
    integration.accounts = []
    return await saved(db, viewer, integration.id)


class OwnerInput(APIModel):
    default_owner_id: uuid.UUID


@router.patch("/{integration_id}/accounts/{account_id}")
async def set_default_owner(
    integration_id: uuid.UUID, account_id: uuid.UUID, body: OwnerInput, viewer: Admin, db: Db
) -> IntegrationOut:
    integration = await load_one(db, viewer, integration_id)
    account = next((a for a in integration.accounts if a.id == account_id), None)
    if account is None:
        raise not_found("Account not found")
    if integration.provider not in OWNS_CONTENT:
        raise bad_request("This connector has no default owner")
    await check_owner(db, viewer, body.default_owner_id)
    account.default_owner_id = body.default_owner_id
    return await saved(db, viewer, integration.id)
