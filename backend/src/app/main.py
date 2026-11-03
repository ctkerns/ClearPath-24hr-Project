from contextlib import asynccontextmanager
from typing import Annotated
from urllib.parse import urlsplit

from fastapi import Depends, FastAPI, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app import audit_log, auth, groups, integrations, invites, library, materials, routing, search, users, workspace
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

UNSAFE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}


@app.middleware("http")
async def same_origin_only(request: Request, call_next):
    """CSRF protection in addition to SameSite cookies: a request that changes data must come from
    a page on this same host. Browsers always send the Origin header with these requests."""
    origin = request.headers.get("origin")
    if request.method in UNSAFE_METHODS and origin and urlsplit(origin).netloc != request.headers.get("host"):
        return JSONResponse({"detail": "Cross-origin request blocked"}, status_code=403)
    return await call_next(request)


# One router per area, one per line. A new area adds its module here.
ROUTERS = [
    auth.router,
    invites.router,
    users.router,
    groups.router,
    workspace.router,
    library.router,
    routing.router,
    integrations.router,
    materials.router,
    audit_log.router,
    search.router,
]
for router in ROUTERS:
    app.include_router(router)


class Health(BaseModel):
    status: str
    database: str


@app.get("/api/health")
async def health(db: Annotated[AsyncSession, Depends(get_db)]) -> Health:
    """Returns ok when the API runs and can query Postgres."""
    await db.execute(text("SELECT 1"))
    return Health(status="ok", database="ok")
