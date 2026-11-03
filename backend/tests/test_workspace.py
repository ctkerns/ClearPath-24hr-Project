import pytest

from tests.helpers import ADMIN, AFFILIATE, MANAGER, as_user


async def test_everyone_reads_workspace_settings(client):
    me = await as_user(client, AFFILIATE)
    assert me["workspaceName"] == "ClearPath demo"
    res = await client.get("/api/workspace")
    assert res.status_code == 200
    body = res.json()
    assert body["isDemo"] is True
    assert body["approvalDays"] == 90
    assert "CA" in body["licensedStates"]


async def test_admin_changes_settings_in_picker_order(client):
    await as_user(client, ADMIN)
    res = await client.patch("/api/workspace", json={"licensedStates": ["TX", "DC", "AL", "DE"], "approvalDays": 120})
    assert res.status_code == 200, res.text
    assert res.json()["licensedStates"] == ["AL", "DE", "DC", "TX"]
    after = (await client.get("/api/workspace")).json()
    assert after["approvalDays"] == 120
    assert after["licensedStates"] == ["AL", "DE", "DC", "TX"]


async def test_only_admin_changes_settings(client):
    await as_user(client, MANAGER)
    res = await client.patch("/api/workspace", json={"approvalDays": 120})
    assert res.status_code == 403


@pytest.mark.parametrize(
    ("change", "code"),
    [
        ({"licensedStates": []}, 400),
        ({"licensedStates": ["XX"]}, 422),
        ({"approvalDays": 14}, 422),
        ({"approvalDays": 366}, 422),
    ],
)
async def test_invalid_settings(client, change, code):
    await as_user(client, ADMIN)
    assert (await client.patch("/api/workspace", json=change)).status_code == code
