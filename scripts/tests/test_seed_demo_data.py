from datetime import datetime
from zoneinfo import ZoneInfo

from seed_demo_data import SEED_USERS, build_activity, email_for, last_sign_ins

NOW = datetime(2026, 11, 13, 15, 30, tzinfo=ZoneInfo("America/New_York"))
USERS = [{"id": f"u{i}", "role": role} for i, (_, role) in enumerate(SEED_USERS)]
DEALS = ["d1", "d2", "d3"]


def test_seed_users_are_20_with_the_agreed_roles():
    roles = [r for _, r in SEED_USERS]
    assert (roles.count("admin"), roles.count("editor"), roles.count("viewer")) == (1, 7, 12)
    emails = [email_for(n) for n, _ in SEED_USERS]
    assert len(set(emails)) == 20
    assert all(e.endswith("@demo.dealledger.test") for e in emails)
    assert not {"admin", "editor", "viewer", "norole"} & {e.split("@")[0] for e in emails}


def test_activity_is_demo_valid_and_never_in_the_future():
    rows = build_activity(USERS, DEALS, NOW)
    assert rows
    for r in rows:
        assert r["is_demo"] is True
        assert datetime.fromisoformat(r["created_at"]) <= NOW
        assert (r["action"] == "page_view") == (r["page"] is not None)
        assert (r["deal_id"] is None) or r["action"] == "deal_edit"
        assert (r["target_user_id"] is None) or r["action"] == "role_change"
    assert {r["action"] for r in rows} == {"sign_in", "page_view", "deal_edit", "role_change"}
    assert [r["created_at"] for r in rows] == sorted(r["created_at"] for r in rows)


def test_roles_only_do_what_they_can():
    rows = build_activity(USERS, DEALS, NOW)
    role = {u["id"]: u["role"] for u in USERS}
    for r in rows:
        if r["action"] == "deal_edit":
            assert role[r["user_id"]] in ("editor", "admin") and r["deal_id"] in DEALS and r["detail"]["fields"]
        if r["action"] == "role_change":
            assert role[r["user_id"]] == "admin"
            assert r["detail"]["to"] == role[r["target_user_id"]]  # consistent with the current role
        if r["action"] == "page_view" and role[r["user_id"]] == "viewer" and r["page"] != "weekly":
            assert r["detail"] == {"denied": True}
        if r["page"] == "admin":
            assert role[r["user_id"]] == "admin"


def test_deterministic_and_last_sign_in_is_latest():
    a, b = build_activity(USERS, DEALS, NOW), build_activity(USERS, DEALS, NOW)
    assert a == b
    latest = last_sign_ins(a)
    for uid, at in latest.items():
        assert at == max(r["created_at"] for r in a if r["user_id"] == uid and r["action"] == "sign_in")
