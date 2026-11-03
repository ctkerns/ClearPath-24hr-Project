"""The policy library (PRD F7, F8, F9): every internal user reads it, Managers and higher change it (R3),
Reviewers save building blocks (F9), and affiliates see none of it (R4)."""

from datetime import UTC, date, datetime, timedelta

import pytest

from app.db import SessionLocal
from app.models import Role, User, Workspace
from app.models.library import CheckLayer, Rule, RuleKind, RuleVersion, Severity
from app.security import hash_password
from app.seed import DEMO_PASSWORD
from tests.helpers import ADMIN, AFFILIATE, MANAGER, REVIEWER, SUBMITTER, as_user, demo_today

VIEWER = "ben.okafor@demo.clearpathcu.org"
LISTS = ["rules", "disclosures", "building-blocks", "rate-sheets", "regulatory-changes"]
WAITING = "cfpb-regz-trigger-terms-commentary"  # edits REGZ-1026.24
APPLIED = "cfpb-udaap-instant-approval-circular"
BLOCK = "01a0d8b2-1c00-7a41-9e3d-2f5b8c1a0d01"
IN_A_YEAR = (datetime.now(UTC).date() + timedelta(days=365)).isoformat()


async def get(client, path):
    res = await client.get(f"/api/library/{path}")
    assert res.status_code == 200, res.text
    return res.json()


async def rule(client, rule_id):
    return next(r for r in await get(client, "rules") if r["id"] == rule_id)


def rule_body(r, **change):
    """A rule from the list, as an edit body."""
    body = {k: r[k] for k in ("title", "kind", "text", "jurisdiction", "products", "channels", "citation",
                               "effectiveDate", "severity", "layer", "check")}
    return {**body, "note": "Test edit.", **change}


def disclosure_body(d, **change):
    body = {k: d[k] for k in ("title", "text", "products", "states", "placement", "effectiveDate")}
    return {**body, "note": "Test edit.", **change}


def block_body(**change):
    return {
        "kind": "claim",
        "text": "No fees to open an account.",
        "products": ["savings"],
        "states": "all",
        "expiresAt": IN_A_YEAR,
        "savedFrom": {"id": "01a0d660-7200-7f2e-846a-4b2b8dd2f651", "title": "Savings email"},
        **change,
    }


CSV = (
    "key,product,offer,rate,min,max,fees\n"
    'personal_loan.fixed,personal_loan,"12 to 60 months, fixed rate",apr,8.49,24.99,No origination fee.\n'
    "savings.cd12,savings,12-month certificate,apy,4.25%,4.25%,$500 minimum.\n"
)


# Reading


@pytest.mark.parametrize("email", [VIEWER, SUBMITTER, REVIEWER, MANAGER, ADMIN])
async def test_internal_users_read_the_seeded_library(client, email):
    await as_user(client, email)
    rules = await get(client, "rules")
    assert len(rules) == 16
    assert {r["id"] for r in rules if r["pendingChange"]} == {"REGZ-1026.24", "NCUA-740", "CA-FIN-22161"}
    regz = next(r for r in rules if r["id"] == "REGZ-1026.24")
    assert (regz["version"], regz["owner"], regz["check"]["disclosure"]) == (3, "Alex Chen", "D-7")
    assert [v["version"] for v in regz["versions"]] == [3, 2, 1]
    assert next(r for r in rules if r["id"] == "RATE-01")["citation"] is None

    disclosures = await get(client, "disclosures")
    assert len(disclosures) == 9
    d7 = next(d for d in disclosures if d["id"] == "D-7")
    assert d7["states"] == "all" and len(d7["versions"]) == 3 and d7["versions"][0]["text"] == d7["text"]
    assert next(d for d in disclosures if d["id"] == "D-9")["states"] == ["CA"]

    blocks = await get(client, "building-blocks")
    assert len(blocks) == 11
    block = next(b for b in blocks if b["id"] == BLOCK)
    assert (block["approvedBy"], block["approvedAt"], block["usedIn"]) == ("Maya Ruiz", "2026-07-14", 6)

    sheets = await get(client, "rate-sheets")
    assert [s["id"] for s in sheets] == ["2026-11", "2026-07", "2026-06", "2026-05"]
    assert sheets[0]["rows"][0] == {
        "key": "personal_loan.fixed",
        "product": "personal_loan",
        "offer": "12 to 60 months, fixed rate",
        "rate": "apr",
        "min": 0.0899,
        "max": 0.2499,
        "fees": "No origination fee. Late fee $25.",
    }

    changes = await get(client, "regulatory-changes")
    assert len(changes) == 6
    review = next(c for c in changes if c["status"] == "in_review")
    assert review["reviewingBy"] == "Alex Chen" and review["decidedBy"] is None
    assert next(c for c in changes if c["id"] == APPLIED)["decidedBy"] == "Maya Ruiz"


@pytest.mark.parametrize("path", LISTS)
async def test_affiliate_cannot_read_the_library(client, path):
    await as_user(client, AFFILIATE)
    assert (await client.get(f"/api/library/{path}")).status_code == 403


@pytest.mark.parametrize("path", LISTS)
async def test_signed_out_is_401(client, path):
    assert (await client.get(f"/api/library/{path}")).status_code == 401


# Rules (F7)


async def test_manager_edits_a_rule_as_a_new_version(client):
    await as_user(client, MANAGER)
    before = await rule(client, "POL-04")
    check = {"type": "phrase_banned", "phrases": [*before["check"]["phrases"], "risk-free"]}
    res = await client.patch("/api/library/rules/POL-04", json=rule_body(before, check=check, note="Ban risk-free."))
    assert res.status_code == 200, res.text
    after = res.json()
    assert after["version"] == before["version"] + 1
    assert after["versions"][0] == {
        "version": after["version"], "effectiveDate": before["effectiveDate"], "by": "Alex Chen", "note": "Ban risk-free."
    }
    assert "risk-free" in (await rule(client, "POL-04"))["check"]["phrases"]


async def test_admin_has_manager_rights(client):
    await as_user(client, ADMIN)
    r = await rule(client, "POL-07")
    res = await client.patch("/api/library/rules/POL-07", json=rule_body(r, title="New title"))
    assert res.status_code == 200
    assert res.json()["versions"][0]["by"] == "Maya Ruiz"


@pytest.mark.parametrize("email", [VIEWER, SUBMITTER, REVIEWER, AFFILIATE])
async def test_only_managers_change_rules(client, email):
    await as_user(client, MANAGER)
    r = await rule(client, "POL-04")
    client.cookies.clear()
    await as_user(client, email)
    assert (await client.patch("/api/library/rules/POL-04", json=rule_body(r))).status_code == 403
    assert (await client.post("/api/library/rules", json={**rule_body(r), "id": "POL-99"})).status_code == 403


async def test_manager_creates_a_rule(client):
    await as_user(client, MANAGER)
    base = rule_body(await rule(client, "POL-04"))
    new = {**base, "id": "POL-99", "title": "No guarantees", "check": {"type": "phrase_banned", "phrases": ["guaranteed"]}}
    res = await client.post("/api/library/rules", json=new)
    assert res.status_code == 201, res.text
    body = res.json()
    assert (body["id"], body["version"], body["owner"], body["pendingChange"]) == ("POL-99", 1, "Alex Chen", False)
    assert [v["note"] for v in body["versions"]] == ["Test edit."]
    assert len(await get(client, "rules")) == 17
    assert (await client.post("/api/library/rules", json=new)).status_code == 409


async def test_invalid_rules(client):
    await as_user(client, MANAGER)
    r = await rule(client, "REGZ-1026.24")
    patch = lambda **c: client.patch("/api/library/rules/REGZ-1026.24", json=rule_body(r, **c))  # noqa: E731
    assert (await patch(check={**r["check"], "disclosure": "D-404"})).status_code == 400
    assert (await patch(layer="ai")).status_code == 422  # an AI rule needs AI guidance
    assert (await patch(jurisdiction="XX")).status_code == 422
    assert (await patch(products=["boat_loan"])).status_code == 422
    assert (await patch(check={"type": "phrase_banned", "phrases": []})).status_code == 422
    assert (await patch(note="")).status_code == 422
    assert (await client.patch("/api/library/rules/NOPE-1", json=rule_body(r))).status_code == 404
    bad_id = await client.post("/api/library/rules", json={**rule_body(r), "id": "has space"})
    assert bad_id.status_code == 422


# Disclosures (F8)


async def test_manager_edits_a_disclosure_and_keeps_every_text(client):
    await as_user(client, MANAGER)
    d = next(x for x in await get(client, "disclosures") if x["id"] == "D-9")
    res = await client.patch(
        "/api/library/disclosures/D-9", json=disclosure_body(d, text="New text.", states=["TX", "CA"], note="Now TX too.")
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert (body["version"], body["text"], body["states"]) == (2, "New text.", ["CA", "TX"])
    assert [v["text"] for v in body["versions"]] == ["New text.", d["text"]]
    assert body["versions"][0]["by"] == "Alex Chen"


async def test_manager_creates_a_disclosure(client):
    await as_user(client, MANAGER)
    d = next(x for x in await get(client, "disclosures") if x["id"] == "D-1")
    res = await client.post("/api/library/disclosures", json={**disclosure_body(d), "id": "D-10"})
    assert res.status_code == 201, res.text
    assert (res.json()["version"], res.json()["owner"]) == (1, "Alex Chen")
    assert (await client.post("/api/library/disclosures", json={**disclosure_body(d), "id": "D-10"})).status_code == 409


async def test_disclosure_rules(client):
    await as_user(client, MANAGER)
    d = next(x for x in await get(client, "disclosures") if x["id"] == "D-1")
    assert (await client.patch("/api/library/disclosures/D-1", json=disclosure_body(d, states=["ZZ"]))).status_code == 422
    assert (await client.patch("/api/library/disclosures/D-1", json=disclosure_body(d, states=[]))).status_code == 422
    assert (await client.patch("/api/library/disclosures/D-404", json=disclosure_body(d))).status_code == 404
    client.cookies.clear()
    await as_user(client, REVIEWER)
    assert (await client.patch("/api/library/disclosures/D-1", json=disclosure_body(d))).status_code == 403
    assert (await client.post("/api/library/disclosures", json={**disclosure_body(d), "id": "D-11"})).status_code == 403


# Building blocks (F9)


async def test_reviewer_saves_a_block_to_the_library(client):
    await as_user(client, REVIEWER)
    res = await client.post("/api/library/building-blocks", json=block_body())
    assert res.status_code == 201, res.text
    block = res.json()
    assert (block["approvedBy"], block["approvedAt"], block["usedIn"]) == ("Jordan Kim", demo_today().isoformat(), 0)
    assert block["savedFrom"]["title"] == "Savings email"
    assert len(await get(client, "building-blocks")) == 12
    # The same text of the same kind is in the library once.
    assert (await client.post("/api/library/building-blocks", json=block_body())).status_code == 409


async def test_invalid_blocks(client):
    await as_user(client, REVIEWER)
    yesterday = (demo_today() - timedelta(days=1)).isoformat()
    for change in [{"expiresAt": yesterday}, {"kind": "footer"}, {"text": ""}, {"states": ["XX"]}]:
        assert (await client.post("/api/library/building-blocks", json=block_body(**change))).status_code == 422


@pytest.mark.parametrize("email", [VIEWER, SUBMITTER, AFFILIATE])
async def test_below_reviewer_cannot_save_blocks(client, email):
    await as_user(client, email)
    assert (await client.post("/api/library/building-blocks", json=block_body())).status_code == 403


async def test_manager_curates_blocks(client):
    await as_user(client, MANAGER)
    scope = {"products": ["personal_loan", "auto_loan"], "states": ["WA", "CA"], "expiresAt": IN_A_YEAR}
    res = await client.patch(f"/api/library/building-blocks/{BLOCK}", json=scope)
    assert res.status_code == 200, res.text
    assert (res.json()["products"], res.json()["states"], res.json()["expiresAt"]) == (
        ["personal_loan", "auto_loan"], ["CA", "WA"], IN_A_YEAR
    )
    assert (await client.delete(f"/api/library/building-blocks/{BLOCK}")).status_code == 204
    assert all(b["id"] != BLOCK for b in await get(client, "building-blocks"))
    assert (await client.delete(f"/api/library/building-blocks/{BLOCK}")).status_code == 404


async def test_reviewer_cannot_curate_blocks(client):
    await as_user(client, REVIEWER)
    scope = {"products": [], "states": "all", "expiresAt": IN_A_YEAR}
    assert (await client.patch(f"/api/library/building-blocks/{BLOCK}", json=scope)).status_code == 403
    assert (await client.delete(f"/api/library/building-blocks/{BLOCK}")).status_code == 403


# Rate sheet (F8)


async def test_manager_uploads_a_rate_sheet(client):
    await as_user(client, MANAGER)
    res = await client.post(
        "/api/library/rate-sheets", json={"effectiveDate": "2026-12-01", "file": "rates-2026-12.csv", "csv": CSV}
    )
    assert res.status_code == 201, res.text
    sheet = res.json()
    assert (sheet["uploadedBy"], sheet["file"], len(sheet["rows"])) == ("Alex Chen", "rates-2026-12.csv", 2)
    assert sheet["rows"][0]["offer"] == "12 to 60 months, fixed rate"
    assert (sheet["rows"][0]["min"], sheet["rows"][1]["rate"], sheet["rows"][1]["max"]) == (0.0849, "apy", 0.0425)
    # The newest sheet is the current one.
    assert (await get(client, "rate-sheets"))[0]["id"] == sheet["id"]


@pytest.mark.parametrize(
    "csv",
    [
        "key,product,offer\nx,savings,y\n",  # missing columns
        "key,product,offer,rate,min,max,fees\n",  # no rows
        "key,product,offer,rate,min,max,fees\nx,boat_loan,y,apr,1,2,z\n",
        "key,product,offer,rate,min,max,fees\nx,savings,y,apz,1,2,z\n",
        "key,product,offer,rate,min,max,fees\nx,savings,y,apy,3,2,z\n",
        "key,product,offer,rate,min,max,fees\nx,savings,y,apy,abc,2,z\n",
        "key,product,offer,rate,min,max,fees\nx,savings,y,apy,1,2,z\nx,savings,y,apy,1,2,z\n",  # key twice
        "key,product,offer,rate,min,max,fees\nx,savings,y,apy,1\n",  # short line
    ],
)
async def test_invalid_rate_sheet(client, csv):
    await as_user(client, MANAGER)
    res = await client.post("/api/library/rate-sheets", json={"effectiveDate": "2026-12-01", "file": "x.csv", "csv": csv})
    assert res.status_code == 400, res.text
    assert len(await get(client, "rate-sheets")) == 4


async def test_reviewer_cannot_upload_a_rate_sheet(client):
    await as_user(client, REVIEWER)
    res = await client.post("/api/library/rate-sheets", json={"effectiveDate": "2026-12-01", "file": "x.csv", "csv": CSV})
    assert res.status_code == 403


# Regulatory change queue (F7)


async def test_manager_applies_a_change(client):
    await as_user(client, MANAGER)
    before = await rule(client, "REGZ-1026.24")
    change = next(c for c in await get(client, "regulatory-changes") if c["id"] == WAITING)
    res = await client.post(f"/api/library/regulatory-changes/{WAITING}/apply", json={})
    assert res.status_code == 200, res.text
    applied = res.json()
    assert (applied["status"], applied["decidedBy"], applied["decisionNote"]) == ("applied", "Alex Chen", None)
    assert applied["edits"][0]["before"] == before["text"]

    after = await rule(client, "REGZ-1026.24")
    assert after["text"] == change["edits"][0]["after"]
    assert (after["version"], after["effectiveDate"], after["pendingChange"]) == (4, change["effectiveDate"], False)
    assert after["versions"][0]["note"] == f"Applied regulatory change: {change['title']}"

    again = await client.post(f"/api/library/regulatory-changes/{WAITING}/apply", json={})
    assert again.status_code == 409


async def test_manager_dismisses_a_change_with_a_reason(client):
    await as_user(client, MANAGER)
    before = await rule(client, "NCUA-740")
    url = "/api/library/regulatory-changes/ncua-digital-official-sign/dismiss"
    assert (await client.post(url, json={})).status_code == 400
    assert (await client.post(url, json={"note": "  "})).status_code == 400
    res = await client.post(url, json={"note": "Our pages already do this."})
    assert res.status_code == 200, res.text
    assert (res.json()["status"], res.json()["decisionNote"]) == ("dismissed", "Our pages already do this.")
    after = await rule(client, "NCUA-740")
    assert (after["text"], after["version"], after["pendingChange"]) == (before["text"], before["version"], False)
    assert (await client.post(f"/api/library/regulatory-changes/{APPLIED}/dismiss", json={"note": "x"})).status_code == 409
    assert (await client.post("/api/library/regulatory-changes/nope/apply", json={})).status_code == 404


async def test_apply_takes_the_review_and_note(client):
    await as_user(client, ADMIN)
    res = await client.post("/api/library/regulatory-changes/ca-dfpi-ccfpl-rate-claims/apply", json={"note": "OK."})
    assert res.status_code == 200
    body = res.json()
    assert (body["reviewingBy"], body["decidedBy"], body["decisionNote"]) == (None, "Maya Ruiz", "OK.")
    assert (await rule(client, "CA-FIN-22161"))["versions"][0]["note"] == "OK."


@pytest.mark.parametrize("email", [VIEWER, SUBMITTER, REVIEWER, AFFILIATE])
async def test_only_managers_decide_changes(client, email):
    await as_user(client, email)
    assert (await client.post(f"/api/library/regulatory-changes/{WAITING}/apply", json={})).status_code == 403
    assert (await client.post(f"/api/library/regulatory-changes/{WAITING}/dismiss", json={"note": "x"})).status_code == 403


# Workspace isolation and the demo reset


async def test_other_workspace_is_invisible(client):
    """Each workspace has its own library. The same rule ID can exist in both."""
    async with SessionLocal() as db, db.begin():
        other = Workspace(name="Real workspace")
        db.add(other)
        await db.flush()
        boss = User(
            workspace_id=other.id, email="boss@clearpath.example", name="Boss", role=Role.MANAGER,
            password_hash=hash_password(DEMO_PASSWORD),
        )
        db.add(boss)
        await db.flush()
        db.add(Rule(
            workspace_id=other.id, id="RATE-01", version=1, title="Real rate rule", kind=RuleKind.POLICY, text="Rates.",
            jurisdiction="all", products=[], channels=[], effective_date=date(2026, 1, 1), owner_id=boss.id,
            severity=Severity.HIGH, layer=CheckLayer.CODE, check={"type": "rate_sheet"},
            versions=[RuleVersion(version=1, effective_date=date(2026, 1, 1), by_id=boss.id, note="First.")],
        ))

    await as_user(client, "boss@clearpath.example")
    assert [r["title"] for r in await get(client, "rules")] == ["Real rate rule"]
    for path in LISTS[1:]:
        assert await get(client, path) == []
    demo_rule = rule_body(await rule(client, "RATE-01"))
    assert (await client.patch("/api/library/rules/REGZ-1026.24", json=demo_rule)).status_code == 404
    assert (await client.post(f"/api/library/regulatory-changes/{WAITING}/apply", json={})).status_code == 404
    scope = {"products": [], "states": "all", "expiresAt": IN_A_YEAR}
    assert (await client.patch(f"/api/library/building-blocks/{BLOCK}", json=scope)).status_code == 404
    # A rule check may not point at another workspace's disclosure.
    check = {"type": "required_disclosure", "disclosure": "D-7"}
    assert (await client.patch("/api/library/rules/RATE-01", json={**demo_rule, "check": check})).status_code == 400

    client.cookies.clear()
    await as_user(client, MANAGER)
    demo = await rule(client, "RATE-01")
    assert demo["title"] != "Real rate rule" and len(await get(client, "rules")) == 16


async def test_demo_reset_restores_the_library(client):
    from app.seed import create_demo, delete_demo

    await as_user(client, MANAGER)
    await client.post(f"/api/library/regulatory-changes/{WAITING}/apply", json={})
    await client.delete(f"/api/library/building-blocks/{BLOCK}")
    await client.post("/api/library/rate-sheets", json={"effectiveDate": "2026-12-01", "file": "x.csv", "csv": CSV})

    async with SessionLocal() as db, db.begin():
        await delete_demo(db)
        await create_demo(db)

    client.cookies.clear()  # the reset ends every demo session
    await as_user(client, MANAGER)
    assert (await rule(client, "REGZ-1026.24"))["version"] == 3
    assert len(await get(client, "building-blocks")) == 11
    assert len(await get(client, "rate-sheets")) == 4
    assert next(c for c in await get(client, "regulatory-changes") if c["id"] == WAITING)["status"] == "waiting"
