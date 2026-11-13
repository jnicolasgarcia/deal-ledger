"""Seed 20 extra demo users and a few days of demo activity. Safe to run again.

Users (clearly fake names, @demo.dealledger.test): 1 admin, 7 editors,
12 viewers. They only populate the users table and the feed: each gets a
random password that is never printed or stored, so nobody can sign in as
them (every run sets a new one). With the 4 from create_demo_users.py that
makes 24 users with a role plus the no-role user.

Activity: the last 5 days (business hours, America/New_York) for these 20
users only: sign-ins, page views of deals, weekly and admin, deal edits on
real deals, and two role changes consistent with the current roles. Every
row has is_demo = true, and the admin feed labels it "Demo". Demo edits are
log rows only: no deal and no deal_events row is changed. Each user's
last_login_at is set to their latest seeded sign-in.

Each run deletes the previous demo activity (is_demo = true) and writes a
fresh set relative to now, so the times stay recent. Real activity is never
touched.

Uses the secret key (admin API) from ../.env.local. Run after migration 007.

Usage: python scripts/seed_demo_data.py
"""

from __future__ import annotations

import os
import random
import secrets
import sys
from datetime import datetime, time, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

from dotenv import load_dotenv
from supabase import create_client

ENV_FILE = Path(__file__).resolve().parent.parent / ".env.local"
DOMAIN = "demo.dealledger.test"
TZ = ZoneInfo("America/New_York")
DAYS = 5
SEED = 7

# (full name, role). Names are deliberately placeholder-like.
SEED_USERS: list[tuple[str, str]] = [
    ("Avery Example", "admin"),
    ("Blake Sample", "editor"),
    ("Casey Placeholder", "editor"),
    ("Drew Testcase", "editor"),
    ("Emery Mockwell", "editor"),
    ("Finley Dummy", "editor"),
    ("Gray Fixture", "editor"),
    ("Harper Stub", "editor"),
    ("Indy Demo", "viewer"),
    ("Jordan Lorem", "viewer"),
    ("Kai Ipsum", "viewer"),
    ("Logan Sandbox", "viewer"),
    ("Morgan Prototype", "viewer"),
    ("Noel Specimen", "viewer"),
    ("Oakley Trial", "viewer"),
    ("Parker Mockup", "viewer"),
    ("Quinn Sampleton", "viewer"),
    ("Reese Example", "viewer"),
    ("Sage Placeholder", "viewer"),
    ("Taylor Testwell", "viewer"),
]

# Fields editors change, weighted toward what the team edits most.
EDIT_FIELDS = ["notes_raw"] * 5 + ["stage"] * 3 + ["list_price", "bldg_sf", "lot_sf", "list_price_per_sf", "address", "city"]


def email_for(name: str) -> str:
    return f"{name.lower().replace(' ', '.')}@{DOMAIN}"


def build_activity(
    users: list[dict], deal_ids: list[str], now: datetime, seed: int = SEED, days: int = DAYS
) -> list[dict]:
    """Demo activity rows for `users` ({id, role}), oldest first, none after `now`.

    Pure and deterministic for a given seed and now, so it can be tested.
    """
    rng = random.Random(seed)
    now_local = now.astimezone(TZ)
    rows: list[dict] = []

    def add(user_id: str, at: datetime, action: str, **extra) -> None:
        if at <= now:
            rows.append({"user_id": user_id, "action": action, "page": None, "deal_id": None,
                         "target_user_id": None, "detail": {}, "is_demo": True,
                         "created_at": at.astimezone(ZoneInfo("UTC")).isoformat(), **extra})

    for back in range(days - 1, -1, -1):
        day = (now_local - timedelta(days=back)).date()
        weekend = day.weekday() >= 5
        for u in users:
            chance = {"admin": 0.9, "editor": 0.85, "viewer": 0.55}[u["role"]]
            if weekend:
                chance *= 0.15
            if rng.random() >= chance:
                continue
            start = datetime.combine(day, time(8, 0), TZ) + timedelta(minutes=rng.randint(0, 9 * 60))
            t = start
            add(u["id"], t, "sign_in")

            def later(lo: int, hi: int) -> datetime:
                nonlocal t
                t = t + timedelta(minutes=rng.randint(lo, hi), seconds=rng.randint(0, 59))
                return t

            if u["role"] == "viewer":
                add(u["id"], later(0, 2), "page_view", page="weekly")
                if rng.random() < 0.05:  # followed an old link to the grid
                    add(u["id"], later(1, 10), "page_view", page="deals", detail={"denied": True})
                continue

            add(u["id"], later(0, 2), "page_view", page="deals")
            for _ in range(rng.choice([0, 1, 1, 2, 2, 3, 4]) if u["role"] == "editor" else rng.choice([0, 0, 1])):
                fields = sorted({rng.choice(EDIT_FIELDS) for _ in range(rng.choice([1, 1, 1, 2]))})
                add(u["id"], later(2, 40), "deal_edit", deal_id=rng.choice(deal_ids), detail={"fields": fields})
            if rng.random() < 0.4:
                add(u["id"], later(5, 90), "page_view", page="weekly")
            if u["role"] == "admin":
                add(u["id"], later(1, 30), "page_view", page="admin")

    # Two role changes by the seeded admin, early in the window, that match the
    # current roles: an editor promoted from viewer, a viewer given access.
    admin = next((u for u in users if u["role"] == "admin"), None)
    editor = next((u for u in users if u["role"] == "editor"), None)
    viewer = next((u for u in reversed(users) if u["role"] == "viewer"), None)
    if admin and editor and viewer:
        first = datetime.combine((now_local - timedelta(days=days - 1)).date(), time(9, 12), TZ)
        add(admin["id"], first, "role_change", target_user_id=viewer["id"], detail={"from": None, "to": "viewer"})
        add(admin["id"], first + timedelta(minutes=3), "role_change", target_user_id=editor["id"],
            detail={"from": "viewer", "to": "editor"})

    rows.sort(key=lambda r: r["created_at"])
    return rows


def last_sign_ins(rows: list[dict]) -> dict[str, str]:
    latest: dict[str, str] = {}
    for r in rows:
        if r["action"] == "sign_in" and r["created_at"] > latest.get(r["user_id"], ""):
            latest[r["user_id"]] = r["created_at"]
    return latest


def main() -> int:
    load_dotenv(ENV_FILE)
    env = {n: os.environ.get(n) for n in ("NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SECRET_KEY")}
    missing = [n for n, v in env.items() if not v]
    if missing:
        print(f"Missing in {ENV_FILE}: {', '.join(missing)}", file=sys.stderr)
        return 2
    client = create_client(env["NEXT_PUBLIC_SUPABASE_URL"], env["SUPABASE_SECRET_KEY"])

    existing = {}
    page = 1
    while True:  # list_users is paginated
        batch = client.auth.admin.list_users(page=page, per_page=200)
        existing.update({u.email.lower(): u for u in batch if u.email})
        if len(batch) < 200:
            break
        page += 1

    failed = False
    users: list[dict] = []
    print(f"{'email':<38} {'action':<9} {'role':<7} result")
    for name, role in SEED_USERS:
        email = email_for(name)
        try:
            # Random, never printed or stored: nobody can sign in as a seeded user.
            attrs = {"password": secrets.token_urlsafe(32), "email_confirm": True, "user_metadata": {"full_name": name}}
            user = existing.get(email)
            if user is None:
                user = client.auth.admin.create_user({"email": email, **attrs}).user
                action = "created"
            else:
                client.auth.admin.update_user_by_id(user.id, attrs)
                action = "updated"
            client.table("profiles").upsert(
                {"user_id": user.id, "email": email, "full_name": name, "role": role}, on_conflict="user_id"
            ).execute()
            users.append({"id": user.id, "role": role})
            print(f"{email:<38} {action:<9} {role:<7} ok")
        except Exception as exc:
            failed = True
            print(f"{email:<38} {'error':<9} {role:<7} {exc}")
    if failed:
        print("Some users failed; activity not seeded.", file=sys.stderr)
        return 1

    deal_ids = [d["id"] for d in client.table("deals").select("id").order("natural_key").execute().data]
    if not deal_ids:
        print("No deals found; run the ingest first.", file=sys.stderr)
        return 1

    rows = build_activity(users, deal_ids, datetime.now(TZ))
    client.table("activity_log").delete().eq("is_demo", True).execute()
    for i in range(0, len(rows), 500):
        client.table("activity_log").insert(rows[i:i + 500]).execute()

    latest = last_sign_ins(rows)
    for u in users:
        client.table("profiles").update({"last_login_at": latest.get(u["id"])}).eq("user_id", u["id"]).execute()

    counts: dict[str, int] = {}
    for r in rows:
        counts[r["action"]] = counts.get(r["action"], 0) + 1
    print(f"\nDemo activity: {len(rows)} rows over {DAYS} days "
          f"({', '.join(f'{k} {v}' for k, v in sorted(counts.items()))}). Previous demo rows replaced.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
