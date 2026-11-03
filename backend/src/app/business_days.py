"""Business days (PRD section 2 turnaround, F6 deadlines): Monday to Friday, in UTC.

One module for the dashboard deadlines, the metrics, and the seeded history, so their numbers agree:
`business_days(start, add_business_days(start, n))` is `n`. Holidays do not count as days off (yet).
A business day is continuous time: half of Friday plus half of Monday is one business day.
"""

from datetime import UTC, date, datetime, timedelta

DAY = timedelta(days=1)


def in_utc(t: datetime) -> datetime:
    """The same moment in UTC. A time without a zone is taken as UTC (the database stores UTC)."""
    return t.replace(tzinfo=UTC) if t.tzinfo is None else t.astimezone(UTC)


def midnight(t: datetime) -> datetime:
    return t.replace(hour=0, minute=0, second=0, microsecond=0)


def business_days(start: datetime, end: datetime) -> float:
    """Days between two times, without Saturdays and Sundays (UTC), to one decimal. Zero when end is before start."""
    start, end = in_utc(start), in_utc(end)
    total = timedelta()
    day = midnight(start)
    while day < end:
        nxt = day + DAY
        if day.weekday() < 5:
            total += min(end, nxt) - max(start, day)
        day = nxt
    return round(max(total.total_seconds(), 0) / 86400, 1)


def add_business_days(start: datetime, days: float) -> datetime:
    """The time `days` business days after `start`, skipping Saturdays and Sundays (UTC), to the second.
    A start on a weekend counts from Monday 00:00, so one business day after Saturday is the end of Monday."""
    left, t = timedelta(days=days), in_utc(start)
    while True:
        next_day = midnight(t) + DAY
        if t.weekday() >= 5:
            t = next_day
            continue
        if left <= next_day - t:
            return (t + left).replace(microsecond=0)
        left -= next_day - t
        t = next_day


def review_deadline(submitted_at: datetime, target_business_days: int) -> datetime:
    """When a reviewer group's review is due (PRD F6 "Deadlines"): the submit time plus the group's target."""
    return add_business_days(submitted_at, target_business_days)


def due_day(deadline: datetime) -> date:
    """The UTC day a deadline falls on. A deadline at exactly midnight is the end of the day before."""
    return (in_utc(deadline) - timedelta(microseconds=1)).date()


def days_left(deadline: datetime, at: datetime) -> int:
    """Whole calendar days from `at` to the deadline's day (UTC): 0 is today, 1 tomorrow, negative is late."""
    return (due_day(deadline) - in_utc(at).date()).days
