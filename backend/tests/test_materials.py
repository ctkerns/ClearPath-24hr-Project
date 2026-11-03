from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select, update

from app.config import settings
from app.db import SessionLocal
from app.models import Role, User, Workspace
from app.models.audit import AuditEvent
from app.models.materials import Comment, Material, MaterialStatus, MaterialVersion
from app.security import hash_password
from app.seed import DEMO_PASSWORD, create_demo, delete_demo
from tests.helpers import ADMIN, AFFILIATE, MANAGER, REVIEWER, SUBMITTER, as_user

VIEWER = "ben.okafor@demo.clearpathcu.org"
LEGAL = "tara.nguyen@demo.clearpathcu.org"  # Legal reviewer
OTHER_AFFILIATE = "leo@rateradar.example"  # RateRadar

SUMMER = "01a112a1-4000-7d42-94be-d09364e3b51d"  # in review: Compliance waits, Legal approved, open High finding
DEBT = "01a0d660-7200-7f2e-846a-4b2b8dd2f651"  # live, with a live item and an issue
HELOC_EMAIL = "01a11743-c600-7e07-a845-e3bc969278a6"  # no seeded version
LENDWISE_POST = "01a0dfa5-7e00-7a60-a023-ce47b3e545d3"
LENDWISE_REVIEW = "01a10dfe-ba00-70a4-92a2-32f7091afc7c"
RATERADAR = "01a0e8ea-8a00-758c-87e6-0a28f7797431"
RETIRED = "01a08795-8c00-7cb9-93fd-75d440fc0a38"
APPROVED = "01a10017-2800-7389-b220-910ed92e6d2d"  # approved, expires 2026-11-20


def submission(**change):
    body = {
        "title": "Winter savings email",
        "channel": "mailchimp",
        "product": "savings",
        "fields": [{"label": "Subject line", "text": "Save more this winter"}, {"label": "Body", "text": "Rates from 4.00% APY."}],
        "nationwide": True,
    }
    return body | change


# Reading


async def test_list_for_internal_roles(client):
    await as_user(client, VIEWER)
    res = await client.get("/api/materials")
    assert res.status_code == 200
    rows = res.json()
    assert len(rows) == 18
    summer = next(m for m in rows if m["id"] == SUMMER)
    assert summer["status"] == "in_review"
    assert summer["owner"] == "Priya Shah"
    assert summer["groups"] == [{"name": "Compliance", "state": "waiting"}, {"name": "Legal", "state": "approved"}]
    assert summer["submittedAt"].startswith("2026-10-30")
    assert "affiliate" not in summer  # absent, like the old demo JSON
    post = next(m for m in rows if m["id"] == LENDWISE_POST)
    assert (post["affiliate"], post["approvalId"], post["expiresAt"]) == ("LendWise", "CP-2026-0131-v1", "2027-04-30")
    assert next(m for m in rows if m.get("source") == "found_live")["liveStatus"] == "unapproved"


async def test_affiliate_sees_only_own_company(client):
    await as_user(client, AFFILIATE)
    rows = (await client.get("/api/materials")).json()
    assert {m["id"] for m in rows} == {LENDWISE_POST, LENDWISE_REVIEW}
    assert (await client.get(f"/api/materials/{RATERADAR}")).status_code == 404
    assert (await client.get(f"/api/materials/{SUMMER}")).status_code == 404

    await as_user(client, OTHER_AFFILIATE)
    assert {m["id"] for m in (await client.get("/api/materials")).json()} == {RATERADAR}


async def test_signed_out_cannot_read(client):
    assert (await client.get("/api/materials")).status_code == 401


async def test_detail(client):
    await as_user(client, VIEWER)
    d = (await client.get(f"/api/materials/{SUMMER}")).json()
    assert (d["version"], d["versionCount"], d["submittedBy"], d["path"]) == (2, 2, "Priya Shah", "full")
    assert d["details"]["targetStates"] == "Nationwide"
    findings = {f["ruleId"] + f["status"]: f for f in d["findings"]}
    f1 = findings["REGZ-1026.24open"]
    assert f1["severity"] == "high" and f1["text"] == "for as low as $199/month"
    # Segments and checklist rows point to the finding by its id.
    marks = [s for s in d["fields"][0]["segments"] if isinstance(s, dict)]
    assert marks[0] == {"text": "for as low as $199/month", "finding": f1["id"]}
    assert d["checklist"][0]["finding"] == f1["id"]
    assert findings["UDAAP-03outdated"]["text"] == "Guaranteed approval"
    assert "suggestion" not in findings["UDAAP-03outdated"]
    compliance, legal = d["groups"]
    assert compliance["state"] == "waiting" and "Jordan Kim" in compliance["members"]
    assert (legal["by"], legal["reason"]) == ("Maya Ruiz", "Product is a loan, nationwide")
    assert [c["author"] for c in d["comments"]] == ["Maya Ruiz", "Dana Ortiz"]
    v1, v2 = d["versions"]
    assert v1["outcome"] == "changes_requested" and v1["fields"][0]["label"] == "Primary text"
    assert v2["current"] is True and "fields" not in v2
    assert d["history"][0]["text"] == "Submitted version 1 by manual upload."
    assert d["live"] == [] and d["issues"] == []

    debt = (await client.get(f"/api/materials/{DEBT}")).json()
    assert debt["live"][0]["externalId"] == "718204992"
    assert debt["issues"][0]["title"] == "Live ad text differs from the approved version"
    assert debt["issues"][0]["actions"][0]["done"] is True


async def test_detail_without_version_is_null(client):
    await as_user(client, VIEWER)
    res = await client.get(f"/api/materials/{HELOC_EMAIL}")
    assert res.status_code == 200 and res.json() is None
    assert (await client.get("/api/materials/01a112a1-4000-7d42-94be-000000000000")).status_code == 404


# Submitting


async def test_submit_new_material(client):
    await as_user(client, SUBMITTER)
    res = await client.post("/api/materials", json=submission())
    assert res.status_code == 201, res.text
    d = res.json()
    assert d["version"] == 1 and d["submittedBy"] == "Priya Shah"
    # The server routes it: savings matches only the seeded rule for everything (PRD F6).
    assert [(g["name"], g["reason"]) for g in d["groups"]] == [("Compliance", "Compliance reviews everything")]
    assert d["fields"][0] == {"label": "Subject line", "segments": ["Save more this winter"]}
    assert [e["type"] for e in d["history"]] == ["submitted", "routed"]
    row = next(m for m in (await client.get("/api/materials")).json() if m["id"] == d["id"])
    assert (row["status"], row["owner"], row["title"]) == ("in_review", "Priya Shah", "Winter savings email")


async def test_viewer_cannot_submit(client):
    await as_user(client, VIEWER)
    assert (await client.post("/api/materials", json=submission())).status_code == 403


@pytest.mark.parametrize(
    ("change", "code"),
    [
        ({"fields": [{"label": "Body", "text": "  "}]}, 422),
        ({"nationwide": False, "states": []}, 422),
        ({"nationwide": False, "states": ["XX"]}, 422),
        ({"nationwide": False, "states": ["WY"]}, 400),  # not a licensed state
        ({"launchDate": "2026-12-10", "endDate": "2026-12-01"}, 422),
        ({"title": " "}, 400),
        ({"channel": "fax"}, 422),
    ],
)
async def test_invalid_submission(client, change, code):
    await as_user(client, SUBMITTER)
    res = await client.post("/api/materials", json=submission(**change))
    assert res.status_code == code, res.text


async def test_affiliate_submits_for_own_company(client):
    await as_user(client, AFFILIATE)
    res = await client.post("/api/materials", json=submission(channel="affiliate", fields=[{"label": "Page text", "text": "Hi"}]))
    assert res.status_code == 201, res.text
    new_id = res.json()["id"]
    row = next(m for m in (await client.get("/api/materials")).json() if m["id"] == new_id)
    assert (row["affiliate"], row["owner"]) == ("LendWise", "Erin Walsh")
    await as_user(client, OTHER_AFFILIATE)
    assert (await client.get(f"/api/materials/{new_id}")).status_code == 404


async def test_new_version(client):
    await as_user(client, MANAGER)
    res = await client.post(f"/api/materials/{SUMMER}/versions", json=submission(channel="meta", product="personal_loan"))
    assert res.status_code == 201, res.text
    d = res.json()
    assert (d["version"], d["versionCount"]) == (3, 3)
    assert all(f["status"] != "open" for f in d["findings"])  # old findings are outdated (PRD F4)
    # New decisions: Legal approved version 2, but waits again (a nationwide loan needs Legal, PRD F6).
    assert [(g["name"], g["state"]) for g in d["groups"]] == [("Compliance", "waiting"), ("Legal", "waiting")]
    assert d["versions"][1]["fields"][1] == {"label": "Headline", "text": "Personal loans from 8.99% APR"}
    assert d["details"]["platformId"] == "23851204417730592"  # kept, for monitoring
    assert d["comments"][0]["author"] == "Maya Ruiz"  # comments stay

    # A new version keeps the channel. A retired material gets no new version.
    assert (await client.post(f"/api/materials/{SUMMER}/versions", json=submission())).status_code == 400
    assert (await client.post(f"/api/materials/{RETIRED}/versions", json=submission())).status_code == 409


async def test_version_of_material_without_versions(client):
    await as_user(client, SUBMITTER)
    res = await client.post(f"/api/materials/{HELOC_EMAIL}/versions", json=submission(product="heloc"))
    assert res.status_code == 201 and res.json()["version"] == 1


async def test_affiliate_cannot_version_other_company(client):
    await as_user(client, AFFILIATE)
    body = submission(channel="affiliate", fields=[{"label": "Page text", "text": "Hi"}])
    assert (await client.post(f"/api/materials/{RATERADAR}/versions", json=body)).status_code == 404
    assert (await client.post(f"/api/materials/{LENDWISE_REVIEW}/versions", json=body)).status_code == 201


# Routing on submit: the server alone decides the required groups (PRD R2, F6)


def routed(d):
    return [(g["name"], g["reason"]) for g in d["groups"]]


MORTGAGE_NATIONWIDE = [
    ("Compliance", "Compliance reviews everything"),
    ("Legal", "Loans sold nationwide"),
    ("Mortgage", "Home lending"),
]


@pytest.mark.parametrize(
    "groups",
    [
        None,  # not sent
        [],
        [{"name": "Compliance", "reason": "Every material"}],  # Legal and Mortgage dropped
        [{"name": "Senior compliance", "reason": "mine"}],  # a group no rule requires
        [{"name": "Nobody"}],  # an unknown group: ignored, not an error
    ],
)
async def test_submit_ignores_client_groups(client, groups):
    await as_user(client, SUBMITTER)
    body = submission(product="mortgage", channel="meta") | ({} if groups is None else {"groups": groups})
    res = await client.post("/api/materials", json=body)
    assert res.status_code == 201, res.text
    assert routed(res.json()) == MORTGAGE_NATIONWIDE


async def test_new_version_ignores_client_groups(client):
    await as_user(client, MANAGER)
    body = submission(channel="meta", product="mortgage", groups=[{"name": "Compliance"}])
    d = (await client.post(f"/api/materials/{SUMMER}/versions", json=body)).json()
    assert routed(d) == MORTGAGE_NATIONWIDE and d["path"] == "full"
    assert d["history"][-1]["text"] == (
        'Required Compliance (rule "Compliance reviews everything"), Legal (rule "Loans sold nationwide"), '
        'Mortgage (rule "Home lending").'
    )
    # States are the version's content: a mortgage in CA only is not "sold nationwide".
    d = (await client.post(f"/api/materials/{SUMMER}/versions", json=body | {"nationwide": False, "states": ["CA"]})).json()
    assert [g["name"] for g in d["groups"]] == ["Compliance", "Mortgage"]


async def test_routing_is_in_the_audit_log(client):
    await as_user(client, SUBMITTER)
    d = (await client.post("/api/materials", json=submission(product="mortgage", channel="meta"))).json()
    async with SessionLocal() as db:
        row = await db.scalar(select(AuditEvent).where(AuditEvent.entity_id == d["id"], AuditEvent.action == "routed"))
    assert row is not None and row.entity == "material"
    assert [g["name"] for g in row.data["groups"]] == ["Compliance", "Legal", "Mortgage"]
    assert row.data["groups"][1]["rules"] == ["Loans sold nationwide"]
    assert row.data["input"]["source"] == "internal" and row.data["path"] == "full" and row.data["version"] == 1


async def test_affiliate_submit_routes_as_affiliate(client):
    # RateRadar has no issue and no rejection: only "Affiliate content" adds a group.
    await as_user(client, OTHER_AFFILIATE)
    body = submission(channel="affiliate", fields=[{"label": "Page text", "text": "Hi"}], groups=[])
    assert routed((await client.post("/api/materials", json=body)).json()) == [
        ("Compliance", "Compliance reviews everything"),
        ("Senior compliance", "Affiliate content"),
    ]
    # LendWise has an open issue, so it has history (PRD F6): Senior compliance and Legal, from two rules.
    await as_user(client, AFFILIATE)
    assert routed((await client.post("/api/materials", json=body)).json()) == [
        ("Compliance", "Compliance reviews everything"),
        ("Senior compliance", "Affiliate content and Affiliates with recent problems"),
        ("Legal", "Affiliates with recent problems"),
    ]


async def test_affiliate_history_from_the_database(client):
    """An internal user's new version of an affiliate's material also routes as affiliate, with its history."""
    await as_user(client, OTHER_AFFILIATE)
    body = submission(channel="affiliate", fields=[{"label": "Page text", "text": "Hi"}])
    new_id = (await client.post("/api/materials", json=body)).json()["id"]
    await as_user(client, REVIEWER)
    assert (await decide(client, new_id, "reject", "Misleading.")).status_code == 200
    await as_user(client, MANAGER)
    d = (await client.post(f"/api/materials/{RATERADAR}/versions", json=body)).json()
    assert ("Legal", "Affiliates with recent problems") in routed(d)
    # 90 days later the rejection no longer counts.
    async with SessionLocal() as db, db.begin():
        old = datetime.now(UTC) - timedelta(days=91)
        await db.execute(update(Comment).where(Comment.material_id == new_id).values(at=old))
        await db.execute(update(MaterialVersion).where(MaterialVersion.material_id == new_id).values(submitted_at=old))
    d = (await client.post(f"/api/materials/{RATERADAR}/versions", json=body)).json()
    assert [g["name"] for g in d["groups"]] == ["Compliance", "Senior compliance"]


async def test_preview_matches_submit(client):
    await as_user(client, SUBMITTER)
    preview = {"channel": "meta", "product": "mortgage", "nationwide": True}
    res = await client.post("/api/routing/preview", json=preview)
    assert res.status_code == 200, res.text
    assert res.json()["path"] == "full"
    assert [(g["name"], g["reason"]) for g in res.json()["groups"]] == MORTGAGE_NATIONWIDE
    assert (await client.post("/api/routing/preview", json=preview | {"states": ["XX"]})).status_code == 422
    # Affiliates preview their own materials (they cannot read the Routing tab).
    await as_user(client, AFFILIATE)
    res = await client.post("/api/routing/preview", json={"materialId": LENDWISE_REVIEW, "channel": "meta", "product": "savings", "states": ["CA"]})
    assert [g["name"] for g in res.json()["groups"]] == ["Compliance", "Senior compliance", "Legal"]  # the material's channel
    res = await client.post("/api/routing/preview", json={"materialId": RATERADAR, "channel": "affiliate", "product": "savings"})
    assert res.status_code == 404
    await as_user(client, VIEWER)
    assert (await client.post("/api/routing/preview", json=preview)).status_code == 403


# Decisions


async def decide(client, material_id, decision, text="", **extra):
    return await client.post(f"/api/materials/{material_id}/decisions", json={"decision": decision, "text": text, **extra})


async def test_approve_completes_the_approval(client):
    await as_user(client, REVIEWER)
    # An open High finding blocks approval without an override reason (PRD F6).
    res = await decide(client, SUMMER, "approve")
    assert res.status_code == 400
    res = await decide(client, SUMMER, "approve", override="Disclosure D-7 goes under the image.")
    assert res.status_code == 200, res.text
    d = res.json()
    assert d["groups"][0]["state"] == "approved" and d["groups"][0]["by"] == "Jordan Kim"
    assert d["comments"][-1]["decision"] == "approve" and "Override:" in d["comments"][-1]["body"]
    assert d["versions"][-1]["outcome"] == "approved"
    assert "Override reason" in d["history"][-1]["text"]
    row = next(m for m in (await client.get("/api/materials")).json() if m["id"] == SUMMER)
    assert row["status"] == "approved"
    assert row["approvalId"] == f"CP-{datetime.now(UTC).year}-0139-v2"  # after the highest seeded number, 0138
    assert row["expiresAt"] == (datetime.now(UTC).date() + timedelta(days=90)).isoformat()
    assert "submittedAt" not in row


async def test_approval_uses_workspace_days(client):
    await as_user(client, ADMIN)
    assert (await client.patch("/api/workspace", json={"approvalDays": 120})).status_code == 200
    await as_user(client, REVIEWER)
    await decide(client, SUMMER, "approve", override="ok")
    row = next(m for m in (await client.get("/api/materials")).json() if m["id"] == SUMMER)
    assert row["expiresAt"] == (datetime.now(UTC).date() + timedelta(days=120)).isoformat()


async def test_who_may_decide(client):
    await as_user(client, SUBMITTER)
    assert (await decide(client, SUMMER, "approve", override="x")).status_code == 403  # role
    await as_user(client, LEGAL)
    assert (await decide(client, SUMMER, "approve", override="x")).status_code == 403  # Legal already approved (R2)
    await as_user(client, VIEWER)
    assert (await decide(client, SUMMER, "reject", "no")).status_code == 403


async def test_no_self_approval(client):
    await as_user(client, MANAGER)
    await client.post(f"/api/materials/{SUMMER}/versions", json=submission(channel="meta", product="personal_loan"))
    res = await decide(client, SUMMER, "approve")
    assert res.status_code == 403 and "submitted" in res.json()["detail"]  # R1
    await as_user(client, REVIEWER)
    assert (await decide(client, SUMMER, "approve")).status_code == 200  # no open findings on the new version


async def test_request_changes_and_reject(client):
    await as_user(client, REVIEWER)
    assert (await decide(client, SUMMER, "request_changes")).status_code == 400  # needs a reason
    res = await decide(client, SUMMER, "request_changes", "Add the APR disclosure.")
    assert res.status_code == 200
    assert res.json()["groups"][0]["state"] == "changes"
    row = next(m for m in (await client.get("/api/materials")).json() if m["id"] == SUMMER)
    assert row["status"] == "changes_requested"
    # Not in review any more
    assert (await decide(client, SUMMER, "reject", "no")).status_code == 409


async def test_reject(client):
    await as_user(client, REVIEWER)
    res = await decide(client, SUMMER, "reject", "Misleading.")
    assert res.status_code == 200
    assert res.json()["versions"][-1]["outcome"] == "rejected"


async def test_approve_with_conditions(client):
    await as_user(client, REVIEWER)
    res = await decide(client, SUMMER, "approve_conditions", "Only with disclosure D-7 v3.", override="ok")
    assert res.status_code == 200
    assert res.json()["conditions"] == "Only with disclosure D-7 v3."
    assert (await decide(client, DEBT, "approve")).status_code == 409  # live, not in review


async def test_escalate(client):
    await as_user(client, REVIEWER)
    res = await decide(client, SUMMER, "escalate", "Mortgage wording.", group="mortgage")
    assert res.status_code == 200, res.text
    added = res.json()["groups"][-1]
    assert (added["name"], added["state"], added["escalatedBy"], added["reason"]) == ("Mortgage", "waiting", "Jordan Kim", "Mortgage wording.")
    assert (await decide(client, SUMMER, "escalate", "again", group="Mortgage")).status_code == 409
    assert (await decide(client, SUMMER, "escalate", "x", group="Nobody")).status_code == 400
    # Now Mortgage waits too, so Compliance alone does not approve the item.
    await decide(client, SUMMER, "approve", override="ok")
    row = next(m for m in (await client.get("/api/materials")).json() if m["id"] == SUMMER)
    assert row["status"] == "in_review"


async def test_retract_own_approval_only(client):
    await as_user(client, REVIEWER)
    assert (await decide(client, SUMMER, "retract", "Changed my mind")).status_code == 400  # Maya's approval, not Jordan's
    await decide(client, SUMMER, "approve", override="ok")
    res = await decide(client, SUMMER, "retract", "I missed the image text.")
    assert res.status_code == 200
    assert res.json()["groups"][0]["state"] == "waiting"
    row = next(m for m in (await client.get("/api/materials")).json() if m["id"] == SUMMER)
    assert row["status"] == "in_review" and "approvalId" not in row

    # A Manager or Admin cannot retract someone else's approval either.
    await as_user(client, ADMIN)  # Maya approved Legal
    assert (await decide(client, SUMMER, "retract", "Legal is not sure")).json()["groups"][1]["state"] == "waiting"


async def test_retract_live_approval(client):
    await as_user(client, MANAGER)  # Alex Chen approved the live debt ad
    res = await decide(client, DEBT, "retract", "The rate is wrong.")
    assert res.status_code == 200, res.text
    row = next(m for m in (await client.get("/api/materials")).json() if m["id"] == DEBT)
    assert (row["status"], row["liveStatus"]) == ("in_review", "unapproved")
    assert "approvalId" not in row


# Comments


async def test_comments(client):
    await as_user(client, SUBMITTER)
    res = await client.post(f"/api/materials/{SUMMER}/comments", json={"body": "Moved the disclosure."})
    assert res.status_code == 201
    d = res.json()
    assert (d["comments"][-1]["author"], d["comments"][-1]["body"]) == ("Priya Shah", "Moved the disclosure.")
    assert d["history"][-1]["text"] == "Commented on version 2."
    assert (await client.post(f"/api/materials/{SUMMER}/comments", json={"body": ""})).status_code == 422

    await as_user(client, VIEWER)
    assert (await client.post(f"/api/materials/{SUMMER}/comments", json={"body": "hi"})).status_code == 403
    await as_user(client, AFFILIATE)
    assert (await client.post(f"/api/materials/{SUMMER}/comments", json={"body": "hi"})).status_code == 404


# Expiry (PRD F15)


async def test_approval_expires_on_its_date(client):
    async with SessionLocal() as db, db.begin():
        await db.execute(update(Material).where(Material.id == APPROVED).values(expires_at=datetime.now(UTC).date()))
    await as_user(client, VIEWER)
    row = next(m for m in (await client.get("/api/materials")).json() if m["id"] == APPROVED)
    assert row["status"] == "expired"


# Files


async def test_upload_and_download(client, tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "upload_dir", tmp_path)
    await as_user(client, SUBMITTER)
    res = await client.post("/api/materials/files", files={"file": ("ad.pdf", b"%PDF-1.4 test", "application/pdf")})
    assert res.status_code == 201, res.text
    file = res.json()
    assert (file["name"], file["size"]) == ("ad.pdf", 13)

    # Before a submission uses it, only the uploader reads it.
    await as_user(client, VIEWER)
    assert (await client.get(f"/api/materials/files/{file['id']}")).status_code == 404

    await as_user(client, SUBMITTER)
    body = submission(fields=[{"label": "Files", "text": "ad.pdf"}], fileIds=[file["id"]])
    d = (await client.post("/api/materials", json=body)).json()
    assert d["files"][0]["id"] == file["id"]
    # A file belongs to one version.
    assert (await client.post("/api/materials", json=body)).status_code == 400

    await as_user(client, VIEWER)
    res = await client.get(f"/api/materials/files/{file['id']}")
    assert res.status_code == 200 and res.content == b"%PDF-1.4 test"
    assert res.headers["content-disposition"].startswith("attachment")
    await as_user(client, AFFILIATE)
    assert (await client.get(f"/api/materials/files/{file['id']}")).status_code == 404


async def test_upload_limits(client, tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "upload_dir", tmp_path)
    monkeypatch.setattr(settings, "upload_max_bytes", 10)
    await as_user(client, VIEWER)
    assert (await client.post("/api/materials/files", files={"file": ("a.txt", b"x", "text/plain")})).status_code == 403
    await as_user(client, SUBMITTER)
    assert (await client.post("/api/materials/files", files={"file": ("a.txt", b"x" * 11, "text/plain")})).status_code == 413
    assert (await client.post("/api/materials/files", files={"file": ("a.txt", b"", "text/plain")})).status_code == 400


# Workspace isolation and the demo reset


async def test_other_workspace_sees_nothing(client):
    async with SessionLocal() as db, db.begin():
        other = Workspace(name="Real credit union", licensed_states=["CA"])
        db.add(other)
        await db.flush()
        db.add(
            User(
                workspace_id=other.id,
                email="admin@real.example",
                name="Real Admin",
                role=Role.ADMIN,
                password_hash=hash_password(DEMO_PASSWORD),
            )
        )
    await as_user(client, "admin@real.example")
    assert (await client.get("/api/materials")).json() == []
    assert (await client.get(f"/api/materials/{SUMMER}")).status_code == 404
    assert (await decide(client, SUMMER, "reject", "x")).status_code == 404
    assert (await client.post(f"/api/materials/{SUMMER}/comments", json={"body": "x"})).status_code == 404
    assert (await client.post(f"/api/materials/{SUMMER}/versions", json=submission(channel="meta"))).status_code == 404
    # Its own submissions use its own groups: it has none, so it cannot route yet.
    assert (await client.post("/api/materials", json=submission(nationwide=False, states=["CA"]))).status_code == 400


async def test_seed_reset_restores_materials(client):
    await as_user(client, REVIEWER)
    await decide(client, SUMMER, "reject", "No.")
    await client.post("/api/materials", json=submission())
    async with SessionLocal() as db, db.begin():
        await delete_demo(db)
        await create_demo(db)
    async with SessionLocal() as db:
        assert len((await db.scalars(select(Material))).all()) == 18
        summer = await db.get(Material, SUMMER)
        assert summer is not None and summer.status is MaterialStatus.IN_REVIEW
