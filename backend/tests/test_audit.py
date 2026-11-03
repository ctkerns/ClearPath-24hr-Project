"""The audit log (PRD F12, section 9 AuditEvent): every write records one entry in the same transaction,
a failed write records none, the database blocks edits and deletes, and internal users read their workspace's log."""

import uuid

import pytest
from sqlalchemy import select, text
from sqlalchemy.exc import DBAPIError

from app.db import SessionLocal
from app.models import Role, User, Workspace
from app.models.audit import AuditEvent
from app.security import hash_password
from app.seed import DEMO_PASSWORD
from tests.helpers import ADMIN, AFFILIATE, MANAGER, REVIEWER, SUBMITTER, as_user
from tests.test_integrations import KLAVIYO, LENDING, META, PRIYA, SAM
from tests.test_issues import DEBT_ISSUE
from tests.test_library import BLOCK, CSV, WAITING, block_body, disclosure_body, rule_body
from tests.test_routing import FIRST_RULE, LEGAL, NEW_RULE

VIEWER = "ben.okafor@demo.clearpathcu.org"
UNKNOWN = "01973a10-0000-7000-8000-000000000000"


# The demo seed writes the history of its materials and issues as entries. Most tests here leave them out.
HISTORY = ("material", "issue")


async def all_events(history: bool = False) -> list[AuditEvent]:
    query = select(AuditEvent).order_by(AuditEvent.created_at, AuditEvent.id)
    if not history:
        query = query.where(AuditEvent.entity.not_in(HISTORY))
    async with SessionLocal() as db:
        return list(await db.scalars(query))


async def write(client, me, method, path, json=None, *, entity, action, entity_id=None):
    """Sends one write and checks that it recorded exactly one entry, by `me`. Returns the response and the entry."""
    before = {e.id for e in await all_events()}
    res = await client.request(method, path, json=json)
    assert res.status_code < 300, res.text
    new = [e for e in await all_events() if e.id not in before]
    assert [(e.entity, e.action) for e in new] == [(entity, action)]
    event = new[0]
    assert event.actor_id == uuid.UUID(me["id"])
    assert event.workspace_id == uuid.UUID(me["workspaceId"])
    if entity_id is not None:
        assert event.entity_id == str(entity_id)
    return res, event


async def fails(client, method, path, json=None, code=400):
    """A write that fails records nothing."""
    count = len(await all_events())
    res = await client.request(method, path, json=json)
    assert res.status_code == code, res.text
    assert len(await all_events()) == count


async def user_id(client, email):
    return next(u["id"] for u in (await client.get("/api/users")).json() if u["email"] == email)


# Writes


async def test_sign_in_and_sign_out(client):
    me = await as_user(client, SUBMITTER)
    [event] = await all_events()
    assert (event.entity, event.entity_id, event.action, str(event.actor_id)) == ("user", me["id"], "signed_in", me["id"])
    await write(client, me, "POST", "/api/auth/sign-out", entity="user", action="signed_out", entity_id=me["id"])
    # Signed out already, and a wrong password: nothing, so guessed emails are not stored.
    await fails(client, "POST", "/api/auth/sign-out", code=204)
    await fails(client, "POST", "/api/auth/sign-in", {"email": "guess@example.com", "password": "x"}, code=401)
    await fails(client, "POST", "/api/auth/sign-in", {"email": SUBMITTER, "password": "wrong"}, code=401)


async def test_user_writes(client):
    me = await as_user(client, ADMIN)
    priya = await user_id(client, SUBMITTER)
    _, e = await write(client, me, "PATCH", f"/api/users/{priya}", {"role": "reviewer"}, entity="user", action="role_changed", entity_id=priya)
    assert e.data == {"before": "submitter", "after": "reviewer"}
    _, e = await write(client, me, "PUT", f"/api/users/{priya}/groups", {"groups": ["Legal"]}, entity="user", action="groups_changed")
    assert e.data["after"] == ["Legal"]
    await write(client, me, "PATCH", f"/api/users/{priya}", {"status": "deactivated"}, entity="user", action="deactivated")
    await write(client, me, "PATCH", f"/api/users/{priya}", {"status": "active"}, entity="user", action="reactivated")

    res, e = await write(client, me, "POST", "/api/users/invites", {"emails": ["new@demo.clearpathcu.org"], "role": "viewer"},
                         entity="user", action="invited")
    added = res.json()[0]["id"]
    assert (e.entity_id, e.data["email"], e.data["role"]) == (added, "new@demo.clearpathcu.org", "viewer")
    await write(client, me, "POST", f"/api/users/{added}/resend-invite", entity="user", action="invite_resent", entity_id=added)
    await write(client, me, "DELETE", f"/api/users/{added}", entity="user", action="invite_cancelled", entity_id=added)


async def test_failed_user_writes_record_nothing(client):
    await as_user(client, ADMIN)
    priya = await user_id(client, SUBMITTER)
    # The role change is valid, the status is not: the whole request fails, and its entry with it.
    await fails(client, "PATCH", f"/api/users/{priya}", {"role": "reviewer", "status": "invited"})
    assert next(u for u in (await client.get("/api/users")).json() if u["id"] == priya)["role"] == "submitter"
    await fails(client, "PUT", f"/api/users/{priya}/groups", {"groups": ["Legal"]})
    await fails(client, "DELETE", f"/api/users/{priya}")
    await as_user(client, MANAGER)
    await fails(client, "PATCH", f"/api/users/{priya}", {"role": "reviewer"}, code=403)


async def test_group_writes(client):
    me = await as_user(client, MANAGER)
    body = {"name": "Fair lending", "description": "Checks fair lending.", "targetBusinessDays": 3}
    res, e = await write(client, me, "POST", "/api/reviewer-groups", body, entity="reviewer_group", action="created")
    group = res.json()["id"]
    assert e.entity_id == group and e.data["name"] == "Fair lending"
    _, e = await write(client, me, "PATCH", f"/api/reviewer-groups/{group}", {**body, "targetBusinessDays": 5},
                       entity="reviewer_group", action="updated", entity_id=group)
    assert e.data == {"targetBusinessDays": {"before": 3, "after": 5}}
    jordan = await user_id(client, REVIEWER)
    await write(client, me, "POST", f"/api/reviewer-groups/{group}/members", {"userIds": [jordan]},
                entity="reviewer_group", action="members_added")
    await write(client, me, "DELETE", f"/api/reviewer-groups/{group}/members/{jordan}",
                entity="reviewer_group", action="member_removed")
    await fails(client, "POST", "/api/reviewer-groups", body, code=409)  # the name is taken


async def test_workspace_write(client):
    me = await as_user(client, ADMIN)
    _, e = await write(client, me, "PATCH", "/api/workspace", {"approvalDays": 120}, entity="workspace", action="updated",
                       entity_id=me["workspaceId"])
    assert e.data == {"approvalDays": {"before": 90, "after": 120}}
    await fails(client, "PATCH", "/api/workspace", {"licensedStates": []})


async def test_library_writes(client):
    me = await as_user(client, MANAGER)
    rules = (await client.get("/api/library/rules")).json()
    regz = next(r for r in rules if r["id"] == "REGZ-1026.24")
    await write(client, me, "POST", "/api/library/rules", {**rule_body(regz), "id": "TEST-1"}, entity="rule", action="created",
                entity_id="TEST-1")
    _, e = await write(client, me, "PATCH", "/api/library/rules/REGZ-1026.24", rule_body(regz), entity="rule", action="updated",
                       entity_id="REGZ-1026.24")
    assert e.data["version"] == 4

    d7 = next(d for d in (await client.get("/api/library/disclosures")).json() if d["id"] == "D-7")
    await write(client, me, "POST", "/api/library/disclosures", {**disclosure_body(d7), "id": "D-99"}, entity="disclosure",
                action="created", entity_id="D-99")
    await write(client, me, "PATCH", "/api/library/disclosures/D-7", disclosure_body(d7), entity="disclosure", action="updated")

    res, _ = await write(client, me, "POST", "/api/library/building-blocks", block_body(), entity="building_block", action="created")
    block = res.json()
    scope = {k: block_body()[k] for k in ("products", "states", "expiresAt")}
    await write(client, me, "PATCH", f"/api/library/building-blocks/{BLOCK}", scope, entity="building_block", action="updated")
    await write(client, me, "DELETE", f"/api/library/building-blocks/{block['id']}", entity="building_block", action="deleted",
                entity_id=block["id"])
    _, e = await write(client, me, "POST", "/api/library/rate-sheets", {"effectiveDate": "2026-12-01", "file": "r.csv", "csv": CSV},
                       entity="rate_sheet", action="created")
    assert e.data["rows"] == 2

    note = {"note": "Not for us."}
    await write(client, me, "POST", "/api/library/regulatory-changes/ncua-digital-official-sign/dismiss", note,
                entity="reg_change", action="dismissed")
    await fails(client, "POST", "/api/library/regulatory-changes/ncua-digital-official-sign/dismiss", note, code=409)
    await fails(client, "POST", "/api/library/rules", {**rule_body(regz), "id": "TEST-1"}, code=409)


async def test_applying_a_regulatory_change_records_each_rule(client):
    """One entry for the change, and one for each rule that gets a new version."""
    await as_user(client, MANAGER)
    before = len(await all_events())
    res = await client.post(f"/api/library/regulatory-changes/{WAITING}/apply", json={})
    assert res.status_code == 200, res.text
    new = (await all_events())[before:]
    assert [(e.entity, e.entity_id, e.action) for e in new] == [
        ("rule", "REGZ-1026.24", "updated"), ("reg_change", WAITING, "applied")
    ]
    assert new[1].data["rules"] == ["REGZ-1026.24"]


async def test_routing_writes(client):
    me = await as_user(client, MANAGER)
    res, _ = await write(client, me, "POST", "/api/routing/rules", NEW_RULE, entity="routing_rule", action="created")
    rule = res.json()["id"]
    _, e = await write(client, me, "PATCH", f"/api/routing/rules/{rule}", {"enabled": False}, entity="routing_rule",
                       action="updated", entity_id=rule)
    assert e.data == {"enabled": False}
    await write(client, me, "POST", f"/api/routing/rules/{FIRST_RULE}/move", {"by": 1}, entity="routing_rule", action="moved")
    await write(client, me, "DELETE", f"/api/routing/rules/{rule}", entity="routing_rule", action="deleted", entity_id=rule)
    await write(client, me, "PATCH", "/api/routing", {"lighterPathGroupId": LEGAL}, entity="routing_settings", action="updated")
    _, e = await write(client, me, "PUT", "/api/routing/default-group", {"groupId": LEGAL}, entity="routing_settings",
                       action="default_group_changed")
    assert e.data["after"] == LEGAL
    await fails(client, "PATCH", f"/api/routing/rules/{FIRST_RULE}", {"name": "  "})
    await fails(client, "PUT", "/api/routing/default-group", {"groupId": UNKNOWN}, code=404)
    top = (await client.get("/api/routing")).json()["rules"][0]["id"]
    await fails(client, "POST", f"/api/routing/rules/{top}/move", {"by": -1}, code=200)  # at the top: no change


async def test_integration_writes(client):
    me = await as_user(client, ADMIN)
    await client.get("/api/integrations")
    await write(client, me, "POST", f"/api/integrations/{META}/sync", entity="integration", action="synced", entity_id=META)
    _, e = await write(client, me, "PATCH", f"/api/integrations/{META}/accounts/{LENDING}", {"defaultOwnerId": SAM},
                       entity="integration", action="default_owner_changed")
    assert e.data["after"] == SAM
    await write(client, me, "POST", f"/api/integrations/{KLAVIYO}/connect", {"accountNames": ["ClearPath Financial"], "defaultOwnerId": PRIYA},
                entity="integration", action="connected", entity_id=KLAVIYO)
    await write(client, me, "POST", f"/api/integrations/{KLAVIYO}/disconnect", entity="integration", action="disconnected")
    await fails(client, "POST", f"/api/integrations/{KLAVIYO}/sync", code=409)


# Append-only in the database


async def some_event() -> AuditEvent:
    async with SessionLocal() as db, db.begin():
        user = await db.scalar(select(User).where(User.email == ADMIN))
        assert user is not None
        event = AuditEvent(workspace_id=user.workspace_id, actor_id=user.id, entity="user", entity_id="x", action="test")
        db.add(event)
    return event


@pytest.mark.parametrize(
    "sql",
    [
        "UPDATE audit_events SET action = 'edited'",
        "DELETE FROM audit_events",
    ],
)
async def test_database_blocks_update_and_delete(sql):
    await some_event()
    async with SessionLocal() as db:
        with pytest.raises(DBAPIError, match="append-only"):
            await db.execute(text(sql))
    assert len(await all_events()) == 1


async def test_delete_needs_the_setting_and_a_demo_workspace():
    event = await some_event()
    async with SessionLocal() as db:
        # The setting does not allow an UPDATE.
        await db.execute(text("SET LOCAL app.allow_audit_delete = 'on'"))
        with pytest.raises(DBAPIError, match="append-only"):
            await db.execute(text("UPDATE audit_events SET action = 'edited'"))
    async with SessionLocal() as db, db.begin():
        real = Workspace(name="Real workspace")
        db.add(real)
        await db.flush()
        db.add(AuditEvent(workspace_id=real.id, entity="workspace", entity_id=str(real.id), action="test", actor_label="Test"))
    async with SessionLocal() as db:
        await db.execute(text("SET LOCAL app.allow_audit_delete = 'on'"))
        with pytest.raises(DBAPIError, match="append-only"):  # the real workspace's entries stay
            await db.execute(text("DELETE FROM audit_events"))
    async with SessionLocal() as db, db.begin():
        await db.execute(text("SET LOCAL app.allow_audit_delete = 'on'"))
        await db.execute(text("DELETE FROM audit_events WHERE id = :id"), {"id": event.id})
    async with SessionLocal() as db:  # SET LOCAL ended with its transaction
        with pytest.raises(DBAPIError, match="append-only"):
            await db.execute(text("DELETE FROM audit_events"))
    assert [e.action for e in await all_events()] == ["test"]


async def test_seed_reset_works_twice_with_entries(client):
    """The reset deletes the demo's entries, also the seeded history, and the seed writes that history again."""
    from app.seed import seed

    seeded = [(e.entity, e.entity_id, e.action, e.created_at) for e in await all_events(history=True)]
    assert seeded and {e for e, *_ in seeded} == set(HISTORY)
    await as_user(client, ADMIN)
    await client.patch("/api/workspace", json={"approvalDays": 120})
    await client.post(f"/api/issues/{DEBT_ISSUE}/comments", json={"text": "Before the reset."})
    assert len(await all_events()) == 2
    assert "Created" in await seed(reset=True)
    assert await all_events() == []
    again = [(e.entity, e.entity_id, e.action, e.created_at) for e in await all_events(history=True)]
    assert again == seeded  # the entry for the comment went too
    await as_user(client, ADMIN)
    assert "Created" in await seed(reset=True)
    await as_user(client, ADMIN)
    assert len(await all_events()) == 1


# Reading


@pytest.mark.parametrize("email", [VIEWER, SUBMITTER, REVIEWER, MANAGER, ADMIN])
async def test_internal_users_read_the_log(client, email):
    admin = await as_user(client, ADMIN)
    await client.patch("/api/workspace", json={"approvalDays": 120})
    me = await as_user(client, email)
    res = await client.get("/api/audit")
    assert res.status_code == 200, res.text
    newest, change, *_ = res.json()
    assert (newest["entity"], newest["entityId"], newest["action"], newest["actor"]) == ("user", me["id"], "signed_in", me["name"])
    assert change == {
        "id": change["id"],
        "actor": "Maya Ruiz",
        "actorId": admin["id"],
        "entity": "workspace",
        "entityId": admin["workspaceId"],
        "action": "updated",
        "data": {"approvalDays": {"before": 90, "after": 120}},
        "createdAt": change["createdAt"],
    }


async def test_affiliate_and_signed_out_cannot_read(client):
    assert (await client.get("/api/audit")).status_code == 401
    await as_user(client, AFFILIATE)
    assert (await client.get("/api/audit")).status_code == 403


async def test_filter_and_pages(client):
    me = await as_user(client, MANAGER)
    for days in (6, 7, 8):
        await client.patch(f"/api/reviewer-groups/{LEGAL}", json={"name": "Legal", "description": "Legal.", "targetBusinessDays": days})
    one = (await client.get("/api/audit", params={"entity": "reviewer_group", "entityId": LEGAL})).json()
    assert [e["data"]["targetBusinessDays"]["after"] for e in one] == [8, 7, 6]
    assert {e["actorId"] for e in one} == {me["id"]}
    assert (await client.get("/api/audit", params={"entity": "rule"})).json() == []

    first = (await client.get("/api/audit", params={"limit": 2})).json()
    rest = (await client.get("/api/audit", params={"limit": 2, "before": first[-1]["id"]})).json()
    everything = (await client.get("/api/audit", params={"limit": 200})).json()
    assert [e["id"] for e in first + rest] == [e["id"] for e in everything[:4]]  # 3 changes and the sign-in
    # Then only the seeded history of the demo materials and issues, which is older
    older = (await client.get("/api/audit", params={"limit": 200, "before": rest[-1]["id"]})).json()
    assert older and {e["entity"] for e in older} == set(HISTORY)
    # Each page holds at most 200, and the seeded history is longer, so compare the part both pages hold.
    assert [e["id"] for e in older][: len(everything) - 4] == [e["id"] for e in everything[4:]]
    assert (await client.get("/api/audit", params={"before": UNKNOWN})).status_code == 400
    assert (await client.get("/api/audit", params={"limit": 0})).status_code == 422


async def test_other_workspace_is_invisible(client):
    await as_user(client, ADMIN)
    demo_event = (await client.get("/api/audit")).json()[0]["id"]
    async with SessionLocal() as db, db.begin():
        other = Workspace(name="Real workspace")
        db.add(other)
        await db.flush()
        db.add(User(workspace_id=other.id, email="ops@clearpath.example", name="Ops", role=Role.VIEWER,
                    password_hash=hash_password(DEMO_PASSWORD)))
    ops = await as_user(client, "ops@clearpath.example")
    [only] = (await client.get("/api/audit")).json()
    assert only["actorId"] == ops["id"]
    # Another workspace's entry is not a cursor either.
    assert (await client.get("/api/audit", params={"before": demo_event})).status_code == 400
