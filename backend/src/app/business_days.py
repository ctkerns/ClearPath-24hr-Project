"""Business days (PRD section 2 turnaround, F6 deadlines): Monday to Friday, in the workspace's time zone.

One module for the dashboard deadlines, the metrics, and the seeded history, so their numbers agree:
`business_days(start, add_business_days(start, n))` is `n`. Holidays do not count as days off (yet).
A business day is continuous time: half of Friday plus half of Monday is one business day.
Each function takes the time zone of its days (app.clock.zone of the workspace); without one, the days are UTC days.
"""

from datetime import UTC, date, datetime, time, timedelta, tzinfo

DAY = timedelta(days=1)


def in_utc(t: datetime) -> datetime:
    """The same moment in UTC. A time without a zone is taken as UTC (the database stores UTC)."""
    return t.replace(tzinfo=UTC) if t.tzinfo is None else t.astimezone(UTC)


def day_of(t: datetime, tz: tzinfo) -> date:
    """The date at a time, in the time zone."""
    return in_utc(t).astimezone(tz).date()


def midnight(d: date, tz: tzinfo) -> datetime:
    """The start of the day in the time zone, in UTC. The arithmetic stays in UTC, so a day with a daylight
    saving change has its real length (23 or 25 hours)."""
    return datetime.combine(d, time.min, tz).astimezone(UTC)


def business_days(start: datetime, end: datetime, tz: tzinfo = UTC) -> float:
    """Days between two times, without Saturdays and Sundays, to one decimal. Zero when end is before start."""
    start, end = in_utc(start), in_utc(end)
    total = timedelta()
    d = day_of(start, tz)
    day = midnight(d, tz)
    while day < end:
        nxt = midnight(d + DAY, tz)
        if d.weekday() < 5:
            total += min(end, nxt) - max(start, day)
        d, day = d + DAY, nxt
    return round(max(total.total_seconds(), 0) / 86400, 1)


def add_business_days(start: datetime, days: float, tz: tzinfo = UTC) -> datetime:
    """The time `days` business days after `start`, skipping Saturdays and Sundays, to the second.
    A start on a weekend counts from Monday 00:00, so one business day after Saturday is the end of Monday."""
    left, t = timedelta(days=days), in_utc(start)
    while True:
        d = day_of(t, tz)
        next_day = midnight(d + DAY, tz)
        if d.weekday() >= 5:
            t = next_day
            continue
        if left <= next_day - t:
            return (t + left).replace(microsecond=0)
        left -= next_day - t
        t = next_day


def review_deadline(submitted_at: datetime, target_business_days: int, tz: tzinfo = UTC) -> datetime:
    """When a reviewer group's review is due (PRD F6 "Deadlines"): the submit time plus the group's target."""
    return add_business_days(submitted_at, target_business_days, tz)


def due_day(deadline: datetime, tz: tzinfo = UTC) -> date:
    """The day a deadline falls on. A deadline at exactly midnight is the end of the day before."""
    return day_of(in_utc(deadline) - timedelta(microseconds=1), tz)


def days_left(deadline: datetime, at: datetime, tz: tzinfo = UTC) -> int:
    """Whole calendar days from `at` to the deadline's day: 0 is today, 1 tomorrow, negative is late."""
    return (due_day(deadline, tz) - day_of(at, tz)).days
