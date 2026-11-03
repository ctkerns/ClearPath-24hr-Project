"""Workspace settings (PRD section 10 "Workspace" tab): licensed states (F7) and approval expiry (F15),
and the default time to fix an issue by severity (F12).

Every signed-in user reads them, because the submit form, routing, decisions and new issues use them.
Only an Admin changes the Workspace tab. The issue due days are policy, so a Manager changes them too (PRD section 4),
in the Settings "Issues" tab, through their own endpoint.
"""

from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import Field, field_validator
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import Admin, APIModel, Manager, SignedIn, bad_request
from app.audit import changes, record
from app.db import get_db
from app.models import Workspace
from app.models.materials import Severity

router = APIRouter(prefix="/api/workspace", tags=["workspace"])

# The 50 states and DC. Saved lists keep this order, the same order as the picker in the frontend.
US_STATES = (
    "AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC "
    "ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY"
).split()


# The bounds of each issue due day setting: at least one day, at most a quarter
ISSUE_DUE_DAYS_MAX = 90


class IssueDueDays(APIModel):
    """Default days from opening an issue to its due date, by severity (PRD F12)."""

    high: int
    medium: int
    low: int

    @classmethod
    def of(cls, w: Workspace) -> IssueDueDays:
        return cls(high=w.issue_due_days_high, medium=w.issue_due_days_medium, low=w.issue_due_days_low)


def issue_due_days(w: Workspace, severity: Severity) -> int:
    """The default days to fix a new issue of this severity, for an issue that gets no due date."""
    return getattr(w, f"issue_due_days_{severity.value}")


class WorkspaceOut(APIModel):
    name: str
    is_demo: bool
    licensed_states: list[str]
    approval_days: int
    issue_due_days: IssueDueDays

    @classmethod
    def of(cls, w: Workspace) -> WorkspaceOut:
        return cls(
            name=w.name,
            is_demo=w.is_demo,
            licensed_states=w.licensed_states,
            approval_days=w.approval_days,
            issue_due_days=IssueDueDays.of(w),
        )


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
    return WorkspaceOut.of(viewer.workspace)


@router.patch("")
async def change_workspace(
    change: WorkspaceChange, viewer: Admin, db: Annotated[AsyncSession, Depends(get_db)]
) -> WorkspaceOut:
    workspace: Workspace = viewer.workspace
    before = {"licensedStates": list(workspace.licensed_states), "approvalDays": workspace.approval_days}
    if change.licensed_states is not None:
        if not change.licensed_states:
            raise bad_request("Choose at least one licensed state")
        workspace.licensed_states = change.licensed_states
    if change.approval_days is not None:
        workspace.approval_days = change.approval_days
    after = {"licensedStates": list(workspace.licensed_states), "approvalDays": workspace.approval_days}
    if diff := changes(before, after):
        record(db, viewer, "workspace", workspace.id, "updated", diff)
    await db.commit()
    return WorkspaceOut.of(workspace)


class IssueDueDaysChange(APIModel):
    high: int | None = Field(default=None, ge=1, le=ISSUE_DUE_DAYS_MAX)
    medium: int | None = Field(default=None, ge=1, le=ISSUE_DUE_DAYS_MAX)
    low: int | None = Field(default=None, ge=1, le=ISSUE_DUE_DAYS_MAX)


@router.patch("/issue-due-days")
async def change_issue_due_days(
    change: IssueDueDaysChange, viewer: Manager, db: Annotated[AsyncSession, Depends(get_db)]
) -> WorkspaceOut:
    """Managers and Admins (PRD section 4: Managers own policy). Only new issues use the new values."""
    workspace: Workspace = viewer.workspace
    before = IssueDueDays.of(workspace).model_dump()
    for severity in Severity:
        if (days := getattr(change, severity.value)) is not None:
            setattr(workspace, f"issue_due_days_{severity.value}", days)
    after = IssueDueDays.of(workspace).model_dump()
    if before != after:
        record(db, viewer, "workspace", workspace.id, "updated", changes({"issueDueDays": before}, {"issueDueDays": after}))
    await db.commit()
    return WorkspaceOut.of(workspace)
