from datetime import date

from app.db import SessionLocal
from app.models import Role, User, Workspace
from app.models.library import CheckLayer, Rule, RuleKind, Severity
from app.security import hash_password
from app.seed import DEMO_PASSWORD
from tests.helpers import AFFILIATE, MANAGER, as_user

VIEWER = "ben.okafor@demo.clearpathcu.org"

LENDWISE_POST = "01a0dfa5-7e00-7a60-a023-ce47b3e545d3"
LENDWISE_REVIEW = "01a10dfe-ba00-70a4-92a2-32f7091afc7c"
MORTGAGE_PAGE = "01a104b9-ae00-78d3-96ab-b1577e94da6a"
EMPTY = {"materials": [], "issues": [], "rules": [], "disclosures": [], "buildingBlocks": []}


async def search(client, q):
    res = await client.get("/api/search", params={"q": q})
    assert res.status_code == 200, res.text
    return res.json()


async def test_title_words(client):
    await as_user(client, VIEWER)
    r = await search(client, "mortgage landing")
    assert [m["id"] for m in r["materials"]] == [MORTGAGE_PAGE]
    m = r["materials"][0]
    assert (m["title"], m["channel"], m["status"], m["approvalId"]) == (
        "Mortgage prequal landing page", "wordpress", "live", "CP-2026-0118-v2"
    )
    # Full-text search stems words: "loans" finds "loan".
    assert "Summer personal loan, Meta feed ad" in [m["title"] for m in (await search(client, "personal loans"))["materials"]]
    # Half-typed words match too.
    assert [m["title"] for m in (await search(client, "summ"))["materials"]] == ["Summer personal loan, Meta feed ad"]


async def test_approval_id(client):
    await as_user(client, VIEWER)
    assert [m["id"] for m in (await search(client, "CP-2026-0118"))["materials"]] == [MORTGAGE_PAGE]
    assert [m["id"] for m in (await search(client, "cp-2026-0118-v2"))["materials"]] == [MORTGAGE_PAGE]


async def test_issues_with_material_title(client):
    await as_user(client, VIEWER)
    r = await search(client, "missing disclosure")
    assert r["issues"][0] == {
        "id": "01a19b87-a300-7083-a17b-e83caf805f10",
        "title": "Live page is missing disclosure D-4",
        "material": "Cash back card, affiliate post",
    }
    # The material title finds its issues too, newest first.
    titles = [i["title"] for i in (await search(client, "mortgage prequal"))["issues"]]
    assert titles == ["NMLS ID missing from the footer after the site redesign", "Hero image changed on the live page"]


async def test_library_ids_and_ranking(client):
    await as_user(client, MANAGER)
    assert [x["id"] for x in (await search(client, "REGZ-1026"))["rules"]] == ["REGZ-1026.16", "REGZ-1026.24"]
    # The exact ID first, then other matches.
    r = await search(client, "d-4")
    assert r["disclosures"] == [{"id": "D-4", "title": "Cash back card rewards terms"}]
    rules = (await search(client, "RATE-01"))["rules"]
    assert rules[0] == {"id": "RATE-01", "title": "Every APR is inside the rate sheet range"}
    blocks = (await search(client, "credit score"))["buildingBlocks"]
    assert [(b["kind"], b["title"]) for b in blocks] == [("cta", "Check your rate. It won't affect your credit score.")]


async def test_group_limit(client):
    await as_user(client, MANAGER)
    r = await search(client, "an")
    assert len(r["materials"]) == 6
    assert len(r["issues"]) == 6
    assert len(r["rules"]) == 6


async def test_short_and_empty_queries(client):
    await as_user(client, MANAGER)
    assert await search(client, "") == EMPTY
    assert await search(client, "   ") == EMPTY
    assert await search(client, "a") == EMPTY


async def test_like_wildcards_are_plain_text(client):
    await as_user(client, MANAGER)
    assert await search(client, "%%") == EMPTY
    assert await search(client, "__") == EMPTY
    assert await search(client, "%_\\") == EMPTY
    # A real % still matches.
    assert [b["title"] for b in (await search(client, "1.5%"))["buildingBlocks"]] == [
        "Earn 1.5% cash back on every purchase, with no annual fee."
    ]


async def test_affiliate_sees_only_own_company(client):
    await as_user(client, AFFILIATE)  # LendWise
    r = await search(client, "card")
    assert {m["id"] for m in r["materials"]} == {LENDWISE_POST, LENDWISE_REVIEW}
    assert {i["material"] for i in r["issues"]} == {"Cash back card, affiliate post"}
    assert (r["rules"], r["disclosures"], r["buildingBlocks"]) == ([], [], [])
    # Other content, and library IDs, find nothing.
    assert await search(client, "mortgage") == EMPTY
    assert await search(client, "unapproved ad") == EMPTY
    assert await search(client, "REGZ") == EMPTY


async def test_other_workspace_never_appears(client):
    async with SessionLocal() as db, db.begin():
        other = Workspace(name="Real credit union")
        db.add(other)
        await db.flush()
        admin = User(
            workspace_id=other.id,
            email="admin@real.example",
            name="Real Admin",
            role=Role.ADMIN,
            password_hash=hash_password(DEMO_PASSWORD),
        )
        db.add(admin)
        await db.flush()
        db.add(
            Rule(
                workspace_id=other.id,
                id="RATE-01",
                version=1,
                title="Real workspace rate rule",
                kind=RuleKind.POLICY,
                text="x",
                jurisdiction="all",
                effective_date=date(2026, 1, 1),
                owner_id=admin.id,
                severity=Severity.HIGH,
                layer=CheckLayer.CODE,
                check={"type": "manual"},
            )
        )
    await as_user(client, "admin@real.example")
    r = await search(client, "loan")
    assert r == EMPTY
    assert (await search(client, "RATE-01"))["rules"] == [{"id": "RATE-01", "title": "Real workspace rate rule"}]

    await as_user(client, MANAGER)
    assert (await search(client, "RATE-01"))["rules"] == [{"id": "RATE-01", "title": "Every APR is inside the rate sheet range"}]


async def test_signed_out(client):
    assert (await client.get("/api/search", params={"q": "loan"})).status_code == 401
