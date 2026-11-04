"""Check the authorization boundary (migration 002) through the public API.

Uses only the publishable key, signed out and as each demo user (run
create_demo_users.py first). Prints a pass/fail matrix against the expected
role table. Exit 1 if any check fails.

Leaves data unchanged: the allowed update_deal call writes a deal's current
notes back (a no-op: no write, no event, updated_by stays null), and the admin
role change sets the viewer's role to the value it already has. Non-admins
attempt a real escalation (viewer -> admin); if one ever succeeds, the
script restores the role and reports a failure.

Usage: python scripts/test_rls.py
"""

from __future__ import annotations

import os
import sys
from pathlib import Path
from typing import Callable

from dotenv import load_dotenv
from supabase import Client, create_client

ENV_FILE = Path(__file__).resolve().parent.parent / ".env.local"
EMAILS = {
    "admin": "admin@demo.dealledger.test",
    "editor": "editor@demo.dealledger.test",
    "viewer": "viewer@demo.dealledger.test",
}
ACTORS = ["signed out", "viewer", "editor", "admin"]

# True = the actor should be able to do it.
EXPECTED: dict[str, dict[str, bool]] = {
    "read deals":                  {"signed out": False, "viewer": False, "editor": True,  "admin": True},
    "read deal_events":            {"signed out": False, "viewer": False, "editor": True,  "admin": True},
    "call get_weekly_review":      {"signed out": False, "viewer": True,  "editor": True,  "admin": True},
    "direct update on deals":      {"signed out": False, "viewer": False, "editor": False, "admin": False},
    "update_deal, allowed field":  {"signed out": False, "viewer": False, "editor": True,  "admin": True},
    "update_deal, natural_key":    {"signed out": False, "viewer": False, "editor": False, "admin": False},
    "read own profile":            {"signed out": False, "viewer": True,  "editor": True,  "admin": True},
    "read another user's profile": {"signed out": False, "viewer": False, "editor": False, "admin": True},
    "change a role":               {"signed out": False, "viewer": False, "editor": False, "admin": True},
}


class Outcome:
    def __init__(self, allowed: bool | None, detail: str):
        self.allowed = allowed  # None = inconclusive
        self.detail = detail


def attempt(fn: Callable[[], object], rows_mean_allowed: bool = True) -> Outcome:
    """Run an API call. Error = denied. Otherwise allowed if it returned rows."""
    try:
        data = getattr(fn(), "data", None)
    except Exception as exc:
        msg = getattr(exc, "message", None) or str(exc)
        return Outcome(False, f"error: {msg}"[:90])
    if not rows_mean_allowed:
        return Outcome(True, "ok")
    n = len(data) if isinstance(data, list) else (1 if data else 0)
    return Outcome(n > 0, f"{n} row(s)")


def main() -> int:
    load_dotenv(ENV_FILE)
    url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    key = os.environ.get("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY")
    password = os.environ.get("DEMO_USER_PASSWORD")
    if not (url and key and password):
        print("Need NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and "
              f"DEMO_USER_PASSWORD in {ENV_FILE}", file=sys.stderr)
        return 2

    clients: dict[str, Client] = {"signed out": create_client(url, key)}
    user_ids: dict[str, str] = {}
    for role, email in EMAILS.items():
        c = create_client(url, key)
        try:
            res = c.auth.sign_in_with_password({"email": email, "password": password})
        except Exception as exc:
            print(f"Sign-in failed for {email}: {exc}. Run create_demo_users.py first.", file=sys.stderr)
            return 2
        clients[role] = c
        user_ids[role] = res.user.id

    # Setup through the API, as the roles allowed to read.
    deal = (clients["editor"].table("deals").select("id, notes_raw")
            .order("natural_key").limit(50).execute().data)
    deal = next((d for d in deal if d["notes_raw"] is None or d["notes_raw"] == d["notes_raw"].strip()), None)
    if deal is None:
        print("Setup failed: editor can't read a deal to test with.", file=sys.stderr)
        return 2
    events_exist = len(clients["editor"].table("deal_events").select("id").limit(1).execute().data) > 0

    def checks(actor: str) -> dict[str, Outcome]:
        c = clients[actor]
        own = user_ids.get(actor)
        other = user_ids["viewer"] if actor == "admin" else user_ids["admin"]
        new_role = "viewer" if actor == "admin" else "admin"  # admin: no-op; others: escalation
        out = {
            "read deals": attempt(lambda: c.table("deals").select("id").execute()),
            "read deal_events": attempt(lambda: c.table("deal_events").select("id").execute()),
            "call get_weekly_review": attempt(lambda: c.rpc("get_weekly_review").execute()),
            "direct update on deals": attempt(
                lambda: c.table("deals").update({"notes_raw": deal["notes_raw"]}).eq("id", deal["id"]).execute()),
            "update_deal, allowed field": attempt(
                lambda: c.rpc("update_deal", {"deal_id": deal["id"],
                                              "changes": {"notes_raw": deal["notes_raw"]}}).execute(),
                rows_mean_allowed=False),
            "update_deal, natural_key": attempt(
                lambda: c.rpc("update_deal", {"deal_id": deal["id"],
                                              "changes": {"natural_key": "rls-test"}}).execute(),
                rows_mean_allowed=False),
            "read own profile": (attempt(lambda: c.table("profiles").select("user_id").eq("user_id", own).execute())
                                 if own else attempt(lambda: c.table("profiles").select("user_id").execute())),
            "read another user's profile": attempt(
                lambda: c.table("profiles").select("user_id").eq("user_id", other).execute()),
            "change a role": attempt(
                lambda: c.table("profiles").update({"role": new_role}).eq("user_id", user_ids["viewer"]).execute()),
        }
        ev = out["read deal_events"]
        if not events_exist and ev.detail.startswith("0 row"):
            # Empty table: no error means the read was permitted, but 0 rows
            # can't tell "RLS hid them" from "there are none".
            ev.allowed = True if EXPECTED["read deal_events"][actor] else None
            ev.detail += " (table empty)"
        nk = out["update_deal, natural_key"]
        if actor in ("editor", "admin") and nk.allowed is False and "not editable" not in nk.detail:
            nk.detail += " (UNEXPECTED REASON)"
            nk.allowed = True  # rejected, but not by the allowlist: count as a failure
        return out

    results = {actor: checks(actor) for actor in ACTORS}

    # Safety net: the viewer must still be a viewer.
    role_now = (clients["admin"].table("profiles").select("role")
                .eq("user_id", user_ids["viewer"]).single().execute().data["role"])
    escalated = role_now != "viewer"
    if escalated:
        clients["admin"].table("profiles").update({"role": "viewer"}).eq("user_id", user_ids["viewer"]).execute()

    # Matrix
    width = 30
    print(f"\nTest deal: {deal['id']}   deal_events present: {events_exist}\n")
    print(f"{'check':<{width}}" + "".join(f"{a:<22}" for a in ACTORS))
    failures = []
    for check, exp in EXPECTED.items():
        line = f"{check:<{width}}"
        for actor in ACTORS:
            o = results[actor][check]
            want = exp[actor]
            if o.allowed is None:
                cell = "?   " + ("allow" if want else "deny")
            else:
                ok = o.allowed == want
                cell = ("PASS " if ok else "FAIL ") + ("allowed" if o.allowed else "denied")
                if not ok:
                    failures.append((check, actor, o.detail))
            line += f"{cell:<22}"
        print(line)

    print("\nDetails:")
    for check in EXPECTED:
        for actor in ACTORS:
            print(f"  {check:<{width}} {actor:<11} {results[actor][check].detail}")

    if escalated:
        failures.append(("change a role", "-", f"viewer role was {role_now!r}; restored to viewer"))
    if not events_exist:
        print("\nNote: deal_events is empty, so 0 rows for signed out/viewer can't tell RLS from no data "
              "('?'). supabase/checks/002_auth_check.sql covers it in a rolled-back transaction.")
    print(f"\n{'All checks passed.' if not failures else f'{len(failures)} failure(s):'}")
    for check, actor, detail in failures:
        print(f"  {check} / {actor}: {detail}")

    for role in EMAILS:
        clients[role].auth.sign_out()
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
