"""Limits on failed sign-ins, per email and per client IP (PRD F1)."""

from datetime import timedelta

from httpx import ASGITransport, AsyncClient
from sqlalchemy import select, update

from app.config import settings
from app.db import SessionLocal
from app.main import app
from app.models.auth import SignInAttempt
from app.seed import DEMO_PASSWORD
from tests.helpers import ADMIN, REVIEWER

LIMIT_MESSAGE = {"detail": "Too many failed sign-ins. Try again later."}


def client_from(ip: str) -> AsyncClient:
    return AsyncClient(transport=ASGITransport(app=app, client=(ip, 1234)), base_url="http://testserver")


async def sign_in(client, email, password="wrong"):
    return await client.post("/api/auth/sign-in", json={"email": email, "password": password})


async def pass_the_window():
    """Time control: makes every failure older than the window, as if 15 minutes went by."""
    async with SessionLocal() as db, db.begin():
        await db.execute(
            update(SignInAttempt).values(created_at=SignInAttempt.created_at - settings.sign_in_window - timedelta(seconds=1))
        )


async def test_email_limit_blocks_even_the_right_password_until_the_window_passes():
    # Each try from a different IP, so only the email limit applies.
    for i in range(settings.sign_in_max_failures_per_email):
        async with client_from(f"10.0.0.{i}") as c:
            assert (await sign_in(c, ADMIN.upper())).status_code == 401

    async with client_from("10.0.1.1") as c:
        blocked = await sign_in(c, ADMIN, DEMO_PASSWORD)
        assert blocked.status_code == 429
        assert blocked.json() == LIMIT_MESSAGE
        assert "set-cookie" not in blocked.headers
        # Other emails still work from there.
        assert (await sign_in(c, REVIEWER, DEMO_PASSWORD)).status_code == 200

        await pass_the_window()
        assert (await sign_in(c, ADMIN, DEMO_PASSWORD)).status_code == 200


async def test_unknown_email_is_limited_the_same_way():
    async with client_from("10.0.2.1") as c:
        for _ in range(settings.sign_in_max_failures_per_email):
            assert (await sign_in(c, "nobody@example.com")).status_code == 401
        assert (await sign_in(c, "nobody@example.com")).status_code == 429


async def test_ip_limit_blocks_every_email_from_that_ip():
    async with client_from("10.0.3.1") as c:
        for i in range(settings.sign_in_max_failures_per_ip):
            assert (await sign_in(c, f"guess{i}@example.com")).status_code == 401
        assert (await sign_in(c, ADMIN, DEMO_PASSWORD)).json() == LIMIT_MESSAGE

    async with client_from("10.0.3.2") as other:
        assert (await sign_in(other, ADMIN, DEMO_PASSWORD)).status_code == 200

    async with client_from("10.0.3.1") as c:
        await pass_the_window()
        assert (await sign_in(c, ADMIN, DEMO_PASSWORD)).status_code == 200


async def test_blocked_tries_do_not_extend_the_window():
    async with client_from("10.0.4.1") as c:
        for _ in range(settings.sign_in_max_failures_per_email):
            await sign_in(c, ADMIN)
        for _ in range(3):
            assert (await sign_in(c, ADMIN)).status_code == 429
    async with SessionLocal() as db:
        rows = list(await db.scalars(select(SignInAttempt)))
    assert len(rows) == settings.sign_in_max_failures_per_email
    assert {r.email for r in rows} == {ADMIN}  # lower case; the password is not stored anywhere


async def test_success_clears_the_email_failures_and_old_rows_go():
    async with client_from("10.0.5.1") as c:
        for _ in range(settings.sign_in_max_failures_per_email - 1):
            await sign_in(c, ADMIN)
        assert (await sign_in(c, ADMIN, DEMO_PASSWORD)).status_code == 200
        await sign_in(c, REVIEWER)
        await pass_the_window()
        await sign_in(c, REVIEWER)  # a new failure deletes rows older than the window
    async with SessionLocal() as db:
        rows = list(await db.scalars(select(SignInAttempt)))
    assert [r.email for r in rows] == [REVIEWER]
