from datetime import UTC, date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from app import metrics
from app.business_days import add_business_days, business_days, days_left, due_day, review_deadline
from app.seed import history

FRIDAY = datetime(2026, 10, 30, 15, 0, tzinfo=UTC)
SATURDAY = datetime(2026, 10, 31, 10, 0, tzinfo=UTC)


def test_one_module_everywhere():
    # Metrics and the seed use the same functions, so their numbers agree with the dashboard deadlines.
    assert metrics.business_days is business_days
    assert history.add_business_days is add_business_days


def test_weekends_do_not_count():
    assert add_business_days(FRIDAY, 1) == datetime(2026, 11, 2, 15, 0, tzinfo=UTC)  # Monday
    assert add_business_days(FRIDAY, 2) == datetime(2026, 11, 3, 15, 0, tzinfo=UTC)
    assert add_business_days(FRIDAY, 0.5) == datetime(2026, 11, 2, 3, 0, tzinfo=UTC)  # 9 h Friday + 3 h Monday
    # From a weekend, the clock starts on Monday 00:00: one business day is the end of Monday.
    assert add_business_days(SATURDAY, 1) == datetime(2026, 11, 3, tzinfo=UTC)
    assert business_days(SATURDAY, datetime(2026, 11, 2, tzinfo=UTC)) == 0.0
    assert business_days(FRIDAY, FRIDAY - timedelta(days=1)) == 0.0


def test_add_and_count_agree():
    for start in (FRIDAY, SATURDAY, datetime(2026, 11, 4, 23, 59, tzinfo=UTC)):
        for n in (1, 2, 3, 5, 10):
            assert business_days(start, add_business_days(start, n)) == n


def test_time_zones_are_utc():
    # Friday 23:30 in New York is Saturday 03:30 UTC: the weekend has started.
    new_york = timezone(timedelta(hours=-4))
    late_friday = datetime(2026, 10, 30, 23, 30, tzinfo=new_york)
    assert add_business_days(late_friday, 1) == datetime(2026, 11, 3, tzinfo=UTC)
    # Monday 08:00 in Tokyo is Sunday 23:00 UTC.
    tokyo = timezone(timedelta(hours=9))
    assert business_days(datetime(2026, 11, 2, 8, 0, tzinfo=tokyo), datetime(2026, 11, 2, 12, 0, tzinfo=UTC)) == 0.5
    # A time without a zone is UTC.
    assert add_business_days(FRIDAY.replace(tzinfo=None), 1) == datetime(2026, 11, 2, 15, 0, tzinfo=UTC)


def test_deadline_and_days_left():
    deadline = review_deadline(FRIDAY, 2)
    assert deadline == datetime(2026, 11, 3, 15, 0, tzinfo=UTC)
    assert days_left(deadline, datetime(2026, 11, 3, 9, 0, tzinfo=UTC)) == 0  # due today
    assert days_left(deadline, datetime(2026, 11, 2, 23, 0, tzinfo=UTC)) == 1
    assert days_left(deadline, datetime(2026, 11, 5, 9, 0, tzinfo=UTC)) == -2
    # A deadline at midnight is the end of the day before.
    assert due_day(datetime(2026, 11, 3, tzinfo=UTC)) == date(2026, 11, 2)
    assert days_left(datetime(2026, 11, 3, tzinfo=UTC), datetime(2026, 11, 2, 12, 0, tzinfo=UTC)) == 0


def test_days_of_the_workspace_time_zone():
    la = ZoneInfo("America/Los_Angeles")
    friday_night = datetime(2026, 10, 31, 6, 0, tzinfo=UTC)  # Friday 23:00 in California, Saturday in UTC
    # One hour of Friday is left in California, then Monday (after the daylight saving change on Sunday) has the rest.
    assert add_business_days(friday_night, 1, la) == datetime(2026, 11, 3, 7, 0, tzinfo=UTC)  # Monday 23:00 PST
    assert add_business_days(friday_night, 1) == datetime(2026, 11, 3, tzinfo=UTC)  # UTC: Saturday, so from Monday
    assert business_days(friday_night, datetime(2026, 11, 3, 7, 0, tzinfo=UTC), la) == 1.0
    for n in (1, 2, 5):
        assert business_days(friday_night, add_business_days(friday_night, n, la), la) == n
    # The due day and the days left count California days.
    deadline = datetime(2026, 11, 3, 7, 0, tzinfo=UTC)
    assert due_day(deadline, la) == date(2026, 11, 2)
    assert due_day(deadline) == date(2026, 11, 3)
    assert days_left(deadline, datetime(2026, 11, 3, 1, 0, tzinfo=UTC), la) == 0  # Monday evening in California
    assert days_left(deadline, datetime(2026, 11, 3, 1, 0, tzinfo=UTC)) == 0
    assert days_left(deadline, datetime(2026, 11, 2, 6, 0, tzinfo=UTC), la) == 1  # Sunday night in California
