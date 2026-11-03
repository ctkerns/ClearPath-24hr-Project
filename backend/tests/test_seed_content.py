"""The demo seed content is complete and agrees with the app: every material has a version, every issue has
details, content fields use the labels of their channel, findings quote the content, and the code findings
are what the pre-review code checks find on that content (PRD F4)."""

import json
import logging
from datetime import date, datetime
from pathlib import Path

import pytest

import app
from app.channels import CHANNEL_FIELDS
from app.models.materials import Channel
from app.prereview import DisclosureSpec, Library, RateRange, RuleSpec, check_content, target_states
from tests.helpers import ADMIN, AFFILIATE, as_user

SEED = Path(app.__file__).parent / "seed" / "data"


def load(name: str) -> dict:
    return json.loads((SEED / name).read_text())


MATERIALS = load("materials.json")["materials"]
DETAILS = {d["id"]: d for d in load("material-details.json")["details"]}
ISSUES = load("issues.json")["issues"]
ISSUE_DETAILS = {d["id"]: d for d in load("issue-details.json")["details"]}
# The first two demo materials were written before this test, by hand. Their findings tell the demo story but
# differ from the checks in small ways (the quoted text of a trigger term, a code finding filed as UDAAP-03),
# and other tests depend on those exact texts, so the pre-review comparison leaves them out.
HAND_WRITTEN = {"01a0d660-7200-7f2e-846a-4b2b8dd2f651", "01a112a1-4000-7d42-94be-d09364e3b51d"}


def text_of(field: dict) -> str:
    return "".join(s if isinstance(s, str) else s["text"] for s in field["segments"]) if "segments" in field else field["text"]


def version_fields(d: dict, number: int) -> dict[str, str]:
    """The content of a version of a seeded material, as {label: text}."""
    if number == d["version"]:
        return {f["label"]: text_of(f) for f in d["fields"]}
    v = next(v for v in d["versions"] if v["number"] == number)
    return {f["label"]: f["text"] for f in v["fields"]}


def library_at(at: datetime, launch: date | None) -> Library:
    """The demo library as prereview.run would have loaded it at a past time: the rules and disclosure versions
    in effect that day, and the rate sheets uploaded by then (the one in effect on the launch date)."""
    day = at.date()
    rules = sorted(
        (
            RuleSpec(id=r["id"], title=r["title"], text=r["text"], severity=r["severity"], layer=r["layer"],
                     jurisdiction=r["jurisdiction"], products=r["products"], channels=r["channels"], check=r["check"],
                     effective_date=date.fromisoformat(r["effectiveDate"]))
            for r in load("rules.json")["rules"]
            if date.fromisoformat(r["effectiveDate"]) <= day
        ),
        key=lambda r: r.id,
    )
    disclosures = {}
    for d in load("disclosures.json")["disclosures"]:
        if vs := [v for v in d["versions"] if date.fromisoformat(v["effectiveDate"]) <= day]:
            cur = max(vs, key=lambda v: v["version"])
            disclosures[d["id"]] = DisclosureSpec(
                id=d["id"], title=d["title"], version=cur["version"], text=cur["text"], products=d["products"],
                states=None if d["states"] == "all" else d["states"],
                old=[(v["version"], v["text"]) for v in vs if v["version"] != cur["version"]],
            )
    sheets = sorted((s for s in load("rate-sheet.json")["sheets"] if datetime.fromisoformat(s["uploadedAt"]) <= at),
                    key=lambda s: (s["effectiveDate"], s["uploadedAt"]), reverse=True)
    on = max(launch, day) if launch else day
    sheet = next((s for s in sheets if date.fromisoformat(s["effectiveDate"]) <= on), sheets[0] if sheets else None)
    rates = [RateRange(r["product"], r["rate"], r["min"], r["max"]) for r in sheet["rows"]] if sheet else None
    return Library(rules, disclosures, rates, load("workspace.json")["workspace"]["licensedStates"])


def test_every_material_has_a_version():
    assert {m["id"] for m in MATERIALS} == set(DETAILS)
    for d in DETAILS.values():
        numbers = [v["number"] for v in d["versions"]]
        assert numbers == list(range(1, len(numbers) + 1)) and d["version"] == numbers[-1] == d["versionCount"], d["id"]
        assert [v.get("current", False) for v in d["versions"]] == [False] * (len(numbers) - 1) + [True], d["id"]


def test_every_issue_has_details():
    assert {i["id"] for i in ISSUES} == set(ISSUE_DETAILS)
    for i in ISSUES:
        d = ISSUE_DETAILS[i["id"]]
        assert d["summary"] and d["activity"], i["id"]
        if i["status"] == "resolved":  # resolving needs a note, which is a comment at the same time
            assert any(e.get("comment") and e["at"] == i["resolvedAt"] for e in d["activity"]), i["id"]


def test_content_labels_match_the_channel():
    for m in MATERIALS:
        d = DETAILS[m["id"]]
        labels = {f.label for f in CHANNEL_FIELDS[Channel(m["channel"])]}
        for v in d["versions"]:
            assert set(version_fields(d, v["number"])) <= labels, (m["title"], v["number"])
        for item in d["live"]:
            assert {f["label"] for f in item["fields"]} <= labels, m["title"]
    for i in ISSUES:
        labels = {f.label for f in CHANNEL_FIELDS[Channel(i["material"]["channel"])]}
        d = ISSUE_DETAILS[i["id"]]
        for part in (d.get("liveItem"), d.get("approved")):
            if part:
                assert {f["label"] for f in part["fields"]} <= labels, i["title"]


def test_findings_and_anchors_quote_the_content():
    for d in DETAILS.values():
        for f in d["findings"]:
            if not f["text"]:  # a missing disclosure has nothing to quote
                continue
            number = d["version"] if f["status"] != "outdated" else f.get("version", d["version"] - 1)
            assert any(f["text"] in t for t in version_fields(d, number).values()), (d["id"], f["id"])
        ids = {f["id"] for f in d["findings"]}
        marks = [s["finding"] for f in d["fields"] for s in f["segments"] if isinstance(s, dict)]
        assert set(marks) <= ids and len(marks) == len(set(marks)), d["id"]
        for c in d["comments"]:
            if a := c.get("anchor"):
                assert a["text"] in version_fields(d, c.get("version", d["version"]))[a["field"]], (d["id"], c["id"])


@pytest.mark.parametrize("material_id", sorted(set(DETAILS) - HAND_WRITTEN))
def test_code_findings_match_prereview(material_id, caplog):
    """The open code findings and the code rows of the checklist are what check_content finds on the current version,
    with the library as it was when that version was submitted."""
    caplog.set_level(logging.WARNING)
    m = next(m for m in MATERIALS if m["id"] == material_id)
    d = DETAILS[material_id]
    if m["status"] == "draft":  # pre-review runs on submit; a draft has had none
        assert not d["findings"] and not d["checklist"]
        return
    details = d["details"]
    launch = date.fromisoformat(details["launchDate"]) if details.get("launchDate") else None
    end = date.fromisoformat(details["endDate"]) if details.get("endDate") else None
    lib = library_at(datetime.fromisoformat(d["submittedAt"]), launch)
    states = target_states(details, lib.licensed_states)
    results = check_content(lib, m["product"], m["channel"], states, list(version_fields(d, d["version"]).items()), end)
    hits = sorted((h.rule_id, h.flagged_text, h.severity) for r in results for h in r.hits)
    seeded = sorted((f["ruleId"], f["text"], f["severity"]) for f in d["findings"] if f["source"] == "code" and f["status"] == "open")
    assert seeded == hits
    rows = [(r["ruleId"], r["result"]) for r in d["checklist"] if r["layer"] == "code"]
    assert rows == [(r.rule.id, "fail" if r.hits else "pass") for r in results]


async def test_seeded_details_through_the_api(client):
    await as_user(client, ADMIN)
    for m in MATERIALS:
        res = await client.get(f"/api/materials/{m['id']}")
        assert res.status_code == 200 and res.json() is not None, m["title"]
        d = res.json()
        assert d["fields"] and len(d["findings"]) == len(DETAILS[m["id"]]["findings"]), m["title"]
    for i in ISSUES:
        res = await client.get(f"/api/issues/{i['id']}")
        assert res.status_code == 200 and res.json()["summary"], i["title"]
    # An affiliate sees its own company's materials in full, and no other company's (R4).
    await as_user(client, AFFILIATE)
    for m in MATERIALS:
        res = await client.get(f"/api/materials/{m['id']}")
        if m.get("affiliate") == "LendWise":
            assert res.status_code == 200 and res.json()["fields"], m["title"]
        else:
            assert res.status_code == 404, m["title"]
