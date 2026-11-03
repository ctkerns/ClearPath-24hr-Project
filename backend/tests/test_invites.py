"""Invite emails and accepting an invite (PRD F16)."""

import re
from datetime import timedelta

import pytest
from sqlalchemy import func, select, update

from app import mail
from app.auth import COOKIE_NAME
from app.db import SessionLocal
from app.models import User
from app.models.auth import InviteToken
from tests.helpers import ADMIN, as_user

NEW = "new.person@demo.clearpathcu.org"
PASSWORD = "a long new password"


@pytest.fixture
def outbox(monkeypatch):
    """The emails the app sent in this test, in place of the console backend."""
    sent: list[dict] = []
    monkeypatch.setattr(mail, "send", lambda to, subject, text: sent.append({"to": to, "subject": subject, "text": text}))
    return sent


def token_in(message: dict) -> str:
    match = re.search(r"http://localhost:8080/accept-invite\?token=([A-Za-z0-9_-]+)", message["text"])
    assert match, message["text"]
    return match.group(1)


async def invite(client, outbox, email=NEW) -> tuple[dict, str]:
    """Maya invites someone, then signs out. Returns the new user and the token from the email."""
    await as_user(client, ADMIN)
    res = await client.post("/api/users/invites", json={"emails": [email], "role": "reviewer", "groups": ["Legal"]})
    assert res.status_code == 201, res.text
    assert outbox[-1]["to"] == email
    client.cookies.clear()
    return res.json()[0], token_in(outbox[-1])


async def test_invite_accept_and_sign_in(client, outbox):
    added, token = await invite(client, outbox)
    assert "Maya Ruiz" in outbox[0]["subject"]
    assert "ClearPath demo" in outbox[0]["text"]

    info = await client.get(f"/api/auth/invite/{token}")
    assert info.status_code == 200
    assert info.json() == {"name": "New Person", "email": NEW, "workspaceName": "ClearPath demo"}

    res = await client.post("/api/auth/accept-invite", json={"token": token, "password": PASSWORD, "name": " Nia Person "})
    assert res.status_code == 200, res.text
    assert (res.json()["email"], res.json()["name"], res.json()["groups"]) == (NEW, "Nia Person", ["Legal"])
    assert "HttpOnly" in res.headers["set-cookie"]

    # Signed in at once, and active.
    me = await client.get("/api/auth/me")
    assert me.status_code == 200 and me.json()["id"] == added["id"]
    async with SessionLocal() as db:
        user = await db.scalar(select(User).where(User.email == NEW))
        assert user.status == "active" and user.password_hash.startswith("$argon2id$")
        assert await db.scalar(select(func.count()).select_from(InviteToken)) == 0

    # The new password works for a normal sign-in, and the used link is dead.
    client.cookies.clear()
    assert (await client.post("/api/auth/sign-in", json={"email": NEW, "password": PASSWORD})).status_code == 200
    assert (await client.get(f"/api/auth/invite/{token}")).status_code == 404
    again = await client.post("/api/auth/accept-invite", json={"token": token, "password": PASSWORD})
    assert again.status_code == 404


async def test_empty_name_keeps_the_invite_name(client, outbox):
    _, token = await invite(client, outbox)
    res = await client.post("/api/auth/accept-invite", json={"token": token, "password": PASSWORD, "name": "  "})
    assert res.json()["name"] == "New Person"


async def test_short_password_is_422(client, outbox):
    _, token = await invite(client, outbox)
    res = await client.post("/api/auth/accept-invite", json={"token": token, "password": "short"})
    assert res.status_code == 422
    assert (await client.get(f"/api/auth/invite/{token}")).status_code == 200  # the link still works


async def test_unknown_token_is_404(client):
    assert (await client.get("/api/auth/invite/made-up")).status_code == 404
    res = await client.post("/api/auth/accept-invite", json={"token": "made-up", "password": PASSWORD})
    assert res.status_code == 404
    assert res.json() == {"detail": "Invite not found"}


async def test_expired_token_is_410(client, outbox):
    _, token = await invite(client, outbox)
    async with SessionLocal() as db, db.begin():
        await db.execute(update(InviteToken).values(expires_at=func.now() - timedelta(seconds=1)))
    assert (await client.get(f"/api/auth/invite/{token}")).status_code == 410
    res = await client.post("/api/auth/accept-invite", json={"token": token, "password": PASSWORD})
    assert res.status_code == 410
    assert res.json() == {"detail": "Invite expired"}
    assert COOKIE_NAME not in client.cookies


async def test_resend_replaces_the_link(client, outbox):
    added, old = await invite(client, outbox)
    await as_user(client, ADMIN)
    res = await client.post(f"/api/users/{added['id']}/resend-invite")
    assert res.status_code == 200
    new = token_in(outbox[-1])
    assert new != old and len(outbox) == 2
    client.cookies.clear()

    assert (await client.get(f"/api/auth/invite/{old}")).status_code == 404
    assert (await client.get(f"/api/auth/invite/{new}")).status_code == 200


async def test_cancelled_invite_link_is_dead(client, outbox):
    added, token = await invite(client, outbox)
    await as_user(client, ADMIN)
    assert (await client.delete(f"/api/users/{added['id']}")).status_code == 204
    client.cookies.clear()
    assert (await client.get(f"/api/auth/invite/{token}")).status_code == 404
    async with SessionLocal() as db:
        assert await db.scalar(select(func.count()).select_from(InviteToken)) == 0


async def test_token_is_never_in_a_response(client, outbox):
    await as_user(client, ADMIN)
    created = await client.post("/api/users/invites", json={"emails": [NEW, "other@demo.clearpathcu.org"], "role": "viewer"})
    tokens = [token_in(m) for m in outbox]
    assert len(tokens) == 2
    resent = await client.post(f"/api/users/{created.json()[0]['id']}/resend-invite")
    tokens.append(token_in(outbox[-1]))
    listed = await client.get("/api/users")
    client.cookies.clear()
    info = await client.get(f"/api/auth/invite/{tokens[1]}")
    for res in (created, resent, listed, info):
        assert res.status_code in (200, 201)
        assert not any(t in res.text for t in tokens)

    # The database has only the hashes.
    async with SessionLocal() as db:
        hashes = list(await db.scalars(select(InviteToken.token_hash)))
    assert len(hashes) == 2 and all(len(h) == 32 for h in hashes)
