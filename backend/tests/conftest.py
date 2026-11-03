"""Test setup. Tests use a separate database, clearpath_test, on the same Postgres as `docker compose up`.

Run: `docker compose up -d postgres`, then `uv run pytest` in backend/.
"""

import os

# Must be set before any app module is imported, because app.config reads it at import time.
BASE_URL = os.environ.get("TEST_DATABASE_SERVER", "postgresql+psycopg://clearpath:clearpath@localhost:5432")
# Parallel worktrees each set their own name, so their tests do not empty each other's tables.
TEST_DB = os.environ.get("TEST_DATABASE_NAME", "clearpath_test")
os.environ["DATABASE_URL"] = f"{BASE_URL}/{TEST_DB}"
os.environ["COOKIE_SECURE"] = "false"  # the test client uses http://

from pathlib import Path  # noqa: E402

import psycopg  # noqa: E402
import pytest  # noqa: E402
from alembic import command  # noqa: E402
from alembic.config import Config  # noqa: E402
from httpx import ASGITransport, AsyncClient  # noqa: E402
from sqlalchemy import text  # noqa: E402

from app.db import SessionLocal, engine  # noqa: E402
from app.main import app  # noqa: E402
from app.models import Base  # noqa: E402
from app.seed import create_demo  # noqa: E402


@pytest.fixture(scope="session", autouse=True)
def database():
    """Creates the test database if it is missing, and applies every migration (tests the migrations too)."""
    with psycopg.connect(f"{BASE_URL.replace('+psycopg', '')}/clearpath", autocommit=True) as conn:
        if not conn.execute("SELECT 1 FROM pg_database WHERE datname = %s", (TEST_DB,)).fetchone():
            conn.execute(f'CREATE DATABASE "{TEST_DB}"')
    command.upgrade(Config(str(Path(__file__).parents[1] / "alembic.ini")), "head")


@pytest.fixture(autouse=True)
async def demo_data(database):
    """Each test starts with only the seeded demo workspace. Empties every table, so new areas need no change here."""
    tables = ", ".join(t.name for t in Base.metadata.sorted_tables)
    async with engine.begin() as conn:
        await conn.execute(text(f"TRUNCATE {tables} CASCADE"))
    async with SessionLocal() as db, db.begin():
        await create_demo(db)
    yield


@pytest.fixture
async def client():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as c:
        yield c


@pytest.fixture(scope="session", autouse=True)
async def close_engine():
    yield
    await engine.dispose()
