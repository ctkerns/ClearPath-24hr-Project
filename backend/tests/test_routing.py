import pytest
from sqlalchemy import select

from app.db import SessionLocal
from app.models import ReviewerGroup, Role, User, Workspace
from tests.helpers import ADMIN, AFFILIATE, MANAGER, REVIEWER, SUBMITTER, as_user

COMPLIANCE = "01973a10-2c00-7b41-9e0a-3f6d2a1c8b01"
LEGAL = "01973a10-2c00-7c52-8f1b-4a7e3b2d9c02"
MORTGAGE = "01973a10-2c00-7d63-9a2c-5b8f4c3eac03"
SENIOR = "01973a10-2c00-7e74-8b3d-6c9a5d4fbd04"
FIRST_RULE = "01973a12-4e00-7a11-8c01-1a2b3c4d5e01"
NY_RULE = "01973a12-4e00-7f66-9b06-6f7a8b9c0d06"

NEW_RULE = {
    "name": "Auto loans in Texas",
    "conditions": {"products": ["auto_loan"], "channels": [], "states": ["TX"]},
    "requiredGroupIds": [LEGAL, COMPLIANCE],
}


async def routing(client):
    res = await client.get("/api/routing")
    assert res.status_code == 200, res.text
    return res.json()


# Reading: every internal role, because the submit form previews routing (PRD F3, F6)


@pytest.mark.parametrize("email", [SUBMITTER, REVIEWER, MANAGER])
async def test_internal_users_read_routing(client, email):
    await as_user(client, email)
    body = await routing(client)
    assert [r["id"] for r in body["rules"]][0] == FIRST_RULE
    assert len(body["rules"]) == 6
    assert body["lighterPathGroupId"] is None
    assert body["noMaterialChangeTypes"]["tracking_link"] is False
    assert body["noMaterialChangeTypes"]["rate_fee"] is True
    problems = next(r for r in body["rules"] if r["name"] == "Affiliates with recent problems")
    assert problems["requiredGroupIds"] == [SENIOR, LEGAL]  # the order the Manager picked
    assert problems["conditions"]["source"] == "affiliate"
    assert problems["conditions"]["affiliateHistory"] is True
    ny = next(r for r in body["rules"] if r["id"] == NY_RULE)
    assert (ny["enabled"], ny["updatedBy"], ny["conditions"]["states"]) == (False, "Alex Chen", ["NY"])


async def test_affiliate_and_signed_out_cannot_read_routing(client):
    assert (await client.get("/api/routing")).status_code == 401
    await as_user(client, AFFILIATE)
    assert (await client.get("/api/routing")).status_code == 403


# Writing: Managers and higher (PRD section 4)


@pytest.mark.parametrize("email", [SUBMITTER, REVIEWER])
async def test_below_manager_cannot_change_routing(client, email):
    await as_user(client, email)
    assert (await client.post("/api/routing/rules", json=NEW_RULE)).status_code == 403
    assert (await client.patch(f"/api/routing/rules/{FIRST_RULE}", json={"enabled": False})).status_code == 403
    assert (await client.delete(f"/api/routing/rules/{FIRST_RULE}")).status_code == 403
    assert (await client.post(f"/api/routing/rules/{FIRST_RULE}/move", json={"by": 1})).status_code == 403
    assert (await client.patch("/api/routing", json={"lighterPathGroupId": LEGAL})).status_code == 403
    assert (await client.put("/api/routing/default-group", json={"groupId": LEGAL})).status_code == 403


@pytest.mark.parametrize("email", [MANAGER, ADMIN])
async def test_manager_creates_edits_and_deletes_a_rule(client, email):
    me = await as_user(client, email)
    res = await client.post("/api/routing/rules", json=NEW_RULE)
    assert res.status_code == 201, res.text
    rule = res.json()
    assert (rule["enabled"], rule["updatedBy"], rule["requiredGroupIds"]) == (True, me["name"], [LEGAL, COMPLIANCE])
    assert rule["conditions"] == {
        "products": ["auto_loan"],
        "channels": [],
        "source": None,
        "affiliateHistory": False,
        "nationwide": False,
        "states": ["TX"],
    }
    assert (await routing(client))["rules"][-1]["id"] == rule["id"]  # new rules go at the end

    edited = await client.patch(
        f"/api/routing/rules/{rule['id']}",
        json={**NEW_RULE, "name": "Auto loans", "requiredGroupIds": [MORTGAGE], "note": " Check dealer ads "},
    )
    assert edited.status_code == 200, edited.text
    assert (edited.json()["name"], edited.json()["requiredGroupIds"], edited.json()["note"]) == (
        "Auto loans",
        [MORTGAGE],
        "Check dealer ads",
    )
    off = await client.patch(f"/api/routing/rules/{rule['id']}", json={"enabled": False})
    assert (off.json()["enabled"], off.json()["note"]) == (False, "Check dealer ads")  # other fields stay
    cleared = await client.patch(f"/api/routing/rules/{rule['id']}", json={"note": None})
    assert cleared.json()["note"] is None

    assert (await client.delete(f"/api/routing/rules/{rule['id']}")).status_code == 204
    assert rule["id"] not in [r["id"] for r in (await routing(client))["rules"]]
    assert (await client.delete(f"/api/routing/rules/{rule['id']}")).status_code == 404


async def test_history_means_affiliate_source(client):
    await as_user(client, MANAGER)
    body = {**NEW_RULE, "conditions": {"products": [], "channels": [], "states": [], "affiliateHistory": True}}
    res = await client.post("/api/routing/rules", json=body)
    assert res.json()["conditions"]["source"] == "affiliate"
    body["conditions"]["source"] = "internal"
    assert (await client.post("/api/routing/rules", json=body)).status_code == 400


@pytest.mark.parametrize(
    ("change", "code"),
    [
        ({"name": ""}, 422),
        ({"requiredGroupIds": []}, 422),
        ({"requiredGroupIds": ["01973a10-0000-7000-8000-000000000000"]}, 400),
        ({"conditions": {"products": ["boat_loan"], "channels": [], "states": []}}, 422),
        ({"conditions": {"products": [], "channels": ["tiktok"], "states": []}}, 422),
        ({"conditions": {"products": [], "channels": [], "states": ["XX"]}}, 422),
        ({"conditions": {"products": [], "channels": [], "states": [], "source": "partner"}}, 422),
    ],
)
async def test_invalid_rules(client, change, code):
    await as_user(client, MANAGER)
    assert (await client.post("/api/routing/rules", json={**NEW_RULE, **change})).status_code == code


async def test_move_rules(client):
    await as_user(client, MANAGER)
    ids = [r["id"] for r in (await routing(client))["rules"]]
    res = await client.post(f"/api/routing/rules/{ids[0]}/move", json={"by": 1})
    assert res.status_code == 200
    assert [r["id"] for r in res.json()["rules"]] == [ids[1], ids[0], *ids[2:]]
    # At the top nothing changes.
    res = await client.post(f"/api/routing/rules/{ids[1]}/move", json={"by": -1})
    assert [r["id"] for r in res.json()["rules"]] == [ids[1], ids[0], *ids[2:]]
    assert (await client.post(f"/api/routing/rules/{ids[1]}/move", json={"by": 2})).status_code == 422


async def test_lighter_path_and_change_types(client):
    await as_user(client, MANAGER)
    res = await client.patch("/api/routing", json={"lighterPathGroupId": LEGAL})
    assert res.status_code == 200, res.text
    assert res.json()["lighterPathGroupId"] == LEGAL
    res = await client.patch("/api/routing", json={"noMaterialChangeTypes": {"tracking_link": True, "rate_fee": False}})
    body = res.json()
    assert body["lighterPathGroupId"] == LEGAL  # not sent, so it stays
    assert (body["noMaterialChangeTypes"]["tracking_link"], body["noMaterialChangeTypes"]["rate_fee"]) == (True, False)
    res = await client.patch("/api/routing", json={"lighterPathGroupId": None})
    assert res.json()["lighterPathGroupId"] is None  # back to the default group

    assert (await client.patch("/api/routing", json={"noMaterialChangeTypes": {"targeting": True}})).status_code == 422
    unknown = await client.patch("/api/routing", json={"lighterPathGroupId": "01973a10-0000-7000-8000-000000000000"})
    assert unknown.status_code == 404


# The default group: one per workspace, moved in one transaction


async def test_manager_moves_the_default_group(client):
    await as_user(client, MANAGER)
    res = await client.put("/api/routing/default-group", json={"groupId": LEGAL})
    assert res.status_code == 200, res.text
    assert (res.json()["name"], res.json()["isDefault"]) == ("Legal", True)
    groups = (await client.get("/api/reviewer-groups")).json()
    assert [g["name"] for g in groups if g["isDefault"]] == ["Legal"]
    # Again on the same group: still exactly one default.
    assert (await client.put("/api/routing/default-group", json={"groupId": LEGAL})).status_code == 200
    groups = (await client.get("/api/reviewer-groups")).json()
    assert [g["name"] for g in groups if g["isDefault"]] == ["Legal"]
    missing = await client.put("/api/routing/default-group", json={"groupId": "01973a10-0000-7000-8000-000000000000"})
    assert missing.status_code == 404


# Workspace isolation


async def test_other_workspace_routing_is_invisible(client):
    async with SessionLocal() as db, db.begin():
        other = Workspace(name="Real workspace")
        db.add(other)
        await db.flush()
        db.add(User(workspace_id=other.id, email="real@clearpath.example", name="Real", role=Role.MANAGER))
        group = ReviewerGroup(workspace_id=other.id, name="Real compliance", target_business_days=2, is_default=True)
        db.add(group)
    await as_user(client, MANAGER)

    # A group of another workspace cannot be required, be the lighter path, or become the default.
    other_group = {**NEW_RULE, "requiredGroupIds": [str(group.id)]}
    assert (await client.post("/api/routing/rules", json=other_group)).status_code == 400
    assert (await client.patch("/api/routing", json={"lighterPathGroupId": str(group.id)})).status_code == 404
    assert (await client.put("/api/routing/default-group", json={"groupId": str(group.id)})).status_code == 404

    # Moving the demo default leaves the other workspace's default alone.
    await client.put("/api/routing/default-group", json={"groupId": LEGAL})
    async with SessionLocal() as db:
        assert await db.scalar(select(ReviewerGroup.is_default).where(ReviewerGroup.id == group.id)) is True


async def test_new_workspace_has_no_rules_and_default_settings(client):
    """A workspace with no routing row reads the defaults: no rules, default group for the lighter path, every type on."""
    from app.security import hash_password
    from app.seed import DEMO_PASSWORD

    async with SessionLocal() as db, db.begin():
        other = Workspace(name="Real workspace")
        db.add(other)
        await db.flush()
        db.add(
            User(
                workspace_id=other.id,
                email="boss@clearpath.example",
                name="Boss",
                role=Role.MANAGER,
                password_hash=hash_password(DEMO_PASSWORD),
            )
        )
    await as_user(client, "boss@clearpath.example")
    body = await routing(client)
    assert body["rules"] == []
    assert body["lighterPathGroupId"] is None
    assert all(body["noMaterialChangeTypes"].values())
    assert (await client.post(f"/api/routing/rules/{FIRST_RULE}/move", json={"by": 1})).status_code == 404
    assert (await client.patch(f"/api/routing/rules/{FIRST_RULE}", json={"enabled": False})).status_code == 404
    res = await client.patch("/api/routing", json={"noMaterialChangeTypes": {"formatting": False}})
    assert res.json()["noMaterialChangeTypes"]["formatting"] is False


async def test_seed_reset_restores_routing(client):
    from app.seed import seed

    await as_user(client, MANAGER)
    await client.delete(f"/api/routing/rules/{FIRST_RULE}")
    await client.put("/api/routing/default-group", json={"groupId": LEGAL})
    assert "Created" in await seed(reset=True)
    await as_user(client, MANAGER)  # the reset ended the session
    body = await routing(client)
    assert body["rules"][0]["id"] == FIRST_RULE
    groups = (await client.get("/api/reviewer-groups")).json()
    assert [g["name"] for g in groups if g["isDefault"]] == ["Compliance"]
