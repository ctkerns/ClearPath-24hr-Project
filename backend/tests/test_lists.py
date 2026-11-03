"""Server-side filters, text search, sort, paging and facets of GET /api/materials and GET /api/issues
(app.listing, app.material_list, app.issue_list), and that they never show more than material_access allows.

Most checks compare the server with the same filter done in Python on the full list, like the browser did before."""

import csv
import io
import json
import zipfile
from collections import Counter
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select, update

from app.db import SessionLocal
from app.models import Role, User, Workspace
from app.models.materials import Channel, Issue, IssueSource, IssueStatus, Material, Severity
from app.security import hash_password
from app.seed import DEMO_PASSWORD
from tests.helpers import AFFILIATE, as_user
from tests.test_export import seeded

VIEWER = "ben.okafor@demo.clearpathcu.org"
OTHER_AFFILIATE = "leo@rateradar.example"  # RateRadar
SUMMER = "01a112a1-4000-7d42-94be-d09364e3b51d"
DEBT = "01a0d660-7200-7f2e-846a-4b2b8dd2f651"
LENDWISE_POST = "01a0dfa5-7e00-7a60-a023-ce47b3e545d3"
LENDWISE_REVIEW = "01a10dfe-ba00-70a4-92a2-32f7091afc7c"
RATERADAR = "01a0e8ea-8a00-758c-87e6-0a28f7797431"
DEBT_ISSUE = "01a1993a-f3e0-7668-886f-7df89511ac54"
NOTICE_ISSUE = "01a19b87-a300-7083-a17b-e83caf805f10"  # LendWise

WIDE = {"dateFrom": "2025-01-01", "dateTo": "2026-12-31"}


async def page(client, path, **params):
    res = await client.get(path, params=params)
    assert res.status_code == 200, res.text
    return res.json()


async def ids(client, path, **params):
    return [row["id"] for row in (await page(client, path, **params))["items"]]


# ---- Materials ----


def material_values(m, key):
    match key:
        case "status": return [m["status"]]
        case "live": return [m["liveStatus"]]
        case "group": return [g["name"] for g in m["groups"]]
        case "affiliate": return [m["affiliate"]] if "affiliate" in m else []
        case _: return [m[key]]


MATERIAL_KEYS = ["status", "live", "channel", "product", "group", "owner", "affiliate"]
ISSUE_KEYS = ["status", "severity", "due", "source", "channel", "owner", "affiliate"]


async def test_materials_page_shape(client):
    await as_user(client, VIEWER)
    body = await page(client, "/api/materials")
    assert body["total"] == len(body["items"]) == 18
    assert "facets" not in body  # only when asked
    summer = next(m for m in body["items"] if m["id"] == SUMMER)
    assert summer["groups"] == [{"name": "Compliance", "state": "waiting"}, {"name": "Legal", "state": "approved"}]


async def test_materials_each_filter_value(client):
    await as_user(client, VIEWER)
    full = (await page(client, "/api/materials"))["items"]
    for key in MATERIAL_KEYS:
        values = {v for m in full for v in material_values(m, key)}
        assert values, key
        for value in values:
            expected = {m["id"] for m in full if value in material_values(m, key)}
            assert set(await ids(client, "/api/materials", **{key: value})) == expected, (key, value)


async def test_materials_any_of_and_all_of(client):
    await as_user(client, VIEWER)
    full = (await page(client, "/api/materials"))["items"]
    want = {m["id"] for m in full if m["status"] in ("submitted", "in_review")}
    assert len(want) == 5
    assert set(await ids(client, "/api/materials", status="submitted,in_review")) == want
    # Repeated parameters work too
    res = await client.get("/api/materials?status=submitted&status=in_review")
    assert {m["id"] for m in res.json()["items"]} == want
    # Different filters must all match
    both = {m["id"] for m in full if m["status"] in ("submitted", "in_review") and "Legal" in material_values(m, "group")}
    assert set(await ids(client, "/api/materials", status="submitted,in_review", group="Legal")) == both
    assert SUMMER in both and len(both) < len(want)
    # A name that no material has matches nothing; it is not an error
    assert await ids(client, "/api/materials", owner="Nobody Here") == []
    assert await ids(client, "/api/materials", group="Compliance,Nope") != []


async def test_materials_text_search(client):
    await as_user(client, VIEWER)
    assert await ids(client, "/api/materials", q="summer") == [SUMMER]
    assert await ids(client, "/api/materials", q="  SUMMER   personal ") == [SUMMER]
    # Approval ID, part of it, affiliate and owner
    assert await ids(client, "/api/materials", q="CP-2026-0131") == [LENDWISE_POST]
    assert set(await ids(client, "/api/materials", q="lendwise")) == {LENDWISE_POST, LENDWISE_REVIEW}
    full = (await page(client, "/api/materials"))["items"]
    assert set(await ids(client, "/api/materials", q="priya")) == {m["id"] for m in full if m["owner"] == "Priya Shah"}
    # Full text: "loans" finds "loan"
    assert SUMMER in await ids(client, "/api/materials", q="loans")
    # LIKE characters are plain text
    assert await ids(client, "/api/materials", q="%") == []
    assert await ids(client, "/api/materials", q="zzzz-no-match") == []
    # Search and filters together
    assert await ids(client, "/api/materials", q="summer", status="draft") == []


async def test_materials_sorts(client):
    await as_user(client, VIEWER)
    async with SessionLocal() as db, db.begin():
        # Creation order differs from the ID order here, so the sort reads created_at
        await db.execute(update(Material).where(Material.id == RATERADAR).values(created_at=datetime(2030, 1, 1, tzinfo=UTC)))
    full = (await page(client, "/api/materials"))["items"]
    assert [m["id"] for m in full] == [m["id"] for m in sorted(full, key=lambda m: m["updatedAt"], reverse=True)]
    assert await ids(client, "/api/materials", sort="updated") == [m["id"] for m in full]

    titles = [m["title"] for m in (await page(client, "/api/materials", sort="title"))["items"]]
    assert titles == sorted(titles, key=str.lower)

    expires = [m.get("expiresAt") for m in (await page(client, "/api/materials", sort="expires"))["items"]]
    dated = [e for e in expires if e]
    assert dated and expires[: len(dated)] == sorted(dated) and all(e is None for e in expires[len(dated):])

    created = await ids(client, "/api/materials", sort="created")
    assert created[0] == RATERADAR
    assert created[1:] == sorted(created[1:], reverse=True)  # UUIDv7: the seeded IDs are in creation order


async def test_materials_paging(client):
    await as_user(client, VIEWER)
    full = await ids(client, "/api/materials", sort="title")
    pages = []
    for offset in range(0, 18, 5):
        body = await page(client, "/api/materials", sort="title", limit=5, offset=offset)
        assert body["total"] == 18
        pages += [m["id"] for m in body["items"]]
    assert pages == full
    past = await page(client, "/api/materials", limit=5, offset=40)
    assert past == {"items": [], "total": 18}
    # The total counts the filtered rows, not the page
    body = await page(client, "/api/materials", status="live", limit=2, offset=1)
    assert len(body["items"]) == 2 and body["total"] == 5


@pytest.mark.parametrize(
    "query",
    [
        "status=bogus",
        "status=draft,bogus",
        "live=gone",
        "channel=tiktok",
        "product=boat",
        "sort=newest",
        "limit=0",
        "limit=201",
        "limit=abc",
        "offset=-1",
        "facets=maybe",
        "q=" + "x" * 201,
        "owner=" + ",".join(f"p{i}" for i in range(51)),
    ],
)
async def test_materials_invalid_params(client, query):
    await as_user(client, VIEWER)
    assert (await client.get(f"/api/materials?{query}")).status_code == 422


def counts(rows, key, values_of):
    return dict(Counter(v for row in rows for v in values_of(row, key)))


async def test_materials_facets(client):
    await as_user(client, VIEWER)
    full = (await page(client, "/api/materials"))["items"]
    facets = (await page(client, "/api/materials", facets="true", limit=1))["facets"]
    assert set(facets) == set(MATERIAL_KEYS)
    for key in MATERIAL_KEYS:
        assert facets[key] == counts(full, key, material_values), key
    assert sum(facets["status"].values()) == 18

    # A field's counts use every other filter, and the text search, but not its own filter
    body = await page(client, "/api/materials", facets="true", status="live,in_review", channel="meta")
    facets = body["facets"]
    meta = [m for m in full if m["channel"] == "meta"]
    picked = [m for m in meta if m["status"] in ("live", "in_review")]
    assert body["total"] == len(picked)
    assert facets["status"] == counts(meta, "status", material_values)
    assert facets["channel"] == counts([m for m in full if m["status"] in ("live", "in_review")], "channel", material_values)
    for key in ("live", "product", "group", "owner", "affiliate"):
        assert facets[key] == counts(picked, key, material_values), key

    group = (await page(client, "/api/materials", facets="true", group="Legal"))["facets"]
    assert group["group"] == counts(full, "group", material_values)
    legal = [m for m in full if "Legal" in material_values(m, "group")]
    assert group["status"] == counts(legal, "status", material_values)

    searched = (await page(client, "/api/materials", facets="true", q="lendwise"))["facets"]
    assert searched["affiliate"] == {"LendWise": 2}


# ---- Issues ----


def issue_values(i, key, at):
    match key:
        case "due":
            if i["status"] == "resolved":
                return []
            due = datetime.fromisoformat(i["dueAt"])
            return ["overdue" if due < at else "week" if due <= at + timedelta(days=7) else "later"]
        case "affiliate": return [i["affiliate"]] if "affiliate" in i else []
        case _: return [i[key]]


async def test_issues_each_filter_value(client):
    await as_user(client, VIEWER)
    at = datetime.now(UTC)
    body = await page(client, "/api/issues")
    full = body["items"]
    assert body["total"] == len(full) == 11
    for key in ISSUE_KEYS:
        values = {v for i in full for v in issue_values(i, key, at)}
        assert values, key
        for value in values:
            expected = {i["id"] for i in full if value in issue_values(i, key, at)}
            assert set(await ids(client, "/api/issues", **{key: value})) == expected, (key, value)


async def test_issues_due_buckets(client):
    now = datetime.now(UTC)
    async with SessionLocal() as db, db.begin():
        await db.execute(update(Issue).where(Issue.id == DEBT_ISSUE).values(due_at=now - timedelta(hours=1), status=IssueStatus.OPEN))
        await db.execute(update(Issue).where(Issue.id == NOTICE_ISSUE).values(due_at=now + timedelta(days=30), status=IssueStatus.OPEN))
    await as_user(client, VIEWER)
    assert DEBT_ISSUE in await ids(client, "/api/issues", due="overdue")
    assert DEBT_ISSUE not in await ids(client, "/api/issues", due="week,later")
    assert NOTICE_ISSUE in await ids(client, "/api/issues", due="later")
    async with SessionLocal() as db, db.begin():
        await db.execute(update(Issue).where(Issue.id == DEBT_ISSUE).values(status=IssueStatus.RESOLVED))
    # A resolved issue is in no due bucket
    assert DEBT_ISSUE not in await ids(client, "/api/issues", due="overdue,week,later")


async def test_issues_text_search(client):
    await as_user(client, VIEWER)
    full = (await page(client, "/api/issues"))["items"]
    lendwise = {i["id"] for i in full if i.get("affiliate") == "LendWise"}
    assert NOTICE_ISSUE in lendwise
    assert set(await ids(client, "/api/issues", q="lendwise")) == lendwise
    # The material's title
    notice = next(i for i in full if i["id"] == NOTICE_ISSUE)
    assert NOTICE_ISSUE in await ids(client, "/api/issues", q=notice["material"]["title"])
    # The owner
    assert set(await ids(client, "/api/issues", q="tara")) == {i["id"] for i in full if i["owner"] == "Tara Nguyen"}
    assert await ids(client, "/api/issues", q="zzzz-no-match") == []


async def test_issues_sorts(client):
    await as_user(client, VIEWER)
    full = (await page(client, "/api/issues"))["items"]
    assert any(i["status"] == "resolved" for i in full)

    def resolved_last(i):
        return i["status"] == "resolved"

    # The default is the due date, with resolved issues last
    assert [i["id"] for i in full] == [i["id"] for i in sorted(full, key=lambda i: (resolved_last(i), i["dueAt"]))]
    rank = {"high": 0, "medium": 1, "low": 2}
    by_severity = (await page(client, "/api/issues", sort="severity"))["items"]
    assert [i["id"] for i in by_severity] == [
        i["id"] for i in sorted(full, key=lambda i: (resolved_last(i), rank[i["severity"]], i["dueAt"]))
    ]
    opened = (await page(client, "/api/issues", sort="opened"))["items"]
    assert [i["openedAt"] for i in opened] == sorted((i["openedAt"] for i in full), reverse=True)
    titles = [i["title"] for i in (await page(client, "/api/issues", sort="title"))["items"]]
    assert titles == sorted(titles, key=str.lower)


async def test_issues_paging_and_invalid(client):
    await as_user(client, VIEWER)
    full = await ids(client, "/api/issues", sort="opened")
    first = await page(client, "/api/issues", sort="opened", limit=4)
    rest = await page(client, "/api/issues", sort="opened", limit=10, offset=4)
    assert first["total"] == rest["total"] == 11
    assert [i["id"] for i in first["items"] + rest["items"]] == full
    for query in ["status=closed", "severity=critical", "due=never", "source=email", "channel=x", "sort=due_at", "limit=500"]:
        assert (await client.get(f"/api/issues?{query}")).status_code == 422, query


async def test_issues_facets(client):
    await as_user(client, VIEWER)
    at = datetime.now(UTC)
    full = (await page(client, "/api/issues"))["items"]
    facets = (await page(client, "/api/issues", facets="true"))["facets"]
    assert set(facets) == set(ISSUE_KEYS)
    for key in ISSUE_KEYS:
        assert facets[key] == counts(full, key, lambda i, k: issue_values(i, k, at)), key

    body = await page(client, "/api/issues", facets="true", status="open,in_progress", severity="high")
    open_ = [i for i in full if i["status"] in ("open", "in_progress")]
    picked = [i for i in open_ if i["severity"] == "high"]
    assert body["total"] == len(picked)
    assert body["facets"]["severity"] == counts(open_, "severity", lambda i, k: issue_values(i, k, at))
    assert body["facets"]["owner"] == counts(picked, "owner", lambda i, k: issue_values(i, k, at))


# ---- Visibility (PRD R4) ----


async def test_affiliate_lists_only_own_company(client):
    await as_user(client, AFFILIATE)  # LendWise
    body = await page(client, "/api/materials", facets="true")
    assert {m["id"] for m in body["items"]} == {LENDWISE_POST, LENDWISE_REVIEW} and body["total"] == 2
    assert body["facets"]["affiliate"] == {"LendWise": 2}
    assert sum(body["facets"]["status"].values()) == 2
    # Filters and search never reach other companies or internal content
    assert await ids(client, "/api/materials", affiliate="RateRadar") == []
    assert await ids(client, "/api/materials", q="summer") == []
    assert await ids(client, "/api/materials", q="RateRadar") == []
    assert (await page(client, "/api/materials", limit=1, offset=1))["total"] == 2

    issues = await page(client, "/api/issues", facets="true")
    assert {i["affiliate"] for i in issues["items"]} == {"LendWise"} and issues["total"] == 2
    assert issues["facets"]["affiliate"] == {"LendWise": 2}
    assert sum(issues["facets"]["status"].values()) == 2
    assert await ids(client, "/api/issues", q="debt") == []
    assert DEBT_ISSUE not in await ids(client, "/api/issues", status="open,in_progress,resolved")

    await as_user(client, OTHER_AFFILIATE)
    assert await ids(client, "/api/materials") == [RATERADAR]
    assert await ids(client, "/api/materials", affiliate="LendWise") == []
    assert (await page(client, "/api/issues", facets="true"))["total"] == 0


async def test_issue_with_no_material_is_internal_only(client):
    """Unapproved content found live that matches no material (PRD F10): internal users only."""
    async with SessionLocal() as db, db.begin():
        viewer = await db.scalar(select(User).where(User.email == VIEWER))
        orphan = Issue(
            workspace_id=viewer.workspace_id, channel=Channel.GOOGLE, title="Zebracorn banner found on Google",
            severity=Severity.HIGH, source=IssueSource.MONITORING, owner_id=viewer.id, due_at=datetime.now(UTC) + timedelta(days=2),
        )
        db.add(orphan)
    await as_user(client, VIEWER)
    assert str(orphan.id) in await ids(client, "/api/issues", channel="google", due="week", q="zebracorn")
    facets = (await page(client, "/api/issues", facets="true", q="zebracorn"))["facets"]
    assert facets["channel"] == {"google": 1} and facets["affiliate"] == {}
    await as_user(client, AFFILIATE)
    assert await ids(client, "/api/issues", q="zebracorn") == []
    assert await ids(client, "/api/issues", channel="google") == []


async def test_affiliate_with_no_company_lists_nothing(client):
    async with SessionLocal() as db, db.begin():
        ws = await db.scalar(select(User.workspace_id).where(User.email == VIEWER))
        db.add(User(workspace_id=ws, email="nocompany@affiliate.example", name="No Company", role=Role.AFFILIATE,
                    password_hash=hash_password(DEMO_PASSWORD)))
    await as_user(client, "nocompany@affiliate.example")
    body = await page(client, "/api/materials", facets="true")
    assert body["items"] == [] and body["total"] == 0 and body["facets"]["status"] == {} and body["facets"]["group"] == {}
    assert (await page(client, "/api/issues", facets="true"))["total"] == 0


async def test_other_workspace_lists_nothing(client):
    async with SessionLocal() as db, db.begin():
        other = Workspace(name="Real credit union", licensed_states=["CA"])
        db.add(other)
        await db.flush()
        db.add(User(workspace_id=other.id, email="admin@real.example", name="Real Admin", role=Role.ADMIN,
                    password_hash=hash_password(DEMO_PASSWORD)))
    await as_user(client, "admin@real.example")
    for path in ("/api/materials", "/api/issues"):
        body = await page(client, path, facets="true")
        assert body["items"] == [] and body["total"] == 0
        assert all(v == {} for v in body["facets"].values())
        assert await ids(client, path, q="summer") == []
        assert await ids(client, path, owner="Priya Shah") == []


async def test_signed_out(client):
    assert (await client.get("/api/materials?status=draft")).status_code == 401
    assert (await client.get("/api/issues?status=open")).status_code == 401


# ---- Regulator export: "only the materials shown in the list" ----


async def test_export_uses_list_filters(client):
    await as_user(client, VIEWER)

    async def exported(**body):
        res = await client.post("/api/exports/regulator", json=WIDE | body)
        assert res.status_code == 200, res.text
        z = zipfile.ZipFile(io.BytesIO(res.content))
        rows = csv.DictReader(io.StringIO(z.read("materials.csv").decode()))
        return {r["materialId"] for r in rows}, json.loads(z.read("manifest.json"))["filters"]

    everything, _ = await exported()
    assert everything == seeded()
    got, filters = await exported(listFilters={"q": "summer", "sort": "title", "limit": 1})
    assert got == {SUMMER}
    assert filters["listFilters"] == {"q": "summer"}  # only what is set, and no paging
    # The same values as the list's URL: comma-separated strings, or lists
    assert (await exported(listFilters={"status": "live,in_review"}))[0] == seeded(status=("live", "in_review"))
    assert (await exported(listFilters={"status": ["draft"]}))[0] == seeded(status="draft")
    assert (await exported(listFilters={"group": "Legal", "owner": "Priya Shah"}))[0] <= seeded(owner="Priya Shah")
    res = await client.post("/api/exports/regulator", json=WIDE | {"listFilters": {"status": "bogus"}})
    assert res.status_code == 422
