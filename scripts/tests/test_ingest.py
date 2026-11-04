import openpyxl
import pytest
from openpyxl.styles import Font

from ingest import (build_deal, client_part, load_deal_tab, natural_key,
                    parse_number, vertical_for)


@pytest.mark.parametrize("value, expected", [
    (None, (None, True)),
    ("", (None, True)),
    (10000.0, (10000.0, True)),
    (42, (42, True)),
    ("1200", (1200, True)),
    ("$3,250,000", (3250000, True)),
    ("1,138.70", (1138.7, True)),
    ("15-51", (None, False)),
    ("2,400A", (None, False)),
    ("400A", (None, False)),
    ("12,34", (None, False)),
    ("-", (None, False)),
    (True, (None, False)),
])
def test_parse_number(value, expected):
    assert parse_number(value) == expected


def test_natural_key_normalizes_and_falls_back():
    assert natural_key("Client A", "  7500 NW  25th St ") == "client a|7500 nw 25th st"
    assert natural_key("Client A", None) is None
    assert natural_key("Client A", "  ") is None


def test_vertical_and_client_part():
    assert vertical_for("food_clientA_nyc") == "Food"
    assert vertical_for("av_clientC_atl") == "Autonomous Vehicle"
    assert vertical_for("catering_clientB_jfk") == "Airline Catering"
    assert vertical_for("retail_clientD_sea") is None
    assert client_part("food_clientA_nyc") == "clienta"


def make_sheet(title, headers, rows, blue=None):
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = title
    ws.append(headers)
    for r in rows:
        ws.append(r)
    if blue:
        ws[blue].font = Font(color="FF0000FF")
    return ws


def test_deal_row_typed_attributes_and_assumption():
    headers = ["Client name", "Metro", "City", "State", "Address", "Status",
               "Bldg SF", "Clear height", "Power", "Days On Market", "Sale Status", "Notes"]
    ws = make_sheet("av_clientC_atl", headers,
                    [["Client C", "Atlanta", "Culver City", "CA", "5861 Washington Blvd",
                      "nego PSA", "2,920", "15-51", "400A", 41, "Active", "raw note"]],
                    blue="I2")
    issues, keys = [], {}
    res = load_deal_tab(ws, issues, keys)
    (d,) = res.payloads
    assert d["vertical"] == "Autonomous Vehicle"
    assert d["market"] == "Atlanta" and d["city"] == "Culver City" and d["state"] == "CA"
    assert d["stage"] == "negotiating_psa" and d["stage_raw"] == "nego PSA"
    assert d["bldg_sf"] == 2920 and d["attributes"]["Bldg SF"] == "2,920"
    assert d["attributes"]["Clear height"] == "15-51"
    assert d["attributes"]["Days On Market"] == 41
    assert d["attributes"]["Sale Status"] == "Active"
    assert d["assumption_fields"] == ["Power"]
    assert d["notes_raw"] == "raw note"
    assert "stage_changed_at" not in d
    assert d["natural_key"] == "client c|5861 washington blvd"


def test_bad_number_kept_raw_and_reported():
    ws = make_sheet("food_clientA_nyc", ["Client name", "Address", "Status", "List Price"],
                    [["Client A", "1 Main St", "Sourcing", "about 3M"]])
    issues = []
    (d,) = load_deal_tab(ws, issues, {}).payloads
    assert d["list_price"] is None
    assert d["attributes"]["List Price"] == "about 3M"
    assert any("not a clean number" in i.problem for i in issues)


def test_no_address_and_duplicate_key_fall_back():
    ws = make_sheet("food_clientA_nyc", ["Client name", "Address", "Status"],
                    [["Client A", None, "On Hold"],
                     ["Client A", "1 Main St", "Sourcing"],
                     ["Client A", "1 MAIN ST", "Listed"]])
    issues = []
    res = load_deal_tab(ws, issues, {})
    keys = [p["natural_key"] for p in res.payloads]
    assert keys == ["food_clientA_nyc:2", "client a|1 main st", "food_clientA_nyc:4"]
    assert res.rows_read == 3 and len(res.payloads) == 3
    assert res.payloads[2]["stage"] == "unknown" and res.payloads[2]["stage_raw"] == "Listed"
    problems = " ".join(i.problem for i in issues)
    assert "no address" in problems and "same client and address" in problems
    assert "not an acquisition stage" in problems


def test_unknown_tab_is_loaded_and_reported():
    ws = make_sheet("retail_clientD_sea", ["Client name", "Address", "Status"],
                    [["Client D", "9 Pike St", "Sourcing"]])
    issues = []
    res = load_deal_tab(ws, issues, {})
    assert res.payloads[0]["vertical"] == "Unknown"
    assert any("matches no vertical rule" in i.problem for i in issues)


def test_blank_client_falls_back_to_tab_name():
    ws = make_sheet("food_clientA_nyc", ["Client name", "Address", "Status"],
                    [[None, "1 Main St", "Sourcing"]])
    issues = []
    (d,) = load_deal_tab(ws, issues, {}).payloads
    assert d["client"] == "Client A"
    assert d["natural_key"] == "client a|1 main st"
    assert any("Client name is blank" in i.problem and "from the tab name" in i.problem
               for i in issues)


def test_blank_client_without_tab_client_part():
    ws = make_sheet("misc", ["Client name", "Address", "Status"], [[None, "1 Main St", "Sourcing"]])
    issues = []
    (d,) = load_deal_tab(ws, issues, {}).payloads
    assert d["client"] == "Unknown"
    assert any("no client part" in i.problem for i in issues)


def test_client_name_mismatch_reported():
    ws = make_sheet("food_clientA_nyc", ["Client name", "Address", "Status"],
                    [["Client B", "1 Main St", "Sourcing"]])
    issues = []
    res = load_deal_tab(ws, issues, {})
    assert res.payloads[0]["vertical"] == "Food"  # vertical unchanged
    assert any("doesn't match tab name part" in i.problem for i in issues)


def test_protect_edited_skips_by_key_or_source_row():
    from ingest import TabResult, protect_edited
    r = TabResult("food_clientA_nyc", "deals", rows_read=3)
    r.payloads = [
        {"natural_key": "client a|1 main st", "source_tab": "food_clientA_nyc", "source_row": 2},
        {"natural_key": "client a|2 main st", "source_tab": "food_clientA_nyc", "source_row": 3},
        {"natural_key": "food_clientA_nyc:4", "source_tab": "food_clientA_nyc", "source_row": 4},
    ]
    contacts = TabResult("contact_tracker", "contacts", rows_read=1)
    contacts.payloads = [{"source_tab": "contact_tracker", "source_row": 2}]
    edited = [
        {"natural_key": "client a|1 main st", "source_tab": "food_clientA_nyc", "source_row": 2,
         "updated_by": "u1", "updated_at": "t"},
        # address edited in the app: key differs, source row still matches
        {"natural_key": "food_clientA_nyc:4", "source_tab": "food_clientA_nyc", "source_row": 4,
         "updated_by": "u2", "updated_at": "t"},
    ]
    protect_edited([r, contacts], edited)
    assert [p["source_row"] for p in r.payloads] == [3]
    assert [s["source_row"] for s in r.skipped] == [2, 4]
    assert len(contacts.payloads) == 1 and contacts.skipped == []


def test_is_edited_uses_updated_by_or_events():
    from ingest import is_edited
    assert is_edited({"updated_by": None, "deal_events": []}) is None
    assert is_edited({"updated_by": "u1", "deal_events": []}) == "updated_by set"
    # editing user deleted: updated_by is null, but events remain
    assert is_edited({"updated_by": None, "deal_events": [{"id": 1}, {"id": 2}]}) == "2 deal_events"
