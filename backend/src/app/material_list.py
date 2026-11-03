"""The Materials list query: filters, text search, sort and facets (PRD F2). Shared rules are in app.listing.

The route is GET /api/materials in app.materials. The regulator export (app.export) uses the same filters
for "only the materials shown in the list".
"""

from typing import Annotated, Any, Literal

from sqlalchemy import ColumnElement, Select, exists, func, nulls_last, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.listing import Facets, Paging, TextSearch, Values, every, facet_counts
from app.material_access import visible
from app.models import Affiliate, ReviewerGroup, User
from app.models.materials import Channel, GroupReview, LiveStatus, Material, MaterialStatus

Owner = aliased(User, name="owner")

MaterialSort = Literal["updated", "created", "expires", "title"]


class MaterialMatch(TextSearch):
    """The text search and filters of the Materials list. Group, owner and affiliate are names, as the list
    shows them. The regulator export takes these too."""

    status: Annotated[list[MaterialStatus], *Values] = []
    live: Annotated[list[LiveStatus], *Values] = []
    channel: Annotated[list[Channel], *Values] = []
    # Any product ID: an unknown one matches nothing, so an old link or an ID from another workspace is no error.
    product: Annotated[list[str], *Values] = []
    group: Annotated[list[str], *Values] = []
    owner: Annotated[list[str], *Values] = []
    affiliate: Annotated[list[str], *Values] = []


class MaterialFilters(MaterialMatch, Paging):
    """The query parameters of GET /api/materials."""

    sort: MaterialSort = "updated"


# The single-valued fields, for the filters and the facets. Group is many-valued (a material has several groups).
COLUMNS: dict[str, ColumnElement[Any]] = {
    "status": Material.status,
    "live": Material.live_status,
    "channel": Material.channel,
    "product": Material.product,
    "owner": Owner.name,
    "affiliate": Affiliate.name,
}

ORDER: dict[str, tuple[ColumnElement[Any], ...]] = {
    "updated": (Material.updated_at.desc(), Material.id.desc()),
    # IDs are UUIDv7, so they break ties in creation order
    "created": (Material.created_at.desc(), Material.id.desc()),
    # soonest expiry first; materials with no expiry go last
    "expires": (nulls_last(Material.expires_at.asc()), Material.id),
    "title": (func.lower(Material.title), Material.id),
}


def base(viewer: User, p: MaterialMatch, *columns: Any) -> Select[Any]:
    """The materials the viewer may see (material_access.visible) that match the text search, before filters."""
    query = (
        select(*columns)
        .select_from(Material)
        .join(Owner, Owner.id == Material.owner_id)
        .outerjoin(Affiliate, Affiliate.id == Material.affiliate_id)
        .where(*visible(viewer))
    )
    if terms := p.terms():
        # The same fields that the list shows: title, approval ID, affiliate and owner
        where, _ = terms.match(Material.title, Material.title, Material.approval_id, Affiliate.name, Owner.name)
        query = query.where(where)
    return query


def has_group(names: list[str]) -> ColumnElement[bool]:
    return exists(
        select(GroupReview.id)
        .join(ReviewerGroup, ReviewerGroup.id == GroupReview.group_id)
        .where(GroupReview.material_id == Material.id, ReviewerGroup.name.in_(names))
    )


def filters_of(p: MaterialMatch) -> dict[str, ColumnElement[bool]]:
    """One WHERE clause per active filter, by field."""
    clauses = {key: col.in_(getattr(p, key)) for key, col in COLUMNS.items() if getattr(p, key)}
    if p.group:
        clauses["group"] = has_group(p.group)
    return clauses


def filtered(viewer: User, p: MaterialMatch, *columns: Any) -> Select[Any]:
    return base(viewer, p, *columns).where(*filters_of(p).values())


def page_query(viewer: User, p: MaterialFilters) -> Select[Any]:
    query = filtered(viewer, p, Material).order_by(*ORDER[p.sort]).offset(p.offset)
    return query.limit(p.limit) if p.limit else query


async def facets_of(db: AsyncSession, viewer: User, p: MaterialFilters) -> Facets:
    filters = filters_of(p)
    facets = await facet_counts(db, base(viewer, p, Material.id), COLUMNS, filters)
    # Group, in a second query: count each material once per group it waits on or was decided by
    others = [clause for key, clause in filters.items() if key != "group"]
    rows = await db.execute(
        base(viewer, p, ReviewerGroup.name, func.count(func.distinct(Material.id)))
        .join(GroupReview, GroupReview.material_id == Material.id)
        .join(ReviewerGroup, ReviewerGroup.id == GroupReview.group_id)
        .where(every(others))
        .group_by(ReviewerGroup.name)
    )
    facets["group"] = {name: count for name, count in rows.all()}
    return facets
