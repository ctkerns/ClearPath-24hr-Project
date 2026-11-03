"""Regulator export (PRD F15, P1): who may run it, the filters, the ZIP layout, history equal to the History tab,
manifest hashes, CSV formula escaping, missing upload files, and the export's own audit entry."""

import csv
import hashlib
import io
import json
import uuid
import zipfile
from pathlib import Path

import app
from app.config import settings
from app.db import SessionLocal
from app.models import Role, User, Workspace
from app.security import hash_password
from app.seed import DEMO_PASSWORD
from tests.helpers import ADMIN, AFFILIATE, SUBMITTER, as_user, demo_today, with_channel_fields

VIEWER = "ben.okafor@demo.clearpathcu.org"
SUMMER = "01a112a1-4000-7d42-94be-d09364e3b51d"  # in review, version 2, open High finding
DEBT = "01a0d660-7200-7f2e-846a-4b2b8dd2f651"  # approved at version 3 (CP-2026-0129-v3), live, with an issue

TABLES = ["materials", "versions", "decisions", "group-reviews", "findings", "comments", "issues", "audit-log", "library-audit-log"]
WIDE = {"dateFrom": "2025-01-01", "dateTo": "2026-12-31"}


def seeded(**match) -> set[str]:
    """The seeded demo materials with these list values (materials.json). Every one has a version in 2026."""
    rows = json.loads((Path(app.__file__).parent / "seed" / "data" / "materials.json").read_text())["materials"]
    return {m["id"] for m in rows if all(m[k] in (v if isinstance(v, tuple) else (v,)) for k, v in match.items())}


def today() -> str:
    return demo_today().isoformat()


async def export(client, **filters):
    res = await client.post("/api/exports/regulator", json=WIDE | filters)
    assert res.status_code == 200, res.text
    return zipfile.ZipFile(io.BytesIO(res.content))


def rows(z: zipfile.ZipFile, table: str) -> list[dict[str, str]]:
    return list(csv.DictReader(io.StringIO(z.read(f"{table}.csv").decode())))


def manifest(z: zipfile.ZipFile) -> dict:
    return json.loads(z.read("manifest.json"))


def material_json(z: zipfile.ZipFile, ref: str) -> dict:
    return json.loads(z.read(f"materials/{ref}/material.json"))


def submission(**change):
    body = {
        "title": "Winter savings email",
        "channel": "mailchimp",
        "product": "savings",
        "fields": [{"label": "Subject line", "text": "Save more this winter"}],
        "nationwide": True,
    }
    return with_channel_fields(body, change)


# Who may run it


async def test_roles(client):
    assert (await client.post("/api/exports/regulator", json=WIDE)).status_code == 401
    await as_user(client, AFFILIATE)
    assert (await client.post("/api/exports/regulator", json=WIDE)).status_code == 403
    for email in (VIEWER, SUBMITTER, ADMIN):
        await as_user(client, email)
        res = await client.post("/api/exports/regulator", json=WIDE)
        assert res.status_code == 200, res.text
        assert res.headers["content-type"] == "application/zip"
        assert res.headers["content-disposition"] == f'attachment; filename="clearpath-export-{today()}.zip"'


async def test_other_workspace_exports_nothing(client):
    async with SessionLocal() as db, db.begin():
        other = Workspace(name="Real credit union")
        db.add(other)
        await db.flush()
        db.add(User(workspace_id=other.id, email="audit@real.example", name="Audit", role=Role.VIEWER, password_hash=hash_password(DEMO_PASSWORD)))
    await as_user(client, "audit@real.example")
    z = await export(client)
    assert manifest(z)["counts"]["materials"] == 0
    assert rows(z, "materials") == [] and rows(z, "audit-log") == []
    assert not [n for n in z.namelist() if n.startswith("materials/")]


# Filters


async def test_invalid_filters(client):
    await as_user(client, VIEWER)
    for body in (
        {"dateFrom": "2026-05-02", "dateTo": "2026-05-01"},  # backwards
        {"dateFrom": "2020-01-01", "dateTo": "2026-01-01"},  # too long
        {"dateFrom": "2026-01-01"},  # no end
        WIDE | {"channel": "tiktok"},
        WIDE | {"status": "pending"},
        WIDE | {"materialIds": ["not-a-uuid"]},
        WIDE | {"materialIds": [str(uuid.uuid4()) for _ in range(501)]},
    ):
        assert (await client.post("/api/exports/regulator", json=body)).status_code == 422, body


def ids(z: zipfile.ZipFile) -> set[str]:
    return {r["materialId"] for r in rows(z, "materials")}


async def test_filters(client):
    await as_user(client, VIEWER)
    assert ids(await export(client)) == seeded()
    # The range is on the version submitted date: DEBT's versions are May to July 2026.
    assert ids(await export(client, dateFrom="2026-06-11", dateTo="2026-06-11")) == {DEBT}
    assert ids(await export(client, dateFrom="2025-01-01", dateTo="2025-02-01")) == set()
    # Products are the workspace's own list: an unknown ID matches nothing, it is no error (PRD F8)
    assert ids(await export(client, product="boat_loan")) == set()
    debt = rows(await export(client, materialIds=[DEBT]), "materials")
    assert [r["materialId"] for r in debt] == [DEBT]
    channel, product, status = debt[0]["channel"], debt[0]["product"], debt[0]["status"]
    assert DEBT in ids(await export(client, channel=channel))
    assert DEBT in ids(await export(client, product=product))
    assert DEBT in ids(await export(client, status=status))
    assert ids(await export(client, status="retired")) == seeded(status="retired")
    assert ids(await export(client, materialIds=[str(uuid.uuid4())])) == set()
    # Versions outside the range stay in the export, marked
    versions = rows(await export(client, dateFrom="2026-06-11", dateTo="2026-06-11"), "versions")
    assert [(v["version"], v["inRange"]) for v in versions] == [("1", "false"), ("2", "true"), ("3", "false")]


# Contents


async def test_layout_and_rows(client):
    await as_user(client, VIEWER)
    z = await export(client, materialIds=[DEBT])
    names = set(z.namelist())
    for t in TABLES:
        assert {f"{t}.csv", f"{t}.json"} <= names
    assert "manifest.json" in names and "materials/CP-2026-0129-v3/material.json" in names

    m = manifest(z)
    assert m["exportedBy"]["email"] == VIEWER and m["filters"]["materialIds"] == [DEBT]
    assert m["dateRange"]["appliesTo"] == "version.submittedAt"
    assert m["exportedAt"].endswith("Z")
    for t in TABLES:
        assert m["counts"][t] == len(rows(z, t)) == len(json.loads(z.read(f"{t}.json")))

    versions = rows(z, "versions")
    assert [v["version"] for v in versions] == ["1", "2", "3"]
    v3 = versions[-1]
    assert (v3["outcome"], v3["approvalId"], v3["current"]) == ("approved", "CP-2026-0129-v3", "true")
    assert v3["submittedAt"].endswith("Z") and v3["outcomeBy"]
    decision = rows(z, "decisions")[0]
    assert (decision["decision"], decision["version"]) == ("approve", "3")
    assert rows(z, "issues") and rows(z, "group-reviews")

    detail = (await client.get(f"/api/materials/{DEBT}")).json()
    doc = material_json(z, "CP-2026-0129-v3")
    assert doc["approvalId"] == "CP-2026-0129-v3" and len(doc["versions"]) == detail["versionCount"]
    assert [c["commentId"] for c in doc["comments"]] == [c["id"] for c in detail["comments"]]
    assert {i["issueId"] for i in doc["issues"]} == {i["id"] for i in detail["issues"]}
    # Issue history is in the audit log too
    issue_rows = [r for r in rows(z, "audit-log") if r["entity"] == "issue"]
    assert issue_rows and {r["entityId"] for r in issue_rows} == {i["id"] for i in detail["issues"]}


async def test_findings_and_override(client):
    await as_user(client, VIEWER)
    z = await export(client, materialIds=[SUMMER])
    detail = (await client.get(f"/api/materials/{SUMMER}")).json()
    found = rows(z, "findings")
    assert {f["findingId"] for f in found} == {f["id"] for f in detail["findings"]}
    f = next(f for f in found if f["findingId"] == detail["findings"][0]["id"])
    assert (f["source"], f["ruleId"], f["severity"], f["status"]) == tuple(
        detail["findings"][0][k] for k in ("source", "ruleId", "severity", "status")
    )
    assert f["flaggedText"] and f["explanation"]


async def test_decision_with_override_and_conditions(client):
    """A new decision through the API: its conditions and override reason reach decisions.csv."""
    await as_user(client, SUBMITTER)
    m = (await client.post("/api/materials", json=submission())).json()
    await as_user(client, ADMIN)
    emails = {u["name"]: u["email"] for u in (await client.get("/api/users")).json()}
    member = next(n for n in m["groups"][0]["members"] if emails[n] != SUBMITTER)
    await as_user(client, emails[member])
    res = await client.post(
        f"/api/materials/{m['id']}/decisions",
        json={"decision": "approve_conditions", "text": "Only until March", "override": "Reviewed by legal"},
    )
    assert res.status_code == 200, res.text
    await as_user(client, VIEWER)
    z = await export(client, dateFrom=today(), dateTo=today())
    d = rows(z, "decisions")[0]
    assert (d["decision"], d["conditions"], d["overrideReason"]) == ("approve_conditions", "Only until March", "Reviewed by legal")


async def test_history_matches_material_page(client):
    await as_user(client, VIEWER)
    z = await export(client)
    audit = rows(z, "audit-log")
    for material_id, ref in ((DEBT, "CP-2026-0129-v3"), (SUMMER, SUMMER)):
        detail = (await client.get(f"/api/materials/{material_id}")).json()
        assert detail["history"]
        assert material_json(z, ref)["history"] == detail["history"]
        lines = [r for r in audit if r["materialId"] == material_id and r["entity"] == "material"]
        assert [(r["actor"], r["historyType"], r["text"].removeprefix("'")) for r in lines] == [
            (h["actor"], h["type"], h["text"]) for h in detail["history"]
        ]


async def test_manifest_hashes(client):
    await as_user(client, VIEWER)
    z = await export(client)
    m = manifest(z)
    listed = {f["path"]: f for f in m["files"]}
    assert set(listed) == set(z.namelist()) - {"manifest.json"}
    for path, f in listed.items():
        data = z.read(path)
        assert hashlib.sha256(data).hexdigest() == f["sha256"] and len(data) == f["size"]


async def test_csv_formula_escaping(client):
    await as_user(client, SUBMITTER)
    body = submission(
        title="=HYPERLINK(\"http://evil.example\",\"click\")",
        # Labels come from the channel's fields (app/channels.py), so only the texts can start with a formula.
        fields=[{"label": "Subject line", "text": "@SUM(A1:A2)"}, {"label": "Body", "text": "-2+3 off today"}],
    )
    m = (await client.post("/api/materials", json=body)).json()
    await client.post(f"/api/materials/{m['id']}/comments", json={"body": "=1+1"})
    await as_user(client, VIEWER)
    z = await export(client, dateFrom=today(), dateTo=today(), materialIds=[m["id"]])
    row = rows(z, "materials")[0]
    assert row["title"] == "'=HYPERLINK(\"http://evil.example\",\"click\")"
    assert rows(z, "versions")[0]["content"] == "Subject line: @SUM(A1:A2)\n\nBody: -2+3 off today"
    assert rows(z, "comments")[0]["body"] == "'=1+1"
    # Every text cell of every CSV is safe
    for t in TABLES:
        for r in rows(z, t):
            assert not any(v.startswith(("=", "+", "-", "@")) for v in r.values()), (t, r)
    # The JSON copies keep the original text
    assert json.loads(z.read("materials.json"))[0]["title"].startswith("=HYPERLINK")
    doc = material_json(z, m["id"])
    assert doc["versions"][0]["fields"][0] == {"label": "Subject line", "text": "@SUM(A1:A2)"}


async def test_files_and_missing_file(client, tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "upload_dir", tmp_path)
    await as_user(client, SUBMITTER)
    kept = (await client.post("/api/materials/files", files={"file": ("ad.pdf", b"%PDF-1.4 kept", "application/pdf")})).json()
    lost = (await client.post("/api/materials/files", files={"file": ("../proof.png", b"png", "image/png")})).json()
    m = (await client.post("/api/materials", json=submission(fileIds=[kept["id"], lost["id"]]))).json()
    (tmp_path / lost["id"]).unlink()

    await as_user(client, VIEWER)
    z = await export(client, dateFrom=today(), dateTo=today(), materialIds=[m["id"]])
    path = f"materials/{m['id']}/v1/files/{kept['id']}-ad.pdf"
    assert z.read(path) == b"%PDF-1.4 kept"
    assert not [n for n in z.namelist() if lost["id"] in n]
    mf = manifest(z)
    assert mf["counts"]["files"] == 1 and mf["counts"]["missingFiles"] == 1
    assert [(x["fileId"], x["name"], x["version"]) for x in mf["missingFiles"]] == [(lost["id"], "../proof.png", 1)]
    files = material_json(z, m["id"])["versions"][0]["files"]
    assert {f["id"]: f.get("missing", False) for f in files} == {kept["id"]: False, lost["id"]: True}
    assert next(f for f in files if f["id"] == kept["id"])["sha256"] == hashlib.sha256(b"%PDF-1.4 kept").hexdigest()


async def test_export_is_audited(client):
    await as_user(client, VIEWER)
    z = await export(client, channel="google", materialIds=[DEBT])
    m = manifest(z)
    entries = (await client.get("/api/audit", params={"entity": "export"})).json()
    assert len(entries) == 1
    e = entries[0]
    assert (e["action"], e["entityId"], e["actor"]) == ("exported", m["exportId"], "Ben Okafor")
    assert e["data"]["filters"] == m["filters"] and e["data"]["counts"] == m["counts"]
    # A failed export records nothing
    await client.post("/api/exports/regulator", json={"dateFrom": "2026-05-02", "dateTo": "2026-05-01"})
    assert len((await client.get("/api/audit", params={"entity": "export"})).json()) == 1
    # The export does not add to any material's history
    assert all(r["entity"] != "export" for r in rows(z, "audit-log"))
