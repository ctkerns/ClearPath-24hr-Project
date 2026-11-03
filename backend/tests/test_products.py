"""Products (PRD F8, US-66): the workspace's product list, its usage counts, who may change it, the audit trail,
inactive products on write, and the migration that made the table from the old fixed list."""

import json
from collections import Counter
from datetime import UTC, date, datetime
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import select, text

import app
from app.db import SessionLocal
from app.models.materials import Material
from app.models.products import Product
from tests.helpers import ADMIN, AFFILIATE, EXAMPLE_FIELDS, MANAGER, REVIEWER, SUBMITTER, as_user

VIEWER = "ben.okafor@demo.clearpathcu.org"
SUMMER = "01a112a1-4000-7d42-94be-d09364e3b51d"  # personal_loan, meta, in review
DATA = Path(app.__file__).parent / "seed" / "data"
SEEDED = ["personal_loan", "credit_card", "mortgage", "heloc", "auto_loan", "savings"]
LEGAL = "01973a10-2c00-7c52-8f1b-4a7e3b2d9c02"
IN_A_YEAR = date(datetime.now(UTC).year + 1, 12, 31).isoformat()
CSV_HEADER = "key,product,offer,rate,min,max,fees\n"


def seed(name: str, key: str):
    return json.loads((DATA / name).read_text())[key]


async def products(client) -> dict[str, dict]:
    res = await client.get("/api/library/products")
    assert res.status_code == 200, res.text
    return {p["id"]: p for p in res.json()}


async def create(client, name: str, description: str = "A test product."):
    return await client.post("/api/library/products", json={"name": name, "description": description})


async def set_active(client, product_id: str, active: bool):
    res = await client.patch(f"/api/library/products/{product_id}", json={"active": active})
    assert res.status_code == 200, res.text
    return res.json()


def submission(**change):
    body = {
        "title": "Winter savings email",
        "channel": "mailchimp",
        "product": "savings",
        "fields": EXAMPLE_FIELDS["mailchimp"],
        "nationwide": True,
    }
    return body | change


# Reading


@pytest.mark.parametrize("email", [VIEWER, SUBMITTER, REVIEWER, MANAGER, ADMIN])
async def test_internal_users_read_the_seeded_products(client, email):
    await as_user(client, email)
    res = await client.get("/api/library/products")
    assert res.status_code == 200
    rows = res.json()
    # Seed materials use all six, so all six stay active. Active first, then by name.
    assert sorted(p["id"] for p in rows) == sorted(SEEDED)
    assert all(p["active"] for p in rows)
    assert [p["name"] for p in rows] == sorted(p["name"] for p in rows)
    loan = next(p for p in rows if p["id"] == "personal_loan")
    assert (loan["name"], loan["createdBy"]) == ("Personal loan", "Alex Chen")
    assert loan["description"] and loan["createdAt"].startswith("2026-01-12")


async def test_affiliates_and_signed_out_cannot_read_products(client):
    assert (await client.get("/api/library/products")).status_code == 401
    await as_user(client, AFFILIATE)
    assert (await client.get("/api/library/products")).status_code == 403


async def test_usage_counts_only_explicit_products(client):
    await as_user(client, MANAGER)
    found = await products(client)

    materials = seed("materials.json", "materials")
    expected = Counter(m["product"] for m in materials)
    waiting = Counter(m["product"] for m in materials if m["status"] in ("submitted", "in_review"))
    rules = Counter(p for r in seed("rules.json", "rules") for p in set(r["products"]))
    # The current sheet is the one in effect today, the same one the rate check uses
    sheets = sorted(seed("rate-sheet.json", "sheets"), key=lambda s: s["effectiveDate"], reverse=True)
    today = datetime.now(UTC).date().isoformat()
    current = next((s for s in sheets if s["effectiveDate"] <= today), sheets[0])
    rates = Counter(r["product"] for r in current["rows"])
    for pid in SEEDED:
        u = found[pid]["usage"]
        assert (u["materials"], u["materialsInReview"]) == (expected[pid], waiting[pid]), pid
        assert u["rules"] == rules[pid], pid
        assert u["rateSheetRows"] == rates[pid], pid  # not the rows of older sheets
    assert found["savings"]["usage"]["rules"] >= 1

    # A record for every product (an empty list) counts for none; a record that names one counts for it.
    before = {pid: p["usage"] for pid, p in found.items()}
    res = await client.post("/api/routing/rules", json={
        "name": "Any product", "conditions": {"products": [], "channels": [], "states": []}, "requiredGroupIds": [LEGAL],
    })
    assert res.status_code == 201, res.text
    res = await client.post("/api/routing/rules", json={
        "name": "HELOC", "conditions": {"products": ["heloc", "heloc"]}, "requiredGroupIds": [LEGAL],
    })
    assert res.status_code == 201, res.text
    assert res.json()["conditions"]["products"] == ["heloc"]
    res = await client.post("/api/library/building-blocks", json={
        "kind": "claim", "text": "Borrow against your home.", "products": ["heloc"], "states": "all",
        "expiresAt": IN_A_YEAR, "savedFrom": {"id": SUMMER, "title": "Summer"},
    })
    assert res.status_code == 201, res.text
    after = await products(client)
    assert after["heloc"]["usage"]["routingRules"] == before["heloc"]["routingRules"] + 1
    assert after["heloc"]["usage"]["blocks"] == before["heloc"]["blocks"] + 1
    for pid in SEEDED:
        if pid != "heloc":
            assert after[pid]["usage"] == before[pid], pid


# Creating and editing


async def test_manager_creates_a_product_with_a_slug_id(client):
    await as_user(client, MANAGER)
    res = await create(client, "  Boat loan  ", "  Loans for boats.  ")
    assert res.status_code == 201, res.text
    boat = res.json()
    assert (boat["id"], boat["name"], boat["description"], boat["active"]) == ("boat_loan", "Boat loan", "Loans for boats.", True)
    assert boat["createdBy"] == "Alex Chen"
    assert set(boat["usage"].values()) == {0}

    # Another name with the same slug gets a suffix
    assert (await create(client, "Boat-loan!")).json()["id"] == "boat_loan_2"
    assert (await create(client, "Boat loan?")).json()["id"] == "boat_loan_3"
    assert (await create(client, "Personal loan (secured)")).json()["id"] == "personal_loan_secured"
    assert (await create(client, "Personal loan.")).json()["id"] == "personal_loan_2"
    assert (await create(client, "€€€")).json()["id"] == "product"
    long = (await create(client, "A very long product name that goes on and on")).json()["id"]
    assert len(long) <= 32 and long.startswith("a_very_long")
    assert "boat_loan" in await products(client)


@pytest.mark.parametrize("name", ["Personal loan", " personal LOAN ", "SAVINGS"])
async def test_duplicate_names_conflict(client, name):
    await as_user(client, MANAGER)
    assert (await create(client, name)).status_code == 409
    assert len(await products(client)) == len(SEEDED)


async def test_rename_conflict_and_own_case_change(client):
    await as_user(client, MANAGER)
    res = await client.patch("/api/library/products/heloc", json={"name": "mortgage"})
    assert res.status_code == 409
    res = await client.patch("/api/library/products/heloc", json={"name": "Heloc"})
    assert res.status_code == 200 and res.json()["name"] == "Heloc"


@pytest.mark.parametrize("body", [{"name": "", "description": "x"}, {"name": "   ", "description": "x"},
                                  {"name": "X", "description": "  "}, {"name": "X"}, {"name": "X" * 101, "description": "x"}])
async def test_invalid_product_input(client, body):
    await as_user(client, MANAGER)
    assert (await client.post("/api/library/products", json=body)).status_code == 422


@pytest.mark.parametrize("email", [VIEWER, SUBMITTER, REVIEWER])
async def test_below_manager_cannot_change_products(client, email):
    await as_user(client, email)
    assert (await create(client, "Boat loan")).status_code == 403
    assert (await client.patch("/api/library/products/heloc", json={"active": False})).status_code == 403
    assert (await client.patch("/api/library/products/heloc", json={"name": "Home equity"})).status_code == 403
    assert all(p["active"] for p in (await products(client)).values())


async def test_admin_can_change_products_and_there_is_no_delete(client):
    await as_user(client, ADMIN)
    assert (await create(client, "Boat loan")).status_code == 201
    assert (await client.delete("/api/library/products/boat_loan")).status_code == 405
    assert (await client.patch("/api/library/products/nothing", json={"active": False})).status_code == 404


async def test_rename_keeps_the_id(client):
    await as_user(client, MANAGER)
    res = await client.patch("/api/library/products/heloc", json={"name": "Home equity line", "description": "New text."})
    assert res.status_code == 200, res.text
    assert (res.json()["id"], res.json()["name"], res.json()["description"]) == ("heloc", "Home equity line", "New text.")
    heloc = [m for m in (await client.get("/api/materials")).json()["items"] if m["product"] == "heloc"]
    assert len(heloc) == Counter(m["product"] for m in seed("materials.json", "materials"))["heloc"]


async def test_deactivation_changes_no_other_record(client):
    await as_user(client, MANAGER)
    paths = ["/api/materials", "/api/library/rules", "/api/library/disclosures", "/api/library/building-blocks",
             "/api/library/rate-sheets", "/api/routing"]
    before = [(await client.get(p)).json() for p in paths]
    usage = (await products(client))["personal_loan"]["usage"]
    p = await set_active(client, "personal_loan", False)
    assert p["active"] is False and p["usage"] == usage
    assert [(await client.get(p)).json() for p in paths] == before
    # Inactive products are still listed, after the active ones
    rows = (await client.get("/api/library/products")).json()
    assert rows[-1]["id"] == "personal_loan"
    assert (await set_active(client, "personal_loan", True))["active"] is True


async def test_audit_entries(client):
    await as_user(client, MANAGER)
    await create(client, "Boat loan", "Loans for boats.")
    await client.patch("/api/library/products/boat_loan", json={"name": "Boat and RV loan"})
    await client.patch("/api/library/products/boat_loan", json={"name": "Boat and RV loan"})  # no change, no entry
    await set_active(client, "boat_loan", False)
    await set_active(client, "boat_loan", True)
    await as_user(client, ADMIN)
    res = await client.get("/api/audit", params={"entity": "product", "entityId": "boat_loan"})
    assert res.status_code == 200, res.text
    events = list(reversed(res.json()))  # newest first
    assert [e["action"] for e in events] == ["created", "updated", "deactivated", "reactivated"]
    assert all(e["actor"] == "Alex Chen" for e in events)
    assert events[0]["data"] == {"name": "Boat loan", "description": "Loans for boats."}
    assert events[1]["data"] == {"name": {"before": "Boat loan", "after": "Boat and RV loan"}}


# Inactive products on write (F8: an inactive product cannot be chosen; existing records keep it)


async def test_inactive_product_on_materials(client):
    await as_user(client, MANAGER)
    await set_active(client, "personal_loan", False)
    await set_active(client, "savings", False)
    await as_user(client, SUBMITTER)
    res = await client.post("/api/materials", json=submission())
    assert res.status_code == 422 and "Savings is inactive" in res.json()["detail"]
    assert (await client.post("/api/materials", json=submission(product="boat_loan"))).status_code == 422
    assert (await client.post("/api/materials", json=submission(product="credit_card"))).status_code == 201

    # A new version keeps the inactive product it has, but cannot move to another inactive one
    meta = EXAMPLE_FIELDS["meta"]
    version = submission(channel="meta", fields=meta, product="personal_loan")
    res = await client.post(f"/api/materials/{SUMMER}/versions", json=version)
    assert res.status_code == 201, res.text
    items = (await client.get("/api/materials", params={"product": "personal_loan"})).json()["items"]
    assert SUMMER in {m["id"] for m in items}
    res = await client.post(f"/api/materials/{SUMMER}/versions", json=version | {"product": "savings"})
    assert res.status_code == 422


async def test_inactive_product_on_library_records(client):
    await as_user(client, MANAGER)
    rules = (await client.get("/api/library/rules")).json()
    savings_rule = next(r for r in rules if r["products"] == ["savings"])
    await set_active(client, "savings", False)

    keys = ("title", "kind", "text", "jurisdiction", "products", "channels", "citation", "effectiveDate", "severity", "layer", "check")
    body = {k: savings_rule[k] for k in keys} | {"note": "Test edit."}
    assert (await client.patch(f"/api/library/rules/{savings_rule['id']}", json=body)).status_code == 200
    res = await client.post("/api/library/rules", json=body | {"id": "NEW-1"})
    assert res.status_code == 422
    other = next(r for r in rules if not r["products"])
    edit = {k: other[k] for k in keys} | {"note": "Test edit.", "products": ["savings"]}
    assert (await client.patch(f"/api/library/rules/{other['id']}", json=edit)).status_code == 422
    assert (await client.patch(f"/api/library/rules/{other['id']}", json=edit | {"products": ["nope"]})).status_code == 422

    d = (await client.get("/api/library/disclosures")).json()[0]
    dbody = {k: d[k] for k in ("title", "text", "states", "placement", "effectiveDate")} | {"note": "Test edit."}
    assert (await client.patch(f"/api/library/disclosures/{d['id']}", json=dbody | {"products": ["savings"]})).status_code == 422
    assert (await client.post("/api/library/disclosures", json=dbody | {"id": "D-NEW", "products": ["savings"]})).status_code == 422
    assert (await client.post("/api/library/disclosures", json=dbody | {"id": "D-NEW", "products": ["heloc"]})).status_code == 201

    block = {"kind": "claim", "text": "Save more.", "states": "all", "expiresAt": IN_A_YEAR,
             "savedFrom": {"id": SUMMER, "title": "Summer"}}
    assert (await client.post("/api/library/building-blocks", json=block | {"products": ["savings"]})).status_code == 422
    res = await client.post("/api/library/building-blocks", json=block | {"products": []})
    assert res.status_code == 201
    scope = {"states": "all", "expiresAt": IN_A_YEAR}
    assert (await client.patch(f"/api/library/building-blocks/{res.json()['id']}", json=scope | {"products": ["savings"]})).status_code == 422


async def test_inactive_product_on_routing_rules(client):
    await as_user(client, MANAGER)
    rule = {"name": "Savings", "conditions": {"products": ["savings"]}, "requiredGroupIds": [LEGAL]}
    created = (await client.post("/api/routing/rules", json=rule)).json()
    await set_active(client, "savings", False)
    assert (await client.post("/api/routing/rules", json=rule)).status_code == 422
    assert (await client.post("/api/routing/rules", json=rule | {"conditions": {"products": ["boat"]}})).status_code == 422
    # The rule keeps it: an edit, or turning it off, still works
    res = await client.patch(f"/api/routing/rules/{created['id']}", json={"name": "Savings 2", "conditions": rule["conditions"]})
    assert res.status_code == 200, res.text
    assert (await client.patch(f"/api/routing/rules/{created['id']}", json={"enabled": False})).status_code == 200
    other = {"products": ["savings", "heloc"]}
    any_rule = (await client.post("/api/routing/rules", json=rule | {"conditions": {"products": ["heloc"]}})).json()
    assert (await client.patch(f"/api/routing/rules/{any_rule['id']}", json={"conditions": other})).status_code == 422


def sheet_csv(*rows: str) -> dict:
    return {"effectiveDate": "2026-12-01", "file": "x.csv", "csv": CSV_HEADER + "".join(r + "\n" for r in rows)}


async def test_rate_sheet_products(client):
    await as_user(client, MANAGER)
    # The ID, or the name in any case
    res = await client.post("/api/library/rate-sheets", json=sheet_csv(
        "personal_loan.fixed,PERSONAL LOAN,Fixed,apr,8.49,24.99,None.",
        "savings.share,savings,Share savings,apy,0.25,0.25,None.",
    ))
    assert res.status_code == 201, res.text
    assert [r["product"] for r in res.json()["rows"]] == ["personal_loan", "savings"]

    res = await client.post("/api/library/rate-sheets", json=sheet_csv("boat.fixed,boat_loan,Boat,apr,5,9,None."))
    assert res.status_code == 400 and res.json()["detail"] == "Line 2: unknown product 'boat_loan'"

    # Inactive: a row of the current sheet keeps it (same key); a new row cannot take it
    await set_active(client, "savings", False)
    kept = sheet_csv("savings.share,savings,Share savings,apy,0.25,0.25,None.")
    assert (await client.post("/api/library/rate-sheets/impact", json=kept)).status_code == 200
    assert (await client.post("/api/library/rate-sheets", json=kept)).status_code == 201
    new = sheet_csv("savings.new,Savings,Money market,apy,1,2,None.")
    res = await client.post("/api/library/rate-sheets", json=new)
    assert res.status_code == 400 and res.json()["detail"] == "Line 2: the product Savings is inactive"


async def test_unknown_product_filter_is_no_error(client):
    await as_user(client, VIEWER)
    res = await client.get("/api/materials", params={"product": "boat_loan"})
    assert res.status_code == 200 and res.json()["items"] == []
    assert (await client.get("/api/metrics")).status_code == 200


async def test_rate_check_names_the_product(client):
    """The check message uses the product's name from the table, and a rename shows in the next check."""
    await as_user(client, MANAGER)
    await client.patch("/api/library/products/personal_loan", json={"name": "Signature loan"})
    await as_user(client, SUBMITTER)
    fields = [{"label": "Primary text", "text": "Rates from 2.00% APR."}, {"label": "Headline", "text": "Borrow"}]
    res = await client.post("/api/materials", json=submission(channel="meta", product="personal_loan", fields=fields))
    assert res.status_code == 201, res.text
    explanations = [f["explanation"] for f in res.json()["findings"] if f["ruleId"] == "RATE-01"]
    assert explanations and 'for the product "Signature loan"' in explanations[0]


# The migration


def alembic(*args):
    getattr(command, args[0])(Config(str(Path(__file__).parents[1] / "alembic.ini")), *args[1:])


async def test_migration_down_and_up_with_data(client):
    """Downgrade and upgrade again on the seeded data: every material keeps its product, and every workspace
    gets the old list back with the same IDs."""
    async with SessionLocal() as db:
        before = dict((await db.execute(select(Material.id, Material.product))).all())
    assert before
    await run_sync(alembic, "downgrade", "5c1e2a7d9b40")
    async with SessionLocal() as db:
        assert (await db.scalar(text("SELECT to_regclass('products')"))) is None
        assert dict((await db.execute(text("SELECT id, product FROM materials"))).all()) == before
    await run_sync(alembic, "upgrade", "head")
    async with SessionLocal() as db:
        assert dict((await db.execute(select(Material.id, Material.product))).all()) == before
        rows = list(await db.scalars(select(Product)))
        assert {p.id for p in rows} == set(SEEDED) and all(p.active for p in rows)
        assert (await db.scalar(text("SELECT count(*) FROM integrations WHERE default_product_id IS NOT NULL"))) == 0


async def test_migration_downgrade_stops_for_a_new_product(client):
    await as_user(client, MANAGER)
    await create(client, "Boat loan")
    await as_user(client, SUBMITTER)
    assert (await client.post("/api/materials", json=submission(product="boat_loan"))).status_code == 201
    with pytest.raises(RuntimeError, match="boat_loan"):
        await run_sync(alembic, "downgrade", "5c1e2a7d9b40")
    async with SessionLocal() as db:  # nothing changed: the downgrade runs in one transaction
        assert (await db.scalar(text("SELECT version_num FROM alembic_version"))) == "a7c3e91f4d25"
        assert await db.get(Product, ((await db.scalar(select(Material.workspace_id).limit(1))), "boat_loan"))


async def run_sync(fn, *args):
    """Alembic's env.py runs its own event loop, so it runs in a thread."""
    import asyncio

    from app.db import engine

    await engine.dispose()  # no pooled connection holds a lock on the tables
    await asyncio.to_thread(fn, *args)
