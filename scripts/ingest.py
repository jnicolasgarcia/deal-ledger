"""Load data/source.xlsx into Supabase, following ASSUMPTIONS.md.

- Client tabs -> public.deals (upsert on natural_key)
- contact_tracker -> public.contacts (upsert on source_tab, source_row)
- target_weekly_view is a reference shape and is not loaded.

Never skips a row: anything that can't be parsed is left null in its typed
column, kept raw in attributes, and reported as an issue.

Usage:
  python scripts/ingest.py [--dry-run] [--source path/to/source.xlsx]

Exit codes: 0 ok, 1 rows read != rows written for some tab, 2 setup error.
"""

from __future__ import annotations

import argparse
import datetime as dt
import os
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import openpyxl
from openpyxl.cell.cell import Cell
from openpyxl.utils import get_column_letter

from profile_workbook import color_key, is_default_color
from stage_map import normalize_stage

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_SOURCE = ROOT / "data" / "source.xlsx"
ENV_FILE = ROOT / ".env.local"

# ASSUMPTIONS.md section 2
VERTICALS = {"food": "Food", "av": "Autonomous Vehicle", "catering": "Airline Catering"}
UNKNOWN_VERTICAL = "Unknown"
UNKNOWN_CLIENT = "Unknown"
CONTACTS_TAB = "contact_tracker"
REFERENCE_TABS = {"target_weekly_view"}

# ASSUMPTIONS.md section 3
ASSUMPTION_RGB = "FF0000FF"

# Shared deal fields: normalized header -> (column, kind). State is expected
# to be missing in some tabs (ASSUMPTIONS.md section 5).
DEAL_FIELDS: dict[str, tuple[str, str]] = {
    "client name": ("client", "client"),
    "metro": ("market", "text"),
    "address": ("address", "text"),
    "city": ("city", "text"),
    "state": ("state", "text"),
    "status": ("stage", "stage"),
    "bldg sf": ("bldg_sf", "number"),
    "list price": ("list_price", "number"),
    "list price/sf": ("list_price_per_sf", "number"),
    "lot sf": ("lot_sf", "number"),
    "list price/lot sf": ("list_price_per_lot_sf", "number"),
    "notes": ("notes_raw", "notes"),
}
OPTIONAL_DEAL_FIELDS = {"state"}
DEAL_COLUMNS = [
    "client", "vertical", "market", "address", "city", "state",
    "bldg_sf", "list_price", "list_price_per_sf", "lot_sf", "list_price_per_lot_sf",
    "stage", "stage_raw", "notes_raw", "attributes", "assumption_fields",
    "source_tab", "source_row", "natural_key",
]  # stage_changed_at and updated_by are never sent: they stay null / untouched.

CONTACT_FIELDS: dict[str, tuple[str, str]] = {
    "contact name": ("contact_name", "text"),
    "title": ("title", "text"),
    "email": ("email", "text"),
    "office #": ("office_phone", "phone"),
    "mobile #": ("mobile_phone", "phone"),
    "emailed?": ("emailed", "bool"),
    "linkedin dm?": ("linkedin_dm", "bool"),
    "helpful reply?": ("helpful_reply", "bool"),
    "notes": ("notes_raw", "notes"),
}
CONTACT_COLUMNS = [c for c, _ in CONTACT_FIELDS.values()] + ["raw", "source_tab", "source_row"]

# A plain number, optionally with $ and thousands commas. Nothing else.
NUMBER_RE = re.compile(r"^\$?\s*-?(\d{1,3}(,\d{3})+|\d+)(\.\d+)?$")


# ---------- small helpers ----------

@dataclass
class Issue:
    tab: str
    row: int | None
    problem: str


@dataclass
class TabResult:
    tab: str
    kind: str
    rows_read: int = 0
    rows_written: int = 0
    payloads: list[dict[str, Any]] = field(default_factory=list)


def is_blank(value: object) -> bool:
    return value is None or (isinstance(value, str) and value.strip() == "")


def norm_text(value: str) -> str:
    """Trim, collapse repeated spaces, lowercase. Used for keys and lookups."""
    return " ".join(value.split()).lower()


def json_value(value: object) -> Any:
    """Raw cell value in a JSON-safe form (dates become ISO strings)."""
    if isinstance(value, (dt.datetime, dt.date, dt.time)):
        return value.isoformat()
    if value is None or isinstance(value, (bool, int, float, str)):
        return value
    return str(value)


def parse_number(value: object) -> tuple[float | int | None, bool]:
    """Return (number, ok). Blank is (None, True). Ambiguous text is (None, False)."""
    if is_blank(value):
        return None, True
    if isinstance(value, bool):
        return None, False
    if isinstance(value, (int, float)):
        return value, True
    if isinstance(value, str):
        text = value.strip()
        if NUMBER_RE.match(text):
            cleaned = text.replace("$", "").replace(",", "").replace(" ", "")
            return (float(cleaned) if "." in cleaned else int(cleaned)), True
    return None, False


def natural_key(client: str, address: str | None) -> str | None:
    if address is None or address.strip() == "":
        return None
    return f"{norm_text(client)}|{norm_text(address)}"


def vertical_for(tab_name: str) -> str | None:
    return VERTICALS.get(tab_name.split("_", 1)[0].lower())


def client_part(tab_name: str) -> str | None:
    """'food_clientA_nyc' -> 'clienta' (for the Client name consistency check)."""
    parts = tab_name.split("_")
    return re.sub(r"[^a-z0-9]", "", parts[1].lower()) if len(parts) >= 3 else None


def client_from_tab(tab_name: str) -> str | None:
    """'food_clientA_nyc' -> 'Client A'. None when the tab name has no client part."""
    parts = tab_name.split("_")
    if len(parts) < 3 or not parts[1]:
        return None
    m = re.fullmatch(r"client(\w+)", parts[1], re.IGNORECASE)
    return f"Client {m.group(1)}" if m else parts[1]


def read_tab(ws) -> tuple[list[str], list[tuple[int, list[Cell]]], list[Issue]]:
    """Header row (row 1) and non-blank data rows. Header keys are unique."""
    issues: list[Issue] = []
    rows = list(ws.iter_rows())
    if not rows:
        return [], [], issues
    header_cells = list(rows[0])
    body = []
    for r in rows[1:]:
        if all(is_blank(c.value) for c in r):
            if any(not is_blank(c.value) for later in rows[r[0].row:] for c in later):
                issues.append(Issue(ws.title, r[0].row, "fully blank row between data rows, nothing to load"))
            continue
        body.append((r[0].row, list(r)))
    headers: list[str] = []
    seen: set[str] = set()
    for i, c in enumerate(header_cells):
        letter = get_column_letter(i + 1)
        has_values = any(i < len(r) and not is_blank(r[i].value) for _, r in body)
        if is_blank(c.value):
            key = f"<unnamed {letter}>"
            if has_values:
                issues.append(Issue(ws.title, None, f"column {letter} has values but no header; kept as {key!r}"))
        else:
            key = str(c.value)
            if key in seen:
                new_key = f"{key} ({letter})"
                issues.append(Issue(ws.title, None, f"duplicate header {key!r} in column {letter}; kept as {new_key!r}"))
                key = new_key
        seen.add(key)
        headers.append(key)
    return headers, body, issues


# ---------- deals ----------

def build_deal(tab: str, vertical: str, headers: list[str], row_num: int,
               cells: list[Cell]) -> tuple[dict[str, Any], list[Issue]]:
    issues: list[Issue] = []
    out: dict[str, Any] = {c: None for c in DEAL_COLUMNS}
    attributes: dict[str, Any] = {}
    assumption_fields: list[str] = []

    for header, cell in zip(headers, cells):
        value = cell.value
        if header.startswith("<unnamed") and is_blank(value):
            continue
        try:
            if not is_blank(value):
                key = color_key(cell)
                if key[0] == "rgb" and key[1] == ASSUMPTION_RGB:
                    assumption_fields.append(header)
                elif not is_default_color(key):
                    issues.append(Issue(tab, row_num, f"{header}: non-default font color {key}, not treated as assumption"))

            spec = DEAL_FIELDS.get(norm_text(header))
            if spec is None:
                if value is not None:
                    attributes[header] = json_value(value)
                continue
            column, kind = spec
            if kind in ("text", "client"):
                text = None if is_blank(value) else str(value).strip()
                out[column] = text
                if value is not None and text != value:
                    attributes[header] = json_value(value)  # keep the raw form
            elif kind == "number":
                number, ok = parse_number(value)
                out[column] = number
                if not ok:
                    attributes[header] = json_value(value)
                    issues.append(Issue(tab, row_num, f"{header}: {value!r} is not a clean number; typed column left null, raw kept"))
                elif isinstance(value, str):
                    attributes[header] = value  # parsed from text: keep raw too
            elif kind == "stage":
                res = normalize_stage(value)
                out["stage"] = res.stage
                out["stage_raw"] = res.stage_raw
                if res.flagged:
                    issues.append(Issue(tab, row_num, f"{res.reason}; stage set to unknown"))
            elif kind == "notes":
                out["notes_raw"] = value if (value is None or isinstance(value, str)) else str(value)
                if value is not None and not isinstance(value, str):
                    attributes[header] = json_value(value)
        except Exception as exc:  # never lose the row over one cell
            attributes[header] = json_value(value)
            issues.append(Issue(tab, row_num, f"{header}: could not process {value!r} ({exc}); raw kept"))

    if out["stage"] is None:
        out["stage"] = "unknown"
    if out["client"] is None:
        derived = client_from_tab(tab)
        out["client"] = derived or UNKNOWN_CLIENT
        source = "from the tab name" if derived else "(tab name has no client part)"
        issues.append(Issue(tab, row_num, f"Client name is blank; client set to {out['client']!r} {source}"))
    out["vertical"] = vertical
    out["attributes"] = attributes
    out["assumption_fields"] = assumption_fields
    out["source_tab"] = tab
    out["source_row"] = row_num
    out["natural_key"] = natural_key(out["client"], out["address"])
    return out, issues


def load_deal_tab(ws, issues: list[Issue], used_keys: dict[str, str]) -> TabResult:
    tab = ws.title
    result = TabResult(tab, "deals")
    vertical = vertical_for(tab)
    if vertical is None:
        vertical = UNKNOWN_VERTICAL
        issues.append(Issue(tab, None, f"tab prefix matches no vertical rule; rows loaded with vertical {UNKNOWN_VERTICAL!r}"))

    headers, body, tab_issues = read_tab(ws)
    issues.extend(tab_issues)
    result.rows_read = len(body)
    present = {norm_text(h) for h in headers}
    for missing in sorted(set(DEAL_FIELDS) - present - OPTIONAL_DEAL_FIELDS):
        issues.append(Issue(tab, None, f"shared column {missing!r} not found; left null"))

    for row_num, cells in body:
        payload, row_issues = build_deal(tab, vertical, headers, row_num, cells)
        issues.extend(row_issues)
        key = payload["natural_key"]
        fallback = f"{tab}:{row_num}"
        if key is None:
            payload["natural_key"] = fallback
            issues.append(Issue(tab, row_num, f"no address; natural_key falls back to {fallback!r}"))
        elif key in used_keys:
            payload["natural_key"] = fallback
            issues.append(Issue(tab, row_num, f"same client and address as {used_keys[key]}; natural_key falls back to {fallback!r}"))
        used_keys.setdefault(payload["natural_key"], fallback)
        result.payloads.append(payload)

    # Client name consistency check (reported only, never changes vertical).
    expected = client_part(tab)
    names: dict[str, list[int]] = {}
    for p in result.payloads:
        names.setdefault(p["client"], []).append(p["source_row"])
    if len(names) > 1:
        issues.append(Issue(tab, None, f"more than one Client name in tab: {names}"))
    if expected is not None:
        for name, rows in names.items():
            if re.sub(r"[^a-z0-9]", "", name.lower()) != expected:
                issues.append(Issue(tab, None, f"Client name {name!r} (rows {rows}) doesn't match tab name part {expected!r}"))
    return result


# ---------- contacts ----------

def build_contact(tab: str, headers: list[str], row_num: int,
                  cells: list[Cell]) -> tuple[dict[str, Any], list[Issue]]:
    issues: list[Issue] = []
    out: dict[str, Any] = {c: None for c in CONTACT_COLUMNS}
    raw: dict[str, Any] = {}
    for header, cell in zip(headers, cells):
        value = cell.value
        if header.startswith("<unnamed") and is_blank(value):
            continue
        raw[header] = json_value(value)
        if not is_blank(value) and not is_default_color(color_key(cell)):
            issues.append(Issue(tab, row_num, f"{header}: non-default font color {color_key(cell)}"))
        spec = CONTACT_FIELDS.get(norm_text(header))
        if spec is None:
            continue
        column, kind = spec
        if is_blank(value):
            continue
        if kind == "text":
            out[column] = str(value).strip()
        elif kind == "phone":
            if isinstance(value, float) and value.is_integer():
                value = int(value)
            out[column] = str(value).strip()
        elif kind == "bool":
            if isinstance(value, bool):
                out[column] = value
            else:
                issues.append(Issue(tab, row_num, f"{header}: {value!r} is not TRUE/FALSE; left null, raw kept"))
        elif kind == "notes":
            out[column] = value if isinstance(value, str) else str(value)
    out["raw"] = raw
    out["source_tab"] = tab
    out["source_row"] = row_num
    return out, issues


def load_contacts_tab(ws, issues: list[Issue]) -> TabResult:
    result = TabResult(ws.title, "contacts")
    headers, body, tab_issues = read_tab(ws)
    issues.extend(tab_issues)
    result.rows_read = len(body)
    for row_num, cells in body:
        payload, row_issues = build_contact(ws.title, headers, row_num, cells)
        issues.extend(row_issues)
        result.payloads.append(payload)
    return result


# ---------- writing ----------

def connect():
    from dotenv import load_dotenv
    from supabase import create_client

    load_dotenv(ENV_FILE)
    url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    key = os.environ.get("SUPABASE_SECRET_KEY")
    missing = [n for n, v in (("NEXT_PUBLIC_SUPABASE_URL", url), ("SUPABASE_SECRET_KEY", key)) if not v]
    if missing:
        raise SystemExit(f"Missing in {ENV_FILE}: {', '.join(missing)}")
    return create_client(url, key)


def write(client, result: TabResult, issues: list[Issue]) -> None:
    table, conflict = ("deals", "natural_key") if result.kind == "deals" else ("contacts", "source_tab,source_row")
    if not result.payloads:
        return
    try:
        resp = client.table(table).upsert(result.payloads, on_conflict=conflict).execute()
        result.rows_written = len(resp.data or [])
        return
    except Exception as exc:
        issues.append(Issue(result.tab, None, f"batch upsert failed ({exc}); retrying row by row"))
    for p in result.payloads:  # isolate the failing rows
        try:
            resp = client.table(table).upsert(p, on_conflict=conflict).execute()
            result.rows_written += len(resp.data or [])
        except Exception as exc:
            issues.append(Issue(result.tab, p["source_row"], f"write failed: {exc}"))


# ---------- main ----------

def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--dry-run", action="store_true", help="do everything except write")
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    args = parser.parse_args(argv)

    if not args.source.exists():
        print(f"Workbook not found: {args.source}", file=sys.stderr)
        return 2
    wb = openpyxl.load_workbook(args.source, data_only=True)  # read only, never saved

    issues: list[Issue] = []
    results: list[TabResult] = []
    used_keys: dict[str, str] = {}
    not_loaded: list[str] = []
    for ws in wb.worksheets:
        if ws.title in REFERENCE_TABS:
            not_loaded.append(ws.title)
        elif ws.title == CONTACTS_TAB:
            results.append(load_contacts_tab(ws, issues))
        else:
            results.append(load_deal_tab(ws, issues, used_keys))

    if args.dry_run:
        for r in results:
            r.rows_written = len(r.payloads)
    else:
        try:
            client = connect()
        except SystemExit as exc:
            print(exc, file=sys.stderr)
            return 2
        for r in results:
            write(client, r, issues)

    written_label = "would write" if args.dry_run else "rows written"
    print(f"\n{'DRY RUN, nothing written' if args.dry_run else 'Ingest'}: {args.source}\n")
    print(f"{'tab':<24} {'table':<9} {'rows read':>9} {written_label:>12} {'issues':>7}")
    for r in results:
        n = sum(1 for i in issues if i.tab == r.tab)
        print(f"{r.tab:<24} {r.kind:<9} {r.rows_read:>9} {r.rows_written:>12} {n:>7}")
    for t in not_loaded:
        print(f"{t:<24} {'-':<9} {'not loaded (reference tab)':>31}")

    print(f"\nIssues ({len(issues)}):")
    for i in issues:
        print(f"  {{tab: {i.tab}, row: {i.row if i.row is not None else '-'}, problem: {i.problem}}}")

    mismatched = [r.tab for r in results if r.rows_read != r.rows_written]
    if mismatched:
        print(f"\nRows read != rows written for: {', '.join(mismatched)}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
