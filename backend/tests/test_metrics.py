"""Metrics (PRD F14, section 2), and the fields they need: comments on selected text, issue kinds,
issues with no material, and problems that were already there at approval."""

import statistics
import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select, text

from app.db import SessionLocal, engine
from app.metrics import business_days, overlaps
from app.models import Base, Role, User, Workspace
from app.models.materials import (
    Channel,
    Finding,
    FindingSource,
    FindingStatus,
    Issue,
    IssueKind,
    IssueSource,
    IssueStatus,
    MaterialVersion,
    Severity,
)
from app.security import hash_password
from app.seed import DEMO_PASSWORD, create_demo
from tests.helpers import ADMIN, AFFILIATE, MANAGER, REVIEWER, SUBMITTER, as_user

VIEWER = "ben.okafor@demo.clearpathcu.org"
SUMMER = "01a112a1-4000-7d42-94be-d09364e3b51d"  # in review, version 2
DEBT = "01a0d660-7200-7f2e-846a-4b2b8dd2f651"  # approved again at version 3, by the lighter path


async def user_id(client, email):
    return next(u["id"] for u in (await client.get("/api/users")).json() if u["email"] == email)


def due(days=3):
    return (datetime.now(UTC) + timedelta(days=days)).isoformat()


async def metrics(client):
    res = await client.get("/api/metrics")
    assert res.status_code == 200, res.text
    return res.json()


def test_business_days_and_overlap():
    friday = datetime(2026, 10, 30, 12, tzinfo=UTC)
    assert business_days(friday, friday + timedelta(days=3)) == 1.0  # to Monday noon: the weekend does not count
    assert business_days(friday, friday + timedelta(hours=6)) == 0.2
    assert overlaps("Approval  guaranteed.", "approval guaranteed") and not overlaps("Rates", "Approval")


# Who may read


async def test_roles(client):
    assert (await client.get("/api/metrics")).status_code == 401
    await as_user(client, AFFILIATE)
    assert (await client.get("/api/metrics")).status_code == 403
    for email in (VIEWER, SUBMITTER, ADMIN):
        await as_user(client, email)
        assert (await client.get("/api/metrics")).status_code == 200


async def test_other_workspace_sees_nothing(client):
    async with SessionLocal() as db, db.begin():
        other = Workspace(name="Real credit union")
        db.add(other)
        await db.flush()
        db.add(User(workspace_id=other.id, email="boss@real.example", name="Boss", role=Role.ADMIN, password_hash=hash_password(DEMO_PASSWORD)))
    await as_user(client, "boss@real.example")
    assert await metrics(client) == {"decisions": [], "violations": []}


# Records from the demo rows


async def test_demo_records(client):
    await as_user(client, VIEWER)
    data = await metrics(client)
    # The debt payoff ad: version 3 approved by the lighter path, with a decision comment.
    assert data["decisions"] == [
        {
            "decidedAt": "2026-07-09T11:00:00Z", "channel": "google", "product": "personal_loan", "groups": ["Compliance"],
            "path": "no_change", "turnaroundDays": 0.9, "rounds": 1, "outcome": "approved", "findings": [],
            "aiFindings": 0, "aiOutdated": 0, "humanComments": 0, "humanUncovered": 0, "laterViolation": False,
        }
    ]
    # One violation for each demo issue with a kind; reviewer issues that are not live problems have none.
    kinds = sorted(v["kind"] for v in data["violations"])
    assert kinds == ["changed"] * 3 + ["condition_broken"] * 3 + ["expired_approval"] + ["unapproved"] * 2
    fixed = [v for v in data["violations"] if "daysToFix" in v]
    assert sorted(v["daysToFix"] for v in fixed) == [3.2, 3.4]


async def test_review_flow_record(client):
    """Submit, two comments on selected text, request changes, a new version, approve: one decision record."""
    await as_user(client, SUBMITTER)
    body = {
        "title": "Winter loan ad",
        "channel": "meta",
        "product": "personal_loan",
        "fields": [{"label": "Headline", "text": "Loans for winter"}, {"label": "Primary text", "text": "Approval guaranteed. Rates from 8.99% APR."}],
        # One state, not nationwide: the server routes it to Compliance only (Legal reviews loans sold nationwide).
        "nationwide": False,
        "states": ["CA"],
    }
    material_id = (await client.post("/api/materials", json=body)).json()["id"]
    # Code pre-review runs on submit (PRD F4 layer 1). The AI layer does not exist yet, so its finding is added here.
    async with SessionLocal() as db, db.begin():
        version = await db.scalar(select(MaterialVersion).where(MaterialVersion.material_id == uuid.UUID(material_id)))
        db.add(Finding(workspace_id=version.workspace_id, material_id=version.material_id, version_id=version.id,
                       source=FindingSource.AI, severity=Severity.MEDIUM, rule_id="UDAAP-03", status=FindingStatus.OPEN,
                       flagged_text="Approval guaranteed", explanation="No promise of guaranteed approval."))

    await as_user(client, REVIEWER)
    for field, selected in (("Primary text", "Approval guaranteed."), ("Headline", "Loans for winter")):
        res = await client.post(f"/api/materials/{material_id}/comments", json={"body": "Please change this.", "anchor": {"field": field, "text": selected}})
        assert res.status_code == 201, res.text
    res = await client.post(f"/api/materials/{material_id}/decisions", json={"decision": "request_changes", "text": "Fix it."})
    assert res.status_code == 200, res.text

    await as_user(client, SUBMITTER)
    fixed = body | {"fields": [{"label": "Headline", "text": "Loans for winter"}, {"label": "Primary text", "text": "Subject to credit approval."}]}
    assert (await client.post(f"/api/materials/{material_id}/versions", json=fixed)).status_code == 201

    await as_user(client, REVIEWER)
    assert (await client.post(f"/api/materials/{material_id}/decisions", json={"decision": "approve"})).status_code == 200
    record = next(d for d in (await metrics(client))["decisions"] if d["channel"] == "meta")
    assert {k: v for k, v in record.items() if k not in ("decidedAt", "turnaroundDays")} == {
        "channel": "meta", "product": "personal_loan", "groups": ["Compliance"], "path": "full", "rounds": 2,
        "outcome": "approved", "findings": ["REGZ-1026.24", "UDAAP-03", "NCUA-740"], "aiFindings": 1, "aiOutdated": 1,
        "humanComments": 2, "humanUncovered": 1, "laterViolation": False,
    }
    assert 0 <= record["turnaroundDays"] < 1

    # A reviewer finds later that the approved version already broke a rule (PRD F5, section 2).
    owner = await user_id(client, SUBMITTER)
    issue = {"materialId": material_id, "title": "Missed claim", "summary": "It was in the approved text.", "severity": "medium",
             "ownerId": owner, "dueAt": due(), "kind": "changed", "presentAtApproval": True}
    res = await client.post("/api/issues", json=issue)
    assert res.status_code == 201, res.text
    assert (res.json()["kind"], res.json()["channel"]) == ("changed", "meta")
    data = await metrics(client)
    assert next(d for d in data["decisions"] if d["channel"] == "meta")["laterViolation"] is True
    found = [v for v in data["violations"] if v["channel"] == "meta" and v["product"] == "personal_loan" and v["kind"] == "changed"]
    assert len(found) == 1 and "daysToFix" not in found[0]


# Comments on selected text (PRD F5)


async def test_comment_anchor(client):
    await as_user(client, REVIEWER)
    anchor = {"field": "Primary text", "text": "Approval in minutes"}
    res = await client.post(f"/api/materials/{SUMMER}/comments", json={"body": "Too strong.", "anchor": anchor})
    assert res.status_code == 201, res.text
    saved = res.json()["comments"][-1]
    assert (saved["body"], saved["anchor"]) == ("Too strong.", anchor)
    # The seeded comment on "$199/month" keeps its anchor; comments without one have none.
    comments = (await client.get(f"/api/materials/{SUMMER}")).json()["comments"]
    assert [c.get("anchor", {}).get("text") for c in comments] == [None, "for as low as $199/month", "Approval in minutes"]
    for wrong in ({"field": "Primary text", "text": "Not in the ad"}, {"field": "Nope", "text": "Approval in minutes"}):
        assert (await client.post(f"/api/materials/{SUMMER}/comments", json={"body": "x", "anchor": wrong})).status_code == 400


# Issues (PRD F10, F12)


async def add_unmatched_issue() -> uuid.UUID:
    """Unapproved content that monitoring found live and that matches no material (PRD F10)."""
    async with SessionLocal() as db, db.begin():
        workspace = await db.scalar(select(Workspace).where(Workspace.is_demo))
        owner = await db.scalar(select(User).where(User.email == SUBMITTER))
        now = datetime.now(UTC)
        issue = Issue(workspace_id=workspace.id, material_id=None, channel=Channel.META, kind=IssueKind.UNAPPROVED,
                      title="Unknown ad found live", severity=Severity.HIGH, status=IssueStatus.OPEN, source=IssueSource.MONITORING,
                      owner_id=owner.id, opened_at=now, due_at=now + timedelta(days=1))
        db.add(issue)
        await db.flush()
        return issue.id


async def test_issue_without_material(client):
    issue_id = str(await add_unmatched_issue())
    await as_user(client, VIEWER)
    row = next(i for i in (await client.get("/api/issues")).json() if i["id"] == issue_id)
    assert "material" not in row and (row["channel"], row["kind"]) == ("meta", "unapproved")
    assert (await client.get(f"/api/issues/{issue_id}")).status_code == 200
    violation = next(v for v in (await metrics(client))["violations"] if v["kind"] == "unapproved" and v["channel"] == "meta" and "product" not in v)
    assert "daysToFix" not in violation
    # Internal users only (PRD R4)
    await as_user(client, AFFILIATE)
    assert issue_id not in {i["id"] for i in (await client.get("/api/issues")).json()}
    assert (await client.get(f"/api/issues/{issue_id}")).status_code == 404
    assert (await client.post(f"/api/issues/{issue_id}/comments", json={"text": "x"})).status_code == 404
    # The owner, or a Manager, works on it like any other issue.
    await as_user(client, MANAGER)
    res = await client.patch(f"/api/issues/{issue_id}", json={"status": "resolved", "note": "Paused the ad."})
    assert res.status_code == 200, res.text


async def test_raise_issue_kind_and_approval(client):
    await as_user(client, REVIEWER)
    owner = await user_id(client, SUBMITTER)
    body = {"title": "T", "summary": "S", "severity": "low", "ownerId": owner, "dueAt": due()}
    res = await client.post("/api/issues", json=body | {"materialId": DEBT, "kind": "condition_broken", "presentAtApproval": True})
    assert res.status_code == 201, res.text
    async with SessionLocal() as db:
        issue = await db.get(Issue, uuid.UUID(res.json()["id"]))
        version = await db.get(MaterialVersion, issue.approved_version_id)
        assert (issue.kind, issue.present_at_approval, version.number) == (IssueKind.CONDITION_BROKEN, True, 3)
    # No kind: not a live problem. No approved version: nothing was there at approval.
    res = await client.post("/api/issues", json=body | {"materialId": SUMMER})
    assert res.status_code == 201 and "kind" not in res.json()
    assert (await client.post("/api/issues", json=body | {"materialId": SUMMER, "presentAtApproval": True})).status_code == 400
    assert (await client.post("/api/issues", json=body | {"materialId": SUMMER, "kind": "drift"})).status_code == 422


# The year of past reviews (seed/history.py)


def summary(decisions):
    """The headline figures, counted like the page (frontend metrics-data.ts `summary`)."""
    approved = [d for d in decisions if d["outcome"] == "approved"]
    full = [d for d in decisions if d["path"] == "full"]
    return {
        "count": len(decisions),
        "median": statistics.median(d["turnaroundDays"] for d in decisions),
        "firstPass": sum(d["rounds"] == 1 for d in approved) / len(approved),
        "laterViolation": sum(d["laterViolation"] for d in approved),
        "aiFixRate": sum(d["aiOutdated"] for d in full) / sum(d["aiFindings"] for d in full),
        "aiMissRate": sum(d["humanUncovered"] for d in full) / sum(d["humanComments"] for d in full),
    }


@pytest.mark.history
async def test_history_numbers(client):
    await as_user(client, VIEWER)
    data = await metrics(client)
    decisions, violations = data["decisions"], data["violations"]
    year_ago = (datetime.now(UTC) - timedelta(days=365)).isoformat()
    assert all(d["decidedAt"] >= year_ago for d in decisions)
    s = summary(decisions)
    # Close to the old demo file: 425 decisions, median 2.8 days (full path), 8 approvals with a later problem.
    assert 360 <= s["count"] <= 470
    assert 1.5 <= s["median"] <= 3.5
    assert 0.4 <= s["firstPass"] <= 0.7
    assert s["laterViolation"] == 8
    assert 0.3 <= s["aiFixRate"] <= 0.75 and 0.08 <= s["aiMissRate"] <= 0.3
    assert 70 <= len(violations) <= 110
    assert {v["kind"] for v in violations} == {"changed", "unapproved", "condition_broken", "expired_approval"}
    assert any("product" not in v for v in violations)  # unapproved content with no material

    # Each filter: the channels and products split the total, and the groups follow the routing.
    for key in ("channel", "product"):
        values = {d[key] for d in decisions}
        assert len(values) == 6
        assert sum(summary([d for d in decisions if d[key] == v])["count"] for v in values) == s["count"]
    mortgage = [d for d in decisions if "Mortgage" in d["groups"]]
    assert mortgage and {d["product"] for d in mortgage} <= {"mortgage", "heloc"}
    assert all(d["groups"][0] == "Compliance" for d in decisions)
    lighter = [d for d in decisions if d["path"] == "no_change"]
    assert 70 <= len(lighter) <= 140
    assert all(d["groups"] == ["Compliance"] and d["rounds"] == 1 and d["turnaroundDays"] <= 1.5 for d in lighter)

    # The past materials are normal rows: the repository lists them.
    rows = (await client.get("/api/materials")).json()
    assert 250 <= len(rows) <= 450
    assert len({m["approvalId"] for m in rows if m.get("approvalId")}) == sum(1 for m in rows if m.get("approvalId"))


@pytest.mark.history
async def test_history_is_deterministic(client):
    await as_user(client, VIEWER)
    first = await metrics(client)
    titles = sorted((m["title"], m["status"]) for m in (await client.get("/api/materials")).json())
    tables = ", ".join(t.name for t in Base.metadata.sorted_tables)
    async with engine.begin() as conn:
        await conn.execute(text(f"TRUNCATE {tables} CASCADE"))
    async with SessionLocal() as db, db.begin():
        await create_demo(db, history=True)
    await as_user(client, VIEWER)
    assert await metrics(client) == first
    assert sorted((m["title"], m["status"]) for m in (await client.get("/api/materials")).json()) == titles
