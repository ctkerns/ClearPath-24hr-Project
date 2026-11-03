import uuid

import pytest
from sqlalchemy import func, select

from app.db import SessionLocal
from app.models import Session, Workspace
from app.seed import DEMO_PASSWORD

ADMIN = "maya.ruiz@demo.clearpathcu.org"
MANAGER = "alex.chen@demo.clearpathcu.org"
REVIEWER = "jordan.kim@demo.clearpathcu.org"
SUBMITTER = "priya.shah@demo.clearpathcu.org"
AFFILIATE = "erin.walsh@lendwise.example"


async def as_user(client, email):
    res = await client.post("/api/auth/sign-in", json={"email": email, "password": DEMO_PASSWORD})
    assert res.status_code == 200, res.text
    return res.json()


async def user_by_email(client, email):
    users = (await client.get("/api/users")).json()
    return next(u for u in users if u["email"] == email)


async def group_by_name(client, name):
    groups = (await client.get("/api/reviewer-groups")).json()
    return next(g for g in groups if g["name"] == name)


# Reading


async def test_internal_user_reads_users_and_groups(client):
    await as_user(client, SUBMITTER)
    users = (await client.get("/api/users")).json()
    assert len(users) == 16
    alex = next(u for u in users if u["email"] == MANAGER)
    assert alex["groups"] == ["Compliance", "Senior compliance"]
    erin = next(u for u in users if u["email"] == AFFILIATE)
    assert (erin["affiliate"], erin["affiliateManager"]) == ("LendWise", "Marcus Lee")
    nina = next(u for u in users if u["status"] == "invited" and u["role"] == "reviewer")
    assert nina["invitedBy"] == "Maya Ruiz"

    groups = (await client.get("/api/reviewer-groups")).json()
    assert [g["name"] for g in groups] == ["Compliance", "Legal", "Mortgage", "Senior compliance"]
    assert next(g for g in groups if g["isDefault"])["name"] == "Compliance"


async def test_affiliate_cannot_read_the_user_list(client):
    await as_user(client, AFFILIATE)
    assert (await client.get("/api/users")).status_code == 403
    assert (await client.get("/api/reviewer-groups")).status_code == 403


async def test_signed_out_is_401(client):
    assert (await client.get("/api/users")).status_code == 401


# Users: only Admins change them


@pytest.mark.parametrize("email", [MANAGER, REVIEWER, SUBMITTER])
async def test_only_admin_changes_users(client, email):
    await as_user(client, email)
    target = await user_by_email(client, SUBMITTER)
    res = await client.patch(f"/api/users/{target['id']}", json={"role": "viewer"})
    assert res.status_code == 403


async def test_admin_lowers_role_and_groups_go(client):
    await as_user(client, ADMIN)
    jordan = await user_by_email(client, REVIEWER)
    res = await client.patch(f"/api/users/{jordan['id']}", json={"role": "submitter"})
    assert res.status_code == 200
    assert res.json()["role"] == "submitter"
    assert res.json()["groups"] == []


async def test_admin_cannot_change_self(client):
    me = await as_user(client, ADMIN)
    res = await client.patch(f"/api/users/{me['id']}", json={"status": "deactivated"})
    assert res.status_code == 400


async def test_deactivate_signs_the_user_out(client):
    # Jordan signs in, in another browser.
    await as_user(client, REVIEWER)
    jordan_cookie = dict(client.cookies)
    client.cookies.clear()

    await as_user(client, ADMIN)
    jordan = await user_by_email(client, REVIEWER)
    res = await client.patch(f"/api/users/{jordan['id']}", json={"status": "deactivated"})
    assert res.status_code == 200
    assert res.json()["status"] == "deactivated"
    async with SessionLocal() as db:
        assert await db.scalar(select(func.count()).select_from(Session).where(Session.user_id == uuid.UUID(jordan["id"]))) == 0

    client.cookies.clear()
    client.cookies.update(jordan_cookie)
    assert (await client.get("/api/auth/me")).status_code == 401


async def test_set_groups(client):
    await as_user(client, ADMIN)
    jordan = await user_by_email(client, REVIEWER)
    res = await client.put(f"/api/users/{jordan['id']}/groups", json={"groups": ["Legal", "Mortgage"]})
    assert res.status_code == 200
    assert res.json()["groups"] == ["Legal", "Mortgage"]

    unknown = await client.put(f"/api/users/{jordan['id']}/groups", json={"groups": ["Nope"]})
    assert unknown.status_code == 400

    priya = await user_by_email(client, SUBMITTER)
    below_reviewer = await client.put(f"/api/users/{priya['id']}/groups", json={"groups": ["Legal"]})
    assert below_reviewer.status_code == 400


async def test_invite_resend_and_cancel(client):
    await as_user(client, ADMIN)
    res = await client.post(
        "/api/users/invites",
        json={"emails": ["New.Person@demo.clearpathcu.org"], "role": "reviewer", "groups": ["Legal"]},
    )
    assert res.status_code == 201, res.text
    [added] = res.json()
    assert added["email"] == "new.person@demo.clearpathcu.org"
    assert added["name"] == "New Person"
    assert (added["status"], added["groups"], added["invitedBy"]) == ("invited", ["Legal"], "Maya Ruiz")

    # An invited user has no password, so they cannot sign in yet.
    client.cookies.clear()
    no_password = await client.post("/api/auth/sign-in", json={"email": added["email"], "password": ""})
    assert no_password.status_code == 401
    await as_user(client, ADMIN)

    assert (await client.post(f"/api/users/{added['id']}/resend-invite")).status_code == 200
    again = await client.post("/api/users/invites", json={"emails": [added["email"]], "role": "viewer"})
    assert again.status_code == 409

    assert (await client.delete(f"/api/users/{added['id']}")).status_code == 204
    assert all(u["id"] != added["id"] for u in (await client.get("/api/users")).json())


async def test_cannot_remove_an_active_user(client):
    await as_user(client, ADMIN)
    priya = await user_by_email(client, SUBMITTER)
    assert (await client.delete(f"/api/users/{priya['id']}")).status_code == 400


async def test_invite_affiliate(client):
    await as_user(client, ADMIN)
    marcus = await user_by_email(client, "marcus.lee@demo.clearpathcu.org")
    res = await client.post(
        "/api/users/invites",
        json={"emails": ["sam@newpartner.example"], "role": "affiliate", "affiliate": "NewPartner", "affiliateManagerId": marcus["id"]},
    )
    assert res.status_code == 201, res.text
    assert (res.json()[0]["affiliate"], res.json()[0]["affiliateManager"]) == ("NewPartner", "Marcus Lee")

    no_company = await client.post("/api/users/invites", json={"emails": ["x@y.example"], "role": "affiliate"})
    assert no_company.status_code == 400


async def test_other_workspace_is_invisible(client):
    """A user of another workspace gives 404 (PRD: data isolation)."""
    async with SessionLocal() as db, db.begin():
        other = Workspace(name="Real workspace")
        db.add(other)
    await as_user(client, ADMIN)
    from app.models import Role, User

    async with SessionLocal() as db, db.begin():
        db.add(User(workspace_id=other.id, email="real@clearpath.example", name="Real", role=Role.ADMIN))
    async with SessionLocal() as db:
        real_id = await db.scalar(select(User.id).where(User.email == "real@clearpath.example"))

    assert all(u["email"] != "real@clearpath.example" for u in (await client.get("/api/users")).json())
    assert (await client.patch(f"/api/users/{real_id}", json={"role": "viewer"})).status_code == 404


# Reviewer groups: only Managers and higher change them


async def test_reviewer_cannot_change_groups(client):
    await as_user(client, REVIEWER)
    res = await client.post("/api/reviewer-groups", json={"name": "X", "description": "Y", "targetBusinessDays": 2})
    assert res.status_code == 403


async def test_manager_creates_renames_and_names_are_unique(client):
    await as_user(client, MANAGER)
    res = await client.post(
        "/api/reviewer-groups", json={"name": "Deposits", "description": "Savings ads", "targetBusinessDays": 3}
    )
    assert res.status_code == 201, res.text
    group = res.json()
    assert (group["createdBy"], group["isDefault"]) == ("Alex Chen", False)

    taken = await client.post("/api/reviewer-groups", json={"name": "legal", "description": "x", "targetBusinessDays": 2})
    assert taken.status_code == 409

    bad_target = await client.post("/api/reviewer-groups", json={"name": "Z", "description": "x", "targetBusinessDays": 0})
    assert bad_target.status_code == 422

    # A rename keeps the members.
    compliance = await group_by_name(client, "Compliance")
    renamed = await client.patch(
        f"/api/reviewer-groups/{compliance['id']}",
        json={"name": "Consumer compliance", "description": compliance["description"], "targetBusinessDays": 2},
    )
    assert renamed.status_code == 200
    assert "Consumer compliance" in (await user_by_email(client, REVIEWER))["groups"]


async def test_members(client):
    await as_user(client, MANAGER)
    legal = await group_by_name(client, "Legal")
    jordan = await user_by_email(client, REVIEWER)
    priya = await user_by_email(client, SUBMITTER)

    res = await client.post(f"/api/reviewer-groups/{legal['id']}/members", json={"userIds": [jordan["id"]]})
    assert res.status_code == 200
    assert jordan["id"] in [m["id"] for m in res.json()]

    below_reviewer = await client.post(f"/api/reviewer-groups/{legal['id']}/members", json={"userIds": [priya["id"]]})
    assert below_reviewer.status_code == 400

    res = await client.delete(f"/api/reviewer-groups/{legal['id']}/members/{jordan['id']}")
    assert res.status_code == 200
    assert jordan["id"] not in [m["id"] for m in res.json()]


async def test_me_returns_groups_from_the_database(client):
    me = await as_user(client, MANAGER)
    assert me["groups"] == ["Compliance", "Senior compliance"]


async def test_seed_reset_works_twice(client):
    from app.seed import seed

    assert "Created" in await seed(reset=True)
    assert "Created" in await seed(reset=True)
