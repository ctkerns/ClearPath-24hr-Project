"""The Issues list query: filters, text search, sort and facets (PRD F12). Shared rules are in app.listing.

The route is GET /api/issues in app.issues.
"""

from datetime import datetime, timedelta
from typing import Annotated, Any, Literal

from sqlalchemy import ColumnElement, Select, case, func, literal, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.listing import Facets, Paging, TextSearch, Values, facet_counts
from app.material_access import issue_visible
from app.models import Affiliate, User
from app.models.materials import Channel, Issue, IssueSource, IssueStatus, Material, Severity

Owner = aliased(User, name="owner")

DueBucket = Literal["overdue", "week", "later"]
IssueSort = Literal["due", "opened", "severity", "title"]
WEEK = timedelta(days=7)


class IssueFilters(TextSearch, Paging):
    """The query parameters of GET /api/issues: text search, filters, sort and paging. Owner and affiliate are names, as the list shows them."""

    status: Annotated[list[IssueStatus], *Values] = []
    severity: Annotated[list[Severity], *Values] = []
    due: Annotated[list[DueBucket], *Values] = []
    source: Annotated[list[IssueSource], *Values] = []
    channel: Annotated[list[Channel], *Values] = []
    owner: Annotated[list[str], *Values] = []
    affiliate: Annotated[list[str], *Values] = []
    sort: IssueSort = "due"


def due_bucket(at: datetime) -> ColumnElement[str | None]:
    """Overdue, due within a week, or later. Resolved issues are in none of them (null)."""
    return case(
        (Issue.status == IssueStatus.RESOLVED, None),
        (Issue.due_at < at, literal("overdue")),
        (Issue.due_at <= at + WEEK, literal("week")),
        else_=literal("later"),
    )


def columns(at: datetime) -> dict[str, ColumnElement[Any]]:
    """The fields, for the filters and the facets. All are single-valued."""
    return {
        "status": Issue.status,
        "severity": Issue.severity,
        "due": due_bucket(at),
        "source": Issue.source,
        # the material's channel, or where monitoring found content that matches no material
        "channel": func.coalesce(Material.channel, Issue.channel),
        "owner": Owner.name,
        "affiliate": Affiliate.name,
    }


resolved_last = case((Issue.status == IssueStatus.RESOLVED, 1), else_=0)
severity_rank = case((Issue.severity == Severity.HIGH, 0), (Issue.severity == Severity.MEDIUM, 1), else_=2)

ORDER: dict[str, tuple[ColumnElement[Any], ...]] = {
    # Resolved issues go last, so the work to do stays at the top
    "due": (resolved_last, Issue.due_at, Issue.id),
    "opened": (Issue.opened_at.desc(), Issue.id.desc()),
    "severity": (resolved_last, severity_rank, Issue.due_at, Issue.id),
    "title": (func.lower(Issue.title), Issue.id),
}


def base(viewer: User, p: IssueFilters, *cols: Any) -> Select[Any]:
    """The issues the viewer may see (material_access.issue_visible) that match the text search, before filters."""
    query = (
        select(*cols)
        .select_from(Issue)
        .join(Owner, Owner.id == Issue.owner_id)
        .outerjoin(Material, Material.id == Issue.material_id)
        .outerjoin(Affiliate, Affiliate.id == Material.affiliate_id)
        .where(*issue_visible(viewer))
    )
    if terms := p.terms():
        # The same fields that the list shows: title, material, affiliate and owner
        doc = func.concat_ws(" ", Issue.title, Material.title)
        where, _ = terms.match(doc, Issue.title, Material.title, Affiliate.name, Owner.name)
        query = query.where(where)
    return query


def filters_of(p: IssueFilters, at: datetime) -> dict[str, ColumnElement[bool]]:
    return {key: col.in_(getattr(p, key)) for key, col in columns(at).items() if getattr(p, key)}


def page_query(viewer: User, p: IssueFilters, at: datetime) -> Select[Any]:
    query = base(viewer, p, Issue).where(*filters_of(p, at).values()).order_by(*ORDER[p.sort]).offset(p.offset)
    return query.limit(p.limit) if p.limit else query


async def facets_of(db: AsyncSession, viewer: User, p: IssueFilters, at: datetime) -> Facets:
    return await facet_counts(db, base(viewer, p, Issue.id), columns(at), filters_of(p, at))
