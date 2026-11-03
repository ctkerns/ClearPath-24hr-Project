"""The workspace calendar: its time zone, today's date, and where a day starts and ends.

Timestamps are stored in UTC. A business date is a day in the workspace's time zone (Workspace.time_zone,
Settings "Workspace" tab), so the server and every viewer agree on it wherever they are: an approval expiry
(PRD F15), the expiring-soon window, rule, disclosure and rate sheet effective dates (F7, F8), building block
expiry (F9), issue due days (F12), review deadline days (F6), and the regulator export range (F15).

Tests change the time with `monkeypatch.setattr(clock, "now", ...)`: every business date comes from now() here.
"""

from datetime import UTC, date, datetime, time, timedelta
from functools import cache
from zoneinfo import ZoneInfo, available_timezones

from app.models import Workspace
from app.models.core import DEFAULT_TIME_ZONE

__all__ = ["DEFAULT_TIME_ZONE", "day_end", "day_of", "day_start", "is_time_zone", "now", "today", "zone"]


def now() -> datetime:
    return datetime.now(UTC)


@cache
def time_zone_names() -> frozenset[str]:
    """Every IANA time zone name, from the tzdata package (the same names as Intl.supportedValuesOf in browsers)."""
    return frozenset(available_timezones())


def is_time_zone(name: str) -> bool:
    return name in time_zone_names()


@cache
def zone_named(name: str) -> ZoneInfo:
    return ZoneInfo(name)


def zone(w: Workspace) -> ZoneInfo:
    return zone_named(w.time_zone)


def today(w: Workspace) -> date:
    """The date in the workspace's time zone now."""
    return day_of(w, now())


def day_of(w: Workspace, t: datetime) -> date:
    """The workspace's date at a time."""
    return t.astimezone(zone(w)).date()


def day_start(w: Workspace, d: date) -> datetime:
    """Midnight at the start of the day in the workspace's time zone, in UTC."""
    return datetime.combine(d, time.min, zone(w)).astimezone(UTC)


def day_end(w: Workspace, d: date) -> datetime:
    """The end of the day in the workspace's time zone: midnight at the start of the next day, in UTC.
    app.business_days.due_day reads a deadline at exactly midnight as the end of the day before, so it is this day."""
    return day_start(w, d + timedelta(days=1))
