import pytest

from app.db import SessionLocal
from app.models import Role, User, Workspace
from tests.helpers import ADMIN, AFFILIATE, MANAGER, REVIEWER, SUBMITTER, as_user

META = "019e807a-ec00-7acf-9d3d-342c48d9073a"
GOOGLE = "019e8fee-0000-745c-9df0-678263e22b63"
KLAVIYO = "019eaed4-2800-7df5-9c56-71c6ec7139c0"
SLACK = "019fc4eb-9000-7668-a303-ec55b75ceacc"
LENDING = "019f0b86-a000-74f7-89e9-9ff358f69117"
PRIYA = "01976f62-4280-77e8-950f-6fe7058397c4"
SAM = "01977752-bb00-73a2-8d7c-2d0d4d36ad8a"


async def integrations(client):
    res = await client.get("/api/integrations")
    assert res.status_code == 200, res.text
    return {i["id"]: i for i in res.json()}


async def test_admin_reads_every_connector(client):
    await as_user(client, ADMIN)
    res = await client.get("/api/integrations")
    body = res.json()
    assert [i["provider"] for i in body][:3] == ["meta", "google_ads", "mailchimp"]
    assert len(body) == 14
    by_id = {i["id"]: i for i in body}
    meta = by_id[META]
    assert (meta["status"], meta["verified"], meta["lastSyncAt"]) == ("connected", True, "2026-11-02T10:52:00Z")
    assert [a["name"] for a in meta["accounts"]] == ["ClearPath Financial – Lending", "ClearPath Financial – Cards"]
    assert meta["accounts"][0]["defaultOwnerId"] == PRIYA
    assert len(meta["available"]) == 3
    assert by_id[GOOGLE]["error"] == {"code": "token_expired", "at": "2026-10-31T22:05:00Z"}
    assert by_id[KLAVIYO]["lastSyncAt"] is None
    assert by_id[KLAVIYO]["error"] is None


@pytest.mark.parametrize("email", [MANAGER, REVIEWER, SUBMITTER, AFFILIATE])
async def test_only_admin_reads_and_changes_connectors(client, email):
    """Integrations are an Admin job (PRD section 4)."""
    await as_user(client, email)
    assert (await client.get("/api/integrations")).status_code == 403
    assert (await client.post(f"/api/integrations/{META}/sync")).status_code == 403
    assert (await client.post(f"/api/integrations/{META}/disconnect")).status_code == 403
    connect = {"accountNames": ["ClearPath Financial – Brand"], "defaultOwnerId": PRIYA}
    assert (await client.post(f"/api/integrations/{META}/connect", json=connect)).status_code == 403
    owner = {"defaultOwnerId": SAM}
    assert (await client.patch(f"/api/integrations/{META}/accounts/{LENDING}", json=owner)).status_code == 403


async def test_signed_out_is_401(client):
    assert (await client.get("/api/integrations")).status_code == 401


async def test_sync_now_records_the_time(client):
    await as_user(client, ADMIN)
    res = await client.post(f"/api/integrations/{META}/sync")
    assert res.status_code == 200, res.text
    assert res.json()["lastSyncAt"] > "2026-11-02T10:52:00Z"
    # Only a connected connector syncs.
    assert (await client.post(f"/api/integrations/{KLAVIYO}/sync")).status_code == 409
    assert (await client.post(f"/api/integrations/{GOOGLE}/sync")).status_code == 409


async def test_connect_disconnect_and_reconnect(client):
    await as_user(client, ADMIN)
    res = await client.post(
        f"/api/integrations/{KLAVIYO}/connect", json={"accountNames": ["ClearPath Financial"], "defaultOwnerId": SAM}
    )
    assert res.status_code == 200, res.text
    klaviyo = res.json()
    assert (klaviyo["status"], klaviyo["accounts"][0]["defaultOwnerId"]) == ("connected", SAM)
    assert klaviyo["lastSyncAt"] is not None

    # Reconnect after an error: the error goes, the picked accounts stay or are added.
    res = await client.post(
        f"/api/integrations/{GOOGLE}/connect",
        json={"accountNames": ["ClearPath Search", "ClearPath Display"], "defaultOwnerId": PRIYA},
    )
    google = res.json()
    assert (google["status"], google["error"]) == ("connected", None)
    owners = {a["name"]: a["defaultOwnerId"] for a in google["accounts"]}
    assert owners == {"ClearPath Search": SAM, "ClearPath Display": PRIYA}  # the kept account keeps its owner

    # Edit accounts: one left out goes away.
    res = await client.post(f"/api/integrations/{META}/connect", json={"accountNames": ["ClearPath Financial – Cards"], "defaultOwnerId": PRIYA})
    assert [a["name"] for a in res.json()["accounts"]] == ["ClearPath Financial – Cards"]

    res = await client.post(f"/api/integrations/{META}/disconnect")
    assert (res.json()["status"], res.json()["accounts"]) == ("not_connected", [])
    assert (await integrations(client))[META]["status"] == "not_connected"


async def test_alerts_need_no_default_owner(client):
    await as_user(client, ADMIN)
    res = await client.post(f"/api/integrations/{SLACK}/connect", json={"accountNames": ["#compliance-alerts", "#marketing-compliance"]})
    assert res.status_code == 200, res.text
    assert all(a["defaultOwnerId"] is None for a in res.json()["accounts"])
    slack_account = res.json()["accounts"][0]["id"]
    owner = await client.patch(f"/api/integrations/{SLACK}/accounts/{slack_account}", json={"defaultOwnerId": SAM})
    assert owner.status_code == 400


@pytest.mark.parametrize(
    ("body", "code"),
    [
        ({"accountNames": []}, 422),
        ({"accountNames": ["Somebody else's account"], "defaultOwnerId": PRIYA}, 400),
        ({"accountNames": ["ClearPath Financial"]}, 400),  # content needs a default owner
        ({"accountNames": ["ClearPath Financial"], "defaultOwnerId": "01970000-0000-7000-8000-000000000000"}, 404),
    ],
)
async def test_invalid_connect(client, body, code):
    await as_user(client, ADMIN)
    assert (await client.post(f"/api/integrations/{KLAVIYO}/connect", json=body)).status_code == code


async def test_default_owner(client):
    await as_user(client, ADMIN)
    res = await client.patch(f"/api/integrations/{META}/accounts/{LENDING}", json={"defaultOwnerId": SAM})
    assert res.status_code == 200, res.text
    assert next(a for a in res.json()["accounts"] if a["id"] == LENDING)["defaultOwnerId"] == SAM

    users = (await client.get("/api/users")).json()
    viewer = next(u for u in users if u["role"] == "viewer")
    affiliate = next(u for u in users if u["email"] == AFFILIATE)
    invited = next(u for u in users if u["status"] == "invited")
    for u in (viewer, affiliate, invited):
        bad = await client.patch(f"/api/integrations/{META}/accounts/{LENDING}", json={"defaultOwnerId": u["id"]})
        assert bad.status_code == 400, u["name"]
    other_account = await client.patch(f"/api/integrations/{GOOGLE}/accounts/{LENDING}", json={"defaultOwnerId": SAM})
    assert other_account.status_code == 404


async def test_other_workspace_is_invisible(client):
    """A new workspace lists every connector as Not connected, and never sees the demo's."""
    from app.security import hash_password
    from app.seed import DEMO_PASSWORD

    async with SessionLocal() as db, db.begin():
        other = Workspace(name="Real workspace")
        db.add(other)
        await db.flush()
        db.add(
            User(
                workspace_id=other.id,
                email="ops@clearpath.example",
                name="Ops",
                role=Role.ADMIN,
                password_hash=hash_password(DEMO_PASSWORD),
            )
        )
    await as_user(client, "ops@clearpath.example")
    real = await integrations(client)
    assert len(real) == 14
    assert META not in real
    assert all(i["status"] == "not_connected" and not i["accounts"] for i in real.values())
    assert {i["provider"] for i in real.values() if i["verified"]} >= {"crawler", "slack"}
    assert len(await integrations(client)) == 14  # reading again adds nothing

    assert (await client.post(f"/api/integrations/{META}/sync")).status_code == 404
    assert (await client.post(f"/api/integrations/{META}/disconnect")).status_code == 404
    # No platform has offered accounts yet (no OAuth), so there is nothing to connect.
    real_meta = next(i for i in real.values() if i["provider"] == "meta")
    assert real_meta["available"] == []
    res = await client.post(f"/api/integrations/{real_meta['id']}/connect", json={"accountNames": ["ClearPath Financial – Lending"], "defaultOwnerId": PRIYA})
    assert res.status_code == 400


async def test_seed_reset_restores_connectors(client):
    from app.seed import seed

    await as_user(client, ADMIN)
    await client.post(f"/api/integrations/{META}/disconnect")
    assert "Created" in await seed(reset=True)
    await as_user(client, ADMIN)
    assert (await integrations(client))[META]["status"] == "connected"
