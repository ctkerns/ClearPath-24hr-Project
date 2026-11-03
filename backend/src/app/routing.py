"""Review routing (PRD F6, section 10 "Routing" tab): routing rules, the default group, the lighter path,
and the no-material-change types.

Every signed-in internal user reads them, because the submit form shows where an item will go (F3).
Affiliates do not: routing is internal data (PRD R4). Only Managers and higher change them (PRD section 4).
Every change goes in the audit log. Open reviews keep their groups when a rule changes.
"""

import uuid
from datetime import UTC, datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Response, status
from pydantic import Field, field_validator
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api import APIModel, InternalUser, Manager, bad_request, not_found
from app.audit import record
from app.db import get_db
from app.groups import GroupOut, load_group
from app.material_access import Submitter, now, visible
from app.models import ReviewerGroup, Role, User
from app.models.materials import Channel, Material, Product, ReviewPath
from app.models.routing import NoMaterialChangeType, RoutingRule, RoutingRuleGroup, RoutingSettings, RuleSource
from app.routing_eval import route
from app.workspace import US_STATES

router = APIRouter(prefix="/api/routing", tags=["routing"])
Db = Annotated[AsyncSession, Depends(get_db)]

# The fixed metadata values (the same lists as PRODUCTS and CHANNELS in the frontend's material-data.ts)
PRODUCTS = ("personal_loan", "credit_card", "mortgage", "heloc", "auto_loan", "savings")
CHANNELS = ("meta", "google", "mailchimp", "wordpress", "affiliate", "other")
CHANGE_TYPES = [t.value for t in NoMaterialChangeType]


# Shapes


class RuleConditions(APIModel):
    """An empty list or a missing field means "any"."""

    products: list[str] = Field(default_factory=list)
    channels: list[str] = Field(default_factory=list)
    source: RuleSource | None = None
    affiliate_history: bool = False
    nationwide: bool = False
    states: list[str] = Field(default_factory=list)

    @staticmethod
    def known(values: list[str], allowed: tuple[str, ...] | list[str], what: str) -> list[str]:
        unknown = sorted(set(values) - set(allowed))
        if unknown:
            raise ValueError(f"Unknown {what}: {', '.join(unknown)}")
        return [v for v in allowed if v in values]  # no duplicates, a fixed order

    @field_validator("products")
    @classmethod
    def known_products(cls, v: list[str]) -> list[str]:
        return cls.known(v, PRODUCTS, "products")

    @field_validator("channels")
    @classmethod
    def known_channels(cls, v: list[str]) -> list[str]:
        return cls.known(v, CHANNELS, "channels")

    @field_validator("states")
    @classmethod
    def known_states(cls, v: list[str]) -> list[str]:
        return cls.known(v, US_STATES, "states")


class RuleOut(APIModel):
    id: uuid.UUID
    name: str
    enabled: bool
    conditions: RuleConditions
    required_group_ids: list[uuid.UUID]
    note: str | None
    updated_by: str | None
    updated_at: datetime

    @classmethod
    def of(cls, r: RoutingRule) -> "RuleOut":
        return cls(
            id=r.id,
            name=r.name,
            enabled=r.enabled,
            conditions=RuleConditions(
                products=r.products,
                channels=r.channels,
                source=r.source,
                affiliate_history=r.affiliate_history,
                nationwide=r.nationwide,
                states=r.states,
            ),
            required_group_ids=[g.group_id for g in r.required],
            note=r.note,
            updated_by=r.updated_by.name if r.updated_by else None,
            updated_at=r.updated_at,
        )


class RoutingOut(APIModel):
    rules: list[RuleOut]
    # Null means "use the default group".
    lighter_path_group_id: uuid.UUID | None
    no_material_change_types: dict[NoMaterialChangeType, bool]


# Reading


RULE_LOAD = (selectinload(RoutingRule.required), selectinload(RoutingRule.updated_by))


async def load_rules(db: AsyncSession, viewer: User) -> list[RoutingRule]:
    return list(
        await db.scalars(
            select(RoutingRule)
            .where(RoutingRule.workspace_id == viewer.workspace_id)
            .options(*RULE_LOAD)
            .order_by(RoutingRule.position, RoutingRule.id)
            .execution_options(populate_existing=True)
        )
    )


async def load_rule(db: AsyncSession, viewer: User, rule_id: uuid.UUID) -> RoutingRule:
    rule = await db.scalar(
        select(RoutingRule)
        .where(RoutingRule.id == rule_id, RoutingRule.workspace_id == viewer.workspace_id)
        .options(*RULE_LOAD)
        .execution_options(populate_existing=True)
    )
    if rule is None:
        raise not_found("Routing rule not found")
    return rule


async def load_settings(db: AsyncSession, viewer: User) -> RoutingSettings | None:
    return await db.get(RoutingSettings, viewer.workspace_id, populate_existing=True)


async def routing_out(db: AsyncSession, viewer: User) -> RoutingOut:
    settings = await load_settings(db, viewer)
    on = settings.enabled_change_types if settings else CHANGE_TYPES  # no row yet: every type is on
    return RoutingOut(
        rules=[RuleOut.of(r) for r in await load_rules(db, viewer)],
        lighter_path_group_id=settings.lighter_path_group_id if settings else None,
        no_material_change_types={t: t.value in on for t in NoMaterialChangeType},
    )


@router.get("")
async def get_routing(viewer: InternalUser, db: Db) -> RoutingOut:
    return await routing_out(db, viewer)


# Rules


class RuleInput(APIModel):
    name: str = Field(min_length=1, max_length=200)
    conditions: RuleConditions
    required_group_ids: list[uuid.UUID] = Field(min_length=1, max_length=50)
    note: str | None = Field(default=None, max_length=2000)


class RuleChange(APIModel):
    """Every field is optional, so the switch can send only `enabled`."""

    name: str | None = Field(default=None, min_length=1, max_length=200)
    conditions: RuleConditions | None = None
    required_group_ids: list[uuid.UUID] | None = Field(default=None, min_length=1, max_length=50)
    note: str | None = Field(default=None, max_length=2000)
    enabled: bool | None = None


def checked_conditions(c: RuleConditions) -> RuleConditions:
    """Affiliate history is only about affiliate content, so it implies source = affiliate (PRD F6)."""
    if c.affiliate_history:
        if c.source is RuleSource.INTERNAL:
            raise bad_request("Affiliate history applies only to affiliate content")
        c.source = RuleSource.AFFILIATE
    return c


async def checked_groups(db: AsyncSession, viewer: User, group_ids: list[uuid.UUID]) -> list[uuid.UUID]:
    """The groups in the order given, once each. Every one must be a group of this workspace."""
    ids = list(dict.fromkeys(group_ids))
    found = set(
        await db.scalars(
            select(ReviewerGroup.id).where(ReviewerGroup.workspace_id == viewer.workspace_id, ReviewerGroup.id.in_(ids))
        )
    )
    if len(found) != len(ids):
        raise bad_request("Unknown reviewer group")
    return ids


def set_conditions(rule: RoutingRule, c: RuleConditions) -> None:
    rule.products = c.products
    rule.channels = c.channels
    rule.source = c.source
    rule.affiliate_history = c.affiliate_history
    rule.nationwide = c.nationwide
    rule.states = c.states


def clean_note(note: str | None) -> str | None:
    return (note or "").strip() or None


@router.post("/rules", status_code=status.HTTP_201_CREATED)
async def create_rule(body: RuleInput, viewer: Manager, db: Db) -> RuleOut:
    """A new rule is on, and goes at the end of the list."""
    group_ids = await checked_groups(db, viewer, body.required_group_ids)
    last = await db.scalar(select(func.max(RoutingRule.position)).where(RoutingRule.workspace_id == viewer.workspace_id))
    rule = RoutingRule(
        workspace_id=viewer.workspace_id,
        position=(last or 0) + 1,
        name=body.name.strip(),
        enabled=True,
        note=clean_note(body.note),
        created_by_id=viewer.id,
        updated_by_id=viewer.id,
        required=[RoutingRuleGroup(group_id=g, position=i) for i, g in enumerate(group_ids)],
    )
    set_conditions(rule, checked_conditions(body.conditions))
    db.add(rule)
    await db.flush()
    rule_id = rule.id
    record(db, viewer, "routing_rule", rule_id, "created", body.model_dump(by_alias=True))
    await db.commit()
    return RuleOut.of(await load_rule(db, viewer, rule_id))


@router.patch("/rules/{rule_id}")
async def change_rule(rule_id: uuid.UUID, body: RuleChange, viewer: Manager, db: Db) -> RuleOut:
    rule = await load_rule(db, viewer, rule_id)
    if body.name is not None:
        rule.name = body.name.strip()
        if not rule.name:
            raise bad_request("A rule needs a name")
    if body.conditions is not None:
        set_conditions(rule, checked_conditions(body.conditions))
    if body.required_group_ids is not None:
        group_ids = await checked_groups(db, viewer, body.required_group_ids)
        rule.required.clear()
        await db.flush()  # remove the old rows before adding the new ones (same primary keys)
        rule.required.extend(RoutingRuleGroup(group_id=g, position=i) for i, g in enumerate(group_ids))
    if "note" in body.model_fields_set:  # null or "" clears the note
        rule.note = clean_note(body.note)
    if body.enabled is not None:
        rule.enabled = body.enabled
    rule.updated_by_id = viewer.id
    rule.updated_at = datetime.now(UTC)
    record(db, viewer, "routing_rule", rule_id, "updated", body.model_dump(by_alias=True, exclude_unset=True))
    await db.commit()
    return RuleOut.of(await load_rule(db, viewer, rule_id))


@router.delete("/rules/{rule_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_rule(rule_id: uuid.UUID, viewer: Manager, db: Db) -> Response:
    rule = await load_rule(db, viewer, rule_id)
    record(db, viewer, "routing_rule", rule_id, "deleted", {"name": rule.name})
    await db.delete(rule)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


class MoveInput(APIModel):
    by: Literal[-1, 1]


@router.post("/rules/{rule_id}/move")
async def move_rule(rule_id: uuid.UUID, body: MoveInput, viewer: Manager, db: Db) -> RoutingOut:
    """Moves a rule one place up (-1) or down (1). Order is for reading only: every matching rule applies.
    At the top or the bottom nothing changes."""
    rules = await load_rules(db, viewer)
    i = next((n for n, r in enumerate(rules) if r.id == rule_id), None)
    if i is None:
        raise not_found("Routing rule not found")
    j = i + body.by
    if 0 <= j < len(rules):
        rules[i], rules[j] = rules[j], rules[i]
        for n, r in enumerate(rules):  # number them again, so gaps and ties go away
            r.position = n + 1
        record(db, viewer, "routing_rule", rule_id, "moved", {"by": body.by, "position": j + 1})
        await db.commit()
    return await routing_out(db, viewer)


# The lighter path and the no-material-change types


class SettingsChange(APIModel):
    """Send only what changes. `lighterPathGroupId: null` means "use the default group"."""

    lighter_path_group_id: uuid.UUID | None = None
    no_material_change_types: dict[NoMaterialChangeType, bool] | None = None


@router.patch("")
async def change_routing(body: SettingsChange, viewer: Manager, db: Db) -> RoutingOut:
    settings = await load_settings(db, viewer)
    if settings is None:
        settings = RoutingSettings(workspace_id=viewer.workspace_id, enabled_change_types=CHANGE_TYPES)
        db.add(settings)
    if "lighter_path_group_id" in body.model_fields_set:
        if body.lighter_path_group_id is not None:
            await load_group(db, viewer, body.lighter_path_group_id)  # 404 for a group of another workspace
        settings.lighter_path_group_id = body.lighter_path_group_id
    if body.no_material_change_types:
        on = set(settings.enabled_change_types)
        for t, value in body.no_material_change_types.items():
            if value:
                on.add(t.value)
            else:
                on.discard(t.value)
        settings.enabled_change_types = [t for t in CHANGE_TYPES if t in on]
    settings.updated_by_id = viewer.id
    settings.updated_at = datetime.now(UTC)
    record(db, viewer, "routing_settings", viewer.workspace_id, "updated", body.model_dump(by_alias=True, exclude_unset=True))
    await db.commit()
    return await routing_out(db, viewer)


# The default group (PRD F6, a required setting): items that match no rule go there.


class DefaultGroupInput(APIModel):
    group_id: uuid.UUID


@router.put("/default-group")
async def set_default_group(body: DefaultGroupInput, viewer: Manager, db: Db) -> GroupOut:
    """Moves the default flag to this group in one transaction. It never clears it: one group is always the default.
    The partial unique index allows one default per workspace, so clear the old one first."""
    group = await load_group(db, viewer, body.group_id)
    before = await db.scalar(
        select(ReviewerGroup.id).where(ReviewerGroup.workspace_id == viewer.workspace_id, ReviewerGroup.is_default)
    )
    record(db, viewer, "routing_settings", viewer.workspace_id, "default_group_changed", {"before": before, "after": group.id})
    await db.execute(
        update(ReviewerGroup)
        .where(ReviewerGroup.workspace_id == viewer.workspace_id, ReviewerGroup.is_default, ReviewerGroup.id != group.id)
        .values(is_default=False)
    )
    await db.execute(update(ReviewerGroup).where(ReviewerGroup.id == group.id).values(is_default=True))
    await db.commit()
    return GroupOut.of(await load_group(db, viewer, group.id))


# The preview (PRD F3, F6): the submit form shows who will review, from the same code that decides on submit,
# so the preview and the decision cannot differ. Affiliates may call it too, for their own materials.


class PreviewInput(APIModel):
    """What the form has so far. For a new version, `materialId` gives the channel and the affiliate."""

    material_id: uuid.UUID | None = None
    channel: Channel
    product: Product
    nationwide: bool = False
    states: list[str] = Field(default_factory=list, max_length=51)

    @field_validator("states")
    @classmethod
    def known_states(cls, v: list[str]) -> list[str]:
        return RuleConditions.known(v, US_STATES, "states")


class PreviewGroup(APIModel):
    name: str
    reason: str  # the same text the material shows after submit
    rules: list[str]  # the names of the rules that require it; empty for the default group or the lighter path


class PreviewOut(APIModel):
    path: ReviewPath
    groups: list[PreviewGroup]


@router.post("/preview")
async def preview_routing(body: PreviewInput, viewer: Submitter, db: Db) -> PreviewOut:
    """Changes nothing. The submit evaluates again, so a rule change in between still counts."""
    channel, affiliate_id = body.channel, viewer.affiliate_id if viewer.role is Role.AFFILIATE else None
    if body.material_id:
        m = await db.scalar(select(Material).where(Material.id == body.material_id, *visible(viewer)))
        if m is None:
            raise not_found("Material not found")
        channel, affiliate_id = m.channel, m.affiliate_id
    r = await route(
        db,
        viewer,
        product=body.product,
        channel=channel,
        affiliate_id=affiliate_id,
        nationwide=body.nationwide,
        states=body.states,
        at=now(),
    )
    return PreviewOut(
        path=r.result.path,
        groups=[PreviewGroup(name=g.group.name, reason=g.reason, rules=g.rule_names) for g in r.groups],
    )
