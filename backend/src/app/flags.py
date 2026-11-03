"""Flags for re-review (PRD F7, F8, F15): which approved materials depend on a library change.

The server decides, from its own data, never the browser:
- The materials: status Approved or Live. Their current version is the approved one (a new version moves
  the material back to Submitted, section 6).
- A version depends on a rule when the rule is on its checklist or one of its findings, or when the rule
  is in scope for its product, channel and target states (the F7 checklist, `prereview.in_scope`). Nationwide
  content gets the rules of every licensed state. A change that takes effect after the version's end date
  does not affect it.
- On a disclosure: a rule it depends on requires the disclosure (and the disclosure is for its product and
  states), or its content has the disclosure's current text word for word.
- On a rate sheet: a rate-sheet rule applies, and a rate the content states is inside the ranges of the
  sheet it replaces but not of the new one (`prereview.check_rate_sheet` on both sheets).

The library endpoints (app.library) call `affected_by_*` for their preview ("impact") and, in the same
transaction as the change, `flag` for each affected material. So the preview is exactly what saving flags.

A flag does not change the material's status. PRD section 6 says a change a material depends on ends the
approval (Expired), but Expired can only leave by a new version, and F7 asks for a re-review. So a flag asks
a Reviewer to look again: they resolve it ("re-reviewed, no change needed") with a note, or submit a new
version, which resolves the flags of the old one. TODO (F15): end the approval when a flag stays open too long.
"""

import uuid
from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Any

from fastapi import APIRouter
from pydantic import Field
from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app import prereview
from app.api import APIModel, bad_request, conflict, not_found
from app.audit import record
from app.material_access import Db, Reviewer, visible
from app.models import User, Workspace
from app.models.flags import FlagKind, FlagResolution, MaterialFlag
from app.models.library import Disclosure, RateSheet, Rule
from app.models.materials import Channel, Finding, Material, MaterialStatus, MaterialVersion, Product
from app.prereview import Content, DisclosureSpec, Library, RateRange, RuleSpec

APPROVED = (MaterialStatus.APPROVED, MaterialStatus.LIVE)


def day(d: date) -> str:
    return f"{d:%b} {d.day}, {d.year}"


# ---- Which materials depend on what ----


@dataclass
class Approved:
    """One approved or live material and its approved version, as plain data for the dependency tests."""

    material: Material
    version: MaterialVersion
    states: list[str]
    end: date | None
    rule_ids: set[str]  # on the version's checklist or findings
    _content: Content | None = field(default=None, repr=False)

    @property
    def product(self) -> str:
        return self.material.product.value

    @property
    def channel(self) -> str:
        return self.material.channel.value

    @property
    def content(self) -> Content:
        if self._content is None:
            fields = [(str(f.get("label", "")), prereview.plain_text(f)) for f in self.version.fields]
            self._content = Content(fields)
        return self._content

    def ends_before(self, effective: date | None) -> bool:
        """The change takes effect only after this version's end date, so it does not affect it."""
        return bool(effective and self.end and effective > self.end)

    def uses_rule(self, rule: RuleSpec) -> bool:
        return rule.id in self.rule_ids or prereview.in_scope(rule, self.product, self.channel, self.states)


async def approved_materials(db: AsyncSession, workspace_id: uuid.UUID) -> list[Approved]:
    """Every approved or live material of the workspace that has a version, by title."""
    latest = (
        select(MaterialVersion.material_id, func.max(MaterialVersion.number).label("number"))
        .where(MaterialVersion.workspace_id == workspace_id)
        .group_by(MaterialVersion.material_id)
        .subquery()
    )
    rows = (
        await db.execute(
            select(Material, MaterialVersion)
            .join(MaterialVersion, MaterialVersion.material_id == Material.id)
            .join(latest, and_(latest.c.material_id == MaterialVersion.material_id, latest.c.number == MaterialVersion.number))
            .where(Material.workspace_id == workspace_id, Material.status.in_(APPROVED))
            .order_by(Material.title, Material.id)
        )
    ).all()
    found: dict[uuid.UUID, set[str]] = {}
    if rows:
        pairs = await db.execute(
            select(Finding.version_id, Finding.rule_id).where(Finding.version_id.in_([v.id for _, v in rows]))
        )
        for version_id, rule_id in pairs.all():
            found.setdefault(version_id, set()).add(rule_id)
    licensed = list((await db.get_one(Workspace, workspace_id)).licensed_states)
    return [
        Approved(
            material=m,
            version=v,
            states=prereview.target_states(v.details, licensed),
            end=prereview.iso_date(v.details.get("endDate")),
            rule_ids={str(r["ruleId"]) for r in v.checklist if isinstance(r, dict) and r.get("ruleId")} | found.get(v.id, set()),
        )
        for m, v in rows
    ]


def affected_by_rules(materials: Sequence[Approved], rules: Sequence[RuleSpec], effective: date | None) -> list[Approved]:
    """A rule edit passes the rule before and after (its scope may change); a regulatory change its rules."""
    return [a for a in materials if not a.ends_before(effective) and any(a.uses_rule(r) for r in rules)]


def uses_disclosure(a: Approved, d: DisclosureSpec, requiring: Sequence[RuleSpec]) -> bool:
    pattern = prereview.literal_pattern(d.text)
    if pattern is not None and a.content.contains(pattern):
        return True
    if d.products and a.product not in d.products:
        return False
    if d.states is not None and not set(d.states) & set(a.states):
        return False
    return any(a.uses_rule(r) for r in requiring)


def affected_by_disclosure(
    materials: Sequence[Approved], d: DisclosureSpec, rules: Sequence[RuleSpec], effective: date | None
) -> list[Approved]:
    """`d` is the disclosure before the change, so its text is the one the approvals used."""
    requiring = [r for r in rules if r.check.get("disclosure") == d.id]
    return [a for a in materials if not a.ends_before(effective) and uses_disclosure(a, d, requiring)]


def uncovered_rates(a: Approved, rule: RuleSpec, rates: list[RateRange] | None) -> set[str]:
    """The stated rates that are outside the sheet's ranges. With no sheet, none: there was nothing to check."""
    if rates is None:
        return set()
    lib = Library(rules=[], disclosures={}, rates=rates, licensed_states=[])
    return {h.flagged_text for h in prereview.check_rate_sheet(rule, a.content, lib, a.product, a.states)}


def affected_by_rates(
    materials: Sequence[Approved],
    rules: Sequence[RuleSpec],
    old: list[RateRange] | None,
    new: list[RateRange],
    effective: date | None,
) -> list[tuple[Approved, list[str]]]:
    """Each affected material with the rates it states that the new sheet no longer covers."""
    rate_rules = [r for r in rules if r.check.get("type") == "rate_sheet"]
    out = []
    for a in materials:
        rule = next((r for r in rate_rules if a.uses_rule(r)), None)
        if rule is None or a.ends_before(effective):
            continue
        lost = uncovered_rates(a, rule, new) - uncovered_rates(a, rule, old)
        if lost:
            out.append((a, sorted(lost)))
    return out


async def rule_specs(db: AsyncSession, workspace_id: uuid.UUID) -> list[RuleSpec]:
    """Every rule, code and AI: a version depends on its AI rules too."""
    rules = await db.scalars(select(Rule).where(Rule.workspace_id == workspace_id).order_by(Rule.id))
    return [prereview.rule_spec(r) for r in rules]


async def disclosure_spec(db: AsyncSession, workspace_id: uuid.UUID, disclosure_id: str) -> DisclosureSpec | None:
    d = await db.scalar(
        select(Disclosure)
        .where(Disclosure.workspace_id == workspace_id, Disclosure.id == disclosure_id)
        .options(selectinload(Disclosure.versions))
    )
    return prereview.disclosure_spec(d) if d else None


async def replaced_rates(db: AsyncSession, workspace_id: uuid.UUID, effective: date) -> list[RateRange] | None:
    """The rates of the sheet that a new sheet effective on that day replaces."""
    sheets = list(
        await db.scalars(
            select(RateSheet)
            .where(RateSheet.workspace_id == workspace_id)
            .options(selectinload(RateSheet.rows))
            .order_by(RateSheet.effective_date.desc(), RateSheet.uploaded_at.desc())
        )
    )
    sheet = prereview.sheet_on(sheets, effective)
    return prereview.rate_ranges(sheet) if sheet else None


# ---- Writing and reading flags ----


def flag(
    db: AsyncSession,
    viewer: User,
    a: Approved,
    kind: FlagKind,
    source_id: str,
    source_version: int | None,
    summary: str,
    data: dict[str, Any] | None = None,
) -> None:
    """Adds one flag and its history entry, in the caller's transaction."""
    flag_id = uuid.uuid7()
    db.add(
        MaterialFlag(
            id=flag_id,
            workspace_id=a.material.workspace_id,
            material_id=a.material.id,
            version_id=a.version.id,
            kind=kind,
            source_id=source_id,
            source_version=source_version,
            summary=summary,
            data=data or {},
            created_by_id=viewer.id,
        )
    )
    record(db, viewer, "material", a.material.id, "flagged", {
        "flagId": flag_id,
        "kind": kind,
        "sourceId": source_id,
        "sourceVersion": source_version,
        "version": a.version.number,
        **(data or {}),
        "text": f"Flagged version {a.version.number} for re-review: {summary}",
    })


class AffectedMaterial(APIModel):
    """An approved material that a library change flags (the preview), or flagged (an applied change)."""

    id: uuid.UUID
    title: str
    channel: Channel
    product: Product
    status: MaterialStatus
    version: int
    approval_id: str | None = None
    rates: list[str] | None = None  # for a rate sheet: the stated rates the new sheet no longer covers

    @classmethod
    def of(cls, a: Approved, rates: list[str] | None = None) -> "AffectedMaterial":
        m = a.material
        return cls(
            id=m.id, title=m.title, channel=m.channel, product=m.product, status=m.status,
            version=a.version.number, approval_id=m.approval_id, rates=rates,
        )


async def flagged_by(db: AsyncSession, workspace_id: uuid.UUID, kind: FlagKind, source_id: str) -> list[AffectedMaterial]:
    """The materials that a saved change flagged, open or resolved, by title."""
    rows = await db.scalars(
        select(MaterialFlag)
        .join(Material, Material.id == MaterialFlag.material_id)
        .where(MaterialFlag.workspace_id == workspace_id, MaterialFlag.kind == kind, MaterialFlag.source_id == source_id)
        .options(selectinload(MaterialFlag.material), selectinload(MaterialFlag.version))
        .order_by(Material.title, MaterialFlag.created_at)
    )
    seen: dict[uuid.UUID, AffectedMaterial] = {}
    for f in rows:
        m = f.material
        seen.setdefault(m.id, AffectedMaterial(
            id=m.id, title=m.title, channel=m.channel, product=m.product, status=m.status,
            version=f.version.number, approval_id=m.approval_id,
        ))
    return list(seen.values())


class FlagOut(APIModel):
    """An open flag on the material page (PRD F7)."""

    id: uuid.UUID
    kind: FlagKind
    source_id: str
    source_version: int | None = None
    summary: str
    version: int  # the approved version it is about
    created_at: datetime
    created_by: str | None = None


async def open_flags(db: AsyncSession, material_id: uuid.UUID) -> list[FlagOut]:
    rows = await db.scalars(
        select(MaterialFlag)
        .where(MaterialFlag.material_id == material_id, MaterialFlag.resolved_at.is_(None))
        .options(selectinload(MaterialFlag.version), selectinload(MaterialFlag.created_by))
        .order_by(MaterialFlag.created_at, MaterialFlag.id)
    )
    return [
        FlagOut(
            id=f.id,
            kind=f.kind,
            source_id=f.source_id,
            source_version=f.source_version,
            summary=f.summary,
            version=f.version.number,
            created_at=f.created_at,
            created_by=f.created_by.name if f.created_by else None,
        )
        for f in rows
    ]


async def open_flag_counts(db: AsyncSession, viewer: User) -> dict[uuid.UUID, int]:
    """Open flags per material, for the list. Only the materials the viewer may see."""
    rows = await db.execute(
        select(MaterialFlag.material_id, func.count())
        .join(Material, Material.id == MaterialFlag.material_id)
        .where(MaterialFlag.resolved_at.is_(None), *visible(viewer))
        .group_by(MaterialFlag.material_id)
    )
    return {mid: n for mid, n in rows.all()}


async def resolve_for_new_version(db: AsyncSession, viewer: User, m: Material, number: int) -> None:
    """A new version replaces the flagged approval: its open flags are done. The new version is
    reviewed against the library as it is now (PRD section 6)."""
    rows = await db.scalars(
        select(MaterialFlag).where(MaterialFlag.material_id == m.id, MaterialFlag.resolved_at.is_(None))
    )
    for f in rows:
        # The database time: the start of the transaction, like the history entry
        f.resolved_at, f.resolved_by_id, f.resolution = func.now(), viewer.id, FlagResolution.NEW_VERSION
        record(db, viewer, "material", m.id, "flag_resolved", {
            "flagId": f.id,
            "resolution": FlagResolution.NEW_VERSION,
            "text": f"Resolved flag by submitting version {number}: {f.summary}",
        })


# ---- Resolving (Reviewers) ----

router = APIRouter(prefix="/api/materials", tags=["materials"])


class Resolve(APIModel):
    note: str = Field(min_length=1, max_length=2000)


@router.post("/{material_id}/flags/{flag_id}/resolve", response_model_exclude_none=True)
async def resolve(material_id: uuid.UUID, flag_id: uuid.UUID, body: Resolve, viewer: Reviewer, db: Db) -> dict[str, Any]:
    """Re-reviewed, no change needed (PRD F7). A Reviewer or higher, with a note for the audit trail.
    The approval stays as it is. Returns the material detail."""
    from app.materials import saved_detail  # here, because materials.py imports this module

    f = await db.scalar(
        select(MaterialFlag)
        .join(Material, Material.id == MaterialFlag.material_id)
        .where(MaterialFlag.id == flag_id, MaterialFlag.material_id == material_id, *visible(viewer))
        .with_for_update(of=MaterialFlag)
    )
    if f is None:
        raise not_found("Flag not found")
    if f.resolved_at is not None:
        raise conflict("This flag is already resolved")
    note = body.note.strip()
    if not note:
        raise bad_request("Write a note")
    f.resolved_at, f.resolved_by_id = func.now(), viewer.id  # the transaction's time, like the history entry
    f.resolution, f.resolution_note = FlagResolution.NO_CHANGE, note
    record(db, viewer, "material", material_id, "flag_resolved", {
        "flagId": f.id,
        "resolution": FlagResolution.NO_CHANGE,
        "note": note,
        "text": f"Re-reviewed, no change needed: {f.summary} Note: {note}",
    })
    detail = await saved_detail(db, viewer, material_id)
    return detail.model_dump(mode="json", by_alias=True, exclude_none=True) if detail else {}
