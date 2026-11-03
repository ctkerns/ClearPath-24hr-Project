from sqlalchemy import func, select, update

from app.auth import COOKIE_NAME
from app.db import SessionLocal
from app.models import Session, User, UserStatus
from app.seed import DEMO_PASSWORD

ADMIN = "maya.ruiz@demo.clearpathcu.org"
INVITED = "nina.patel@demo.clearpathcu.org"
DEACTIVATED = "chris.doyle@demo.clearpathcu.org"


async def sign_in(client, email=ADMIN, password=DEMO_PASSWORD):
    return await client.post("/api/auth/sign-in", json={"email": email, "password": password})


async def test_sign_in_sets_secure_cookie_and_me_returns_user(client):
    res = await sign_in(client)
    assert res.status_code == 200
    assert res.json()["email"] == ADMIN
    assert res.json()["role"] == "admin"
    assert res.json()["is_demo"] is True

    cookie = res.headers["set-cookie"]
    assert "HttpOnly" in cookie
    assert "SameSite=lax" in cookie
    assert "Path=/api" in cookie

    me = await client.get("/api/auth/me")
    assert me.status_code == 200
    assert me.json()["email"] == ADMIN


async def test_database_stores_only_the_token_hash(client):
    await sign_in(client)
    token = client.cookies[COOKIE_NAME]
    async with SessionLocal() as db:
        stored = await db.scalar(select(Session.token_hash))
    assert stored is not None and len(stored) == 32
    assert token.encode() != stored


async def test_email_is_not_case_sensitive(client):
    res = await sign_in(client, email="  Maya.Ruiz@DEMO.clearpathcu.org ")
    assert res.status_code == 200


async def test_every_failure_returns_the_same_error(client):
    wrong_password = await sign_in(client, password="wrong")
    unknown_email = await sign_in(client, email="nobody@example.com")
    invited = await sign_in(client, email=INVITED)
    deactivated = await sign_in(client, email=DEACTIVATED)
    for res in (wrong_password, unknown_email, invited, deactivated):
        assert res.status_code == 401
        assert res.json() == {"detail": "Invalid email or password"}
        assert "set-cookie" not in res.headers


async def test_me_without_session_is_401(client):
    assert (await client.get("/api/auth/me")).status_code == 401
    client.cookies.set(COOKIE_NAME, "made-up-token")
    assert (await client.get("/api/auth/me")).status_code == 401


async def test_sign_out_ends_the_session_on_the_server(client):
    await sign_in(client)
    token = client.cookies[COOKIE_NAME]

    res = await client.post("/api/auth/sign-out")
    assert res.status_code == 204

    # Even a copy of the old token no longer works.
    client.cookies.set(COOKIE_NAME, token)
    assert (await client.get("/api/auth/me")).status_code == 401


async def test_expired_session_is_rejected(client):
    await sign_in(client)
    async with SessionLocal() as db, db.begin():
        await db.execute(update(Session).values(expires_at=func.now()))
    assert (await client.get("/api/auth/me")).status_code == 401


async def test_deactivated_user_loses_access_at_once(client):
    await sign_in(client)
    async with SessionLocal() as db, db.begin():
        await db.execute(update(User).where(User.email == ADMIN).values(status=UserStatus.DEACTIVATED))
    assert (await client.get("/api/auth/me")).status_code == 401


async def test_cross_origin_post_is_blocked(client):
    res = await client.post(
        "/api/auth/sign-in",
        json={"email": ADMIN, "password": DEMO_PASSWORD},
        headers={"Origin": "https://evil.example"},
    )
    assert res.status_code == 403


async def test_same_origin_post_is_allowed(client):
    res = await client.post(
        "/api/auth/sign-in",
        json={"email": ADMIN, "password": DEMO_PASSWORD},
        headers={"Origin": "http://testserver"},
    )
    assert res.status_code == 200
