"""Global search for the Cmd+K palette (PRD section 4, R4).

Each group returns a few results. A result shows only what the viewer could open: materials and issues
follow material_access.visible (affiliates see only their own company), and the library is for
internal users only, like the library API.

Matching, in Postgres:
- Full-text search on titles with the `english` configuration, so "loans" finds "loan" and
  "approved" finds "approval". websearch_to_tsquery accepts any user text without errors.
- Substring matching (ILIKE) for each word, so IDs like "REGZ-1026" or "CP-2026-0118" and half-typed
  words like "summ" also match. Full-text search alone does not match parts of words or IDs.
- No indexes: a workspace has hundreds of rows, so a scan is fast. TODO: GIN indexes (to_tsvector and
  pg_trgm) if workspaces grow to many thousands of materials.
"""

import uuid
from typing import Any

from fastapi import APIRouter, Query
from sqlalchemy import ColumnElement, and_, case, func, literal_column, or_, select

from app.api import APIModel, SignedIn
from app.material_access import Db, visible
from app.materials import expire_approvals
from app.models import Affiliate, Role, User
from app.models.library import BlockKind, BuildingBlock, Disclosure, Rule
from app.models.materials import Channel, Issue, Material, MaterialStatus

router = APIRouter(prefix="/api/search", tags=["search"])

LIMIT = 6  # results per group
MAX_WORDS = 8
CONFIG = literal_column("'english'::regconfig")


class SearchMaterial(APIModel):
    id: uuid.UUID
    title: str
    channel: Channel
    affiliate: str | None = None
    status: MaterialStatus
    approval_id: str | None = None


class SearchIssue(APIModel):
    id: uuid.UUID
    title: str
    material: str | None = None  # null when the issue has no material (unapproved content found live)


class SearchRef(APIModel):
    id: str
    title: str


class SearchBlock(APIModel):
    id: uuid.UUID
    title: str  # the block's text
    kind: BlockKind


class SearchResults(APIModel):
    materials: list[SearchMaterial] = []
    issues: list[SearchIssue] = []
    rules: list[SearchRef] = []
    disclosures: list[SearchRef] = []
    building_blocks: list[SearchBlock] = []


def like_escape(value: str) -> str:
    """So that % and _ in the query are plain characters in a LIKE pattern."""
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


class Terms:
    """The query, ready for SQL."""

    def __init__(self, q: str):
        self.q = q
        self.words = q.split()[:MAX_WORDS]
        self.tsquery = func.websearch_to_tsquery(CONFIG, q)

    def match(self, doc: ColumnElement[Any], *fields: ColumnElement[Any]) -> tuple[ColumnElement[bool], ColumnElement[Any]]:
        """WHERE clause and rank: the full-text search on `doc`, or every word inside one of `fields`."""
        vector = func.to_tsvector(CONFIG, doc)
        haystack = func.concat_ws(" ", *fields)  # skips nulls
        words = and_(*(haystack.ilike(f"%{like_escape(w)}%", escape="\\") for w in self.words))
        return or_(vector.op("@@")(self.tsquery), words), func.ts_rank(vector, self.tsquery)

    def id_rank(self, column: ColumnElement[Any]) -> ColumnElement[int]:
        """2 for the exact ID, 1 for an ID that starts with the query, else 0."""
        return case(
            (func.lower(column) == self.q.lower(), 2),
            (column.ilike(f"{like_escape(self.q)}%", escape="\\"), 1),
            else_=0,
        )


def issue_visible(viewer: User) -> ColumnElement[bool]:
    """An issue is visible when its material is (PRD R4). An issue without a material is internal content:
    never for affiliates. TODO: move this to material_access when issues.material_id becomes nullable."""
    clause = Issue.material_id.in_(select(Material.id).where(*visible(viewer)).correlate(None))
    if viewer.role is Role.AFFILIATE:
        return clause
    return or_(clause, Issue.material_id.is_(None))


@router.get("", response_model_exclude_none=True)
async def search(viewer: SignedIn, db: Db, q: str = Query("", max_length=200)) -> SearchResults:
    q = " ".join(q.split())
    if len(q) < 2:
        return SearchResults()
    terms = Terms(q)
    await expire_approvals(db, viewer)  # so the status is the one the materials list shows (PRD F15)

    where, rank = terms.match(Material.title, Material.title, Material.approval_id, Affiliate.name)
    materials = await db.execute(
        select(Material, Affiliate.name)
        .outerjoin(Affiliate, Affiliate.id == Material.affiliate_id)
        .where(*visible(viewer), where)
        .order_by(terms.id_rank(Material.approval_id).desc(), rank.desc(), Material.updated_at.desc())
        .limit(LIMIT)
    )
    results = SearchResults(
        materials=[
            SearchMaterial(id=m.id, title=m.title, channel=m.channel, affiliate=company, status=m.status, approval_id=m.approval_id)
            for m, company in materials.all()
        ]
    )

    where, rank = terms.match(func.concat_ws(" ", Issue.title, Material.title), Issue.title, Material.title)
    issues = await db.execute(
        select(Issue.id, Issue.title, Material.title)
        .outerjoin(Material, Material.id == Issue.material_id)
        .where(Issue.workspace_id == viewer.workspace_id, issue_visible(viewer), where)
        .order_by(rank.desc(), Issue.opened_at.desc())
        .limit(LIMIT)
    )
    results.issues = [SearchIssue(id=i, title=title, material=material) for i, title, material in issues.all()]

    # The library API is for internal users only; affiliates get 403 there, so no results here.
    if not viewer.role.at_least(Role.VIEWER):
        return results

    where, rank = terms.match(Rule.title, Rule.id, Rule.title)
    rules = await db.execute(
        select(Rule.id, Rule.title)
        .where(Rule.workspace_id == viewer.workspace_id, where)
        .order_by(terms.id_rank(Rule.id).desc(), rank.desc(), Rule.id)
        .limit(LIMIT)
    )
    results.rules = [SearchRef(id=i, title=title) for i, title in rules.all()]

    where, rank = terms.match(Disclosure.title, Disclosure.id, Disclosure.title)
    disclosures = await db.execute(
        select(Disclosure.id, Disclosure.title)
        .where(Disclosure.workspace_id == viewer.workspace_id, where)
        .order_by(terms.id_rank(Disclosure.id).desc(), rank.desc(), Disclosure.id)
        .limit(LIMIT)
    )
    results.disclosures = [SearchRef(id=i, title=title) for i, title in disclosures.all()]

    where, rank = terms.match(BuildingBlock.text, BuildingBlock.text)
    blocks = await db.execute(
        select(BuildingBlock.id, BuildingBlock.text, BuildingBlock.kind)
        .where(BuildingBlock.workspace_id == viewer.workspace_id, where)
        .order_by(rank.desc(), BuildingBlock.approved_at.desc())
        .limit(LIMIT)
    )
    results.building_blocks = [SearchBlock(id=i, title=text, kind=kind) for i, text, kind in blocks.all()]
    return results
