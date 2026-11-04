"""Read-only profile of data/source.xlsx.

Prints, per tab: headers, row counts, blanks, status values, font colors,
mixed numeric/text columns, rows without an address and every note. Then
compares target_weekly_view against the client tabs.

Never writes the workbook (it checks the file hash before and after) and
never touches a database. It describes the data; it does not decide rules.

Usage: python scripts/profile_workbook.py [path/to/source.xlsx]
"""

from __future__ import annotations

import hashlib
import re
import sys
from collections import Counter, defaultdict
from difflib import SequenceMatcher
from pathlib import Path

import openpyxl
from openpyxl.cell.cell import Cell
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.worksheet import Worksheet

DEFAULT_PATH = Path(__file__).resolve().parent.parent / "data" / "source.xlsx"
CLIENT_TABS = ["food_clientA_nyc", "av_clientC_atl", "catering_clientB_jfk"]
TARGET_TAB = "target_weekly_view"
STATUS_HEADER = re.compile(r"status|stage", re.IGNORECASE)
ADDRESS_HEADER = re.compile(r"^address$", re.IGNORECASE)
NOTES_HEADER = re.compile(r"^notes?$", re.IGNORECASE)
PLACEHOLDERS = {"-"}  # shown in target_weekly_view where the source is blank


# ---------- generic helpers ----------

def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def is_blank(value: object) -> bool:
    return value is None or (isinstance(value, str) and value.strip() == "")


def is_number(value: object) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def section(title: str) -> None:
    print(f"\n{'=' * 78}\n{title}\n{'=' * 78}")


def sub(title: str) -> None:
    print(f"\n--- {title} ---")


class Tab:
    """Header row (row 1) plus data rows, trimmed to columns that matter."""

    def __init__(self, ws: Worksheet):
        self.ws = ws
        self.name = ws.title
        rows = list(ws.iter_rows())
        header_cells = list(rows[0]) if rows else []
        body = [r for r in rows[1:] if any(not is_blank(c.value) for c in r)]
        self.blank_rows_inside = [
            r[0].row for r in rows[1:] if all(is_blank(c.value) for c in r)
            and body and r[0].row < body[-1][0].row
        ]
        # A column is kept if it has a header or any value.
        width = 0
        for idx in range(len(header_cells)):
            has_header = not is_blank(header_cells[idx].value)
            has_value = any(idx < len(r) and not is_blank(r[idx].value) for r in body)
            if has_header or has_value:
                width = idx + 1
        self.dropped_trailing = len(header_cells) - width
        self.headers: list[str | None] = [header_cells[i].value for i in range(width)]
        self.rows: list[list[Cell]] = [list(r[:width]) for r in body]

    def col(self, pattern: re.Pattern[str]) -> list[int]:
        return [i for i, h in enumerate(self.headers) if isinstance(h, str) and pattern.search(h)]

    def label(self, idx: int) -> str:
        h = self.headers[idx]
        return h if not is_blank(h) else f"<unnamed {get_column_letter(idx + 1)}>"


# ---------- per-tab profile ----------

def profile_structure(tab: Tab) -> None:
    sub("1. Header, rows, blanks")
    print(f"Header row: {tab.headers}")
    print(f"Data rows: {len(tab.rows)}  (sheet dimensions {tab.ws.dimensions})")
    if tab.dropped_trailing:
        print(f"Ignored {tab.dropped_trailing} trailing column(s) with no header and no values.")
    if tab.blank_rows_inside:
        print(f"Fully blank rows between data rows: {tab.blank_rows_inside}")
    unnamed = [i for i, h in enumerate(tab.headers) if is_blank(h)]
    for i in unnamed:
        vals = [(c.coordinate, c.value) for c in (r[i] for r in tab.rows) if not is_blank(c.value)]
        print(f"WARNING: unnamed column {get_column_letter(i + 1)} has values: {vals}")
    if not unnamed:
        print("No unnamed column has values.")
    print("Blank count per column:")
    for i in range(len(tab.headers)):
        blanks = sum(1 for r in tab.rows if is_blank(r[i].value))
        print(f"  {get_column_letter(i + 1):>2} {tab.label(i):<22} {blanks}/{len(tab.rows)}")

    # Extra structure that could carry meaning (validation lists, comments, formulas).
    ws = tab.ws
    extras = []
    if ws.sheet_state != "visible":
        extras.append(f"sheet state: {ws.sheet_state}")
    if ws.sheet_properties.tabColor is not None:
        extras.append(f"tab color: {ws.sheet_properties.tabColor.rgb}")
    if ws.data_validations.dataValidation:
        for dv in ws.data_validations.dataValidation:
            extras.append(f"data validation {dv.sqref}: type={dv.type} formula1={dv.formula1}")
    comments = [(c.coordinate, c.comment.text) for r in ws.iter_rows() for c in r if c.comment]
    if comments:
        extras.append(f"comments: {comments}")
    formulas = [c.coordinate for r in ws.iter_rows() for c in r
                if isinstance(c.value, str) and c.value.startswith("=")]
    if formulas:
        extras.append(f"formula cells: {formulas}")
    hidden_cols = [k for k, d in ws.column_dimensions.items() if d.hidden]
    hidden_rows = [k for k, d in ws.row_dimensions.items() if d.hidden]
    if hidden_cols or hidden_rows:
        extras.append(f"hidden columns {hidden_cols}, hidden rows {hidden_rows}")
    if ws.merged_cells.ranges:
        extras.append(f"merged: {[str(m) for m in ws.merged_cells.ranges]}")
    print("Other structure: " + ("; ".join(extras) if extras else "no validations, comments, formulas, hidden or merged cells"))


def profile_status(tab: Tab) -> None:
    sub("2. Status / stage values (raw, exact)")
    cols = tab.col(STATUS_HEADER)
    if not cols:
        print("No status or stage column.")
        return
    for i in cols:
        counts = Counter(r[i].value for r in tab.rows)
        print(f"{tab.label(i)}:")
        for value, n in sorted(counts.items(), key=lambda kv: (-kv[1], repr(kv[0]))):
            print(f"  {value!r:<22} {n}")


def color_key(cell: Cell) -> tuple:
    color = cell.font.color if cell.font else None
    if color is None:
        return (None, None, None, None)
    rgb = color.rgb if color.type == "rgb" else None
    theme = color.theme if color.type == "theme" else None
    indexed = color.indexed if color.type == "indexed" else None
    return (color.type, rgb if indexed is None else f"indexed={indexed}", theme, color.tint)


def is_default_color(key: tuple) -> bool:
    ctype, rgb, theme, tint = key
    if ctype is None:
        return True
    if ctype == "theme" and theme == 1 and not tint:  # "Text 1", Excel's automatic black
        return True
    if ctype == "rgb" and rgb in ("FF000000", "00000000"):
        return True
    if ctype == "indexed" and rgb in ("indexed=8", "indexed=64"):  # black / system foreground
        return True
    return False


def profile_colors(tab: Tab) -> None:
    sub("3. Font colors in data cells")
    filled = Counter()
    empty_styled = Counter()
    by_key: dict[tuple, list[Cell]] = defaultdict(list)
    for r in tab.rows:
        for c in r:
            key = color_key(c)
            if is_blank(c.value):
                if not is_default_color(key):
                    empty_styled[key] += 1
                continue
            filled[key] += 1
            by_key[key].append(c)
    print(f"{'type':<8} {'rgb':<12} {'theme':<6} {'tint':<6} count  (cells with a value)")
    for key, n in sorted(filled.items(), key=lambda kv: -kv[1]):
        ctype, rgb, theme, tint = key
        tag = "default" if is_default_color(key) else "NON-DEFAULT"
        print(f"{ctype!s:<8} {rgb!s:<12} {theme!s:<6} {tint!s:<6} {n:<5}  {tag}")
    non_default = [(k, cells) for k, cells in by_key.items() if not is_default_color(k)]
    if not non_default:
        print("No non-default font colors in data cells.")
    for key, cells in non_default:
        print(f"Cells with color {key}:")
        for c in cells:
            print(f"  {c.coordinate:<5} {tab.label(c.column - 1):<20} {c.value!r}")
    for key, n in empty_styled.items():
        print(f"Note: {n} empty cell(s) carry non-default color {key} (no value to flag).")


def profile_mixed(tab: Tab) -> None:
    sub("4. Mostly numeric columns that contain text")
    found = False
    for i in range(len(tab.headers)):
        vals = [r[i] for r in tab.rows if not is_blank(r[i].value)]
        nums = [c for c in vals if is_number(c.value)]
        texts = [c for c in vals if isinstance(c.value, str)]
        if nums and texts and len(nums) >= len(texts):
            found = True
            ex = ", ".join(f"{c.coordinate}={c.value!r}" for c in texts)
            print(f"{tab.label(i)}: {len(nums)} numeric, {len(texts)} text -> {ex}")
    if not found:
        print("None.")
    # Text columns whose values look like numbers with units or separators.
    for i in range(len(tab.headers)):
        vals = [r[i] for r in tab.rows if not is_blank(r[i].value)]
        if vals and all(isinstance(c.value, str) for c in vals) and all(
            re.search(r"\d", c.value) for c in vals
        ) and not re.search(r"phone|address|zoning|#", tab.label(i), re.IGNORECASE):
            ex = ", ".join(f"{c.coordinate}={c.value!r}" for c in vals)
            print(f"Also: {tab.label(i)} is all text but numeric-looking -> {ex}")


def profile_address_notes(tab: Tab) -> None:
    sub("5. Rows with no address, and every note")
    addr = tab.col(ADDRESS_HEADER)
    status = tab.col(STATUS_HEADER)
    notes = tab.col(NOTES_HEADER)
    if not addr:
        print("No Address column.")
    else:
        a = addr[0]
        missing = [r for r in tab.rows if is_blank(r[a].value) or r[a].value in PLACEHOLDERS]
        print(f"Rows with no address: {len(missing)}")
        for r in missing:
            st = r[status[0]].value if status else "n/a"
            nt = r[notes[0]].value if notes else "n/a"
            print(f"  row {r[0].row}: address={r[a].value!r} status={st!r} notes={nt!r}")
    if not notes:
        print("No Notes column.")
        return
    n = notes[0]
    print("Notes:")
    for r in tab.rows:
        print(f"  row {r[0].row}: {r[n].value!r}")


# ---------- target_weekly_view comparison ----------

def norm(value: object) -> object:
    if isinstance(value, str):
        return value.strip()
    if is_number(value):
        return round(float(value), 4)
    return value


def similarity(a: object, b: object) -> float:
    if is_blank(a) or is_blank(b):
        return 0.0
    if norm(a) == norm(b):
        return 1.0
    if isinstance(a, str) and isinstance(b, str):
        return SequenceMatcher(None, a.lower(), b.lower()).ratio()
    return 0.0


def row_score(target: list[Cell], source: list[Cell]) -> float:
    """How well a source row explains a target row: best similarity per target cell."""
    score = 0.0
    for t in target:
        if is_blank(t.value) or t.value in PLACEHOLDERS:
            continue
        score += max((similarity(t.value, s.value) for s in source), default=0.0)
    return score


def compare_target(tabs: dict[str, Tab]) -> None:
    target = tabs[TARGET_TAB]
    clients = [tabs[n] for n in CLIENT_TABS if n in tabs]
    section(f"{TARGET_TAB} vs client tabs")

    # Match each target row to its most similar source row (data-driven, no rules).
    matches: list[tuple[list[Cell], Tab, list[Cell], float]] = []
    for trow in target.rows:
        best = max(
            ((tab, srow, row_score(trow, srow)) for tab in clients for srow in tab.rows),
            key=lambda x: x[2],
        )
        matches.append((trow, *best))

    sub("Row matching (target row -> best source row, similarity score)")
    for trow, tab, srow, score in matches:
        addr = trow[target.headers.index("Address")].value if "Address" in target.headers else None
        print(f"  target row {trow[0].row} ({addr!r}) -> {tab.name} row {srow[0].row}  score={score:.2f}")

    # Column mapping: per target column and client tab, the source column whose
    # values agree best with the matched rows.
    sub("Column mapping (target column -> source column per client tab)")
    mapping: dict[tuple[int, str], int | None] = {}
    header = f"{'target column':<14}" + "".join(f"{t.name:<26}" for t in clients)
    print(header)
    for ti, th in enumerate(target.headers):
        if is_blank(th):
            continue
        line = f"{th!s:<14}"
        for tab in clients:
            pairs = [(t[ti], s) for t, s_tab, s, _ in matches if s_tab is tab
                     and not is_blank(t[ti].value) and t[ti].value not in PLACEHOLDERS]
            if not pairs:
                mapping[(ti, tab.name)] = None
                line += f"{'(no matched rows)':<26}"
                continue
            scored = []
            for si in range(len(tab.headers)):
                exact = sum(1 for t, s in pairs if norm(t.value) == norm(s[si].value))
                sim = sum(similarity(t.value, s[si].value) for t, s in pairs)
                scored.append((exact, sim, si))
            exact, sim, si = max(scored)
            if sim < 0.5 * len(pairs):
                mapping[(ti, tab.name)] = None
                line += f"{'none (tab name prefix?)':<26}"
            else:
                mapping[(ti, tab.name)] = si
                cell = f"{tab.label(si)} ({exact}/{len(pairs)} exact)"
                line += f"{cell:<26}"
        print(line)
    vertical_cols = [i for i, h in enumerate(target.headers) if h == "Vertical"]
    if vertical_cols:
        vi = vertical_cols[0]
        seen = defaultdict(set)
        for trow, tab, _, _ in matches:
            seen[trow[vi].value].add(tab.name)
        print("Vertical values vs the tab their rows matched: "
              + "; ".join(f"{v!r} -> {sorted(t)}" for v, t in seen.items()))

    sub("Source rows included / left out")
    used = {(tab.name, srow[0].row) for _, tab, srow, _ in matches}
    for tab in clients:
        st = tab.col(STATUS_HEADER)
        ad = tab.col(ADDRESS_HEADER)
        for srow in tab.rows:
            mark = "INCLUDED " if (tab.name, srow[0].row) in used else "left out "
            status = srow[st[0]].value if st else None
            addr = srow[ad[0]].value if ad else None
            print(f"  {mark} {tab.name:<22} row {srow[0].row}: status={status!r:<20} address={addr!r}")

    sub("Values that differ between target and source")
    any_diff = False
    for trow, tab, srow, _ in matches:
        for ti, th in enumerate(target.headers):
            if is_blank(th):
                continue
            si = mapping.get((ti, tab.name))
            tval = trow[ti].value
            if si is None:
                continue
            sval = srow[si].value
            if norm(tval) == norm(sval):
                continue
            any_diff = True
            kind = "blank shown as '-'" if tval in PLACEHOLDERS and is_blank(sval) else "differs"
            print(f"  target {trow[ti].coordinate} {th}: {tval!r}\n"
                  f"    source {tab.name}!{srow[si].coordinate} {tab.label(si)}: {sval!r}  [{kind}]")
    if not any_diff:
        print("  None.")


# ---------- vertical evidence ----------

def vertical_evidence(wb: openpyxl.Workbook, tabs: dict[str, Tab]) -> None:
    section("Vertical: config tab and other evidence")
    config = [n for n in wb.sheetnames if "config" in n.lower()]
    print(f"Sheets: {wb.sheetnames}")
    print(f"Config tab present: {'yes ' + str(config) if config else 'no'}")
    hidden = [ws.title for ws in wb.worksheets if ws.sheet_state != "visible"]
    print(f"Hidden sheets: {hidden or 'none'}")
    print(f"Defined names: {list(wb.defined_names.keys()) or 'none'}")
    p = wb.properties
    print(f"Doc properties: title={p.title!r} subject={p.subject!r} keywords={p.keywords!r} "
          f"category={p.category!r} description={p.description!r}")
    vert_cols = {n: t.col(re.compile(r"vertical|business|line", re.IGNORECASE)) for n, t in tabs.items()}
    print(f"Columns named like vertical/business line: "
          f"{ {n: [tabs[n].label(i) for i in c] for n, c in vert_cols.items() if c} or 'none'}")
    for name in CLIENT_TABS:
        tab = tabs.get(name)
        if not tab:
            continue
        prefix = name.split("_", 1)[0]
        ci = [i for i, h in enumerate(tab.headers) if h == "Client name"]
        clients = Counter(r[ci[0]].value for r in tab.rows) if ci else {}
        mi = [i for i, h in enumerate(tab.headers) if h == "Metro"]
        metros = Counter(r[mi[0]].value for r in tab.rows) if mi else {}
        others = set().union(*(set(tabs[o].headers) for o in CLIENT_TABS if o != name and o in tabs))
        unique = [h for h in tab.headers if h not in others and not is_blank(h)]
        print(f"{name}: prefix={prefix!r} Client name={dict(clients)} Metro={dict(metros)} "
              f"columns only in this tab={unique}")


def main() -> int:
    path = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_PATH
    if not path.exists():
        print(f"Workbook not found: {path}", file=sys.stderr)
        return 1
    before = sha256(path)
    wb = openpyxl.load_workbook(path, data_only=False)  # never saved
    tabs = {ws.title: Tab(ws) for ws in wb.worksheets}

    print(f"Workbook: {path}\nsha256: {before}")
    vertical_evidence(wb, tabs)
    for name, tab in tabs.items():
        section(f"Tab: {name}")
        profile_structure(tab)
        profile_status(tab)
        profile_colors(tab)
        profile_mixed(tab)
        profile_address_notes(tab)
    if TARGET_TAB in tabs:
        compare_target(tabs)

    after = sha256(path)
    section("Integrity")
    print(f"Workbook unchanged: {before == after}")
    return 0 if before == after else 2


if __name__ == "__main__":
    sys.exit(main())
