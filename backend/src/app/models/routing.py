"""Review routing tables (PRD F6, section 9): routing rules and the routing settings of each workspace.

The default group is a flag on the reviewer group itself (ReviewerGroup.is_default, in core).
"""

import enum
import uuid
from datetime import datetime

from sqlalchemy import ARRAY, ForeignKey, String, Text, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, now_default, str_enum, uuid_pk
from app.models.core import User


class RuleSource(enum.StrEnum):
    INTERNAL = "internal"
    AFFILIATE = "affiliate"


class NoMaterialChangeType(enum.StrEnum):
    """The built-in list (PRD F6). The product defines it, because each type needs an exact code check."""

    RATE_FEE = "rate_fee"
    OFFER_DATE = "offer_date"
    DISCLOSURE_REFRESH = "disclosure_refresh"
    BLOCK_SWAP = "block_swap"
    FORMATTING = "formatting"
    TRACKING_LINK = "tracking_link"


class RoutingSettings(Base):
    """One row per workspace: the lighter path and the no-material-change switches (PRD F6).
    A workspace with no row uses the defaults: lighter path = default group, every type on."""

    __tablename__ = "routing_settings"

    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id"), primary_key=True)
    # Null means "use the default group".
    lighter_path_group_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("reviewer_groups.id", ondelete="SET NULL")
    )
    # The types that are on, in the order of NoMaterialChangeType.
    enabled_change_types: Mapped[list[str]] = mapped_column(ARRAY(String(32)))
    seeded: Mapped[bool] = mapped_column(server_default=text("false"))
    updated_at: Mapped[datetime] = now_default()
    updated_by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))


class RoutingRuleGroup(Base):
    """A group that a rule requires. `position` keeps the order the Manager picked them in."""

    __tablename__ = "routing_rule_groups"

    rule_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("routing_rules.id", ondelete="CASCADE"), primary_key=True)
    group_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("reviewer_groups.id", ondelete="CASCADE"), primary_key=True, index=True
    )
    position: Mapped[int]


class RoutingRule(Base):
    """Conditions on fixed metadata fields and the groups that must review a match (PRD F6).
    An empty list or a null field means "any". Every enabled rule that matches applies; the order is for reading."""

    __tablename__ = "routing_rules"

    id: Mapped[uuid.UUID] = uuid_pk()
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id"), index=True)
    position: Mapped[int]
    name: Mapped[str] = mapped_column(String(200))
    enabled: Mapped[bool] = mapped_column(server_default=text("true"))
    # Conditions
    products: Mapped[list[str]] = mapped_column(ARRAY(String(32)), server_default=text("'{}'"))
    channels: Mapped[list[str]] = mapped_column(ARRAY(String(32)), server_default=text("'{}'"))
    source: Mapped[RuleSource | None] = mapped_column(str_enum(RuleSource, "rule_source"))
    # The affiliate has an open issue, or a rejected version, in the last 90 days. Affiliate content only.
    affiliate_history: Mapped[bool] = mapped_column(server_default=text("false"))
    nationwide: Mapped[bool] = mapped_column(server_default=text("false"))
    states: Mapped[list[str]] = mapped_column(ARRAY(String(2)), server_default=text("'{}'"))
    note: Mapped[str | None] = mapped_column(Text)
    seeded: Mapped[bool] = mapped_column(server_default=text("false"))
    created_at: Mapped[datetime] = now_default()
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    updated_at: Mapped[datetime] = now_default()
    updated_by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))

    required: Mapped[list[RoutingRuleGroup]] = relationship(
        order_by=RoutingRuleGroup.position, cascade="all, delete-orphan", passive_deletes=True
    )
    updated_by: Mapped[User | None] = relationship(foreign_keys=[updated_by_id])


__all__ = ["NoMaterialChangeType", "RoutingRule", "RoutingRuleGroup", "RoutingSettings", "RuleSource"]
