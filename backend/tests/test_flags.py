"""Flags for re-review (PRD F7, F8, F15). The server decides which approved materials depend on a library
change, from their approved version: checklist and findings, product, channel, target states, end date,
content, and the rule's jurisdiction. The preview ("impact") is exactly what saving flags. Flags and their
history entries are written in the same transaction as the change. Reviewers resolve them. Affiliates see
flags only on their own materials."""

import uuid
import pytest
from sqlalchemy import func, select

from app import library
from app.db import SessionLocal
from app.models import Affiliate, User, Workspace
from app.models.audit import AuditEvent
from app.models.flags import MaterialFlag
from app.models.materials import Channel, Material, MaterialStatus, MaterialVersion, Product
from tests.helpers import AFFILIATE, MANAGER, REVIEWER, SUBMITTER, as_user
from tests.test_library import CSV, WAITING, disclosure_body, rule, rule_body
from tests.test_materials import DEBT, SUMMER, VIEWER, submission

SEEDED_FLAG = "01a1b2c0-5e00-7f07-9a11-6c0d2f1e0a01"
# The debt payoff ad (DEBT) states 8.99% to 24.99% APR and has "Federally insured by NCUA." in its content.
LOAN_FIELDS = [{"label": "Headline", "text": "Personal loans from 8.99% APR"}, {"label": "Footer", "text": "Federally insured by NCUA."}]


async def approved(title, *, product="personal_loan", channel="meta", states="Nationwide", fields=LOAN_FIELDS,
                   end=None, status=MaterialStatus.APPROVED, checklist=(), affiliate=None) -> str:
    """An approved material with one version, made in the database. Returns its id."""
    async with SessionLocal() as db, db.begin():
        ws = await db.scalar(select(Workspace).where(Workspace.is_demo))
        owner = await db.scalar(select(User).where(User.email == SUBMITTER))
        company = await db.scalar(select(Affiliate).where(Affiliate.name == affiliate)) if affiliate else None
        m = Material(workspace_id=ws.id, title=title, channel=Channel(channel), product=Product(product), status=status,
                     owner_id=owner.id, affiliate_id=company.id if company else None, approval_id=f"CP-T-{uuid.uuid4().hex[:6]}")
        db.add(m)
        await db.flush()
        details = {"targetStates": states, **({"endDate": end} if end else {})}
        db.add(MaterialVersion(workspace_id=ws.id, material_id=m.id, number=1, submitted_by_id=owner.id, details=details,
                               fields=[{"label": f["label"], "segments": [f["text"]]} for f in fields],
                               checklist=[{"ruleId": r, "title": r, "layer": "code", "result": "pass"} for r in checklist]))
        return str(m.id)


async def impact(client, path, body=None):
    res = await (client.post(f"/api/library/{path}/impact", json=body) if body is not None else client.get(f"/api/library/{path}/impact"))
    assert res.status_code == 200, res.text
    return {m["id"] for m in res.json()}


async def flags_of(material_id) -> list[MaterialFlag]:
    async with SessionLocal() as db:
        return list(await db.scalars(
            select(MaterialFlag).where(MaterialFlag.material_id == material_id).order_by(MaterialFlag.created_at, MaterialFlag.id)
        ))


async def open_flag_ids() -> set[str]:
    async with SessionLocal() as db:
        return {str(m) for m in await db.scalars(select(MaterialFlag.material_id).where(MaterialFlag.resolved_at.is_(None)))}


async def audit(material_id, action) -> list[AuditEvent]:
    async with SessionLocal() as db:
        return list(await db.scalars(
            select(AuditEvent).where(AuditEvent.entity_id == str(material_id), AuditEvent.action == action).order_by(AuditEvent.id)
        ))


# Which materials depend on a change


async def test_rule_dependents_use_the_approved_version(client):
    await as_user(client, VIEWER)  # every internal user reads the library and its impact
    texas = await approved("Texas loan ad", states="TX")
    california = await approved("California loan ad", states="CA, TX")
    card = await approved("Card ad", product="credit_card")
    listed = await approved("Card ad with REGZ on its checklist", product="credit_card", checklist=["REGZ-1026.24"])
    waiting = await approved("Loan ad in review", status=MaterialStatus.IN_REVIEW)
    # REGZ-1026.24: federal, personal loans, auto loans, mortgages. DEBT is live and has it on its checklist.
    found = await impact(client, "rules/REGZ-1026.24")
    assert {DEBT, texas, california, listed} <= found
    assert card not in found  # other product
    assert waiting not in found and SUMMER not in found  # not approved: in review
    # A state rule: only content that targets the state, or nationwide content (every licensed state, F7)
    found = await impact(client, "rules/CA-FIN-22161")
    assert {DEBT, california} <= found and texas not in found
    # A company rule ("all") applies everywhere, and an AI rule counts too (it is not on the code checklist)
    assert {texas, card} <= await impact(client, "rules/POL-04")
    assert texas in await impact(client, "rules/UDAAP-03")
    assert await impact(client, "rules/REGZ-1026.16") >= {card} and DEBT not in await impact(client, "rules/REGZ-1026.16")


async def test_rule_edit_flags_what_the_preview_shows(client):
    await as_user(client, MANAGER)
    texas = await approved("Texas loan ad", states="TX")
    ended = await approved("Ended loan ad", end="2026-01-31")
    california = await approved("California card ad", product="credit_card", states="CA")
    r = await rule(client, "CA-FIN-22161")
    # The edit widens the rule to credit cards; it takes effect after the ended ad's end date.
    scope = {"jurisdiction": "CA", "products": ["personal_loan", "auto_loan", "credit_card"], "channels": [], "effectiveDate": "2026-12-01"}
    preview = await impact(client, "rules/CA-FIN-22161", scope)
    assert {DEBT, california} <= preview  # before (loans in CA) and after (cards too)
    assert texas not in preview and ended not in preview

    res = await client.patch("/api/library/rules/CA-FIN-22161", json=rule_body(r, **scope, text="New text."))
    assert res.status_code == 200, res.text
    assert await open_flag_ids() == preview  # nothing else had an open flag
    [f] = await flags_of(california)
    assert (f.kind, f.source_id, f.source_version) == ("rule_changed", "CA-FIN-22161", 2)
    # The history entry is written in the same transaction as the rule version and the flag
    [e] = await audit(california, "flagged")
    [updated] = await audit("CA-FIN-22161", "updated")
    assert e.created_at == updated.created_at and e.data["flagId"] == str(f.id)
    assert e.data["text"] == f'Flagged version 1 for re-review: Rule CA-FIN-22161 "{r["title"]}" changed to version 2.'
    # The material is still approved: a flag asks for a re-review, it does not end the approval
    res = await client.get(f"/api/materials/{california}")
    assert res.json()["flags"][0]["summary"] == f.summary
    assert res.json()["history"][-1] == {"at": res.json()["history"][-1]["at"], "actor": "Alex Chen", "type": "flag", "text": e.data["text"]}
    row = next(m for m in (await client.get("/api/materials")).json() if m["id"] == california)
    assert (row["status"], row["openFlags"]) == ("approved", 1)
    assert "openFlags" not in next(m for m in (await client.get("/api/materials")).json() if m["id"] == texas)


async def test_failed_edit_flags_nothing(client, monkeypatch):
    await as_user(client, MANAGER)
    r = await rule(client, "REGZ-1026.24")

    async def broken(*args, **kwargs):
        raise RuntimeError("commit failed")

    monkeypatch.setattr(library, "rule_saved", broken)
    with pytest.raises(RuntimeError):
        await client.patch("/api/library/rules/REGZ-1026.24", json=rule_body(r))
    assert await open_flag_ids() == set()
    assert not [e for e in await audit(DEBT, "flagged") if e.data.get("sourceId") == "REGZ-1026.24"]


async def test_disclosure_edit_flags_its_users(client):
    await as_user(client, MANAGER)
    uses_text = await approved("Card ad with the NCUA line", product="credit_card", channel="google")
    no_text = await approved("Card ad without it", product="credit_card", fields=[{"label": "Body", "text": "Earn cash back."}])
    # D-1 "Federally insured by NCUA." is required by NCUA-740 for every product, so both depend on it;
    # D-7 is for personal loans only, and only REGZ-1026.24 requires it.
    assert {DEBT, uses_text, no_text} <= await impact(client, "disclosures/D-1")
    d7 = await impact(client, "disclosures/D-7")
    assert DEBT in d7 and uses_text not in d7 and no_text not in d7
    d = next(x for x in (await client.get("/api/library/disclosures")).json() if x["id"] == "D-7")
    res = await client.patch("/api/library/disclosures/D-7", json=disclosure_body(d, text="APR = Annual Percentage Rate. New text."))
    assert res.status_code == 200, res.text
    assert await open_flag_ids() == d7
    [f] = [x for x in await flags_of(DEBT) if x.resolved_at is None]
    assert (f.kind, f.source_id, f.source_version) == ("disclosure_changed", "D-7", 4)


async def test_rate_sheet_flags_rates_it_no_longer_covers(client):
    await as_user(client, MANAGER)
    savings = await approved("Savings ad", product="savings", fields=[{"label": "Body", "text": "Earn 4.25% APY."}])
    body = {"effectiveDate": "2026-12-01", "file": "rates.csv", "csv": CSV}  # personal loans from 8.49%: still covers 8.99%
    assert await impact(client, "rate-sheets", body) == set()
    # Personal loans now start at 9.49%, so "8.99%" in the ads is no longer covered. Savings stays.
    higher = CSV.replace("apr,8.49,24.99", "apr,9.49,24.99")
    res = await client.post("/api/library/rate-sheets/impact", json={**body, "csv": higher})
    affected = {m["id"]: m["rates"] for m in res.json()}
    assert affected[DEBT] == ["8.99%"] and savings not in affected
    res = await client.post("/api/library/rate-sheets", json={**body, "csv": higher})
    assert res.status_code == 201, res.text
    assert await open_flag_ids() == set(affected)
    [f] = (await flags_of(DEBT))[1:]  # the seeded flag is first
    assert (f.kind, f.source_id, f.data) == ("rate_sheet_changed", res.json()["id"], {"rates": ["8.99%"]})
    # A bad CSV fails the preview the same way it fails the upload
    assert (await client.post("/api/library/rate-sheets/impact", json={**body, "csv": "a,b\n1,2\n"})).status_code == 400


async def test_regulatory_change_flags_once_per_material(client):
    await as_user(client, MANAGER)
    preview = await impact(client, f"regulatory-changes/{WAITING}")
    assert DEBT in preview and SUMMER not in preview
    res = await client.post(f"/api/library/regulatory-changes/{WAITING}/apply", json={"note": None})
    assert res.status_code == 200, res.text
    assert await open_flag_ids() == preview
    new = [f for f in await flags_of(DEBT) if f.resolved_at is None]
    assert [(f.kind, f.source_id, f.data) for f in new] == [("regulatory_change", WAITING, {"rules": ["REGZ-1026.24"]})]
    # Applied: the impact lists what it flagged. A dismissed change flags nothing.
    assert await impact(client, f"regulatory-changes/{WAITING}") == preview
    assert await impact(client, "regulatory-changes/ftc-can-spam-transactional") == set()


# Resolving


async def test_reviewer_resolves_a_flag(client):
    await as_user(client, MANAGER)
    await client.post(f"/api/library/regulatory-changes/{WAITING}/apply", json={"note": None})
    flag = (await client.get(f"/api/materials/{DEBT}")).json()["flags"][0]
    url = f"/api/materials/{DEBT}/flags/{flag['id']}/resolve"

    await as_user(client, SUBMITTER)
    assert (await client.post(url, json={"note": "Fine."})).status_code == 403  # Reviewer or higher
    await as_user(client, REVIEWER)
    assert (await client.post(url, json={"note": ""})).status_code == 422
    assert (await client.post(f"/api/materials/{SUMMER}/flags/{flag['id']}/resolve", json={"note": "x"})).status_code == 404
    res = await client.post(url, json={"note": "The ad has the full disclosure."})
    assert res.status_code == 200, res.text
    assert res.json()["flags"] == []
    assert res.json()["history"][-1]["type"] == "flag"
    assert res.json()["history"][-1]["text"].endswith("Note: The ad has the full disclosure.")
    [f] = [x for x in await flags_of(DEBT) if str(x.id) == flag["id"]]
    assert (f.resolution, f.resolution_note) == ("no_change", "The ad has the full disclosure.")
    [e] = [x for x in await audit(DEBT, "flag_resolved") if x.data["flagId"] == flag["id"]]
    assert e.created_at == f.resolved_at
    assert (await client.post(url, json={"note": "Again."})).status_code == 409
    row = next(m for m in (await client.get("/api/materials")).json() if m["id"] == DEBT)
    assert row["status"] == "live" and "openFlags" not in row


async def test_new_version_resolves_flags(client):
    await as_user(client, MANAGER)
    await client.post(f"/api/library/regulatory-changes/{WAITING}/apply", json={"note": None})
    await as_user(client, SUBMITTER)
    res = await client.post(f"/api/materials/{DEBT}/versions", json=submission(channel="google", product="personal_loan"))
    assert res.status_code == 201, res.text
    assert res.json()["flags"] == []
    assert [f.resolution for f in await flags_of(DEBT)][-1] == "new_version"


# Visibility and roles


async def test_affiliate_sees_flags_on_own_material_only(client):
    own = await approved("LendWise loan post", channel="affiliate", affiliate="LendWise")
    other = await approved("RateRadar loan post", channel="affiliate", affiliate="RateRadar")
    await as_user(client, MANAGER)
    await client.post(f"/api/library/regulatory-changes/{WAITING}/apply", json={"note": None})
    assert {own, other} <= await open_flag_ids()

    await as_user(client, AFFILIATE)
    detail = (await client.get(f"/api/materials/{own}")).json()
    assert len(detail["flags"]) == 1 and detail["history"][-1]["type"] == "flag"
    rows = {m["id"]: m for m in (await client.get("/api/materials")).json()}
    assert rows[own]["openFlags"] == 1 and other not in rows
    assert (await client.get(f"/api/materials/{other}")).status_code == 404
    # Affiliates cannot read the library, so neither its impact (R4), nor resolve a flag
    assert (await client.get(f"/api/library/regulatory-changes/{WAITING}/impact")).status_code == 403
    url = f"/api/materials/{own}/flags/{detail['flags'][0]['id']}/resolve"
    assert (await client.post(url, json={"note": "Looks fine."})).status_code == 403


async def test_previews_are_for_managers(client):
    await as_user(client, REVIEWER)
    assert (await client.get("/api/library/rules/REGZ-1026.24/impact")).status_code == 200
    scope = {"jurisdiction": "federal", "products": [], "channels": [], "effectiveDate": "2026-12-01"}
    assert (await client.post("/api/library/rules/REGZ-1026.24/impact", json=scope)).status_code == 403
    assert (await client.post("/api/library/rate-sheets/impact", json={"effectiveDate": "2026-12-01", "file": "a.csv", "csv": CSV})).status_code == 403
    assert (await client.get("/api/library/rules/NOPE/impact")).status_code == 404


async def test_seeded_flag_is_resolved_with_history(client):
    await as_user(client, REVIEWER)
    d = (await client.get(f"/api/materials/{DEBT}")).json()
    assert d["flags"] == []  # resolved in the seed
    lines = [e["text"] for e in d["history"] if e["type"] == "flag"]
    assert lines[0].startswith("Flagged version 2 for re-review: Regulatory change")
    assert lines[1].startswith("Re-reviewed, no change needed:")
    async with SessionLocal() as db:
        assert await db.scalar(select(func.count()).select_from(MaterialFlag).where(MaterialFlag.id == SEEDED_FLAG)) == 1
