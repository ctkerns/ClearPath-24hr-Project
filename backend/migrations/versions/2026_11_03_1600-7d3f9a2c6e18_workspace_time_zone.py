"""workspace time zone

The IANA time zone of each workspace (Settings "Workspace" tab). Its days are the business dates: approval expiry,
effective dates, issue due days, and the regulator export range (app.clock). Existing workspaces get
America/Los_Angeles, the server default: nothing says where the company is.

Revision ID: 7d3f9a2c6e18
Revises: 5c1e2a7d9b40
Create Date: 2026-11-03 16:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '7d3f9a2c6e18'
down_revision: Union[str, Sequence[str], None] = '5c1e2a7d9b40'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        'workspaces',
        sa.Column('time_zone', sa.String(length=64), server_default=sa.text("'America/Los_Angeles'"), nullable=False),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('workspaces', 'time_zone')
