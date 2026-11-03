"""Shared test helpers: the seeded demo accounts, and sign-in as one of them."""

from datetime import UTC, date, datetime
from zoneinfo import ZoneInfo

from app.seed import DEMO_PASSWORD

ADMIN = "maya.ruiz@demo.clearpathcu.org"
MANAGER = "alex.chen@demo.clearpathcu.org"
REVIEWER = "jordan.kim@demo.clearpathcu.org"
SUBMITTER = "priya.shah@demo.clearpathcu.org"
AFFILIATE = "erin.walsh@lendwise.example"

# The demo workspace's time zone (seed/data/workspace.json): its days are the business dates (app.clock).
DEMO_ZONE = ZoneInfo("America/Los_Angeles")


def demo_today() -> date:
    """Today in the demo workspace's time zone: the day the server counts expiry and due days by."""
    return datetime.now(UTC).astimezone(DEMO_ZONE).date()


async def as_user(client, email):
    res = await client.post("/api/auth/sign-in", json={"email": email, "password": DEMO_PASSWORD})
    assert res.status_code == 200, res.text
    return res.json()


# A valid submission's content for each channel: its own field labels (app/channels.py), with the same savings text,
# so a test that only changes the channel gets the same code check results.
EXAMPLE_FIELDS = {
    "meta": [{"label": "Primary text", "text": "Rates from 4.00% APY."}, {"label": "Headline", "text": "Save more this winter"}],
    "google": [{"label": "Headline 1", "text": "Save more this winter"}, {"label": "Description", "text": "Rates from 4.00% APY."}],
    "mailchimp": [{"label": "Subject line", "text": "Save more this winter"}, {"label": "Body", "text": "Rates from 4.00% APY."}],
    "wordpress": [{"label": "Page title", "text": "Save more this winter"}, {"label": "Body", "text": "Rates from 4.00% APY."}],
    "affiliate": [{"label": "Page text", "text": "Rates from 4.00% APY."}],
    "other": [{"label": "Body", "text": "Rates from 4.00% APY."}],
}


def with_channel_fields(body: dict, change: dict) -> dict:
    """`body | change`; a change of channel without fields also takes that channel's example fields."""
    if change.get("channel") in EXAMPLE_FIELDS and "fields" not in change:
        change = {**change, "fields": EXAMPLE_FIELDS[change["channel"]]}
    return body | change
