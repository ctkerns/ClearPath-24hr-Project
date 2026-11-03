from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select, update

from app.db import SessionLocal
from app.models import Role, User, UserStatus, Workspace
from app.models.notifications import Notification
from app.security import hash_password
from app.seed import DEMO_PASSWORD, create_demo, delete_demo
from tests.helpers import ADMIN, AFFILIATE, MANAGER, REVIEWER, SUBMITTER, as_user

SAM = "sam.rivera@demo.clearpathcu.org"
MARCUS = "marcus.lee@demo.clearpathcu.org"
SUMMER = "01a112a1-4000-7d42-94be-d09364e3b51d"  # owner Priya Shah; Compliance waits, Legal approved; Maya and Dana commented
LENDWISE_POST = "01a0dfa5-7e00-7a60-a023-ce47b3e545d3"  # LendWise, affiliate manager Marcus Lee
NOTICE_ISSUE = "01a19b87-a300-7083-a17b-e83caf805f10"
COMPLIANCE_REVIEWERS = {"Maya Ruiz", "Alex Chen", "Jordan Kim", "Dana Ortiz", "Grace Liu"}  # Nina Patel is only invited


def submission(**change):
    body = {
        "title": "Winter savings email",
        "channel": "mailchimp",
        "product": "savings",
        "fields": [{"label": "Body", "text": "Rates from 4.00% APY."}],
        "nationwide": True,
        "groups": [{"name": "Compliance", "reason": "Every material"}],
    }
    return body | change


async def sent(type=None):
    """Who got a new (not seeded) notification, by name, of one type or of any type."""
    async with SessionLocal() as db:
        query = select(User.name).join(Notification, Notification.user_id == User.id).where(Notification.seeded.is_(False))
        if type:
            query = query.where(Notification.type == type)
        return sorted((await db.scalars(query)).all())


async def decide(client, material_id, decision, text="", **extra):
    return await client.post(f"/api/materials/{material_id}/decisions", json={"decision": decision, "text": text, **extra})


async def user_id(client, email):
    return next(u["id"] for u in (await client.get("/api/users")).json() if u["email"] == email)


def new_issue(material_id, owner_id, **change):
    due = (datetime.now(UTC) + timedelta(days=3)).isoformat()
    body = {"materialId": material_id, "title": "Wrong APR", "summary": "S", "severity": "high", "ownerId": owner_id, "dueAt": due}
    return body | change


# Reading


async def test_seeded_notifications_by_role(client):
    await as_user(client, REVIEWER)
    rows = (await client.get("/api/notifications")).json()
    assert [(n["type"], n["group"], n["actor"], n["read"]) for n in rows] == [("assignment", "Compliance", "Priya Shah", False)]
    assert rows[0]["materialId"] == SUMMER and rows[0]["material"] == "Summer personal loan, Meta feed ad"
    assert "issueId" not in rows[0]  # absent, like the old demo JSON

    await as_user(client, MANAGER)
    rows = (await client.get("/api/notifications")).json()
    assert [n["type"] for n in rows] == ["assignment", "issue"]  # newest first
    assert rows[1]["issueId"] == NOTICE_ISSUE and rows[1]["summary"] == "live page is missing disclosure D-4"

    await as_user(client, SUBMITTER)
    assert [(n["type"], n["read"]) for n in (await client.get("/api/notifications")).json()] == [
        ("comment", False),
        ("decision_changes_requested", True),
    ]
    await as_user(client, AFFILIATE)  # affiliates get their own too
    assert [n["type"] for n in (await client.get("/api/notifications")).json()] == ["decision_approved"]


async def test_limit_and_signed_out(client):
    assert (await client.get("/api/notifications")).status_code == 401
    assert (await client.post("/api/notifications/read", json={})).status_code == 401
    await as_user(client, MANAGER)
    assert len((await client.get("/api/notifications?limit=1")).json()) == 1
    assert (await client.get("/api/notifications?limit=0")).status_code == 422


# Marking read


async def test_mark_some_then_all(client):
    await as_user(client, MANAGER)
    rows = (await client.get("/api/notifications")).json()
    res = await client.post("/api/notifications/read", json={"ids": [rows[0]["id"]]})
    assert res.status_code == 204
    assert [n["read"] for n in (await client.get("/api/notifications")).json()] == [True, False]
    assert (await client.post("/api/notifications/read", json={})).status_code == 204
    assert all(n["read"] for n in (await client.get("/api/notifications")).json())


async def test_cannot_mark_someone_elses(client):
    await as_user(client, REVIEWER)
    jordans = (await client.get("/api/notifications")).json()[0]["id"]
    await as_user(client, SUBMITTER)
    assert (await client.post("/api/notifications/read", json={"ids": [jordans]})).status_code == 204  # ignored
    assert (await client.post("/api/notifications/read", json={})).status_code == 204  # all of Priya's only
    await as_user(client, REVIEWER)
    assert (await client.get("/api/notifications")).json()[0]["read"] is False


async def test_other_workspace(client):
    async with SessionLocal() as db, db.begin():
        other = Workspace(name="Real credit union")
        db.add(other)
        await db.flush()
        db.add(User(workspace_id=other.id, email="boss@real.example", name="Boss", role=Role.ADMIN, password_hash=hash_password(DEMO_PASSWORD)))
    await as_user(client, MANAGER)
    alexs = [n["id"] for n in (await client.get("/api/notifications")).json()]
    await as_user(client, "boss@real.example")
    assert (await client.get("/api/notifications")).json() == []
    assert (await client.post("/api/notifications/read", json={"ids": alexs})).status_code == 204
    await as_user(client, MANAGER)
    assert not any(n["read"] for n in (await client.get("/api/notifications")).json())


# Triggers


async def test_assignment_goes_to_the_groups_reviewers(client):
    await as_user(client, SUBMITTER)
    res = await client.post("/api/materials", json=submission())
    assert res.status_code == 201
    assert await sent("assignment") == sorted(COMPLIANCE_REVIEWERS)
    await as_user(client, REVIEWER)
    first = (await client.get("/api/notifications")).json()[0]
    assert (first["type"], first["actor"], first["group"], first["material"]) == ("assignment", "Priya Shah", "Compliance", "Winter savings email")
    assert first["materialId"] == res.json()["id"]


async def test_assignment_once_per_person_and_not_the_submitter(client):
    await as_user(client, MANAGER)  # Alex is in Compliance himself
    groups = [{"name": "Compliance"}, {"name": "Mortgage"}]  # Grace Liu is in both
    assert (await client.post(f"/api/materials/{SUMMER}/versions", json=submission(channel="meta", groups=groups))).status_code == 201
    assert await sent("assignment") == sorted(COMPLIANCE_REVIEWERS - {"Alex Chen"})


async def test_deactivated_users_get_nothing(client):
    async with SessionLocal() as db, db.begin():
        await db.execute(update(User).where(User.name == "Dana Ortiz").values(status=UserStatus.DEACTIVATED))
    await as_user(client, SUBMITTER)
    await client.post("/api/materials", json=submission())
    assert await sent("assignment") == sorted(COMPLIANCE_REVIEWERS - {"Dana Ortiz"})


async def test_escalation_goes_to_the_added_group(client):
    await as_user(client, REVIEWER)
    assert (await decide(client, SUMMER, "escalate", "Mortgage wording.", group="Mortgage")).status_code == 200
    assert await sent() == ["Grace Liu"]
    async with SessionLocal() as db:
        row = await db.scalar(select(Notification).where(Notification.seeded.is_(False)))
        assert (row.type, row.group_name, row.actor_name) == ("escalation", "Mortgage", "Jordan Kim")


async def test_full_approval_notifies_the_owner(client):
    await as_user(client, REVIEWER)
    assert (await decide(client, SUMMER, "approve", override="ok")).status_code == 200  # Legal approved already
    assert await sent() == ["Priya Shah"]
    assert await sent("decision_approved") == ["Priya Shah"]


async def test_partial_approval_notifies_nobody(client):
    await as_user(client, REVIEWER)
    await decide(client, SUMMER, "escalate", "Mortgage wording.", group="Mortgage")
    await decide(client, SUMMER, "approve", override="ok")  # Mortgage still waits
    assert await sent("decision_approved") == []


async def test_decision_also_notifies_a_different_submitter(client):
    await as_user(client, MANAGER)  # Alex submits a version of Priya's material
    await client.post(f"/api/materials/{SUMMER}/versions", json=submission(channel="meta"))
    await as_user(client, REVIEWER)
    assert (await decide(client, SUMMER, "reject", "Misleading.")).status_code == 200
    assert await sent("decision_rejected") == ["Alex Chen", "Priya Shah"]


async def test_changes_requested(client):
    await as_user(client, REVIEWER)
    assert (await decide(client, SUMMER, "request_changes", "Add the APR disclosure.")).status_code == 200
    assert await sent() == ["Priya Shah"]
    assert await sent("decision_changes_requested") == ["Priya Shah"]


async def test_comment_goes_to_owner_and_earlier_commenters(client):
    await as_user(client, REVIEWER)
    assert (await client.post(f"/api/materials/{SUMMER}/comments", json={"body": "Where is D-7?"})).status_code == 201
    assert await sent("comment") == ["Dana Ortiz", "Maya Ruiz", "Priya Shah"]
    await as_user(client, SUBMITTER)  # the owner replies: Jordan now is in the thread, Priya is the actor
    await client.post(f"/api/materials/{SUMMER}/comments", json={"body": "Under the image."})
    assert await sent("comment") == ["Dana Ortiz", "Dana Ortiz", "Jordan Kim", "Maya Ruiz", "Maya Ruiz", "Priya Shah"]


async def test_new_issue_goes_to_owner_and_managers(client):
    await as_user(client, REVIEWER)
    res = await client.post("/api/issues", json=new_issue(SUMMER, await user_id(client, SAM)))
    assert res.status_code == 201, res.text
    assert await sent("issue") == ["Alex Chen", "Maya Ruiz", "Sam Rivera"]
    await as_user(client, SAM)
    first = (await client.get("/api/notifications")).json()[0]
    assert (first["type"], first["issueId"], first["materialId"], first["summary"]) == ("issue", res.json()["id"], SUMMER, "Wrong APR")


async def test_affiliate_issue_copies_the_affiliate_manager(client):
    await as_user(client, MANAGER)  # the actor is a Manager: he gets no notification himself
    res = await client.post("/api/issues", json=new_issue(LENDWISE_POST, await user_id(client, AFFILIATE)))
    assert res.status_code == 201, res.text
    assert await sent("issue") == ["Erin Walsh", "Marcus Lee", "Maya Ruiz"]
    await as_user(client, AFFILIATE)
    assert (await client.get("/api/notifications")).json()[0]["issueId"] == res.json()["id"]


async def test_failed_writes_notify_nobody(client):
    await as_user(client, REVIEWER)
    assert (await decide(client, SUMMER, "reject")).status_code == 400  # no reason
    assert (await decide(client, SUMMER, "escalate", "x", group="Nobody")).status_code == 400
    assert (await decide(client, SUMMER, "escalate", "x", group="Legal")).status_code == 409  # already required
    past = (datetime.now(UTC) - timedelta(days=1)).isoformat()
    assert (await client.post("/api/issues", json=new_issue(SUMMER, await user_id(client, SAM), dueAt=past))).status_code == 400
    await as_user(client, SUBMITTER)
    assert (await client.post("/api/materials", json=submission(groups=[{"name": "Nobody"}]))).status_code == 400
    assert await sent() == []


async def test_seed_reset_twice(client):
    await as_user(client, REVIEWER)
    await client.post("/api/notifications/read", json={})
    await decide(client, SUMMER, "reject", "No.")
    for _ in range(2):
        async with SessionLocal() as db, db.begin():
            await delete_demo(db)
            await create_demo(db)
    async with SessionLocal() as db:
        assert await db.scalar(select(func.count()).select_from(Notification)) == 12
        assert await db.scalar(select(func.count()).where(Notification.read_at.is_(None))) == 7
