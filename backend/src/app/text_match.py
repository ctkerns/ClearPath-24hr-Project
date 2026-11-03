"""Text matching for search: the Cmd+K palette (app.search) and the Materials and Issues lists.

Matching, in Postgres:
- Full-text search with the `english` configuration, so "loans" finds "loan" and "approved" finds
  "approval". websearch_to_tsquery accepts any user text without errors.
- Substring matching (ILIKE) for each word, so IDs like "REGZ-1026" or "CP-2026-0118" and half-typed
  words like "summ" also match. Full-text search alone does not match parts of words or IDs.
- No indexes: a workspace has hundreds of rows, so a scan is fast. TODO: GIN indexes (to_tsvector and
  pg_trgm) if workspaces grow to many thousands of materials.
"""

from typing import Any

from sqlalchemy import ColumnElement, and_, case, func, literal_column, or_

MAX_WORDS = 8
CONFIG = literal_column("'english'::regconfig")


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
