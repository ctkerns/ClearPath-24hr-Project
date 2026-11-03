"""Shared test helpers: the seeded demo accounts, and sign-in as one of them."""

from app.seed import DEMO_PASSWORD

ADMIN = "maya.ruiz@demo.clearpathcu.org"
MANAGER = "alex.chen@demo.clearpathcu.org"
REVIEWER = "jordan.kim@demo.clearpathcu.org"
SUBMITTER = "priya.shah@demo.clearpathcu.org"
AFFILIATE = "erin.walsh@lendwise.example"


async def as_user(client, email):
    res = await client.post("/api/auth/sign-in", json={"email": email, "password": DEMO_PASSWORD})
    assert res.status_code == 200, res.text
    return res.json()
