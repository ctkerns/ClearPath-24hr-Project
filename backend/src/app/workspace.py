"""Workspace settings (PRD section 10 "Workspace" tab): licensed states (F7) and approval expiry (F15).

Every signed-in user reads them, because the submit form, routing and decisions use them.
Only an Admin changes them.
"""

from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import Field, field_validator
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import Admin, APIModel, SignedIn, bad_request
from app.db import get_db
from app.models import Workspace

router = APIRouter(prefix="/api/workspace", tags=["workspace"])

# The 50 states and DC. Saved lists keep this order, the same order as the picker in the frontend.
US_STATES = (
    "AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC "
    "ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY"
).split()


class WorkspaceOut(APIModel):
    name: str
    is_demo: bool
    licensed_states: list[str]
    approval_days: int


class WorkspaceChange(APIModel):
    licensed_states: list[str] | None = None
    approval_days: int | None = Field(default=None, ge=15, le=365)

    @field_validator("licensed_states")
    @classmethod
    def known_states(cls, states: list[str] | None) -> list[str] | None:
        if states is None:
            return None
        unknown = sorted(set(states) - set(US_STATES))
        if unknown:
            raise ValueError(f"Unknown states: {', '.join(unknown)}")
        return [s for s in US_STATES if s in states]


@router.get("")
async def get_workspace(viewer: SignedIn) -> WorkspaceOut:
    return WorkspaceOut.model_validate(viewer.workspace)


@router.patch("")
async def change_workspace(
    change: WorkspaceChange, viewer: Admin, db: Annotated[AsyncSession, Depends(get_db)]
) -> WorkspaceOut:
    workspace: Workspace = viewer.workspace
    if change.licensed_states is not None:
        if not change.licensed_states:
            raise bad_request("Choose at least one licensed state")
        workspace.licensed_states = change.licensed_states
    if change.approval_days is not None:
        workspace.approval_days = change.approval_days
    await db.commit()
    return WorkspaceOut.model_validate(workspace)
