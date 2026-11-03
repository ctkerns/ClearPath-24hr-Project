"""The material History and the issue activity are the audit log (PRD section 9 AuditEvent, F2, F12).

Each material and issue action writes its entry in the same transaction as the change; a failed action writes
none. The History tab and the activity list read those entries back, with the same lines as before. Issue
comments are in their own table. Who sees a material or an issue sees its history, also an affiliate, who
cannot read the audit log page.
"""

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select, update

from app import issues, materials
from app.db import SessionLocal
from app.models import Workspace
from app.models.audit import AuditEvent
from app.models.materials import Finding, FindingSource, FindingStatus, IssueComment, Material, MaterialVersion, Severity
from app.seed import seed
from tests.helpers import ADMIN, AFFILIATE, MANAGER, REVIEWER, SUBMITTER, as_user
from tests.test_issues import DEBT_ISSUE, NOTICE_ISSUE, SAM, TARA, due, user_id
from tests.test_materials import (
    DEBT,
    LENDWISE_POST,
    OTHER_AFFILIATE,
    RATERADAR,
    SUMMER,
    VIEWER,
    decide,
    submission,
)


async def entries(entity: str, entity_id) -> list[AuditEvent]:
    async with SessionLocal() as db:
        return list(
            await db.scalars(
                select(AuditEvent)
                .where(AuditEvent.entity == entity, AuditEvent.entity_id == str(entity_id))
                .order_by(AuditEvent.created_at, AuditEvent.id)
            )
        )


async def new_entries(entity: str, entity_id, before: list[AuditEvent]) -> list[AuditEvent]:
    seen = {e.id for e in before}
    return [e for e in await entries(entity, entity_id) if e.id not in seen]


def line(e: dict) -> tuple:
    return e["actor"], e["type"], e["text"]


# Material actions


async def test_submit_writes_submitted_and_routed(client):
    me = await as_user(client, SUBMITTER)
    d = (await client.post("/api/materials", json=submission(product="mortgage", channel="meta"))).json()
    submitted, routed, checked = await entries("material", d["id"])
    assert (submitted.action, str(submitted.actor_id), submitted.data["version"]) == ("submitted", me["id"], 1)
    # Routing is the system's decision: a system actor, not a fake user (PRD R1, F6)
    assert (routed.action, routed.actor_id, routed.actor_label) == ("routed", None, "Routing")
    assert routed.data["version"] == 1 and [g["name"] for g in routed.data["groups"]] == ["Compliance", "Legal", "Mortgage"]
    # Pre-review runs after routing, in the same transaction, as the "Rule check" system actor (PRD F4)
    assert (checked.action, checked.actor_id, checked.actor_label, checked.data["version"]) == ("prereviewed", None, "Rule check", 1)
    assert submitted.created_at == routed.created_at == checked.created_at  # one transaction
    assert [line(e) for e in d["history"]] == [
        ("Priya Shah", "submitted", "Submitted version 1 by manual upload."),
        ("Routing", "routed", routed.data["text"]),
        ("Rule check", "prereview", checked.data["text"]),
    ]
    assert routed.data["text"].startswith('Required Compliance (rule "Compliance reviews everything")')

    # A new version adds the same three entries.
    d = (await client.post(f"/api/materials/{d['id']}/versions", json=submission(product="mortgage", channel="meta"))).json()
    assert [e["text"] for e in d["history"]][3] == "Submitted version 2 by manual upload."
    assert [e.data["version"] for e in await entries("material", d["id"])] == [1, 1, 1, 2, 2, 2]


async def test_failed_submit_writes_nothing(client, monkeypatch):
    await as_user(client, SUBMITTER)
    count = len(await entries("material", SUMMER))

    async def broken(*args, **kwargs):
        raise RuntimeError("notification failed")

    # The entries are written before the notifications; a failure after them takes them back.
    monkeypatch.setattr(materials, "notify_groups", broken)
    with pytest.raises(RuntimeError):
        await client.post(f"/api/materials/{SUMMER}/versions", json=submission(channel="meta", product="personal_loan"))
    with pytest.raises(RuntimeError):
        await client.post("/api/materials", json=submission(title="Never saved"))
    async with SessionLocal() as db:
        assert await db.scalar(select(Material).where(Material.title == "Never saved")) is None
    assert len(await entries("material", SUMMER)) == count


async def test_decisions_write_their_entry(client):
    me = await as_user(client, REVIEWER)
    before = await entries("material", SUMMER)
    assert (await decide(client, SUMMER, "approve")).status_code == 400  # open High finding, no override
    assert (await decide(client, SUMMER, "request_changes")).status_code == 400  # no reason
    assert len(await entries("material", SUMMER)) == len(before)

    res = await decide(client, SUMMER, "escalate", "Mortgage wording.", group="Mortgage")
    [e] = await new_entries("material", SUMMER, before)
    assert (e.action, str(e.actor_id), e.data["groups"], e.data["decision"]) == ("escalated", me["id"], ["Mortgage"], "escalate")
    assert line(res.json()["history"][-1]) == ("Jordan Kim", "decision", "Escalated: added Mortgage as a required group. Mortgage wording.")

    before = await entries("material", SUMMER)
    res = await decide(client, SUMMER, "approve", override="Disclosure goes under the image.")
    [e] = await new_entries("material", SUMMER, before)
    assert (e.action, e.data["version"], e.data["groups"]) == ("approved", 2, ["Compliance"])
    assert e.data["override"] == "Disclosure goes under the image."  # PRD F6
    comment = res.json()["comments"][-1]
    assert e.data["commentId"] == comment["id"]
    assert res.json()["history"][-1]["text"] == "Approved for Compliance on version 2. Override reason: Disclosure goes under the image."

    before = await entries("material", SUMMER)
    res = await decide(client, SUMMER, "retract", "I missed the image text.")
    [e] = await new_entries("material", SUMMER, before)
    assert (e.action, e.data["groups"]) == ("approval_retracted", ["Compliance"])
    assert res.json()["history"][-1]["text"] == "Retracted own approval on version 2: I missed the image text."


async def test_approval_writes_id_and_expiry(client):
    await as_user(client, REVIEWER)
    async with SessionLocal() as db, db.begin():  # no High finding, so no override
        await db.execute(update(Finding).where(Finding.material_id == SUMMER).values(status=FindingStatus.HIDDEN))
        version = await db.scalar(select(MaterialVersion).where(MaterialVersion.material_id == SUMMER, MaterialVersion.number == 2))
        db.add(Finding(workspace_id=version.workspace_id, material_id=version.material_id, version_id=version.id,
                       source=FindingSource.AI, severity=Severity.LOW, rule_id="UDAAP-03", status=FindingStatus.OPEN,
                       flagged_text="x", explanation="y"))
    before = await entries("material", SUMMER)
    d = (await decide(client, SUMMER, "approve_conditions", "Only with D-7 under the image.")).json()
    [e] = await new_entries("material", SUMMER, before)
    row = next(m for m in (await client.get("/api/materials")).json() if m["id"] == SUMMER)
    assert e.action == "approved_with_conditions" and e.data["conditions"] == "Only with D-7 under the image."
    assert (e.data["approvalId"], e.data["expiresAt"]) == (row["approvalId"], row["expiresAt"])
    assert d["history"][-1]["text"].startswith("Approved with conditions for Compliance on version 2: Only with D-7 under the image.")
    assert f"Approval ID {row['approvalId']}, expires " in d["history"][-1]["text"]


async def test_request_changes_and_reject(client):
    await as_user(client, REVIEWER)
    before = await entries("material", SUMMER)
    d = (await decide(client, SUMMER, "request_changes", "Fix the APR.")).json()
    [e] = await new_entries("material", SUMMER, before)
    assert (e.action, e.data["decision"]) == ("changes_requested", "request_changes")
    assert line(d["history"][-1]) == ("Jordan Kim", "decision", "Requested changes for Compliance on version 2: Fix the APR.")


async def test_comment_writes_its_entry(client):
    me = await as_user(client, SUBMITTER)
    before = await entries("material", SUMMER)
    assert (await client.post(f"/api/materials/{SUMMER}/comments", json={"body": "  "})).status_code == 400
    d = (await client.post(f"/api/materials/{SUMMER}/comments", json={"body": "Fixed the image."})).json()
    [e] = await new_entries("material", SUMMER, before)
    assert (e.action, str(e.actor_id), e.data["version"], e.data["commentId"]) == ("commented", me["id"], 2, d["comments"][-1]["id"])
    assert line(d["history"][-1]) == ("Priya Shah", "comment", "Commented on version 2.")


async def test_expiry_writes_a_system_entry(client):
    async with SessionLocal() as db, db.begin():
        await db.execute(update(Material).where(Material.id == DEBT).values(expires_at=datetime.now(UTC).date()))
    await as_user(client, VIEWER)
    d = (await client.get(f"/api/materials/{DEBT}")).json()
    [e] = [e for e in await entries("material", DEBT) if e.action == "approval_expired"]
    assert (e.actor_id, e.actor_label) == (None, "ClearPath")  # a system actor
    assert line(d["history"][-1]) == ("ClearPath", "decision", f"Approval {e.data['approvalId']} expired.")
    assert e.data["approvalId"] == "CP-2026-0129-v3"
    await client.get(f"/api/materials/{DEBT}")
    assert len([e for e in await entries("material", DEBT) if e.action == "approval_expired"]) == 1  # once


# Issue actions


async def raise_issue(client, **change):
    owner = await user_id(client, SUBMITTER)
    body = {"materialId": SUMMER, "title": "Image text too small", "summary": "Hard to read.", "severity": "low",
            "ownerId": owner, "dueAt": due()} | change
    return await client.post("/api/issues", json=body)


async def test_raise_writes_issue_and_material_entries(client):
    me = await as_user(client, REVIEWER)
    before = await entries("material", SUMMER)
    issue = (await raise_issue(client)).json()
    [on_issue] = await entries("issue", issue["id"])
    [on_material] = await new_entries("material", SUMMER, before)
    assert (on_issue.action, str(on_issue.actor_id), on_issue.data["title"], on_issue.data["owner"]["name"]) == (
        "raised", me["id"], "Image text too small", "Priya Shah")
    assert (on_material.action, on_material.data["issueId"]) == ("issue_raised", issue["id"])
    assert on_issue.created_at == on_material.created_at
    d = (await client.get(f"/api/issues/{issue['id']}")).json()
    assert [(a["actor"], a["text"]) for a in d["activity"]] == [("Jordan Kim", "Raised this issue and assigned it to Priya Shah.")]
    m = (await client.get(f"/api/materials/{SUMMER}")).json()
    assert line(m["history"][-1]) == ("Jordan Kim", "issue", 'Raised the issue "Image text too small" and assigned it to Priya Shah.')


async def test_failed_raise_writes_nothing(client, monkeypatch):
    await as_user(client, REVIEWER)
    before = await entries("material", SUMMER)

    async def broken(*args, **kwargs):
        raise RuntimeError("notification failed")

    monkeypatch.setattr(issues, "notify_new_issue", broken)
    with pytest.raises(RuntimeError):
        await raise_issue(client)
    assert (await raise_issue(client, title=" ")).status_code == 400
    assert len(await entries("material", SUMMER)) == len(before)
    async with SessionLocal() as db:
        assert not list(await db.scalars(select(AuditEvent).where(AuditEvent.entity == "issue", AuditEvent.action == "raised",
                                                                  AuditEvent.data["title"].astext == "Image text too small")))


async def test_status_action_and_notice_entries(client):
    sam = await as_user(client, SAM)
    before = await entries("issue", DEBT_ISSUE)
    await client.patch(f"/api/issues/{DEBT_ISSUE}", json={"status": "in_progress"})
    res = await client.patch(f"/api/issues/{DEBT_ISSUE}", json={"status": "resolved", "note": "Restored the approved text."})
    progress, resolved = await new_entries("issue", DEBT_ISSUE, before)
    assert (progress.action, progress.data["before"], progress.data["after"]) == ("status_changed", "open", "in_progress")
    assert (resolved.data["after"], str(resolved.actor_id)) == ("resolved", sam["id"])
    # The note is a comment; the entry points to it, so the text is stored once.
    async with SessionLocal() as db:
        note = await db.get_one(IssueComment, uuid.UUID(resolved.data["commentId"]))
    assert note.body == "Restored the approved text." and "Restored" not in str(resolved.data)
    activity = res.json()["activity"]
    assert [(a["text"], a.get("comment")) for a in activity[-2:]] == [
        ("Changed the status to Resolved.", None), ("Restored the approved text.", True)
    ]

    await client.patch(f"/api/issues/{DEBT_ISSUE}", json={"status": "open"})
    todo = next(a for a in (await client.get(f"/api/issues/{DEBT_ISSUE}")).json()["actions"] if not a["done"])
    before = await entries("issue", DEBT_ISSUE)
    res = await client.post(f"/api/issues/{DEBT_ISSUE}/actions/{todo['id']}/done")
    [e] = await new_entries("issue", DEBT_ISSUE, before)
    assert (e.action, e.data["actionId"], e.data["label"]) == ("action_done", todo["id"], todo["label"])  # PRD F12: who ran it
    assert res.json()["activity"][-1]["text"] == f"Marked done: {todo['label']}."
    assert (await client.post(f"/api/issues/{DEBT_ISSUE}/actions/{todo['id']}/done")).status_code == 409
    assert len(await new_entries("issue", DEBT_ISSUE, before)) == 1

    await as_user(client, TARA)
    before = await entries("issue", NOTICE_ISSUE)
    res = await client.post(f"/api/issues/{NOTICE_ISSUE}/notice", json={"subject": "Fix it", "body": "Please add D-4."})
    [e] = await new_entries("issue", NOTICE_ISSUE, before)
    assert (e.action, e.data["subject"]) == ("notice_sent", "Fix it") and e.data["to"].startswith("Tara Nguyen")
    assert res.json()["activity"][-1]["text"] == f"Sent the correction notice to {e.data['to']}."


async def test_issue_comments_are_in_their_own_table(client, monkeypatch):
    me = await as_user(client, SUBMITTER)
    before = await entries("issue", DEBT_ISSUE)
    res = await client.post(f"/api/issues/{DEBT_ISSUE}/comments", json={"text": "I can help."})
    assert res.status_code == 201
    [e] = await new_entries("issue", DEBT_ISSUE, before)
    async with SessionLocal() as db:
        comment = await db.get_one(IssueComment, uuid.UUID(e.data["commentId"]))
    assert (comment.body, str(comment.author_id), str(e.actor_id), e.action) == ("I can help.", me["id"], me["id"], "commented")
    assert e.data == {"commentId": str(comment.id)}  # no copy of the text
    assert res.json()["activity"][-1] == {"at": res.json()["activity"][-1]["at"], "actor": "Priya Shah", "text": "I can help.", "comment": True}
    # The entry is not a second line in the list.
    assert [a["text"] for a in res.json()["activity"]].count("I can help.") == 1

    async def broken(*args, **kwargs):
        raise RuntimeError("commit failed")

    monkeypatch.setattr(issues, "saved", broken)  # fails before the commit: no comment, no entry
    with pytest.raises(RuntimeError):
        await client.post(f"/api/issues/{DEBT_ISSUE}/comments", json={"text": "Lost."})
    async with SessionLocal() as db:
        assert await db.scalar(select(IssueComment).where(IssueComment.body == "Lost.")) is None
    assert len(await new_entries("issue", DEBT_ISSUE, before)) == 1


# Reading back


async def test_seeded_history_reads_back(client):
    await as_user(client, VIEWER)
    d = (await client.get(f"/api/materials/{SUMMER}")).json()
    assert [line(e) for e in d["history"]][:4] == [
        ("Priya Shah", "submitted", "Submitted version 1 by manual upload."),
        ("Rule check", "prereview", "Code checks found 2 problems: REGZ-1026.24, UDAAP-03."),
        ("AI reviewer", "prereview", "AI review found 1 problem: UDAAP-03."),
        ("Routing", "routed", 'Required Compliance (rule "Every material") and Legal (rule "Loan, nationwide").'),
    ]
    assert d["history"][0]["at"] == "2026-10-30T15:02:00Z"
    # System actors are system actors, people are users.
    async with SessionLocal() as db:
        rows = list(await db.scalars(select(AuditEvent).where(AuditEvent.entity == "material", AuditEvent.entity_id == SUMMER)))
    assert {r.actor_label for r in rows if r.actor_id is None} == {"Rule check", "AI reviewer", "Routing"}
    assert all(r.actor_label is None for r in rows if r.actor_id is not None)
    issue = (await client.get(f"/api/issues/{DEBT_ISSUE}")).json()
    assert [(a["actor"], a.get("comment")) for a in issue["activity"]] == [
        ("Monitoring", None), ("Monitoring", None), ("Monitoring", None), ("Sam Rivera", True)
    ]


async def test_history_is_only_this_materials(client):
    """Entries of another material, another entity with the same id, or another workspace do not show."""
    async with SessionLocal() as db, db.begin():
        other = Workspace(name="Real credit union")
        db.add(other)
        await db.flush()
        db.add(AuditEvent(workspace_id=other.id, actor_label="X", entity="material", entity_id=SUMMER, action="submitted",
                          data={"text": "From another workspace"}))
        summer = await db.get_one(Material, uuid.UUID(SUMMER))
        db.add(AuditEvent(workspace_id=summer.workspace_id, actor_label="X", entity="issue", entity_id=SUMMER, action="raised",
                          data={"text": "Another entity"}))
        own = [e for e in await entries("material", SUMMER) if e.workspace_id == summer.workspace_id]
    await as_user(client, VIEWER)
    texts = [e["text"] for e in (await client.get(f"/api/materials/{SUMMER}")).json()["history"]]
    assert "From another workspace" not in texts and "Another entity" not in texts
    assert texts == [e.data["text"] for e in own]


# Visibility (PRD section 4, R4): unchanged, and not the audit log page's permission


async def test_affiliate_sees_own_history_and_activity(client):
    await as_user(client, REVIEWER)  # an issue on the affiliate's material shows in its history
    erin = await user_id(client, AFFILIATE)
    assert (await raise_issue(client, materialId=LENDWISE_POST, ownerId=erin)).status_code == 201
    await as_user(client, AFFILIATE)
    assert (await client.get("/api/audit")).status_code == 403  # the audit log page is for internal users
    body = submission(channel="affiliate", fields=[{"label": "Page text", "text": "Hi"}])
    assert (await client.post(f"/api/materials/{LENDWISE_POST}/versions", json=body)).status_code == 201
    d = (await client.get(f"/api/materials/{LENDWISE_POST}")).json()
    assert [line(e)[:2] for e in d["history"]] == [
        ("Jordan Kim", "issue"), ("Erin Walsh", "submitted"), ("Routing", "routed"), ("Rule check", "prereview"),
    ]
    assert (await client.get(f"/api/materials/{RATERADAR}")).status_code == 404
    assert (await client.get(f"/api/materials/{SUMMER}")).status_code == 404
    notice = (await client.get(f"/api/issues/{NOTICE_ISSUE}")).json()
    assert notice["activity"][0]["actor"] == "Monitoring"
    assert (await client.get(f"/api/issues/{DEBT_ISSUE}")).status_code == 404

    await as_user(client, OTHER_AFFILIATE)
    assert (await client.get(f"/api/materials/{LENDWISE_POST}")).status_code == 404
    assert (await client.get(f"/api/issues/{NOTICE_ISSUE}")).status_code == 404
    assert (await client.get(f"/api/materials/{RATERADAR}")).json() is None  # visible, but it has no version


@pytest.mark.parametrize("email", [VIEWER, SUBMITTER, REVIEWER, MANAGER, ADMIN])
async def test_internal_users_see_history_and_activity(client, email):
    await as_user(client, email)
    assert (await client.get(f"/api/materials/{SUMMER}")).json()["history"]
    assert (await client.get(f"/api/issues/{DEBT_ISSUE}")).json()["activity"]


# Demo reset


async def test_demo_reset_restores_history(client):
    await as_user(client, VIEWER)
    history = (await client.get(f"/api/materials/{SUMMER}")).json()["history"]
    activity = (await client.get(f"/api/issues/{DEBT_ISSUE}")).json()["activity"]
    await as_user(client, SAM)
    await client.post(f"/api/issues/{DEBT_ISSUE}/comments", json={"text": "Before the reset."})
    await as_user(client, REVIEWER)
    await decide(client, SUMMER, "request_changes", "Before the reset.")
    assert "Created" in await seed(reset=True)  # the append-only trigger lets the demo's entries go
    await as_user(client, VIEWER)
    assert (await client.get(f"/api/materials/{SUMMER}")).json()["history"] == history
    assert (await client.get(f"/api/issues/{DEBT_ISSUE}")).json()["activity"] == activity
    async with SessionLocal() as db:
        assert await db.scalar(select(IssueComment).where(IssueComment.body == "Before the reset.")) is None


async def test_entries_of_one_request_share_its_time(client):
    """The database sets created_at to the start of the transaction, so the order comes from the id."""
    await as_user(client, SUBMITTER)
    start = datetime.now(UTC)
    d = (await client.post("/api/materials", json=submission())).json()
    times = {e["at"] for e in d["history"]}
    assert len(times) == 1
    assert abs(datetime.fromisoformat(times.pop().replace("Z", "+00:00")) - start) < timedelta(seconds=30)
