from datetime import UTC, datetime, timedelta

from sqlalchemy import event, select, update

from app.business_days import days_left, review_deadline
from app.db import SessionLocal, engine
from app.models import User
from app.models.materials import Issue, IssueStatus, Material
from tests.helpers import AFFILIATE, MANAGER, REVIEWER, SUBMITTER, as_user

VIEWER = "ben.okafor@demo.clearpathcu.org"
LEGAL = "tara.nguyen@demo.clearpathcu.org"  # Legal reviewer
OTHER_AFFILIATE = "leo@rateradar.example"  # RateRadar
SUMMER = "01a112a1-4000-7d42-94be-d09364e3b51d"  # in review: Compliance waits, Legal approved; owner Priya Shah
AUTO_REFI = "Auto refinance search ad, Q4"
HELOC = "Holiday HELOC rate email"


def parse(s: str) -> datetime:
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


async def dashboard(client, who):
    await as_user(client, who)
    res = await client.get("/api/dashboard")
    assert res.status_code == 200, res.text
    return res.json()


async def set_submitted(title: str, at: datetime) -> None:
    async with SessionLocal() as db, db.begin():
        await db.execute(update(Material).where(Material.title == title).values(submitted_at=at))


async def test_reviewer_queue_has_deadlines_late_first(client):
    now = datetime.now(UTC).replace(microsecond=0)
    await set_submitted(AUTO_REFI, now - timedelta(days=14))  # long late
    await set_submitted(HELOC, now)  # just submitted
    d = await dashboard(client, REVIEWER)
    queue = d["queue"]
    titles = [q["material"]["title"] for q in queue]
    assert AUTO_REFI in titles and HELOC in titles
    assert titles[0] == AUTO_REFI and titles[-1] == HELOC
    deadlines = [parse(q["deadline"]["at"]) for q in queue]
    assert deadlines == sorted(deadlines)
    overdue = [q["deadline"]["overdue"] for q in queue]
    assert overdue == sorted(overdue, reverse=True)  # late ones first
    for q in queue:
        assert q["groups"] == ["Compliance"]
        assert q["deadline"]["targetDays"] == 2
        submitted = parse(q["material"]["submittedAt"])
        assert parse(q["deadline"]["at"]) == review_deadline(submitted, 2)
        assert q["deadline"]["daysLeft"] == days_left(review_deadline(submitted, 2), datetime.now(UTC))
    heloc = next(q for q in queue if q["material"]["title"] == HELOC)
    assert heloc["deadline"]["overdue"] is False and heloc["deadline"]["daysLeft"] >= 1
    assert queue[0]["deadline"]["overdue"] is True and queue[0]["deadline"]["daysLeft"] < -10
    # Never my own materials (R1), and only my groups: the Legal-only mortgage guide is not here
    assert "First-time buyer mortgage guide" not in titles
    assert all(q["material"]["owner"] != "Jordan Kim" for q in queue)


async def test_deadline_is_the_strictest_of_my_groups(client):
    # An affiliate item needs Compliance (2 days) and Senior compliance (1 day). Alex is in both.
    await as_user(client, AFFILIATE)
    body = {
        "title": "Winter card review",
        "channel": "affiliate",
        "product": "credit_card",
        "fields": [{"label": "Page text", "text": "Hi"}],
        "nationwide": True,
    }
    res = await client.post("/api/materials", json=body)
    assert res.status_code == 201, res.text
    detail = res.json()
    submitted = parse(detail["submittedAt"])
    groups = {g["name"]: g for g in detail["groups"]}
    assert groups["Compliance"]["deadline"]["targetDays"] == 2
    assert groups["Senior compliance"]["deadline"]["targetDays"] == 1
    assert parse(groups["Legal"]["deadline"]["at"]) == review_deadline(submitted, 3)

    manager = await dashboard(client, MANAGER)
    item = next(q for q in manager["queue"] if q["material"]["id"] == detail["id"])
    assert item["groups"] == ["Compliance", "Senior compliance"]
    assert item["deadline"]["targetDays"] == 1
    assert parse(item["deadline"]["at"]) == review_deadline(submitted, 1)
    reviewer = await dashboard(client, REVIEWER)
    item = next(q for q in reviewer["queue"] if q["material"]["id"] == detail["id"])
    assert (item["groups"], item["deadline"]["targetDays"]) == (["Compliance"], 2)


async def test_detail_deadline_only_while_waiting(client):
    await as_user(client, REVIEWER)
    d = (await client.get(f"/api/materials/{SUMMER}")).json()
    row = next(m for m in (await client.get("/api/materials")).json() if m["id"] == SUMMER)
    groups = {g["name"]: g for g in d["groups"]}
    # From the material's submit time, the same one that the list and the dashboard use
    assert parse(groups["Compliance"]["deadline"]["at"]) == review_deadline(parse(row["submittedAt"]), 2)
    assert "deadline" not in groups["Legal"]  # already approved


async def test_own_material_is_not_in_my_queue(client):
    async with SessionLocal() as db, db.begin():
        jordan = await db.scalar(select(User.id).where(User.email == REVIEWER))
        await db.execute(update(Material).where(Material.id == SUMMER).values(owner_id=jordan))
    d = await dashboard(client, REVIEWER)
    assert SUMMER not in [q["material"]["id"] for q in d["queue"]]
    assert SUMMER in [m["id"] for m in d["submissions"]]


async def test_submitter_and_viewer_have_no_queue(client):
    d = await dashboard(client, SUBMITTER)
    assert "queue" not in d
    assert [m["owner"] for m in d["submissions"]] == ["Priya Shah"] * len(d["submissions"])
    assert SUMMER in [m["id"] for m in d["submissions"]]
    assert all(m["status"] not in ("expired", "retired") for m in d["submissions"])
    updated = [m["updatedAt"] for m in d["submissions"]]
    assert updated == sorted(updated, reverse=True)
    assert all(i["owner"] == "Priya Shah" or i.get("openedBy") == "Priya Shah" for i in d["issues"])

    d = await dashboard(client, VIEWER)
    assert "queue" not in d and d["submissions"] == []
    assert [i["owner"] for i in d["issues"]] == ["Ben Okafor"]


async def test_my_issues_owned_or_raised_unresolved_soonest_first(client):
    d = await dashboard(client, REVIEWER)
    issues = d["issues"]
    assert issues and all(i["owner"] == "Jordan Kim" or i.get("openedBy") == "Jordan Kim" for i in issues)
    assert [i["dueAt"] for i in issues] == sorted(i["dueAt"] for i in issues)
    async with SessionLocal() as db, db.begin():
        await db.execute(update(Issue).where(Issue.id == issues[0]["id"]).values(status=IssueStatus.RESOLVED))
    d = await dashboard(client, REVIEWER)
    assert issues[0]["id"] not in [i["id"] for i in d["issues"]]


async def test_workspace_panel(client):
    d = await dashboard(client, VIEWER)
    w = d["workspace"]
    materials = (await client.get("/api/materials")).json()
    issues = (await client.get("/api/issues")).json()
    now = datetime.now(UTC)
    problems = ("unapproved", "changed", "condition_broken", "expired_approval")
    assert w["liveProblems"] == sum(m["liveStatus"] in problems for m in materials)
    assert w["overdueIssues"] == sum(i["status"] != "resolved" and parse(i["dueAt"]) < now for i in issues)
    assert w["highIssues"] == sum(i["status"] != "resolved" and i["severity"] == "high" for i in issues)
    today = now.date()
    expected = sorted(
        (m["expiresAt"], m["id"]) for m in materials
        if m.get("expiresAt") and today < datetime.fromisoformat(m["expiresAt"]).date() <= today + timedelta(days=30)
    )
    assert [(e["expiresAt"], e["id"]) for e in w["expiring"]] == expected


async def test_affiliate_sees_only_own_company(client):
    await as_user(client, AFFILIATE)
    res = await client.post(
        "/api/materials",
        json={"title": "LendWise rate post", "channel": "affiliate", "product": "personal_loan",
              "fields": [{"label": "Page text", "text": "Hi"}], "nationwide": True},
    )
    new_id = res.json()["id"]
    d = await dashboard(client, AFFILIATE)
    assert "queue" not in d
    assert [m["id"] for m in d["submissions"]] == [new_id]
    assert all(m["affiliate"] == "LendWise" for m in d["submissions"])
    w = d["workspace"]
    visible = (await client.get("/api/materials")).json()
    assert w["liveProblems"] <= len(visible)
    assert {e["id"] for e in w["expiring"]} <= {m["id"] for m in visible}
    internal = await dashboard(client, VIEWER)
    assert w["liveProblems"] < internal["workspace"]["liveProblems"]

    other = await dashboard(client, OTHER_AFFILIATE)
    assert "queue" not in other
    assert new_id not in [m["id"] for m in other["submissions"]]
    assert all(m["affiliate"] == "RateRadar" for m in other["submissions"])
    assert all((i.get("affiliate") or "RateRadar") == "RateRadar" for i in other["issues"])


async def test_sign_in_required(client):
    assert (await client.get("/api/dashboard")).status_code == 401


async def test_legal_reviewer_queue(client):
    d = await dashboard(client, LEGAL)
    assert [q["material"]["title"] for q in d["queue"]] == ["First-time buyer mortgage guide"]
    assert d["queue"][0]["deadline"]["targetDays"] == 3


async def test_few_queries(client):
    """The page needs one request, and the request a fixed number of queries, however many items there are."""
    await as_user(client, MANAGER)
    statements: list[str] = []

    def count(conn, cursor, statement, *args):
        statements.append(statement)

    event.listen(engine.sync_engine, "before_cursor_execute", count)
    try:
        assert (await client.get("/api/dashboard")).status_code == 200
    finally:
        event.remove(engine.sync_engine, "before_cursor_execute", count)
    assert len(statements) <= 14  # 12 today: the session, the expiry check, and the dashboard queries with their loads
