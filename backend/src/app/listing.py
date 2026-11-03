"""Filter, search, sort and paging on the server, shared by the Materials and Issues lists (PRD F2, F12).

The query parameters are the list page's URL search params, with the same names and values
(`?status=submitted,in_review&sort=title&q=summer`), plus `limit`, `offset` and `facets`.
A filter takes several values, comma-separated or repeated (`status=a&status=b`); an item matches
when it has any of them. Different filters must all match. Unknown enum values give 422.

Facets are the counts per value for the filter menus. Each field's counts use the text search and every
filter except the field's own, so a count says how many items one more value of that field would add.
"""

from collections.abc import Mapping, Sequence
from enum import Enum
from typing import Any

from pydantic import BeforeValidator, Field
from sqlalchemy import ColumnElement, Select, and_, func, select, true
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import APIModel
from app.text_match import Terms

MAX_LIMIT = 200
MAX_VALUES = 50  # values in one filter


def comma_values(value: Any) -> Any:
    """`a,b` and `a&a=b` (and a JSON list, for the export body) all give ["a", "b"]."""
    if value is None:
        return []
    if isinstance(value, str):
        value = [value]
    if isinstance(value, list | tuple):
        return [part.strip() for item in value for part in str(item).split(",") if part.strip()]
    return value


# For a filter field: `status: Annotated[list[MaterialStatus], *Values] = []`
Values = (BeforeValidator(comma_values), Field(max_length=MAX_VALUES))


class TextSearch(APIModel):
    q: str = Field("", max_length=200)

    def terms(self) -> Terms | None:
        q = " ".join(self.q.split())
        return Terms(q) if q else None


class Paging(APIModel):
    """Without `limit` the response has every matching row (for the screens that still read the whole list)."""

    limit: int | None = Field(None, ge=1, le=MAX_LIMIT)
    offset: int = Field(0, ge=0)
    facets: bool = False  # also return the counts for the filter menus


Facets = dict[str, dict[str, int]]


def plain(value: Any) -> str:
    return str(value.value if isinstance(value, Enum) else value)


def every(clauses: Sequence[ColumnElement[bool]]) -> ColumnElement[bool]:
    return and_(true(), *clauses)


async def total_of(db: AsyncSession, query: Select[Any]) -> int:
    return await db.scalar(select(func.count()).select_from(query.order_by(None).subquery())) or 0


async def facet_counts(
    db: AsyncSession,
    base: Select[Any],
    columns: Mapping[str, ColumnElement[Any]],
    filters: Mapping[str, ColumnElement[bool]],
) -> Facets:
    """Counts per value of each single-valued column, in one query (GROUP BY GROUPING SETS).

    `base` selects the rows the viewer may see that match the text search. `filters` has one WHERE clause per
    active filter, by field. The inner query labels each value and each filter result, so the outer query can
    count each field with the other fields' filters only. Null values (an internal material has no affiliate)
    are left out, like in the list's filter menus."""
    inner = base.with_only_columns(
        *(col.label(f"v_{key}") for key, col in columns.items()),
        *(clause.label(f"f_{key}") for key, clause in filters.items()),
        maintain_column_froms=True,
    ).subquery()
    counted = []
    for key in columns:
        others = [inner.c[f"f_{k}"] for k in filters if k != key]
        counted.append(func.count().filter(every(others)).label(f"c_{key}"))
    rows = await db.execute(
        select(
            *(inner.c[f"v_{key}"] for key in columns),
            *(func.grouping(inner.c[f"v_{key}"]).label(f"g_{key}") for key in columns),
            *counted,
        ).group_by(func.grouping_sets(*(inner.c[f"v_{key}"] for key in columns)))
    )
    facets: Facets = {key: {} for key in columns}
    for row in rows.mappings():
        for key in columns:
            # GROUPING() is 0 for the column that this row groups by
            if row[f"g_{key}"] == 0 and row[f"v_{key}"] is not None and row[f"c_{key}"]:
                facets[key][plain(row[f"v_{key}"])] = row[f"c_{key}"]
    return facets
