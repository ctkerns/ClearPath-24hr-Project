"""The policy library (PRD F7, F8, F9, screen 7): rules, disclosures, building blocks, the rate sheet,
and the regulatory change queue.

Every internal user reads it, because reviews check against it. Affiliates do not (R4).
Only Managers and higher change it (section 4, R3). One exception: Reviewers save building blocks
from approved materials with "Save to library" (F9); Managers curate them after that.
"""

import csv
import io
import uuid
from datetime import UTC, date, datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, status
from pydantic import Field, field_validator, model_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api import APIModel, InternalUser, Manager, bad_request, conflict, not_found, require_role
from app.db import get_db
from app.models import Role, User
from app.models.library import (
    BlockKind,
    BuildingBlock,
    CheckLayer,
    Disclosure,
    DisclosureVersion,
    RateKind,
    RateSheet,
    RateSheetRow,
    RegChange,
    RegChangeStatus,
    Rule,
    RuleKind,
    RuleVersion,
    Severity,
)
from app.workspace import US_STATES

router = APIRouter(prefix="/api/library", tags=["library"])
Db = Annotated[AsyncSession, Depends(get_db)]
Reviewer = Annotated[User, Depends(require_role(Role.REVIEWER))]

# The same lists as the frontend (materials/material-data.ts)
Product = Literal["personal_loan", "credit_card", "mortgage", "heloc", "auto_loan", "savings"]
Channel = Literal["meta", "google", "mailchimp", "wordpress", "affiliate", "other"]
PRODUCTS: tuple[str, ...] = Product.__args__  # type: ignore[attr-defined]

# A short ID that people read, like "REGZ-1026.24" or "D-7". It is part of URLs, so no spaces or slashes.
TextId = Annotated[str, Field(pattern=r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")]
ShortText = Annotated[str, Field(min_length=1, max_length=200)]
LongText = Annotated[str, Field(min_length=1, max_length=5000)]
Note = Annotated[str, Field(min_length=1, max_length=2000)]


def check_states(states: list[str]) -> list[str]:
    unknown = sorted(set(states) - set(US_STATES))
    if unknown:
        raise ValueError(f"Unknown states: {', '.join(unknown)}")
    if not states:
        raise ValueError('Choose at least one state, or "all"')
    return [s for s in US_STATES if s in states]


def states_out(states: list[str] | None) -> Literal["all"] | list[str]:
    """In the database, null means every licensed state. The API says "all", like the frontend."""
    return "all" if states is None else states


def states_in(states: Literal["all"] | list[str]) -> list[str] | None:
    return None if states == "all" else states


class Citation(APIModel):
    label: ShortText
    url: Annotated[str, Field(min_length=1, max_length=500, pattern=r"^https?://")]


class VersionOut(APIModel):
    version: int
    effective_date: date
    by: str  # name
    note: str


# Rules (F7)


class TriggerTermsCheck(APIModel):
    type: Literal["trigger_terms"]
    terms: list[ShortText] = Field(min_length=1, max_length=100)
    disclosure: TextId


class RequiredDisclosureCheck(APIModel):
    type: Literal["required_disclosure"]
    disclosure: TextId


class PhraseRequiredCheck(APIModel):
    type: Literal["phrase_required"]
    phrases: list[ShortText] = Field(min_length=1, max_length=100)


class PhraseBannedCheck(APIModel):
    type: Literal["phrase_banned"]
    phrases: list[ShortText] = Field(min_length=1, max_length=100)


class RateSheetCheck(APIModel):
    type: Literal["rate_sheet"]


class HiddenTextCheck(APIModel):
    type: Literal["hidden_text"]


class AICheck(APIModel):
    type: Literal["ai"]
    guidance: LongText


# How a code rule is checked, or the guidance for the AI reviewer (F4, F7)
RuleCheck = Annotated[
    TriggerTermsCheck
    | RequiredDisclosureCheck
    | PhraseRequiredCheck
    | PhraseBannedCheck
    | RateSheetCheck
    | HiddenTextCheck
    | AICheck,
    Field(discriminator="type"),
]


class RuleOut(APIModel):
    id: str
    version: int
    title: str
    kind: RuleKind
    text: str
    jurisdiction: str
    products: list[str]
    channels: list[str]
    citation: Citation | None
    effective_date: date
    owner: str  # name
    severity: Severity
    layer: CheckLayer
    check: RuleCheck
    # A regulatory change that is not decided yet edits this rule (F7)
    pending_change: bool
    versions: list[VersionOut]

    @classmethod
    def of(cls, r: Rule, pending: set[str]) -> "RuleOut":
        return cls(
            id=r.id,
            version=r.version,
            title=r.title,
            kind=r.kind,
            text=r.text,
            jurisdiction=r.jurisdiction,
            products=r.products,
            channels=r.channels,
            citation=Citation(label=r.citation_label, url=r.citation_url) if r.citation_label and r.citation_url else None,
            effective_date=r.effective_date,
            owner=r.owner.name,
            severity=r.severity,
            layer=r.layer,
            check=r.check,  # type: ignore[arg-type]  # pydantic checks the stored shape
            pending_change=r.id in pending,
            versions=[VersionOut(version=v.version, effective_date=v.effective_date, by=v.by.name, note=v.note) for v in r.versions],
        )


RULE_LOAD = (selectinload(Rule.owner), selectinload(Rule.versions).selectinload(RuleVersion.by))


async def pending_rule_ids(db: AsyncSession, viewer: User) -> set[str]:
    """Rules that an undecided regulatory change edits. Worked out each time, so it is never out of date."""
    rows = await db.scalars(
        select(RegChange)
        .where(
            RegChange.workspace_id == viewer.workspace_id,
            RegChange.status.in_([RegChangeStatus.WAITING, RegChangeStatus.IN_REVIEW]),
        )
        .options(selectinload(RegChange.edits))
    )
    return {e.rule_id for c in rows for e in c.edits}


async def load_rule(db: AsyncSession, viewer: User, rule_id: str) -> Rule:
    rule = await db.scalar(
        select(Rule)
        .where(Rule.workspace_id == viewer.workspace_id, Rule.id == rule_id)
        .options(*RULE_LOAD)
        .execution_options(populate_existing=True)
    )
    if rule is None:
        raise not_found("Rule not found")
    return rule


async def rule_saved(db: AsyncSession, viewer: User, rule_id: str) -> RuleOut:
    await db.commit()
    return RuleOut.of(await load_rule(db, viewer, rule_id), await pending_rule_ids(db, viewer))


@router.get("/rules")
async def list_rules(viewer: InternalUser, db: Db) -> list[RuleOut]:
    rules = await db.scalars(
        select(Rule).where(Rule.workspace_id == viewer.workspace_id).options(*RULE_LOAD).order_by(Rule.id)
    )
    pending = await pending_rule_ids(db, viewer)
    return [RuleOut.of(r, pending) for r in rules]


class RuleInput(APIModel):
    title: ShortText
    kind: RuleKind
    text: LongText
    jurisdiction: str
    products: list[Product] = Field(max_length=10)
    channels: list[Channel] = Field(max_length=10)
    citation: Citation | None = None
    effective_date: date
    severity: Severity
    layer: CheckLayer
    check: RuleCheck
    note: Note  # what changed, for the version history

    @field_validator("jurisdiction")
    @classmethod
    def known_jurisdiction(cls, value: str) -> str:
        if value not in ("federal", "all", *US_STATES):
            raise ValueError('Use "federal", "all", or a state code')
        return value

    @model_validator(mode="after")
    def layer_matches_check(self) -> "RuleInput":
        # F4: an AI rule has guidance for the AI; a code rule has a check that code runs.
        if (self.layer is CheckLayer.AI) != (self.check.type == "ai"):
            raise ValueError("An AI rule needs AI guidance, and a code rule needs a code check")
        return self


class NewRule(RuleInput):
    id: TextId


async def check_disclosure_exists(db: AsyncSession, viewer: User, body: RuleInput) -> None:
    disclosure_id = getattr(body.check, "disclosure", None)
    if disclosure_id and not await find_disclosure(db, viewer, disclosure_id):
        raise bad_request(f"Unknown disclosure {disclosure_id}")


def set_rule_fields(rule: Rule, body: RuleInput) -> None:
    rule.title = body.title.strip()
    rule.kind = body.kind
    rule.text = body.text.strip()
    rule.jurisdiction = body.jurisdiction
    rule.products = list(body.products)
    rule.channels = list(body.channels)
    rule.citation_label = body.citation.label if body.citation else None
    rule.citation_url = body.citation.url if body.citation else None
    rule.effective_date = body.effective_date
    rule.severity = body.severity
    rule.layer = body.layer
    rule.check = body.check.model_dump(by_alias=True)


@router.post("/rules", status_code=status.HTTP_201_CREATED)
async def create_rule(body: NewRule, viewer: Manager, db: Db) -> RuleOut:
    if await db.get(Rule, (viewer.workspace_id, body.id)):
        raise conflict("Another rule already uses this ID")
    await check_disclosure_exists(db, viewer, body)
    rule = Rule(workspace_id=viewer.workspace_id, id=body.id, version=1, owner_id=viewer.id)
    set_rule_fields(rule, body)
    rule.versions = [RuleVersion(version=1, effective_date=body.effective_date, by_id=viewer.id, note=body.note.strip())]
    db.add(rule)
    return await rule_saved(db, viewer, rule.id)


@router.patch("/rules/{rule_id}")
async def edit_rule(rule_id: str, body: RuleInput, viewer: Manager, db: Db) -> RuleOut:
    """Every change is a new version. The owner stays the same.
    TODO (F7): flag the approved materials that depend on this rule for re-review, when materials are in the database."""
    rule = await load_rule(db, viewer, rule_id)
    await check_disclosure_exists(db, viewer, body)
    set_rule_fields(rule, body)
    new_rule_version(rule, viewer, body.effective_date, body.note.strip())
    return await rule_saved(db, viewer, rule.id)


def new_rule_version(rule: Rule, viewer: User, effective: date, note: str) -> None:
    rule.version += 1
    rule.versions.insert(0, RuleVersion(version=rule.version, effective_date=effective, by_id=viewer.id, note=note))


# Disclosures (F8)


class DisclosureVersionOut(VersionOut):
    text: str


class DisclosureOut(APIModel):
    id: str
    title: str
    version: int
    text: str
    products: list[str]
    states: Literal["all"] | list[str]
    placement: str
    effective_date: date
    owner: str
    versions: list[DisclosureVersionOut]

    @classmethod
    def of(cls, d: Disclosure) -> "DisclosureOut":
        return cls(
            id=d.id,
            title=d.title,
            version=d.version,
            text=d.text,
            products=d.products,
            states=states_out(d.states),
            placement=d.placement,
            effective_date=d.effective_date,
            owner=d.owner.name,
            versions=[
                DisclosureVersionOut(version=v.version, effective_date=v.effective_date, by=v.by.name, note=v.note, text=v.text)
                for v in d.versions
            ],
        )


DISCLOSURE_LOAD = (selectinload(Disclosure.owner), selectinload(Disclosure.versions).selectinload(DisclosureVersion.by))


async def find_disclosure(db: AsyncSession, viewer: User, disclosure_id: str) -> Disclosure | None:
    return await db.scalar(
        select(Disclosure)
        .where(Disclosure.workspace_id == viewer.workspace_id, Disclosure.id == disclosure_id)
        .options(*DISCLOSURE_LOAD)
        .execution_options(populate_existing=True)
    )


async def load_disclosure(db: AsyncSession, viewer: User, disclosure_id: str) -> Disclosure:
    disclosure = await find_disclosure(db, viewer, disclosure_id)
    if disclosure is None:
        raise not_found("Disclosure not found")
    return disclosure


async def disclosure_saved(db: AsyncSession, viewer: User, disclosure_id: str) -> DisclosureOut:
    await db.commit()
    return DisclosureOut.of(await load_disclosure(db, viewer, disclosure_id))


@router.get("/disclosures")
async def list_disclosures(viewer: InternalUser, db: Db) -> list[DisclosureOut]:
    rows = await db.scalars(
        select(Disclosure)
        .where(Disclosure.workspace_id == viewer.workspace_id)
        .options(*DISCLOSURE_LOAD)
        .order_by(Disclosure.title)
    )
    return [DisclosureOut.of(d) for d in rows]


class DisclosureInput(APIModel):
    title: ShortText
    text: LongText
    products: list[Product] = Field(max_length=10)
    states: Literal["all"] | list[str]
    placement: LongText
    effective_date: date
    note: Note

    @field_validator("states")
    @classmethod
    def known_states(cls, states: Literal["all"] | list[str]) -> Literal["all"] | list[str]:
        return states if states == "all" else check_states(states)


class NewDisclosure(DisclosureInput):
    id: TextId


def set_disclosure_fields(d: Disclosure, body: DisclosureInput) -> None:
    d.title = body.title.strip()
    d.text = body.text.strip()
    d.products = list(body.products)
    d.states = states_in(body.states)
    d.placement = body.placement.strip()
    d.effective_date = body.effective_date


@router.post("/disclosures", status_code=status.HTTP_201_CREATED)
async def create_disclosure(body: NewDisclosure, viewer: Manager, db: Db) -> DisclosureOut:
    if await db.get(Disclosure, (viewer.workspace_id, body.id)):
        raise conflict("Another disclosure already uses this ID")
    d = Disclosure(workspace_id=viewer.workspace_id, id=body.id, version=1, owner_id=viewer.id)
    set_disclosure_fields(d, body)
    d.versions = [
        DisclosureVersion(version=1, effective_date=d.effective_date, by_id=viewer.id, note=body.note.strip(), text=d.text)
    ]
    db.add(d)
    return await disclosure_saved(db, viewer, d.id)


@router.patch("/disclosures/{disclosure_id}")
async def edit_disclosure(disclosure_id: str, body: DisclosureInput, viewer: Manager, db: Db) -> DisclosureOut:
    """Every change is a new version, and each version keeps its full text.
    TODO (F7, F15): flag the approvals that used the old text, when approvals are in the database."""
    d = await load_disclosure(db, viewer, disclosure_id)
    set_disclosure_fields(d, body)
    d.version += 1
    d.versions.insert(
        0,
        DisclosureVersion(
            version=d.version, effective_date=d.effective_date, by_id=viewer.id, note=body.note.strip(), text=d.text
        ),
    )
    return await disclosure_saved(db, viewer, d.id)


# Building blocks (F9)


class SavedFrom(APIModel):
    id: uuid.UUID  # the approved material
    title: ShortText


class BlockOut(APIModel):
    id: uuid.UUID
    kind: BlockKind
    text: str
    products: list[str]
    states: Literal["all"] | list[str]
    approved_by: str
    approved_at: date
    expires_at: date
    saved_from: SavedFrom
    used_in: int

    @classmethod
    def of(cls, b: BuildingBlock) -> "BlockOut":
        return cls(
            id=b.id,
            kind=b.kind,
            text=b.text,
            products=b.products,
            states=states_out(b.states),
            approved_by=b.approved_by.name,
            approved_at=b.approved_at,
            expires_at=b.expires_at,
            saved_from=SavedFrom(id=b.saved_from_id, title=b.saved_from_title),
            used_in=b.used_in,
        )


async def load_block(db: AsyncSession, viewer: User, block_id: uuid.UUID) -> BuildingBlock:
    block = await db.scalar(
        select(BuildingBlock)
        .where(BuildingBlock.workspace_id == viewer.workspace_id, BuildingBlock.id == block_id)
        .options(selectinload(BuildingBlock.approved_by))
        .execution_options(populate_existing=True)
    )
    if block is None:
        raise not_found("Building block not found")
    return block


async def block_saved(db: AsyncSession, viewer: User, block_id: uuid.UUID) -> BlockOut:
    await db.commit()
    return BlockOut.of(await load_block(db, viewer, block_id))


@router.get("/building-blocks")
async def list_blocks(viewer: InternalUser, db: Db) -> list[BlockOut]:
    rows = await db.scalars(
        select(BuildingBlock)
        .where(BuildingBlock.workspace_id == viewer.workspace_id)
        .options(selectinload(BuildingBlock.approved_by))
        .order_by(BuildingBlock.id)
    )
    return [BlockOut.of(b) for b in rows]


class BlockScope(APIModel):
    """Where a block may be used, and until when. An approval is valid only in its context (F9)."""

    products: list[Product] = Field(max_length=10)
    states: Literal["all"] | list[str]
    expires_at: date

    @field_validator("states")
    @classmethod
    def known_states(cls, states: Literal["all"] | list[str]) -> Literal["all"] | list[str]:
        return states if states == "all" else check_states(states)

    @field_validator("expires_at")
    @classmethod
    def in_the_future(cls, value: date) -> date:
        if value <= datetime.now(UTC).date():
            raise ValueError("The expiry date must be in the future")
        return value


class NewBlock(BlockScope):
    kind: BlockKind
    text: LongText
    saved_from: SavedFrom


@router.post("/building-blocks", status_code=status.HTTP_201_CREATED)
async def save_block(body: NewBlock, viewer: Reviewer, db: Db) -> BlockOut:
    """ "Save to library" on an approved material (F9). The one who saves it is the approver of the block.
    TODO: check that the material is approved and contains this text, when materials are in the database."""
    text = body.text.strip()
    taken = await db.scalar(
        select(BuildingBlock.id).where(
            BuildingBlock.workspace_id == viewer.workspace_id, BuildingBlock.kind == body.kind, BuildingBlock.text == text
        )
    )
    if taken:
        raise conflict("This text is already a building block")
    block = BuildingBlock(
        workspace_id=viewer.workspace_id,
        kind=body.kind,
        text=text,
        products=list(body.products),
        states=states_in(body.states),
        approved_by_id=viewer.id,
        approved_at=datetime.now(UTC).date(),
        expires_at=body.expires_at,
        saved_from_id=body.saved_from.id,
        saved_from_title=body.saved_from.title.strip(),
    )
    db.add(block)
    await db.flush()
    return await block_saved(db, viewer, block.id)


@router.patch("/building-blocks/{block_id}")
async def edit_block(block_id: uuid.UUID, body: BlockScope, viewer: Manager, db: Db) -> BlockOut:
    """Managers curate where a block applies and when it expires. The text stays as it was approved."""
    block = await load_block(db, viewer, block_id)
    block.products = list(body.products)
    block.states = states_in(body.states)
    block.expires_at = body.expires_at
    return await block_saved(db, viewer, block.id)


@router.delete("/building-blocks/{block_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_block(block_id: uuid.UUID, viewer: Manager, db: Db) -> None:
    """Materials keep their text; only the library entry goes."""
    await db.delete(await load_block(db, viewer, block_id))
    await db.commit()


# Rate sheet (F8)


class RateRowOut(APIModel):
    key: str
    product: str
    offer: str
    rate: RateKind
    min: float
    max: float
    fees: str


class RateSheetOut(APIModel):
    id: str
    effective_date: date
    uploaded_at: datetime
    uploaded_by: str
    file: str
    rows: list[RateRowOut]

    @classmethod
    def of(cls, s: RateSheet) -> "RateSheetOut":
        return cls(
            id=s.id,
            effective_date=s.effective_date,
            uploaded_at=s.uploaded_at,
            uploaded_by=s.uploaded_by.name,
            file=s.file,
            rows=[RateRowOut.model_validate(r) for r in s.rows],
        )


SHEET_LOAD = (selectinload(RateSheet.uploaded_by), selectinload(RateSheet.rows))


@router.get("/rate-sheets")
async def list_rate_sheets(viewer: InternalUser, db: Db) -> list[RateSheetOut]:
    """Newest first. The first one is the current sheet, which rule RATE-01 checks against (F4)."""
    rows = await db.scalars(
        select(RateSheet)
        .where(RateSheet.workspace_id == viewer.workspace_id)
        .options(*SHEET_LOAD)
        .order_by(RateSheet.effective_date.desc(), RateSheet.uploaded_at.desc())
    )
    return [RateSheetOut.of(s) for s in rows]


CSV_COLUMNS = ["key", "product", "offer", "rate", "min", "max", "fees"]


class RateSheetUpload(APIModel):
    effective_date: date
    file: Annotated[str, Field(min_length=1, max_length=255)]  # the CSV file name
    # The CSV text. Columns: key, product, offer, rate (apr or apy), min, max (in percent, like 8.99), fees.
    csv: Annotated[str, Field(min_length=1, max_length=200_000)]


def percent(value: str, line: int) -> float:
    try:
        number = float(value.strip().removesuffix("%"))
    except ValueError:
        raise bad_request(f"Line {line}: {value!r} is not a number") from None
    if not 0 <= number <= 100:
        raise bad_request(f"Line {line}: a rate must be from 0 to 100 percent")
    return round(number / 100, 6)


def parse_rate_csv(content: str) -> list[RateSheetRow]:
    reader = csv.DictReader(io.StringIO(content.lstrip("﻿")))
    header = [h.strip().lower() for h in reader.fieldnames or []]
    if header != CSV_COLUMNS:
        raise bad_request(f"The CSV needs these columns, in this order: {', '.join(CSV_COLUMNS)}")
    reader.fieldnames = header
    rows: list[RateSheetRow] = []
    keys: set[str] = set()
    for i, raw in enumerate(reader):
        line = i + 2  # line 1 is the header
        if None in raw or any(raw[c] is None for c in CSV_COLUMNS):
            raise bad_request(f"Line {line}: needs {len(CSV_COLUMNS)} columns")
        cell = {c: raw[c].strip() for c in CSV_COLUMNS}
        if not cell["key"] or not cell["offer"]:
            raise bad_request(f"Line {line}: key and offer cannot be empty")
        if cell["key"] in keys:
            raise bad_request(f"Line {line}: the key {cell['key']} is used twice")
        if cell["product"] not in PRODUCTS:
            raise bad_request(f"Line {line}: unknown product {cell['product']!r}")
        if cell["rate"].lower() not in ("apr", "apy"):
            raise bad_request(f"Line {line}: rate must be apr or apy")
        low, high = percent(cell["min"], line), percent(cell["max"], line)
        if low > high:
            raise bad_request(f"Line {line}: min is more than max")
        keys.add(cell["key"])
        rows.append(
            RateSheetRow(
                position=len(rows),
                key=cell["key"][:100],
                product=cell["product"],
                offer=cell["offer"][:300],
                rate=RateKind(cell["rate"].lower()),
                min=low,
                max=high,
                fees=cell["fees"],
            )
        )
    if not rows:
        raise bad_request("The CSV has no rows")
    return rows


@router.post("/rate-sheets", status_code=status.HTTP_201_CREATED)
async def upload_rate_sheet(body: RateSheetUpload, viewer: Manager, db: Db) -> RateSheetOut:
    """A new full sheet. Older sheets stay as history.
    TODO (F6, F7): flag approved materials whose rates are no longer on the sheet, when materials are in the database."""
    sheet = RateSheet(
        workspace_id=viewer.workspace_id,
        effective_date=body.effective_date,
        uploaded_by_id=viewer.id,
        file=body.file.strip(),
        rows=parse_rate_csv(body.csv),
    )
    db.add(sheet)
    await db.flush()
    sheet_id = sheet.id
    await db.commit()
    saved = await db.scalar(
        select(RateSheet)
        .where(RateSheet.workspace_id == viewer.workspace_id, RateSheet.id == sheet_id)
        .options(*SHEET_LOAD)
        .execution_options(populate_existing=True)
    )
    assert saved is not None
    return RateSheetOut.of(saved)


# Regulatory change queue (F7)


class RuleEditOut(APIModel):
    rule_id: str
    before: str
    after: str


class RegChangeOut(APIModel):
    id: str
    title: str
    summary: str
    source: str
    agency: str
    citation: Citation
    published_at: date
    effective_date: date
    status: RegChangeStatus
    edits: list[RuleEditOut]
    reviewing_by: str | None
    decided_by: str | None
    decided_at: datetime | None
    decision_note: str | None

    @classmethod
    def of(cls, c: RegChange) -> "RegChangeOut":
        return cls(
            id=c.id,
            title=c.title,
            summary=c.summary,
            source=c.source,
            agency=c.agency,
            citation=Citation(label=c.citation_label, url=c.citation_url),
            published_at=c.published_at,
            effective_date=c.effective_date,
            status=c.status,
            edits=[RuleEditOut(rule_id=e.rule_id, before=e.before, after=e.after) for e in c.edits],
            reviewing_by=c.reviewing_by.name if c.reviewing_by else None,
            decided_by=c.decided_by.name if c.decided_by else None,
            decided_at=c.decided_at,
            decision_note=c.decision_note,
        )


CHANGE_LOAD = (
    selectinload(RegChange.edits),
    selectinload(RegChange.reviewing_by),
    selectinload(RegChange.decided_by),
)


async def load_change(db: AsyncSession, viewer: User, change_id: str) -> RegChange:
    change = await db.scalar(
        select(RegChange)
        .where(RegChange.workspace_id == viewer.workspace_id, RegChange.id == change_id)
        .options(*CHANGE_LOAD)
        .execution_options(populate_existing=True)
    )
    if change is None:
        raise not_found("Regulatory change not found")
    return change


async def undecided_change(db: AsyncSession, viewer: User, change_id: str) -> RegChange:
    change = await load_change(db, viewer, change_id)
    if change.status not in (RegChangeStatus.WAITING, RegChangeStatus.IN_REVIEW):
        raise conflict("This change is already decided")
    return change


@router.get("/regulatory-changes")
async def list_changes(viewer: InternalUser, db: Db) -> list[RegChangeOut]:
    rows = await db.scalars(
        select(RegChange)
        .where(RegChange.workspace_id == viewer.workspace_id)
        .options(*CHANGE_LOAD)
        .order_by(RegChange.published_at.desc(), RegChange.id)
    )
    return [RegChangeOut.of(c) for c in rows]


class Decision(APIModel):
    note: str | None = Field(default=None, max_length=2000)


def decide(change: RegChange, viewer: User, new_status: RegChangeStatus, note: str | None) -> None:
    change.status = new_status
    change.decided_by_id = viewer.id
    change.decided_at = datetime.now(UTC)
    change.decision_note = note
    change.reviewing_by_id = None


@router.post("/regulatory-changes/{change_id}/apply")
async def apply_change(change_id: str, body: Decision, viewer: Manager, db: Db) -> RegChangeOut:
    """Writes the suggested text into each rule as a new version (R3). Each edit keeps the text the rule had.
    TODO (F7): flag the approved materials that depend on these rules, when materials are in the database."""
    change = await undecided_change(db, viewer, change_id)
    note = (body.note or "").strip() or None
    for edit in change.edits:
        rule = await load_rule(db, viewer, edit.rule_id)
        edit.before = rule.text
        rule.text = edit.after
        rule.effective_date = change.effective_date
        new_rule_version(rule, viewer, change.effective_date, note or f"Applied regulatory change: {change.title}")
    decide(change, viewer, RegChangeStatus.APPLIED, note)
    await db.commit()
    return RegChangeOut.of(await load_change(db, viewer, change_id))


@router.post("/regulatory-changes/{change_id}/dismiss")
async def dismiss_change(change_id: str, body: Decision, viewer: Manager, db: Db) -> RegChangeOut:
    """The rules stay as they are. A dismissal needs a reason, for the audit trail."""
    change = await undecided_change(db, viewer, change_id)
    note = (body.note or "").strip()
    if not note:
        raise bad_request("Say why you dismiss this change")
    decide(change, viewer, RegChangeStatus.DISMISSED, note)
    await db.commit()
    return RegChangeOut.of(await load_change(db, viewer, change_id))
