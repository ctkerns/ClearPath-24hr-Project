"""What every seed module shares: the demo password, the seed files, and the rows made so far."""

import json
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Affiliate, ReviewerGroup, User, Workspace

# Public on purpose: the sign-in page shows it in the "Try the demo" panel (PRD F1).
DEMO_PASSWORD = "clearpath-demo"
DEMO_WORKSPACE_NAME = "ClearPath demo"
DATA = Path(__file__).parent / "data"


def load(name: str, key: str) -> Any:
    """One list or object from a JSON file in seed/data. Each file keeps its rows under one key, next to a _note."""
    return json.loads((DATA / name).read_text())[key]


def parse_time(value: str | None) -> datetime | None:
    return datetime.fromisoformat(value) if value else None


@dataclass
class SeedContext:
    """Rows that earlier seed modules made, so later ones can refer to them.
    The seed files refer to people and groups by name, so these are by name too."""

    db: AsyncSession
    # Also add about a year of past reviews (seed/history.py). The CLI does; the tests do only for the metrics tests.
    history: bool = False
    workspace: Workspace = None  # type: ignore[assignment]  # core.create sets it first
    users: dict[str, User] = field(default_factory=dict)
    groups: dict[str, ReviewerGroup] = field(default_factory=dict)
    affiliates: dict[str, Affiliate] = field(default_factory=dict)
    # Other areas keep their rows here, for example extra["rules"] = {rule_id: Rule}
    extra: dict[str, Any] = field(default_factory=dict)
