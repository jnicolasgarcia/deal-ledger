"""Status -> deal_stage normalization (ASSUMPTIONS.md section 1).

Lookup is case-insensitive: trim, collapse repeated spaces, lowercase.
Blank maps to unknown (not flagged). A value that doesn't match, or that
is listed as unmappable, maps to unknown and is flagged.
"""

from __future__ import annotations

from typing import NamedTuple

STAGES = (
    "sourcing",
    "in_pipeline",
    "pre_loi",
    "negotiating_loi",
    "negotiating_psa",
    "in_contract",
    "closed",
    "on_hold",
    "unknown",
)

# Keys are already normalized (see normalize_key). None = known but unmappable.
STATUS_MAP: dict[str, str | None] = {
    "sourcing": "sourcing",
    "in pipeline": "in_pipeline",
    "pre loi": "pre_loi",
    "negotiating loi": "negotiating_loi",
    "negotiating psa": "negotiating_psa",
    "nego psa": "negotiating_psa",
    "in contract": "in_contract",
    "under contract": "in_contract",
    "closed": "closed",
    "on hold": "on_hold",
    "listed": None,  # not an acquisition stage; client appears to be selling
}


class StageResult(NamedTuple):
    stage: str          # a value of STAGES
    stage_raw: str | None  # original text, unchanged
    flagged: bool       # True when a non-blank value couldn't be mapped
    reason: str | None


def normalize_key(raw: str) -> str:
    return " ".join(raw.split()).lower()


def normalize_stage(raw: object) -> StageResult:
    if raw is None:
        return StageResult("unknown", None, False, None)
    stage_raw = raw if isinstance(raw, str) else str(raw)
    key = normalize_key(stage_raw)
    if key == "":
        return StageResult("unknown", stage_raw, False, None)
    if key not in STATUS_MAP:
        return StageResult("unknown", stage_raw, True, f"unmapped status {stage_raw!r}")
    mapped = STATUS_MAP[key]
    if mapped is None:
        return StageResult("unknown", stage_raw, True,
                           f"status {stage_raw!r} is not an acquisition stage")
    return StageResult(mapped, stage_raw, False, None)
