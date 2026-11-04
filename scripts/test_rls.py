"""Check the authorization boundary through the public API (publishable key only).

Part 1, database (always runs): signed out and as each demo user (run
create_demo_users.py first), against RLS, grants and the database functions
from migrations 002-006. Prints a pass/fail matrix against the expected role
table.

Part 2, app (with --app URL, e.g. --app http://localhost:3000): the app's own
entry points over HTTP, as a browser would call them: the /auth/signout route
and the deals server actions (saveDealField, getDealHistory). Needs a running
build of the app; action ids are read from .next/server/server-reference-manifest.json.

Leaves data unchanged: allowed edits are no-ops (a value written back as it
is: no write, no event), forbidden ones are refused before anything is
written, and write probes target an id that doesn't exist. Non-admins attempt
a real escalation (viewer -> admin); if one ever succeeds, the script restores
the role and reports a failure. Sign-out is local (this browser only), so the
sign-out check ends only the session it creates for that purpose.

Usage: python scripts/test_rls.py [--app http://localhost:3000]
Exit 1 if any check fails.
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import sys
from pathlib import Path
from typing import Any, Callable
from urllib.parse import urlparse

import httpx
from dotenv import load_dotenv
from supabase import Client, create_client

ROOT = Path(__file__).resolve().parent.parent
ENV_FILE = ROOT / ".env.local"
ACTION_MANIFEST = ROOT / ".next" / "server" / "server-reference-manifest.json"
EMAILS = {
    "admin": "admin@demo.dealledger.test",
    "editor": "editor@demo.dealledger.test",
    "viewer": "viewer@demo.dealledger.test",
    "no role": "norole@demo.dealledger.test",
}
ACTORS = ["signed out", "no role", "viewer", "editor", "admin"]
NO_SUCH_ID = "00000000-0000-0000-0000-000000000000"

# What get_weekly_review() may return (002, 004, 006) and nothing else.
WEEKLY_COLUMNS = {
    "id", "vertical", "market", "address", "city", "state", "stage", "list_price", "bldg_sf",
    "list_price_per_sf", "lot_sf", "notes", "assumption_fields", "days_in_stage", "previous_stage",
    "updated_at", "imported_at",
}

# True = the actor should be able to do it. None = not tested for that actor.
T, F, X = True, False, None
EXPECTED: dict[str, dict[str, bool | None]] = {
    # --- reads
    "read deals":                      {"signed out": F, "no role": F, "viewer": F, "editor": T, "admin": T},
    "read deal_events":                {"signed out": F, "no role": F, "viewer": F, "editor": T, "admin": T},
    "read contacts":                   {"signed out": F, "no role": F, "viewer": F, "editor": T, "admin": T},
    "call get_weekly_review":          {"signed out": F, "no role": F, "viewer": T, "editor": T, "admin": T},
    "weekly returns only weekly cols": {"signed out": F, "no role": F, "viewer": T, "editor": T, "admin": T},
    "read own profile":                {"signed out": F, "no role": T, "viewer": T, "editor": T, "admin": T},
    "read another user's profile":     {"signed out": F, "no role": F, "viewer": F, "editor": F, "admin": T},
    "call get_profile_names":          {"signed out": F, "no role": F, "viewer": F, "editor": T, "admin": T},
    "profile names: names only":       {"signed out": F, "no role": F, "viewer": F, "editor": T, "admin": T},
    # --- writes
    "direct update on deals":          {"signed out": F, "no role": F, "viewer": F, "editor": F, "admin": F},
    "direct insert/delete on deals":   {"signed out": F, "no role": F, "viewer": F, "editor": F, "admin": F},
    "direct insert on deal_events":    {"signed out": F, "no role": F, "viewer": F, "editor": F, "admin": F},
    "update_deal, allowed field":      {"signed out": F, "no role": F, "viewer": F, "editor": T, "admin": T},
    "update_deal, real stage change":  {"signed out": F, "no role": F, "viewer": F, "editor": X, "admin": X},
    "update_deal, natural_key":        {"signed out": F, "no role": F, "viewer": F, "editor": F, "admin": F},
    "update_deal, protected fields":   {"signed out": F, "no role": F, "viewer": F, "editor": F, "admin": F},
    "update_deal, bad values":         {"signed out": F, "no role": F, "viewer": F, "editor": F, "admin": F},
    "change a role":                   {"signed out": F, "no role": F, "viewer": F, "editor": F, "admin": T},
    "call internal functions":         {"signed out": F, "no role": F, "viewer": F, "editor": F, "admin": F},
}


class Outcome:
    def __init__(self, allowed: bool, detail: str):
        self.allowed = allowed
        self.detail = detail


def _error(exc: Exception) -> tuple[str, str]:
    return str(getattr(exc, "code", "") or ""), (getattr(exc, "message", None) or str(exc))


def attempt(fn: Callable[[], object], rows_mean_allowed: bool = True) -> Outcome:
    """Run an API call. Error = denied. Otherwise allowed if it returned rows."""
    try:
        data = getattr(fn(), "data", None)
    except Exception as exc:
        return Outcome(False, f"error: {_error(exc)[1]}"[:100])
    if not rows_mean_allowed:
        return Outcome(True, "ok")
    n = len(data) if isinstance(data, list) else (1 if data else 0)
    return Outcome(n > 0, f"{n} row(s)")


def attempt_denied(calls: list[tuple[str, Callable[[], object]]], codes: set[str]) -> Outcome:
    """Every call must fail with one of `codes`. Anything accepted, or refused for
    another reason, counts as allowed (so a constraint error can't pass as a
    permission check)."""
    seen = []
    for label, fn in calls:
        try:
            fn()
            return Outcome(True, f"{label}: ACCEPTED")
        except Exception as exc:
            code, msg = _error(exc)
            if code not in codes:
                return Outcome(True, f"{label}: unexpected {code} {msg}"[:100])
            seen.append(code)
    return Outcome(False, f"all refused ({', '.join(sorted(set(seen)))})")


# ---------------------------------------------------------------- part 1: database

def database_checks(url: str, key: str, password: str) -> tuple[list[tuple[str, str, str]], dict[str, Any]]:
    clients: dict[str, Client] = {"signed out": create_client(url, key)}
    user_ids: dict[str, str] = {}
    for role, email in EMAILS.items():
        c = create_client(url, key)
        res = c.auth.sign_in_with_password({"email": email, "password": password})
        clients[role] = c
        user_ids[role] = res.user.id

    deals = clients["editor"].table("deals").select("id, notes_raw, stage").order("natural_key").limit(50).execute().data
    deal = next(d for d in deals if d["notes_raw"] is None or d["notes_raw"] == d["notes_raw"].strip())
    events_exist = len(clients["editor"].table("deal_events").select("id").limit(1).execute().data) > 0
    contacts_exist = len(clients["editor"].table("contacts").select("id").limit(1).execute().data) > 0
    other_stage = "closed" if deal["stage"] != "closed" else "sourcing"
    edit_codes = {"42501"}

    def rpc_update(c: Client, changes: dict) -> Callable[[], object]:
        return lambda: c.rpc("update_deal", {"deal_id": deal["id"], "changes": changes}).execute()

    def checks(actor: str) -> dict[str, Outcome]:
        c = clients[actor]
        own = user_ids.get(actor)
        other = user_ids["viewer"] if actor == "admin" else user_ids["admin"]
        new_role = "viewer" if actor == "admin" else "admin"  # admin: no-op; others: escalation
        can_edit = actor in ("editor", "admin")
        out: dict[str, Outcome] = {}

        out["read deals"] = attempt(lambda: c.table("deals").select("id").execute())
        out["read deal_events"] = attempt(lambda: c.table("deal_events").select("id").execute())
        out["read contacts"] = attempt(lambda: c.table("contacts").select("id").execute())
        out["call get_weekly_review"] = attempt(lambda: c.rpc("get_weekly_review").execute())
        try:
            rows = c.rpc("get_weekly_review").execute().data or []
            cols = set(rows[0]) if rows else set()
            extra, missing = cols - WEEKLY_COLUMNS, WEEKLY_COLUMNS - cols
            out["weekly returns only weekly cols"] = Outcome(
                bool(rows) and not extra and not missing,
                f"{len(cols)} cols" + (f", extra {sorted(extra)}" if extra else "") + (f", missing {sorted(missing)}" if missing else ""),
            )
        except Exception as exc:
            out["weekly returns only weekly cols"] = Outcome(False, f"error: {_error(exc)[1]}"[:100])
        out["read own profile"] = (
            attempt(lambda: c.table("profiles").select("user_id").eq("user_id", own).execute())
            if own else attempt(lambda: c.table("profiles").select("user_id").execute())
        )
        out["read another user's profile"] = attempt(lambda: c.table("profiles").select("user_id").eq("user_id", other).execute())
        out["call get_profile_names"] = attempt(
            lambda: c.rpc("get_profile_names", {"user_ids": [user_ids["admin"], user_ids["viewer"]]}).execute())
        try:
            names = c.rpc("get_profile_names", {"user_ids": [user_ids["admin"]]}).execute().data or []
            keys = set(names[0]) if names else set()
            out["profile names: names only"] = Outcome(keys == {"user_id", "display_name"}, f"keys {sorted(keys)}")
        except Exception as exc:
            out["profile names: names only"] = Outcome(False, f"error: {_error(exc)[1]}"[:100])

        out["direct update on deals"] = attempt_denied(
            [("update", lambda: c.table("deals").update({"notes_raw": deal["notes_raw"]}).eq("id", deal["id"]).execute())], edit_codes)
        out["direct insert/delete on deals"] = attempt_denied([
            ("insert", lambda: c.table("deals").insert({"client": "x", "vertical": "x", "source_tab": "rls", "source_row": 1,
                                                        "natural_key": "rls-test-insert"}).execute()),
            ("delete", lambda: c.table("deals").delete().eq("id", NO_SUCH_ID).execute()),
        ], edit_codes)
        out["direct insert on deal_events"] = attempt_denied([
            ("insert", lambda: c.table("deal_events").insert({"deal_id": NO_SUCH_ID, "field": "stage"}).execute())], edit_codes)
        out["update_deal, allowed field"] = attempt(rpc_update(c, {"notes_raw": deal["notes_raw"]}), rows_mean_allowed=False)
        if not can_edit:
            out["update_deal, real stage change"] = attempt_denied([("stage", rpc_update(c, {"stage": other_stage}))], edit_codes)
        out["update_deal, natural_key"] = attempt_denied([("natural_key", rpc_update(c, {"natural_key": "rls-test"}))], edit_codes)
        out["update_deal, protected fields"] = attempt_denied(
            [(k, rpc_update(c, {k: v})) for k, v in [
                ("stage_changed_at", None), ("updated_by", own or NO_SUCH_ID), ("assumption_fields", []),
                ("source_row", 1), ("id", NO_SUCH_ID), ("created_at", "2020-01-01"), ("client", "x"), ("vertical", "x"),
                ("stage_raw", "x"),
            ]], edit_codes)
        out["update_deal, bad values"] = attempt_denied(
            [(k, rpc_update(c, v)) for k, v in [
                ("negative", {"lot_sf": -1}), ("text in number", {"list_price": "abc"}), ("bad stage", {"stage": "won"}),
                ("nested attribute", {"attributes": {"a": {"b": 1}}}), ("empty", {}),
            ]], {"22023"} if can_edit else edit_codes)
        out["change a role"] = attempt(
            lambda: c.table("profiles").update({"role": new_role}).eq("user_id", user_ids["viewer"]).execute())
        out["call internal functions"] = attempt_denied(
            [(fn, (lambda fn=fn: c.rpc(fn).execute())) for fn in ("handle_new_user", "set_updated_at", "prevent_last_admin_removal")],
            {"42501", "PGRST202", "42883", "0A000"})

        if not events_exist or not contacts_exist:
            for name, exists in (("read deal_events", events_exist), ("read contacts", contacts_exist)):
                o = out[name]
                if not exists and o.detail.startswith("0 row"):
                    o.allowed = EXPECTED[name][actor] is True
                    o.detail += " (table empty: can't tell RLS from no data)"
        nk = out["update_deal, natural_key"]
        if can_edit and not nk.allowed:
            try:
                rpc_update(c, {"natural_key": "rls-test"})()
            except Exception as exc:
                if "not editable" not in _error(exc)[1]:
                    nk.allowed, nk.detail = True, f"refused, but not by the allowlist: {_error(exc)[1]}"
        return out

    results = {actor: checks(actor) for actor in ACTORS}

    # Safety net: the viewer must still be a viewer, and the deal unchanged.
    role_now = clients["admin"].table("profiles").select("role").eq("user_id", user_ids["viewer"]).single().execute().data["role"]
    failures: list[tuple[str, str, str]] = []
    if role_now != "viewer":
        clients["admin"].table("profiles").update({"role": "viewer"}).eq("user_id", user_ids["viewer"]).execute()
        failures.append(("change a role", "-", f"viewer role was {role_now!r}; restored to viewer"))
    stage_now = clients["editor"].table("deals").select("stage").eq("id", deal["id"]).single().execute().data["stage"]
    if stage_now != deal["stage"]:
        failures.append(("update_deal, real stage change", "-", f"test deal stage changed to {stage_now!r}"))

    width = 32
    print(f"\nPart 1, database. Test deal: {deal['id']}   deal_events present: {events_exist}\n")
    print(f"{'check':<{width}}" + "".join(f"{a:<16}" for a in ACTORS))
    for check, exp in EXPECTED.items():
        line = f"{check:<{width}}"
        for actor in ACTORS:
            want = exp[actor]
            o = results[actor].get(check)
            if want is None or o is None:
                cell = "-"
            else:
                ok = o.allowed == want
                cell = ("PASS " if ok else "FAIL ") + ("allowed" if o.allowed else "denied")
                if not ok:
                    failures.append((check, actor, o.detail))
            line += f"{cell:<16}"
        print(line)

    print("\nDetails (new checks):")
    for check in ("weekly returns only weekly cols", "profile names: names only", "direct insert/delete on deals",
                  "direct insert on deal_events", "update_deal, real stage change", "update_deal, protected fields",
                  "update_deal, bad values", "call internal functions"):
        for actor in ACTORS:
            if check in results[actor]:
                print(f"  {check:<{width}} {actor:<11} {results[actor][check].detail}")

    for role in EMAILS:
        clients[role].auth.sign_out()
    return failures, {"deal": deal}


# ---------------------------------------------------------------- part 2: app (HTTP)

def session_cookies(url: str, session: Any) -> dict[str, str]:
    """The cookies @supabase/ssr reads: sb-<ref>-auth-token = 'base64-' + base64url(session JSON), chunked."""
    ref = urlparse(url).hostname.split(".")[0]
    name = f"sb-{ref}-auth-token"
    payload = session.model_dump(mode="json", exclude={"provider_token", "provider_refresh_token"})
    value = "base64-" + base64.urlsafe_b64encode(json.dumps(payload).encode()).decode().rstrip("=")
    size = 3180
    if len(value) <= size:
        return {name: value}
    return {f"{name}.{i}": value[i * size:(i + 1) * size] for i in range((len(value) + size - 1) // size)}


def call_action(app: str, path: str, action_id: str, args: list, cookies: dict[str, str]) -> str:
    """POST a server action the way the browser does; returns the RSC response text."""
    r = httpx.post(
        f"{app}{path}",
        content=json.dumps(args),
        headers={"Next-Action": action_id, "Content-Type": "text/plain;charset=UTF-8",
                 "Accept": "text/x-component", "Origin": app},
        cookies=cookies, follow_redirects=False, timeout=30,
    )
    return f"{r.status_code} {r.text}"


def action_result(text: str) -> dict | None:
    """Find the action's return value ({ok: ...}) in the RSC response."""
    for line in text.splitlines():
        _, _, body = line.partition(":")
        if body.startswith("{") and '"ok"' in body:
            try:
                return json.loads(body)
            except json.JSONDecodeError:
                pass
    return None


def app_checks(app: str, url: str, key: str, password: str, deal: dict) -> list[tuple[str, str, str]]:
    failures: list[tuple[str, str, str]] = []
    rows: list[tuple[str, bool, str]] = []

    def record(name: str, ok: bool, detail: str) -> None:
        rows.append((name, ok, detail))
        if not ok:
            failures.append((name, "app", detail))

    try:
        httpx.get(f"{app}/login", timeout=10)
    except Exception as exc:
        print(f"\nPart 2, app: {app} not reachable ({exc}).")
        return [("app reachable", "app", str(exc))]
    manifest = json.loads(ACTION_MANIFEST.read_text())
    ids = {v.get("exportedName"): k for k, v in manifest.get("node", {}).items()}
    save_id, history_id = ids.get("saveDealField"), ids.get("getDealHistory")
    if not save_id or not history_id:
        return [("server action ids", "app", f"not in {ACTION_MANIFEST}; run npm run build")]

    sessions: dict[str, Any] = {}
    for role in ("editor", "viewer", "no role"):
        c = create_client(url, key)
        sessions[role] = c.auth.sign_in_with_password({"email": EMAILS[role], "password": password}).session
    cookies = {"signed out": {}, **{r: session_cookies(url, s) for r, s in sessions.items()}}

    # Deal edit actions, called directly (no UI), as each user.
    for actor in ("signed out", "no role", "viewer"):
        res = action_result(call_action(app, "/deals", save_id, [deal["id"], "stage", "closed"], cookies[actor]))
        record(f"saveDealField as {actor}: refused", res is not None and res.get("ok") is False, json.dumps(res)[:100])
        res = action_result(call_action(app, "/deals", history_id, [deal["id"]], cookies[actor]))
        refused = res is not None and (res.get("ok") is False or res.get("entries") == [])
        record(f"getDealHistory as {actor}: no history returned", refused, json.dumps(res)[:100])
    res = action_result(call_action(app, "/deals", save_id, [deal["id"], "notes_raw", deal["notes_raw"]], cookies["editor"]))
    record("saveDealField as editor, unchanged value: ok", res is not None and res.get("ok") is True, json.dumps(res)[:80])
    res = action_result(call_action(app, "/deals", save_id, [deal["id"], "natural_key", "x"], cookies["editor"]))
    record("saveDealField as editor, natural_key: refused", res is not None and res.get("ok") is False, json.dumps(res)[:100])
    res = action_result(call_action(app, "/deals", save_id, ["not-a-uuid", "stage", "closed"], cookies["editor"]))
    record("saveDealField as editor, bad id: refused", res is not None and res.get("ok") is False, json.dumps(res)[:100])
    editor = create_client(url, key)
    editor.auth.sign_in_with_password({"email": EMAILS["editor"], "password": password})
    stage_now = editor.table("deals").select("stage").eq("id", deal["id"]).single().execute().data["stage"]
    record("test deal unchanged after the action calls", stage_now == deal["stage"], f"stage {stage_now}")
    events = editor.table("deal_events").select("deal_id").execute().data or []
    if events:
        res = action_result(call_action(app, "/deals", history_id, [events[0]["deal_id"]], cookies["editor"]))
        record("getDealHistory as editor: history returned", bool(res and res.get("ok") and res.get("entries")), f"{len((res or {}).get('entries') or [])} entries")
    editor.auth.sign_out()

    # Sign-out route. Signing out must need a same-site POST: a GET (an <img>
    # or a link on another site) or a cross-site form must not end the session.
    viewer = sessions["viewer"]
    r = httpx.get(f"{app}/auth/signout", timeout=10, follow_redirects=False)
    record("GET /auth/signout signed out: proxy sends to /login", r.status_code == 307 and r.headers.get("location", "").endswith("/login"),
           f"{r.status_code} -> {r.headers.get('location')}")
    r = httpx.get(f"{app}/auth/signout", cookies=session_cookies(url, viewer), timeout=10, follow_redirects=False)
    record("GET /auth/signout signed in: 405, not a sign-out", r.status_code == 405 and not r.headers.get_list("set-cookie"),
           f"{r.status_code}, {len(r.headers.get_list('set-cookie'))} cookie(s) set")
    r = httpx.post(f"{app}/auth/signout", headers={"Origin": "https://evil.example"},
                   cookies=session_cookies(url, viewer), timeout=10, follow_redirects=False)
    record("cross-site POST /auth/signout: 403", r.status_code == 403, f"{r.status_code}")
    probe = create_client(url, key)
    try:
        refreshed = probe.auth.refresh_session(viewer.refresh_token).session
        record("cross-site POST didn't end the session", refreshed is not None, "refresh ok")
    except Exception as exc:
        refreshed = None
        record("cross-site POST didn't end the session", False, f"refresh failed: {exc}")
    # A second "device" signed in as the same user: local sign-out must leave it alone.
    other_device = create_client(url, key).auth.sign_in_with_password(
        {"email": EMAILS["viewer"], "password": password}).session
    if refreshed:
        r = httpx.post(f"{app}/auth/signout", headers={"Origin": app},
                       cookies=session_cookies(url, refreshed), timeout=10, follow_redirects=False)
        cleared = [c for c in r.headers.get_list("set-cookie") if c.startswith("sb-")]
        record("same-site POST /auth/signout: 303 to /login, cookie cleared",
               r.status_code == 303 and r.headers.get("location", "").endswith("/login")
               and bool(cleared) and all("Max-Age=0" in c or "expires=Thu, 01 Jan 1970" in c.lower() for c in cleared),
               f"{r.status_code} -> {r.headers.get('location')}, {len(cleared)} cookie(s) cleared, "
               f"Clear-Site-Data {r.headers.get('clear-site-data')}")
        try:
            create_client(url, key).auth.refresh_session(refreshed.refresh_token)
            record("after sign-out this session can't be refreshed", False, "refresh still works")
        except Exception:
            record("after sign-out this session can't be refreshed", True, "refresh refused")
        try:
            still = create_client(url, key).auth.refresh_session(other_device.refresh_token).session
            record("same user on another device stays signed in (local scope)", still is not None, "refresh ok")
        except Exception as exc:
            record("same user on another device stays signed in (local scope)", False, f"refresh failed: {exc}")

    print(f"\nPart 2, app ({app}):")
    for name, ok, detail in rows:
        print(f"  {'PASS' if ok else 'FAIL'}  {name:<58} {detail}")
    return failures


def main() -> int:
    parser = argparse.ArgumentParser(description="Check the authorization boundary.")
    parser.add_argument("--app", help="base URL of a running build, e.g. http://localhost:3000, to also test the app's entry points")
    args = parser.parse_args()

    load_dotenv(ENV_FILE)
    url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    key = os.environ.get("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY")
    password = os.environ.get("DEMO_USER_PASSWORD")
    if not (url and key and password):
        print("Need NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and "
              f"DEMO_USER_PASSWORD in {ENV_FILE}", file=sys.stderr)
        return 2

    try:
        failures, ctx = database_checks(url, key, password)
    except Exception as exc:
        print(f"Setup failed: {exc}. Run create_demo_users.py first.", file=sys.stderr)
        return 2
    if args.app:
        failures += app_checks(args.app.rstrip("/"), url, key, password, ctx["deal"])
    else:
        print("\nPart 2, app: skipped (pass --app http://localhost:3000 to test the app's entry points).")

    print(f"\n{'All checks passed.' if not failures else f'{len(failures)} failure(s):'}")
    for check, actor, detail in failures:
        print(f"  {check} / {actor}: {detail}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
