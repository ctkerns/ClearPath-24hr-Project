import pytest
from sqlalchemy import select

from app.db import SessionLocal
from app.models.audit import AuditEvent
from tests.helpers import ADMIN, AFFILIATE, MANAGER, REVIEWER, as_user


async def test_everyone_reads_workspace_settings(client):
    me = await as_user(client, AFFILIATE)
    assert me["workspaceName"] == "ClearPath demo"
    res = await client.get("/api/workspace")
    assert res.status_code == 200
    body = res.json()
    assert body["isDemo"] is True
    assert body["approvalDays"] == 90
    assert "CA" in body["licensedStates"]
    assert body["issueDueDays"] == {"high": 1, "medium": 3, "low": 7}


async def test_admin_changes_settings_in_picker_order(client):
    await as_user(client, ADMIN)
    res = await client.patch("/api/workspace", json={"licensedStates": ["TX", "DC", "AL", "DE"], "approvalDays": 120})
    assert res.status_code == 200, res.text
    assert res.json()["licensedStates"] == ["AL", "DE", "DC", "TX"]
    after = (await client.get("/api/workspace")).json()
    assert after["approvalDays"] == 120
    assert after["licensedStates"] == ["AL", "DE", "DC", "TX"]


async def test_only_admin_changes_settings(client):
    await as_user(client, MANAGER)
    res = await client.patch("/api/workspace", json={"approvalDays": 120})
    assert res.status_code == 403


@pytest.mark.parametrize(
    ("change", "code"),
    [
        ({"licensedStates": []}, 400),
        ({"licensedStates": ["XX"]}, 422),
        ({"approvalDays": 14}, 422),
        ({"approvalDays": 366}, 422),
    ],
)
async def test_invalid_settings(client, change, code):
    await as_user(client, ADMIN)
    assert (await client.patch("/api/workspace", json=change)).status_code == code


# Default days to fix an issue (PRD F12): policy, so a Manager changes them (section 4)


async def test_manager_changes_issue_due_days(client):
    await as_user(client, MANAGER)
    res = await client.patch("/api/workspace/issue-due-days", json={"high": 2, "low": 10})
    assert res.status_code == 200, res.text
    assert res.json()["issueDueDays"] == {"high": 2, "medium": 3, "low": 10}
    await as_user(client, AFFILIATE)
    assert (await client.get("/api/workspace")).json()["issueDueDays"] == {"high": 2, "medium": 3, "low": 10}
    async with SessionLocal() as db:
        e = (await db.scalars(select(AuditEvent).where(AuditEvent.entity == "workspace"))).one()
    assert e.action == "updated"
    assert e.data == {"issueDueDays": {"before": {"high": 1, "medium": 3, "low": 7}, "after": {"high": 2, "medium": 3, "low": 10}}}


async def test_admin_changes_issue_due_days_and_no_change_records_nothing(client):
    await as_user(client, ADMIN)
    assert (await client.patch("/api/workspace/issue-due-days", json={"medium": 4})).json()["issueDueDays"]["medium"] == 4
    assert (await client.patch("/api/workspace/issue-due-days", json={"medium": 4})).status_code == 200
    async with SessionLocal() as db:
        assert len((await db.scalars(select(AuditEvent).where(AuditEvent.entity == "workspace"))).all()) == 1


@pytest.mark.parametrize("email", [REVIEWER, AFFILIATE])
async def test_below_manager_cannot_change_issue_due_days(client, email):
    await as_user(client, email)
    assert (await client.patch("/api/workspace/issue-due-days", json={"high": 2})).status_code == 403


@pytest.mark.parametrize("change", [{"high": 0}, {"medium": 91}, {"low": -1}, {"high": "soon"}])
async def test_invalid_issue_due_days(client, change):
    await as_user(client, MANAGER)
    assert (await client.patch("/api/workspace/issue-due-days", json=change)).status_code == 422
    assert (await client.get("/api/workspace")).json()["issueDueDays"] == {"high": 1, "medium": 3, "low": 7}
