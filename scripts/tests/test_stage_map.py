from pathlib import Path

import pytest

from stage_map import STAGES, STATUS_MAP, normalize_stage


@pytest.mark.parametrize("raw, stage", [
    # Every spelling found in the workbook (ASSUMPTIONS.md section 1).
    ("Sourcing", "sourcing"),
    ("sourcing", "sourcing"),
    ("SOURCING", "sourcing"),
    ("In Pipeline", "in_pipeline"),
    ("in pipeline", "in_pipeline"),
    ("pre loi", "pre_loi"),
    ("Negotiating LOI", "negotiating_loi"),
    ("Negotiating PSA", "negotiating_psa"),
    ("nego PSA", "negotiating_psa"),
    ("In Contract", "in_contract"),
    ("Under Contract", "in_contract"),
    ("On Hold", "on_hold"),
    # Case-insensitive lookup with trimming and collapsed spaces.
    ("NEGOTIATING PSA", "negotiating_psa"),
    ("  Negotiating   PSA ", "negotiating_psa"),
    ("closed", "closed"),
])
def test_mapped(raw, stage):
    res = normalize_stage(raw)
    assert res.stage == stage
    assert res.stage_raw == raw  # original kept exactly
    assert res.flagged is False


@pytest.mark.parametrize("raw", ["Listed", "LISTED", "Dead", "LOI sent", "123"])
def test_unmappable_is_unknown_and_flagged(raw):
    res = normalize_stage(raw)
    assert res.stage == "unknown"
    assert res.stage_raw == raw
    assert res.flagged is True
    assert res.reason


@pytest.mark.parametrize("raw", [None, "", "   "])
def test_blank_is_unknown_not_flagged(raw):
    res = normalize_stage(raw)
    assert res.stage == "unknown"
    assert res.stage_raw == raw
    assert res.flagged is False


def test_non_string_raw_kept_as_text():
    res = normalize_stage(42)
    assert (res.stage, res.stage_raw, res.flagged) == ("unknown", "42", True)


WORKBOOK = Path(__file__).resolve().parents[2] / "data" / "source.xlsx"

# Every Status value profile_workbook.py found, and where ASSUMPTIONS.md sends it.
EXPECTED_FROM_PROFILE = {
    "Sourcing": "sourcing", "sourcing": "sourcing", "SOURCING": "sourcing",
    "In Pipeline": "in_pipeline", "in pipeline": "in_pipeline",
    "pre loi": "pre_loi",
    "Negotiating LOI": "negotiating_loi",
    "Negotiating PSA": "negotiating_psa", "nego PSA": "negotiating_psa",
    "In Contract": "in_contract", "Under Contract": "in_contract",
    "On Hold": "on_hold",
    "Listed": "unknown",
}


@pytest.mark.skipif(not WORKBOOK.exists(), reason="data/source.xlsx not present (not committed)")
def test_every_status_in_workbook_is_known():
    import openpyxl

    wb = openpyxl.load_workbook(WORKBOOK, read_only=True, data_only=True)
    found = set()
    for tab in ("food_clientA_nyc", "av_clientC_atl", "catering_clientB_jfk"):
        rows = wb[tab].iter_rows(values_only=True)
        col = list(next(rows)).index("Status")
        found |= {r[col] for r in rows if r[col] is not None}
    wb.close()
    assert found == set(EXPECTED_FROM_PROFILE), f"new or missing spellings: {found ^ set(EXPECTED_FROM_PROFILE)}"
    for raw in found:
        res = normalize_stage(raw)
        assert res.stage == EXPECTED_FROM_PROFILE[raw], raw
        assert res.stage_raw == raw
        assert res.flagged is (raw == "Listed")


def test_map_targets_are_valid_enum_values():
    assert all(v is None or v in STAGES for v in STATUS_MAP.values())
