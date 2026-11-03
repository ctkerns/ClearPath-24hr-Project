"""Evaluates the routing rules for one item (PRD F6, R2). The server alone decides the required groups.

The submit form shows a preview (POST /api/routing/preview runs this same code), but a submit never sends
its groups: routing must not be bypassed (PRD R2, F6). The matching is the same as `evaluateRouting` and
`missOf` in the frontend's routing-data.ts, which the Routing tab's "Test routing" still uses.
"""

import uuid
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from datetime import datetime, timedelta

from sqlalchemy import exists, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api import bad_request
from app.models import ReviewerGroup, User
from app.models.materials import (
    Channel,
    Comment,
    Decision,
    Issue,
    Material,
    MaterialVersion,
    Outcome,
    ReviewPath,
)
from app.models.routing import NoMaterialChangeType, RoutingRule, RoutingSettings, RuleSource

# PRD F6: "the affiliate has an open issue, or a rejected version, in the last 90 days"
HISTORY_DAYS = 90


# ---- The pure evaluation (no database), so unit tests can call it directly ----


@dataclass(frozen=True)
class Rule:
    id: uuid.UUID
    name: str
    enabled: bool
    required_group_ids: tuple[uuid.UUID, ...]
    products: tuple[str, ...] = ()
    channels: tuple[str, ...] = ()
    source: str | None = None
    affiliate_history: bool = False
    nationwide: bool = False
    states: tuple[str, ...] = ()

    @classmethod
    def of(cls, r: RoutingRule) -> "Rule":
        return cls(
            id=r.id,
            name=r.name,
            enabled=r.enabled,
            required_group_ids=tuple(g.group_id for g in r.required),
            products=tuple(r.products),
            channels=tuple(r.channels),
            source=r.source.value if r.source else None,
            affiliate_history=r.affiliate_history,
            nationwide=r.nationwide,
            states=tuple(r.states),
        )


@dataclass(frozen=True)
class RoutingInput:
    """The facts about one item that routing reads. The server builds them from its own data."""

    product: str
    channel: str
    source: str  # "internal" or "affiliate"
    affiliate_history: bool
    nationwide: bool
    states: tuple[str, ...]


@dataclass(frozen=True)
class RuleResult:
    rule: Rule
    outcome: str  # "matched", "off", or "skipped"
    miss: str | None = None  # the first condition the item fails: product, channel, source, history, states


@dataclass(frozen=True)
class Required:
    group_id: uuid.UUID
    rule_ids: list[uuid.UUID] = field(default_factory=list)  # empty for the default group or the lighter path


@dataclass(frozen=True)
class RoutingResult:
    results: list[RuleResult]
    required: list[Required]
    used_default: bool
    path: ReviewPath


def miss_of(r: Rule, v: RoutingInput) -> str | None:
    """Why a rule does not match: the first condition the item fails. An empty list means "any"."""
    if r.products and v.product not in r.products:
        return "product"
    if r.channels and v.channel not in r.channels:
        return "channel"
    # Affiliate history is only about affiliate content, so it implies source = affiliate.
    source = RuleSource.AFFILIATE.value if r.affiliate_history else r.source
    if source and source != v.source:
        return "source"
    if r.affiliate_history and not v.affiliate_history:
        return "history"
    if r.nationwide or r.states:
        # Nationwide content reaches every state, so it matches any state condition.
        hit = (r.nationwide or bool(r.states)) if v.nationwide else any(s in r.states for s in v.states)
        if not hit:
            return "states"
    return None


def evaluate(
    rules: Sequence[Rule],
    default_group_id: uuid.UUID | None,
    v: RoutingInput,
    *,
    no_material_change: bool = False,
    lighter_path_group_id: uuid.UUID | None = None,
) -> RoutingResult:
    """PRD F6: all groups from all enabled rules that match, in rule order, each with the rules that asked for it.
    No match: the default group, so no item is ever left without a reviewer.
    A version with no material change takes the lighter path: one group, the lighter-path group
    (a Manager setting; null means the default group)."""
    results = []
    for rule in rules:
        if not rule.enabled:
            results.append(RuleResult(rule, "off"))
            continue
        miss = miss_of(rule, v)
        results.append(RuleResult(rule, "skipped", miss) if miss else RuleResult(rule, "matched"))

    if no_material_change:
        group = lighter_path_group_id or default_group_id
        required = [Required(group)] if group else []
        return RoutingResult(results, required, used_default=False, path=ReviewPath.LIGHTER)

    by_group: dict[uuid.UUID, list[uuid.UUID]] = {}
    for r in results:
        if r.outcome == "matched":
            for g in r.rule.required_group_ids:
                by_group.setdefault(g, []).append(r.rule.id)
    used_default = not by_group and default_group_id is not None
    if used_default:
        by_group[default_group_id] = []  # type: ignore[index]
    required = [Required(g, ids) for g, ids in by_group.items()]
    return RoutingResult(results, required, used_default=used_default, path=ReviewPath.FULL)


def is_lighter(changes: Iterable[str] | None, enabled_types: Iterable[str]) -> bool:
    """PRD F6: no material change when every difference from the last approved version is a type that is on.
    `changes` is None when there is no approved version to compare with, or a difference is not on the list."""
    if changes is None:
        return False
    found = set(changes)
    return bool(found) and found <= set(enabled_types)


def list_text(names: list[str]) -> str:
    """"A", "A and B", "A, B, and C", like formatList in the frontend."""
    if len(names) <= 2:
        return " and ".join(names)
    return f"{', '.join(names[:-1])}, and {names[-1]}"


# ---- With the database ----


@dataclass(frozen=True)
class RoutedGroup:
    group: ReviewerGroup
    rule_names: list[str]
    reason: str  # stored on the GroupReview, shown on the material


@dataclass(frozen=True)
class Routing:
    input: RoutingInput
    result: RoutingResult
    groups: list[RoutedGroup]

    def history_text(self) -> str:
        """For the material history: 'Required Compliance (rule "Compliance reviews everything"), Legal (...).'"""
        parts = []
        for g in self.groups:
            if g.rule_names:
                rules = ", ".join(f'"{n}"' for n in g.rule_names)
                parts.append(f"{g.group.name} ({'rules' if len(g.rule_names) > 1 else 'rule'} {rules})")
            else:
                parts.append(f"{g.group.name} ({g.reason.lower()})")
        return f"Required {', '.join(parts)}."

    def audit(self) -> dict[str, object]:
        """What the audit log records about the decision (PRD F2, F6)."""
        return {
            "path": self.result.path.value,
            "usedDefault": self.result.used_default,
            "input": {
                "product": self.input.product,
                "channel": self.input.channel,
                "source": self.input.source,
                "affiliateHistory": self.input.affiliate_history,
                "nationwide": self.input.nationwide,
                "states": list(self.input.states),
            },
            "groups": [{"id": g.group.id, "name": g.group.name, "rules": g.rule_names} for g in self.groups],
            "matchedRules": [str(r.rule.id) for r in self.result.results if r.outcome == "matched"],
        }


async def affiliate_history(db: AsyncSession, workspace_id: uuid.UUID, affiliate_id: uuid.UUID, at: datetime) -> bool:
    """PRD F6: the affiliate had an open issue, or a rejected version, in the last 90 days.
    An issue counts while it is open, and for 90 days after it is resolved.
    A rejection counts by the reject decision's date; a version without that comment (seeded data)
    counts by its submit date."""
    since = at - timedelta(days=HISTORY_DAYS)
    theirs = select(Material.id).where(Material.workspace_id == workspace_id, Material.affiliate_id == affiliate_id)
    issue = exists().where(
        Issue.material_id.in_(theirs), or_(Issue.resolved_at.is_(None), Issue.resolved_at >= since)
    )
    rejected_comment = exists().where(
        Comment.material_id.in_(theirs), Comment.decision == Decision.REJECT, Comment.at >= since
    )
    rejected_version = exists().where(
        MaterialVersion.material_id.in_(theirs),
        MaterialVersion.outcome == Outcome.REJECTED,
        MaterialVersion.submitted_at >= since,
    )
    return bool(await db.scalar(select(or_(issue, rejected_comment, rejected_version))))


async def route(
    db: AsyncSession,
    viewer: User,
    *,
    product: str,
    channel: Channel,
    affiliate_id: uuid.UUID | None,
    nationwide: bool,
    states: Sequence[str],
    at: datetime,
    changes: Iterable[str] | None = None,
) -> Routing:
    """Builds the input from server data and evaluates the workspace's rules.
    The caller checks the states (known and licensed); everything else comes from the database:
    the source is affiliate for an affiliate's material (or an affiliate page), and the history is computed here.
    `changes` are the no-material-change types found against the last approved version (None: a material change).
    400 when nobody can review the item (no default group)."""
    ws = viewer.workspace_id
    # Affiliate pages come from affiliates, the same as the form preview and "Test routing" (PRD F6).
    source = RuleSource.AFFILIATE if affiliate_id or channel is Channel.AFFILIATE else RuleSource.INTERNAL
    history = await affiliate_history(db, ws, affiliate_id, at) if affiliate_id else False
    v = RoutingInput(
        product=product,
        channel=channel.value,
        source=source.value,
        affiliate_history=history,
        nationwide=nationwide,
        states=() if nationwide else tuple(states),
    )
    rules = [
        Rule.of(r)
        for r in await db.scalars(
            select(RoutingRule)
            .where(RoutingRule.workspace_id == ws)
            .options(selectinload(RoutingRule.required))
            .order_by(RoutingRule.position, RoutingRule.id)
        )
    ]
    groups = {g.id: g for g in await db.scalars(select(ReviewerGroup).where(ReviewerGroup.workspace_id == ws))}
    default = next((g.id for g in groups.values() if g.is_default), None)
    settings = await db.get(RoutingSettings, ws)
    # No row yet: every type is on (the same as GET /api/routing).
    enabled = settings.enabled_change_types if settings else [t.value for t in NoMaterialChangeType]
    result = evaluate(
        rules,
        default,
        v,
        no_material_change=is_lighter(changes, enabled),
        lighter_path_group_id=settings.lighter_path_group_id if settings else None,
    )
    names = {r.id: r.name for r in rules}
    routed = []
    for req in result.required:
        if req.group_id not in groups:  # rules only point to groups of this workspace; skip anything else
            continue
        rule_names = [names[i] for i in req.rule_ids]
        if rule_names:
            reason = list_text(rule_names)
        elif result.path is ReviewPath.LIGHTER:
            reason = "No material change (lighter path)"
        else:
            reason = "Default group"
        routed.append(RoutedGroup(groups[req.group_id], rule_names, reason))
    if not routed:
        raise bad_request("The workspace has no default reviewer group")
    return Routing(v, result, routed)
