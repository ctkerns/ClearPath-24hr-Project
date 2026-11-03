"""The workspace time zone (app.clock): the setting, and the business dates that use it. Expiry turns at midnight
in the workspace's time zone, not in UTC (PRD F15); a default issue due date is the end of a day there (F12)."""

import io
import zipfile
from datetime import UTC, date, datetime

import pytest
from sqlalchemy import select, update

from app import clock
from app.db import SessionLocal
from app.models.audit import AuditEvent
from app.models.materials import Material, MaterialVersion
from tests.helpers import ADMIN, MANAGER, SUBMITTER, as_user

VIEWER = "ben.okafor@demo.clearpathcu.org"
APPROVED = "01a10017-2800-7389-b220-910ed92e6d2d"  # approved, expires 2026-11-20
SUMMER = "01a112a1-4000-7d42-94be-d09364e3b51d"


def at(monkeypatch, t: datetime) -> None:
    """Sets the server's clock (app.clock.now) to `t`."""
    monkeypatch.setattr(clock, "now", lambda: t)


async def status_of(client, material_id: str) -> str:
    return next(m for m in (await client.get("/api/materials")).json()["items"] if m["id"] == material_id)["status"]


async def test_everyone_reads_the_time_zone(client):
    me = await as_user(client, SUBMITTER)
    assert me["timeZone"] == "America/Los_Angeles"
    assert (await client.get("/api/workspace")).json()["timeZone"] == "America/Los_Angeles"


async def test_expiry_turns_at_midnight_in_the_workspace_time_zone(client, monkeypatch):
    async with SessionLocal() as db, db.begin():
        await db.execute(update(Material).where(Material.id == APPROVED).values(expires_at=date(2027, 2, 1)))
    await as_user(client, VIEWER)
    # Midnight UTC on Feb 1 is the afternoon of Jan 31 in California: still approved.
    at(monkeypatch, datetime(2027, 2, 1, 0, 0, tzinfo=UTC))
    assert await status_of(client, APPROVED) == "approved"
    at(monkeypatch, datetime(2027, 2, 1, 7, 59, tzinfo=UTC))  # 23:59 on Jan 31, PST
    assert await status_of(client, APPROVED) == "approved"
    at(monkeypatch, datetime(2027, 2, 1, 8, 0, tzinfo=UTC))  # midnight on Feb 1, PST
    assert await status_of(client, APPROVED) == "expired"
    async with SessionLocal() as db:
        expired = await db.scalars(select(AuditEvent).where(AuditEvent.entity_id == APPROVED, AuditEvent.action == "approval_expired"))
        assert len(expired.all()) == 1


async def test_expiry_follows_a_changed_time_zone(client, monkeypatch):
    async with SessionLocal() as db, db.begin():
        await db.execute(update(Material).where(Material.id == APPROVED).values(expires_at=date(2027, 2, 1)))
    await as_user(client, ADMIN)
    assert (await client.patch("/api/workspace", json={"timeZone": "Asia/Tokyo"})).status_code == 200
    at(monkeypatch, datetime(2027, 1, 31, 14, 59, tzinfo=UTC))  # 23:59 on Jan 31 in Tokyo
    assert await status_of(client, APPROVED) == "approved"
    at(monkeypatch, datetime(2027, 1, 31, 15, 0, tzinfo=UTC))  # midnight on Feb 1 in Tokyo, still Jan 31 in UTC
    assert await status_of(client, APPROVED) == "expired"


async def test_dashboard_expiring_window_counts_workspace_days(client, monkeypatch):
    async with SessionLocal() as db, db.begin():
        await db.execute(update(Material).where(Material.id == APPROVED).values(expires_at=date(2027, 3, 3)))
    await as_user(client, MANAGER)
    # Feb 1 in California (Feb 2 in UTC): Mar 3 is 30 days away, so it is in the window.
    at(monkeypatch, datetime(2027, 2, 2, 6, 0, tzinfo=UTC))
    expiring = (await client.get("/api/dashboard")).json()["workspace"]["expiring"]
    assert APPROVED in [e["id"] for e in expiring]


async def test_admin_changes_the_time_zone_with_an_audit_entry(client):
    me = await as_user(client, ADMIN)
    res = await client.patch("/api/workspace", json={"timeZone": "America/New_York"})
    assert res.status_code == 200, res.text
    assert res.json()["timeZone"] == "America/New_York"
    assert (await client.get("/api/auth/me")).json()["timeZone"] == "America/New_York"
    async with SessionLocal() as db:
        e = (await db.scalars(select(AuditEvent).where(AuditEvent.entity == "workspace"))).one()
    assert (e.action, str(e.actor_id)) == ("updated", me["id"])
    assert e.data == {"timeZone": {"before": "America/Los_Angeles", "after": "America/New_York"}}
    # The same zone again changes nothing, so it records nothing.
    assert (await client.patch("/api/workspace", json={"timeZone": "America/New_York"})).status_code == 200
    async with SessionLocal() as db:
        assert len((await db.scalars(select(AuditEvent).where(AuditEvent.entity == "workspace"))).all()) == 1


@pytest.mark.parametrize("email", [MANAGER, SUBMITTER])
async def test_only_admin_changes_the_time_zone(client, email):
    await as_user(client, email)
    assert (await client.patch("/api/workspace", json={"timeZone": "America/New_York"})).status_code == 403


@pytest.mark.parametrize("name", ["Mars/Olympus_Mons", "", "america/los_angeles", "../../etc/passwd", "PST"])
async def test_unknown_time_zone_is_rejected(client, name):
    await as_user(client, ADMIN)
    assert (await client.patch("/api/workspace", json={"timeZone": name})).status_code == 422
    assert (await client.get("/api/workspace")).json()["timeZone"] == "America/Los_Angeles"


async def test_default_issue_due_date_is_the_end_of_a_workspace_day(client, monkeypatch):
    await as_user(client, SUBMITTER)
    owner = next(u["id"] for u in (await client.get("/api/users")).json() if u["email"] == SUBMITTER)
    await as_user(client, MANAGER)
    # 23:30 on Nov 3 in California, already Nov 4 in UTC. A High issue gets one day: the end of Nov 4 there.
    at(monkeypatch, datetime(2026, 11, 4, 7, 30, tzinfo=UTC))
    body = {"materialId": SUMMER, "title": "Rate is wrong", "summary": "8.99% is not on the rate sheet.", "severity": "high", "ownerId": owner}
    res = await client.post("/api/issues", json=body)
    assert res.status_code == 201, res.text
    assert datetime.fromisoformat(res.json()["dueAt"]) == datetime(2026, 11, 5, 8, 0, tzinfo=UTC)  # midnight PST


async def test_export_range_is_in_workspace_days(client):
    debt = "01a0d660-7200-7f2e-846a-4b2b8dd2f651"
    async with SessionLocal() as db, db.begin():
        first = await db.scalar(select(MaterialVersion).where(MaterialVersion.material_id == debt, MaterialVersion.number == 1))
        first.submitted_at = datetime(2024, 3, 2, 5, 0, tzinfo=UTC)  # 21:00 on Mar 1 in California
    await as_user(client, VIEWER)

    async def exported(day: str) -> bool:
        res = await client.post("/api/exports/regulator", json={"dateFrom": day, "dateTo": day})
        assert res.status_code == 200, res.text
        return debt in zipfile.ZipFile(io.BytesIO(res.content)).read("materials.csv").decode()

    assert await exported("2024-03-01")
    assert not await exported("2024-03-02")


def test_day_bounds_follow_daylight_saving():
    class W:
        time_zone = "America/Los_Angeles"

    w = W()
    assert clock.day_start(w, date(2026, 11, 1)) == datetime(2026, 11, 1, 7, 0, tzinfo=UTC)  # PDT
    assert clock.day_end(w, date(2026, 11, 1)) == datetime(2026, 11, 2, 8, 0, tzinfo=UTC)  # PST: a 25 hour day
    assert clock.day_of(w, datetime(2026, 11, 2, 7, 59, tzinfo=UTC)) == date(2026, 11, 1)
