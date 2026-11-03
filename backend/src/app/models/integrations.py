"""Connector tables (PRD F11, section 9): one row per connector in each workspace, and its connected accounts.

No real platform calls yet: the rows hold the state the Integrations tab shows.
TODO: credentials (OAuth tokens, API keys) go in an encrypted column per workspace (PRD F11). Never in plain text.
The demo workspace has no credentials (PRD A1).
"""

import enum
import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import ForeignKey, ForeignKeyConstraint, String, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, now_default, str_enum, uuid_pk


class Provider(enum.StrEnum):
    META = "meta"
    GOOGLE_ADS = "google_ads"
    MAILCHIMP = "mailchimp"
    KLAVIYO = "klaviyo"
    WORDPRESS = "wordpress"
    WEBFLOW = "webflow"
    CRAWLER = "crawler"
    SEED_INBOX = "seed_inbox"
    IMPACT = "impact"
    CJ = "cj"
    COMPLIANCE_AI = "compliance_ai"
    WOLTERS_KLUWER = "wolters_kluwer"
    SLACK = "slack"
    EMAIL_ALERTS = "email_alerts"


class IntegrationStatus(enum.StrEnum):
    CONNECTED = "connected"
    NOT_CONNECTED = "not_connected"
    ERROR = "error"


class IntegrationErrorCode(enum.StrEnum):
    TOKEN_EXPIRED = "token_expired"
    WEBHOOK_SILENT = "webhook_silent"
    PERMISSION_REMOVED = "permission_removed"


class Integration(Base):
    __tablename__ = "integrations"
    __table_args__ = (
        UniqueConstraint("workspace_id", "provider", name="uq_integrations_workspace_provider"),
        ForeignKeyConstraint(
            ["workspace_id", "default_product_id"],
            ["products.workspace_id", "products.id"],
            name="fk_integrations_default_product_id_products",
        ),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id"), index=True)
    provider: Mapped[Provider] = mapped_column(str_enum(Provider, "provider"))
    status: Mapped[IntegrationStatus] = mapped_column(
        str_enum(IntegrationStatus, "status"), server_default=IntegrationStatus.NOT_CONNECTED.value
    )
    # Tested against a real account. Built only from documentation means Unverified (PRD F11).
    verified: Mapped[bool] = mapped_column(server_default=text("false"))
    last_sync_at: Mapped[datetime | None]
    error_code: Mapped[IntegrationErrorCode | None] = mapped_column(str_enum(IntegrationErrorCode, "error_code"))
    error_at: Mapped[datetime | None]
    # Accounts the platform offers after sign-in, as [{name, detail}]. Seeded for the demo.
    # TODO: the real list comes from the platform after the OAuth flow.
    available: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, server_default=text("'[]'"))
    # The product that materials imported by this connector get (PRD F3, section 9). Null: the owner chooses one.
    default_product_id: Mapped[str | None] = mapped_column(String(32))
    seeded: Mapped[bool] = mapped_column(server_default=text("false"))
    created_at: Mapped[datetime] = now_default()

    accounts: Mapped[list["IntegrationAccount"]] = relationship(
        order_by="IntegrationAccount.id", cascade="all, delete-orphan", passive_deletes=True
    )


class IntegrationAccount(Base):
    """An account the Admin connected, for example one Meta ad account."""

    __tablename__ = "integration_accounts"

    id: Mapped[uuid.UUID] = uuid_pk()
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id"), index=True)
    integration_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("integrations.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(200))
    detail: Mapped[str] = mapped_column(String(200), server_default="")
    # Owner of synced or found-live content with no platform author (PRD section 4, F10)
    default_owner_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    seeded: Mapped[bool] = mapped_column(server_default=text("false"))
    created_at: Mapped[datetime] = now_default()
