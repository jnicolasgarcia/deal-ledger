"""Create the demo users and set their roles. Safe to run again.

- admin@demo.dealledger.test  -> admin
- editor@demo.dealledger.test -> editor
- viewer@demo.dealledger.test -> viewer
- norole@demo.dealledger.test -> no role (tests the no-access path, 005)

Uses the secret key (admin API) and DEMO_USER_PASSWORD from ../.env.local.
An existing user gets its password reset to DEMO_USER_PASSWORD, its email
confirmed and its role set, so every run ends in the same state.

Usage: python scripts/create_demo_users.py
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

from dotenv import load_dotenv
from supabase import create_client

ENV_FILE = Path(__file__).resolve().parent.parent / ".env.local"
DEMO_USERS = [
    ("admin@demo.dealledger.test", "admin", "Demo Admin"),
    ("editor@demo.dealledger.test", "editor", "Demo Editor"),
    ("viewer@demo.dealledger.test", "viewer", "Demo Viewer"),
    ("norole@demo.dealledger.test", None, "Demo No Role"),
]


def main() -> int:
    load_dotenv(ENV_FILE)
    env = {n: os.environ.get(n) for n in ("NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SECRET_KEY", "DEMO_USER_PASSWORD")}
    missing = [n for n, v in env.items() if not v]
    if missing:
        print(f"Missing in {ENV_FILE}: {', '.join(missing)}", file=sys.stderr)
        return 2
    client = create_client(env["NEXT_PUBLIC_SUPABASE_URL"], env["SUPABASE_SECRET_KEY"])
    password = env["DEMO_USER_PASSWORD"]

    existing = {}
    page = 1
    while True:  # list_users is paginated
        users = client.auth.admin.list_users(page=page, per_page=200)
        existing.update({u.email.lower(): u for u in users if u.email})
        if len(users) < 200:
            break
        page += 1

    failed = False
    print(f"{'email':<30} {'action':<9} {'role':<7} result")
    for email, role, name in DEMO_USERS:
        try:
            attrs = {"password": password, "email_confirm": True, "user_metadata": {"full_name": name}}
            user = existing.get(email)
            if user is None:
                user = client.auth.admin.create_user({"email": email, **attrs}).user
                action = "created"
            else:
                client.auth.admin.update_user_by_id(user.id, attrs)
                action = "updated"
            # The signup trigger creates the profile; upsert covers users from before 002.
            client.table("profiles").upsert(
                {"user_id": user.id, "email": email, "full_name": name, "role": role},
                on_conflict="user_id",
            ).execute()
            got = client.table("profiles").select("role").eq("user_id", user.id).single().execute().data
            ok = got and got["role"] == role
            failed |= not ok
            print(f"{email:<30} {action:<9} {role or 'none':<7} {'ok' if ok else 'ROLE NOT SET: ' + str(got)}")
        except Exception as exc:
            failed = True
            print(f"{email:<30} {'error':<9} {role or 'none':<7} {exc}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
