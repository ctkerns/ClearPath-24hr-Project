from contextlib import asynccontextmanager
from typing import Annotated

from fastapi import Depends, FastAPI
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import engine, get_db


@asynccontextmanager
async def lifespan(_: FastAPI):
    yield
    await engine.dispose()  # Close database connections when the server stops.


# All routes are under /api, so Caddy can send /api/* here and everything else to the frontend.
app = FastAPI(
    title="ClearPath API",
    lifespan=lifespan,
    docs_url="/api/docs",
    openapi_url="/api/openapi.json",
)


class Health(BaseModel):
    status: str
    database: str


@app.get("/api/health")
async def health(db: Annotated[AsyncSession, Depends(get_db)]) -> Health:
    """Returns ok when the API runs and can query Postgres."""
    await db.execute(text("SELECT 1"))
    return Health(status="ok", database="ok")
