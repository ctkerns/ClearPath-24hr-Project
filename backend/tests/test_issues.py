from datetime import UTC, datetime, timedelta

import pytest

from app.db import SessionLocal
from app.models import Role, User, Workspace
from app.security import hash_password
from app.seed import DEMO_PASSWORD
from tests.helpers import ADMIN, AFFILIATE, MANAGER, REVIEWER, SUBMITTER, as_user

VIEWER = "ben.okafor@demo.clearpathcu.org"
SAM = "sam.rivera@demo.clearpathcu.org"
TARA = "tara.nguyen@demo.clearpathcu.org"
OTHER_AFFILIATE = "leo@rateradar.example"

DEBT_ISSUE = "01a1993a-f3e0-7668-886f-7df89511ac54"  # owner Sam Rivera, actions a1 done, a2 and a3 open
NOTICE_ISSUE = "01a19b87-a300-7083-a17b-e83caf805f10"  # LendWise, owner Tara Nguyen, has a notice draft
BEN_ISSUE = "01a19afc-7a00-7b94-a2c9-209ffc0a0fe5"  # owner Ben Okafor, a Viewer; no detail file
SUMMER = "01a112a1-4000-7d42-94be-d09364e3b51d"
RATERADAR = "01a0e8ea-8a00-758c-87e6-0a28f7797431"
LENDWISE_POST = "01a0dfa5-7e00-7a60-a023-ce47b3e545d3"


async def user_id(client, email):
    return next(u["id"] for u in (await client.get("/api/users")).json() if u["email"] == email)


def due(days=3):
    return (datetime.now(UTC) + timedelta(days=days)).isoformat()


# Reading


async def test_list(client):
    await as_user(client, VIEWER)
    rows = (await client.get("/api/issues")).json()
    assert len(rows) == 11
    notice = next(i for i in rows if i["id"] == NOTICE_ISSUE)
    assert notice["material"] == {"id": LENDWISE_POST, "title": "Cash back card, affiliate post", "channel": "affiliate"}
    assert (notice["affiliate"], notice["affiliateManager"], notice["owner"]) == ("LendWise", "Marcus Lee", "Tara Nguyen")
    raised = next(i for i in rows if i["source"] == "reviewer")
    assert raised["openedBy"]


async def test_affiliate_sees_only_own_issues(client):
    await as_user(client, AFFILIATE)
    rows = (await client.get("/api/issues")).json()
    assert {i["affiliate"] for i in rows} == {"LendWise"} and len(rows) == 2
    assert (await client.get(f"/api/issues/{DEBT_ISSUE}")).status_code == 404
    await as_user(client, OTHER_AFFILIATE)
    assert (await client.get("/api/issues")).json() == []


async def test_detail(client):
    await as_user(client, VIEWER)
    d = (await client.get(f"/api/issues/{NOTICE_ISSUE}")).json()
    assert d["rule"] == {"id": "D-4 v2", "title": "Cash back card rewards terms"}
    assert d["liveItem"]["similarity"] == 0.91
    assert d["approved"]["approvalId"] == "CP-2026-0131-v1"
    assert d["notice"]["to"].startswith("Tara Nguyen")
    assert [a["kind"] for a in d["actions"]] == ["notice", "confirm_fix"]
    assert d["activity"][0]["actor"] == "Monitoring"
    # An issue without a seeded detail still has its opening event.
    ben = (await client.get(f"/api/issues/{BEN_ISSUE}")).json()
    assert ben["summary"] == "" and ben["actions"] == []
    assert ben["activity"][0]["text"] == "Opened this issue and assigned it to Ben Okafor."


# Raising (PRD F12)


async def test_reviewer_raises_issue(client):
    await as_user(client, REVIEWER)
    owner = await user_id(client, SUBMITTER)
    body = {"materialId": SUMMER, "title": "Image text too small", "summary": "The NCUA line is hard to read.", "severity": "low", "ownerId": owner, "dueAt": due()}
    res = await client.post("/api/issues", json=body)
    assert res.status_code == 201, res.text
    issue = res.json()
    assert (issue["source"], issue["status"], issue["owner"], issue["openedBy"]) == ("reviewer", "open", "Priya Shah", "Jordan Kim")
    d = (await client.get(f"/api/issues/{issue['id']}")).json()
    assert d["activity"][0]["text"] == "Raised this issue and assigned it to Priya Shah."
    material = (await client.get(f"/api/materials/{SUMMER}")).json()
    assert material["issues"][0]["title"] == "Image text too small"
    assert material["history"][-1]["type"] == "issue"


@pytest.mark.parametrize(
    ("change", "code"),
    [
        ({"title": ""}, 422),
        ({"title": "  "}, 400),
        ({"severity": "urgent"}, 422),
        ({"dueAt": "2020-01-01T17:00:00Z"}, 400),
        ({"materialId": "01a112a1-4000-7d42-94be-000000000000"}, 404),
    ],
)
async def test_invalid_issue(client, change, code):
    await as_user(client, REVIEWER)
    owner = await user_id(client, SUBMITTER)
    body = {"materialId": SUMMER, "title": "T", "summary": "S", "severity": "low", "ownerId": owner, "dueAt": due()} | change
    assert (await client.post("/api/issues", json=body)).status_code == code


async def test_affiliate_owner_only_for_own_company(client):
    await as_user(client, REVIEWER)
    erin = await user_id(client, AFFILIATE)
    body = {"title": "T", "summary": "S", "severity": "low", "ownerId": erin, "dueAt": due()}
    assert (await client.post("/api/issues", json=body | {"materialId": RATERADAR})).status_code == 400
    assert (await client.post("/api/issues", json=body | {"materialId": LENDWISE_POST})).status_code == 201


async def test_submitter_cannot_raise_issue(client):
    await as_user(client, SUBMITTER)
    owner = await user_id(client, SUBMITTER)
    body = {"materialId": SUMMER, "title": "T", "summary": "S", "severity": "low", "ownerId": owner, "dueAt": due()}
    assert (await client.post("/api/issues", json=body)).status_code == 403


# Changing (owner or Manager)


async def test_owner_changes_status(client):
    await as_user(client, SAM)
    res = await client.patch(f"/api/issues/{DEBT_ISSUE}", json={"status": "in_progress"})
    assert res.status_code == 200, res.text
    assert res.json()["activity"][-1]["text"] == "Changed the status to In progress."
    assert (await client.patch(f"/api/issues/{DEBT_ISSUE}", json={"status": "in_progress"})).status_code == 409
    assert (await client.patch(f"/api/issues/{DEBT_ISSUE}", json={"status": "resolved"})).status_code == 400  # needs a note
    res = await client.patch(f"/api/issues/{DEBT_ISSUE}", json={"status": "resolved", "note": "Restored the approved text."})
    assert res.json()["activity"][-1] == {"at": res.json()["activity"][-1]["at"], "actor": "Sam Rivera", "text": "Restored the approved text.", "comment": True}
    row = next(i for i in (await client.get("/api/issues")).json() if i["id"] == DEBT_ISSUE)
    assert row["status"] == "resolved" and row["resolvedAt"]
    res = await client.patch(f"/api/issues/{DEBT_ISSUE}", json={"status": "open"})
    assert res.status_code == 200
    row = next(i for i in (await client.get("/api/issues")).json() if i["id"] == DEBT_ISSUE)
    assert "resolvedAt" not in row


async def test_who_may_change_an_issue(client):
    await as_user(client, SUBMITTER)  # not the owner
    assert (await client.patch(f"/api/issues/{DEBT_ISSUE}", json={"status": "in_progress"})).status_code == 403
    await as_user(client, REVIEWER)  # not the owner, below Manager
    assert (await client.patch(f"/api/issues/{DEBT_ISSUE}", json={"status": "in_progress"})).status_code == 403
    await as_user(client, VIEWER)  # owner, but a Viewer only reads
    assert (await client.patch(f"/api/issues/{BEN_ISSUE}", json={"status": "in_progress"})).status_code == 403
    await as_user(client, MANAGER)
    assert (await client.patch(f"/api/issues/{DEBT_ISSUE}", json={"status": "in_progress"})).status_code == 200


async def test_complete_action(client):
    await as_user(client, SAM)
    d = (await client.get(f"/api/issues/{DEBT_ISSUE}")).json()
    todo = next(a for a in d["actions"] if not a["done"])
    done = next(a for a in d["actions"] if a["done"])
    res = await client.post(f"/api/issues/{DEBT_ISSUE}/actions/{todo['id']}/done")
    assert res.status_code == 200
    after = next(a for a in res.json()["actions"] if a["id"] == todo["id"])
    assert after["done"] and after["doneBy"] == "Sam Rivera"
    assert (await client.post(f"/api/issues/{DEBT_ISSUE}/actions/{done['id']}/done")).status_code == 409
    assert (await client.post(f"/api/issues/{DEBT_ISSUE}/actions/{d['id']}/done")).status_code == 404
    await as_user(client, SUBMITTER)
    assert (await client.post(f"/api/issues/{DEBT_ISSUE}/actions/{todo['id']}/done")).status_code == 403


async def test_send_notice(client):
    await as_user(client, TARA)
    res = await client.post(f"/api/issues/{NOTICE_ISSUE}/notice", json={"subject": "Fix it", "body": "Please add D-4."})
    assert res.status_code == 200, res.text
    d = res.json()
    assert (d["notice"]["subject"], d["notice"]["sentBy"]) == ("Fix it", "Tara Nguyen") and d["notice"]["sentAt"]
    assert next(a for a in d["actions"] if a["kind"] == "notice")["done"]
    assert (await client.post(f"/api/issues/{NOTICE_ISSUE}/notice", json={"subject": "x", "body": "y"})).status_code == 409
    await as_user(client, SAM)
    assert (await client.post(f"/api/issues/{DEBT_ISSUE}/notice", json={"subject": "x", "body": "y"})).status_code == 409  # no notice
    assert (await client.post(f"/api/issues/{DEBT_ISSUE}/notice", json={"subject": "", "body": "y"})).status_code == 422


async def test_comments(client):
    await as_user(client, SUBMITTER)
    res = await client.post(f"/api/issues/{DEBT_ISSUE}/comments", json={"text": "I can help."})
    assert res.status_code == 201
    assert res.json()["activity"][-1]["comment"] is True
    await as_user(client, VIEWER)
    assert (await client.post(f"/api/issues/{DEBT_ISSUE}/comments", json={"text": "x"})).status_code == 403
    await as_user(client, AFFILIATE)
    assert (await client.post(f"/api/issues/{NOTICE_ISSUE}/comments", json={"text": "Fixed."})).status_code == 201
    assert (await client.post(f"/api/issues/{DEBT_ISSUE}/comments", json={"text": "x"})).status_code == 404


async def test_other_workspace_sees_no_issues(client):
    async with SessionLocal() as db, db.begin():
        other = Workspace(name="Real credit union")
        db.add(other)
        await db.flush()
        db.add(User(workspace_id=other.id, email="boss@real.example", name="Boss", role=Role.ADMIN, password_hash=hash_password(DEMO_PASSWORD)))
    await as_user(client, "boss@real.example")
    assert (await client.get("/api/issues")).json() == []
    assert (await client.get(f"/api/issues/{DEBT_ISSUE}")).status_code == 404
    assert (await client.patch(f"/api/issues/{DEBT_ISSUE}", json={"status": "in_progress"})).status_code == 404
    # A demo user cannot own an issue in another workspace, and the other way round.
    await as_user(client, ADMIN)
    body = {"materialId": SUMMER, "title": "T", "summary": "S", "severity": "low", "ownerId": "01a112a1-4000-7d42-94be-000000000000", "dueAt": due()}
    assert (await client.post("/api/issues", json=body)).status_code == 404
